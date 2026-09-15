/**
 * 验收：背景照片与轮播、设置持久化、备份导出与恢复、损坏备份不覆盖、窗口尺寸变化后的可读性。
 */

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { APP_ROOT, freshDataDir, goto, launchApp, readDbCounts, readSettingsFile, restart, screenshot, seed, type Launched } from './helpers'

const TMP = path.join(APP_ROOT, '.e2e-tmp')
const SOURCE_PHOTO = path.resolve(APP_ROOT, '..', 'sources', '参考照片-01.jpg')

let ctx: Launched

async function stubOpenDialog(app: ElectronApplication, filePaths: string[]): Promise<void> {
  await app.evaluate(({ dialog }, paths) => {
    ;(dialog as unknown as Record<string, unknown>).showOpenDialog = async () => ({
      canceled: (paths as string[]).length === 0,
      filePaths: paths as string[]
    })
  }, filePaths)
}

async function stubSaveDialog(app: ElectronApplication, filePath: string): Promise<void> {
  await app.evaluate(({ dialog }, p) => {
    ;(dialog as unknown as Record<string, unknown>).showSaveDialog = async () => ({
      canceled: false,
      filePath: p as string
    })
  }, filePath)
}

async function resizeWindow(app: ElectronApplication, width: number, height: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setSize((size as number[])[0], (size as number[])[1])
  }, [width, height] as number[])
  await new Promise((r) => setTimeout(r, 700))
}

/** range 输入用原生 setter + input 事件，React 的 onChange 才会收到 */
async function setRange(page: Page, testId: string, value: number): Promise<void> {
  await page.locator(`[data-testid="${testId}"]`).evaluate((el, v) => {
    const input = el as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, String(v))
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}

async function dismissToasts(page: Page): Promise<void> {
  const toasts = page.locator('[data-testid^="toast-"]')
  for (const t of await toasts.all()) {
    await t.click().catch(() => undefined)
  }
  await expect(toasts).toHaveCount(0)
}

/** 布局与可读性检查：无横向溢出、面板底色足够不透明、正文文字可见 */
async function assertReadable(page: Page, label: string): Promise<void> {
  const report = await page.evaluate(() => {
    const doc = document.documentElement
    const panel = document.querySelector('.panel') as HTMLElement | null
    const body = [...document.querySelectorAll('.panel__body, .list__topic-main')].find(
      (el) => (el as HTMLElement).offsetParent !== null
    ) as HTMLElement | undefined
    const bg = panel ? getComputedStyle(panel).backgroundColor : ''
    // 新版 Chromium 会把 color-mix() 的结果输出成 color(srgb r g b / a)，两种写法都要能读
    const rgba = bg.match(/rgba?\(([^)]+)\)/)
    let alpha = 0
    if (rgba) {
      const parts = rgba[1].split(',').map((s) => Number(s.trim()))
      alpha = parts.length === 4 ? parts[3] : parts.length === 3 ? 1 : 0
    } else if (/color\(/.test(bg)) {
      const slash = bg.match(/\/\s*([\d.]+%?)\s*\)/)
      alpha = slash ? (slash[1].endsWith('%') ? Number(slash[1].slice(0, -1)) / 100 : Number(slash[1])) : 1
    }
    const txt = body ? getComputedStyle(body).color : ''
    return {
      overflowX: doc.scrollWidth - doc.clientWidth,
      panelAlpha: alpha,
      panelBg: bg,
      textColor: txt,
      viewport: { w: window.innerWidth, h: window.innerHeight }
    }
  })
  expect(report.overflowX, `${label}: 不应出现横向滚动`).toBeLessThanOrEqual(1)
  expect(report.panelAlpha, `${label}: 面板底色应基本不透明（实际 ${report.panelBg}）`).toBeGreaterThanOrEqual(0.5)
  expect(report.textColor).not.toBe('')
  expect(report.viewport.w).toBeGreaterThan(900)
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  // 每轮清空临时目录：从只读的 sources 复制会继承只读属性，残留文件会让下次复制 EPERM
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(TMP, { recursive: true })
  copyFileSync(SOURCE_PHOTO, path.join(TMP, 'my-new-bg.jpg'))
  copyFileSync(SOURCE_PHOTO, path.join(TMP, 'my-new-bg-2.jpg'))
  ctx = await launchApp(freshDataDir('system'))

  // 一份用于备份/恢复校验的数据
  const event = await seed<{ id: number }>(ctx.page, 'events:create', { name: '备份测试赛事', result: '四强', note: '' })
  await seed(ctx.page, 'matches:create', {
    date: '2026-08-01',
    startTime: '09:00',
    topic: '备份前就存在的比赛',
    category: '正赛',
    eventId: event.id,
    side: '正方',
    position: '一辩',
    status: '胜',
    isBestDebater: true,
    comment: '备份测试'
  })
  await seed(ctx.page, 'matches:create', {
    date: '2026-08-02',
    startTime: null,
    topic: '备份前就存在的第二场',
    category: '模拟赛',
    eventId: null,
    side: null,
    position: null,
    status: '负',
    isBestDebater: false,
    comment: ''
  })
  await seed(ctx.page, 'honors:create', { name: '最佳辩手', date: '2026-08-03', eventId: event.id, note: '备份荣誉' })

  // 经 IPC 造的数据要重启一次，让界面的数据切片重新加载
  ctx = await restart(ctx)
})

test.afterAll(async () => {
  if (ctx) await ctx.app.close()
})

test('初始：没有背景照片，也不显示背景图', async () => {
  const { page } = ctx
  await goto(page, 'settings')
  await expect(page.locator('[data-testid="settings-background"]')).toContainText('还没有背景照片')
  await expect(page.locator('[data-testid="bg-image"]')).toHaveCount(0)

  await screenshot(page, '08-设置')
})

test('批量添加照片：复制到数据目录，原文件移走仍可显示', async () => {
  const { page, app } = ctx
  const source = path.join(TMP, 'my-new-bg.jpg')
  const source2 = path.join(TMP, 'my-new-bg-2.jpg')
  await stubOpenDialog(app, [source, source2])

  await goto(page, 'settings')
  await page.click('[data-testid="bg-add"]')
  await expect(page.locator('[data-testid="bg-cards"] .bg-card')).toHaveCount(2)
  await expect(page.locator('[data-testid="bg-cards"]')).toContainText('my-new-bg.jpg')
  await expect(page.locator('[data-testid="bg-cards"]')).toContainText('my-new-bg-2.jpg')

  // 已复制进 photos 目录
  const copied = await page.evaluate(async () => {
    const list = (await (globalThis as unknown as { api: { invoke: (c: string) => Promise<unknown> } }).api.invoke(
      'backgrounds:list'
    )) as Array<{ fileName: string; originalName: string; url: string }>
    return list.map((p) => p.fileName)
  })
  expect(copied).toHaveLength(2)
  for (const f of copied) {
    expect(existsSync(path.join(ctx.dataDir, 'photos', f))).toBe(true)
  }

  // 删除原文件后仍然可以显示（照片已复制）；第 1 张导入时已自动设为当前，所以切到第 2 张
  rmSync(source, { force: true })
  rmSync(source2, { force: true })
  await ctx.app.close()
  ctx = await launchApp(ctx.dataDir)
  await goto(ctx.page, 'settings')
  await ctx.page.click('[data-testid="bg-set-active-2"]')
  await expect(ctx.page.locator('[data-testid="bg-image"][data-active="true"]')).toHaveAttribute('data-photo-id', '2')
  const width = await ctx.page.evaluate(
    () => (document.querySelector('[data-testid="bg-image"][data-active="true"]') as HTMLImageElement).naturalWidth
  )
  expect(width).toBe(660)
})

test('手动切换与圆点切换背景', async () => {
  const { page } = ctx
  await goto(page, 'settings')

  // 承接上一个用例：当前是第 2 张，两张照片循环切换
  await expect(page.locator('[data-testid="bg-image"][data-active="true"]')).toHaveAttribute('data-photo-id', '2')
  await page.click('[data-testid="bg-next"]')
  await expect(page.locator('[data-testid="bg-image"][data-active="true"]')).toHaveAttribute('data-photo-id', '1')
  await page.click('[data-testid="bg-prev"]')
  await expect(page.locator('[data-testid="bg-image"][data-active="true"]')).toHaveAttribute('data-photo-id', '2')

  await page.click('[data-testid="bg-dot-1"]')
  await expect(page.locator('[data-testid="bg-image"][data-active="true"]')).toHaveAttribute('data-photo-id', '1')
  await page.click('[data-testid="bg-cycle"]')
  await expect(page.locator('[data-testid="bg-image"][data-active="true"]')).toHaveAttribute('data-photo-id', '2')
})

test('轮播间隔、暂停与不透明度都会记住', async () => {
  const { page } = ctx
  await goto(page, 'settings')

  await page.click('[data-testid="bg-interval-1"]')
  await expect
    .poll(async () => (await readSettingsFile(ctx.dataDir)).rotationIntervalMs)
    .toBe(60_000)

  await page.fill('[data-testid="bg-interval"]', '2')
  await expect
    .poll(async () => (await readSettingsFile(ctx.dataDir)).rotationIntervalMs)
    .toBe(120_000)

  await setRange(page, 'bg-opacity', 30)
  await expect.poll(async () => (await readSettingsFile(ctx.dataDir)).backgroundOpacity).toBe(0.3)
  await setRange(page, 'bg-blur', 8)
  await expect.poll(async () => (await readSettingsFile(ctx.dataDir)).backgroundBlur).toBe(8)

  await page.click('[data-testid="rotation-toggle"]')
  await expect.poll(async () => (await readSettingsFile(ctx.dataDir)).rotationEnabled).toBe(false)
  await expect(page.locator('[data-testid="rotation-toggle"]')).toContainText('继续轮播')

  // 背景不显示 → 没有激活的图
  // 注意：设置写回是异步的，复选框会被短暂拨回旧值，所以用 click + 轮询设置文件
  await page.click('[data-testid="bg-enabled"]')
  await expect.poll(async () => (await readSettingsFile(ctx.dataDir)).backgroundEnabled).toBe(false)
  await expect(page.locator('[data-testid="bg-image"][data-active="true"]')).toHaveCount(0)

  ctx = await restart(ctx)
  await goto(ctx.page, 'settings')
  await expect(ctx.page.locator('[data-testid="bg-interval"]')).toHaveValue('2')
  await expect(ctx.page.locator('[data-testid="rotation-toggle"]')).toContainText('继续轮播')
  await expect(ctx.page.locator('[data-testid="bg-image"][data-active="true"]')).toHaveCount(0)
  await expect(ctx.page.locator('[data-testid="bg-cards"] .bg-card')).toHaveCount(2)
  await expect(ctx.page.locator('[data-testid="bg-enabled"]')).not.toBeChecked()
  await ctx.page.click('[data-testid="bg-enabled"]')
  await expect.poll(async () => (await readSettingsFile(ctx.dataDir)).backgroundEnabled).toBe(true)
})

test('导出完整备份，改动数据后从文件恢复（恢复前自动做安全备份）', async () => {
  const { page, app } = ctx
  const exportPath = path.join(TMP, '导出的完整备份.zip')
  rmSync(exportPath, { force: true })

  await goto(page, 'settings')
  await page.click('[data-testid="backup-now"]')
  await expect(page.locator('[data-testid="backup-list"]')).toContainText('手动')

  const before = await readDbCounts(ctx.dataDir)
  expect(before).toEqual({ matches: 2, events: 1, honors: 1, backgrounds: 2 })

  await stubSaveDialog(app, exportPath)
  await page.click('[data-testid="backup-export"]')
  await expect.poll(() => existsSync(exportPath)).toBe(true)
  expect(statSync(exportPath).size).toBeGreaterThan(1000)

  // 导出后破坏数据：删一场、加一场、删一条荣誉
  await goto(page, 'matches')
  await page.click('[data-testid="tab-matches"]')
  await page.fill('[data-testid="matches-search"]', '备份前就存在的第二场')
  await page.click('[data-testid="match-remove-2"]')
  await page.click('[data-testid="confirm-ok"]')
  await seed(page, 'matches:create', {
    date: '2026-08-09',
    startTime: null,
    topic: '备份之后新增的比赛',
    category: '正赛',
    eventId: null,
    side: null,
    position: null,
    status: '胜',
    isBestDebater: false,
    comment: ''
  })
  await expect.poll(async () => (await readDbCounts(ctx.dataDir)).matches).toBe(2)

  // 从导出的文件恢复
  await stubOpenDialog(app, [exportPath])
  await goto(page, 'settings')
  await page.click('[data-testid="backup-restore-file"]')
  await expect(page.locator('[data-testid="toast-success"]').filter({ hasText: '恢复完成' })).toBeVisible()

  await expect.poll(async () => (await readDbCounts(ctx.dataDir)).matches).toBe(2)
  const after = await readDbCounts(ctx.dataDir)
  expect(after).toEqual(before)

  await goto(page, 'matches')
  await page.fill('[data-testid="matches-search"]', '备份')
  const list = page.locator('[data-testid="matches-list"]')
  await expect(list).toContainText('备份前就存在的比赛')
  await expect(list).toContainText('备份前就存在的第二场')
  await expect(list).not.toContainText('备份之后新增的比赛')

  // 照片与设置也一起回来了，且存在一份「恢复前」安全备份
  await goto(page, 'settings')
  await expect(page.locator('[data-testid="bg-cards"] .bg-card')).toHaveCount(2)
  await expect(page.locator('[data-testid="backup-list"]')).toContainText('恢复前')
  await screenshot(page, '09-设置-备份列表')
})

test('损坏的备份不会覆盖现有数据', async () => {
  const { page, app } = ctx
  const good = path.join(TMP, '导出的完整备份.zip')
  const before = await readDbCounts(ctx.dataDir)

  // 情形一：文件被截断（结构损坏）
  const truncated = path.join(TMP, '截断的备份.zip')
  const bytes = readFileSync(good)
  writeFileSync(truncated, bytes.subarray(0, Math.floor(bytes.length / 2)))

  // 情形二：内容被篡改（CRC/解压校验失败）
  const tampered = path.join(TMP, '篡改的备份.zip')
  const copy = Buffer.from(bytes)
  for (let i = 0; i < 400; i++) copy[Math.floor(copy.length / 3) + i] = copy[Math.floor(copy.length / 3) + i] ^ 0xff
  writeFileSync(tampered, copy)

  // 情形三：是合法 zip，但不是本程序的备份
  const alien = path.join(TMP, '无关压缩包.zip')
  const alienDir = path.join(TMP, 'alien-src')
  mkdirSync(alienDir, { recursive: true })
  writeFileSync(path.join(alienDir, 'hello.txt'), '这不是备份')
  const { execFileSync } = await import('node:child_process')
  // 注意：这台机器上用默认的管道 stdio 捕获子进程输出会卡死，必须显式 ignore
  execFileSync(
    'powershell',
    ['-NoProfile', '-Command', `Compress-Archive -Path '${path.join(alienDir, 'hello.txt')}' -DestinationPath '${alien}' -Force`],
    { stdio: 'ignore' }
  )
  expect(existsSync(alien)).toBe(true)

  for (const file of [truncated, tampered, alien]) {
    await dismissToasts(page)
    await stubOpenDialog(app, [file])
    await goto(page, 'settings')
    await page.click('[data-testid="backup-restore-file"]')
    const errorToast = page.locator('[data-testid="toast-error"]')
    await expect(errorToast).toHaveCount(1)
    await expect(errorToast).not.toContainText('恢复完成')
    expect(errorToast).toBeTruthy()
    // 现有数据必须原样保留
    expect(await readDbCounts(ctx.dataDir)).toEqual(before)
  }
  await dismissToasts(page)

  // 数据仍可正常使用
  await goto(page, 'matches')
  await expect(page.locator('[data-testid="matches-list"]')).toContainText('备份前就存在的比赛')
})

test('窗口尺寸变化后布局正常、文字清楚', async () => {
  const { page, app } = ctx
  await goto(page, 'matches')

  for (const [w, h] of [
    [1024, 660],
    [1280, 800],
    [1900, 1100]
  ] as const) {
    await resizeWindow(app, w, h)
    await assertReadable(page, `${w}×${h}`)
    await screenshot(page, `10-窗口-${w}x${h}`)
  }

  // 缩到最小尺寸时，面板与文字仍然可见可用
  await resizeWindow(app, 1024, 660)
  await expect(page.locator('[data-testid="matches-search"]')).toBeVisible()
  await expect(page.locator('[data-testid="matches-list"]')).toBeVisible()

  // 背景层必须画在正文之下：否则页头标题与主按钮会被背景洗白（曾出现过这个缺陷）
  const bgZ = await page.evaluate(() => getComputedStyle(document.querySelector('.bg-layer') as Element).zIndex)
  expect(Number(bgZ)).toBeLessThan(0)

  // 绘制顺序的实测：临时让背景层参与命中测试，页头上方的第一个元素必须还是标题本身
  const stackTop = await page.evaluate(() => {
    const bg = document.querySelector('.bg-layer') as HTMLElement
    const title = document.querySelector('.page-head__title') as HTMLElement
    const prev = bg.style.pointerEvents
    bg.style.pointerEvents = 'auto'
    const r = title.getBoundingClientRect()
    const names = document
      .elementsFromPoint(r.x + Math.min(24, r.width / 2), r.y + r.height / 2)
      .map((el) => (typeof el.className === 'string' ? el.className : el.tagName))
    bg.style.pointerEvents = prev
    return names
  })
  expect(stackTop[0]).toContain('page-head__title')

  await resizeWindow(app, 1480, 940)
})

test('清空全部背景后重启仍为无照片状态', async () => {
  const { page } = ctx
  await goto(page, 'settings')
  await page.click('[data-testid="bg-clear"]')
  // 清空后设置页显示空状态（没有照片时不会渲染照片卡片区）
  await expect(page.locator('[data-testid="settings-background"]')).toContainText('还没有背景照片')
  await expect(page.locator('[data-testid="bg-image"]')).toHaveCount(0)
  expect((await readDbCounts(ctx.dataDir)).backgrounds).toBe(0)

  ctx = await restart(ctx)
  await goto(ctx.page, 'settings')
  await expect(ctx.page.locator('[data-testid="bg-image"]')).toHaveCount(0)
  await expect(ctx.page.locator('[data-testid="settings-background"]')).toContainText('还没有背景照片')
  expect((await readDbCounts(ctx.dataDir)).backgrounds).toBe(0)
})

test('自动备份每天首次启动才做一次，并按设置只保留最近几份', async () => {
  const dir = freshDataDir('autobak')
  const settingsFile = path.join(dir, 'settings.json')
  const backupsDir = path.join(dir, 'backups')
  const autoCount = (): number =>
    existsSync(backupsDir)
      ? readdirSync(backupsDir).filter((f) => f.startsWith('auto-') && f.endsWith('.zip')).length
      : 0

  // 没有数据时不做自动备份，所以先造一条比赛
  let launched = await launchApp(dir)
  await seed(launched.page, 'matches:create', {
    date: '2026-09-14',
    startTime: null,
    topic: '自动备份保留份数测试',
    category: '正赛',
    eventId: null,
    side: null,
    position: null,
    status: '胜',
    isBestDebater: false,
    comment: ''
  })
  await launched.app.close()

  // 连续模拟 5 天的「当天首次启动」：保留份数设为 3，只允许留下最近 3 份
  for (let day = 1; day <= 5; day++) {
    const s = JSON.parse(readFileSync(settingsFile, 'utf8')) as Record<string, unknown>
    s.lastAutoBackupDate = '2000-01-01'
    s.autoBackupKeep = 3
    writeFileSync(settingsFile, JSON.stringify(s, null, 2), 'utf8')

    launched = await launchApp(dir)
    await expect.poll(autoCount, { timeout: 20_000 }).toBe(Math.min(day, 3))
    await launched.app.close()
  }

  // 同一天内再次启动：不会再多做一份
  launched = await launchApp(dir)
  await launched.page.waitForTimeout(1500)
  expect(autoCount()).toBe(3)
  await launched.app.close()
})
