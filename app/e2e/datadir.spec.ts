/**
 * 验收：数据目录搬到别的盘（例如 D 盘）。
 * 覆盖：默认位置解析、搬迁（复制 + 原位置保留）、直接沿用已有数据、恢复默认位置、
 *       界面上的「更改数据目录…」流程，以及重启后真的用新位置。
 */

import { expect, test, type Page } from '@playwright/test'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { APP_ROOT, SHOT_DIR, goto, launchAppAtHome, seed, type Launched } from './helpers'

const TMP = path.join(APP_ROOT, '.e2e-tmp-datadir')

interface AppInfo {
  dataDir: string
  databaseFile: string
  photosDir: string
  backupsDir: string
  dataDirIsCustom: boolean
  defaultDataDir: string
}

interface RelocateResult {
  ok: boolean
  dataDir: string
  copiedFiles: number
  adopted: boolean
  needsRestart: boolean
  error?: string
}

async function info(page: Page): Promise<AppInfo> {
  return seed<AppInfo>(page, 'app:info')
}

function pointer(home: string): { dataDir: string; movedAt: string; note?: string } | null {
  const file = path.join(home, 'location.json')
  if (!existsSync(file)) return null
  return JSON.parse(readFileSync(file, 'utf8')) as { dataDir: string; movedAt: string; note?: string }
}

test.describe.configure({ mode: 'serial' })

test.describe('数据目录可以搬走', () => {
  let ctx: Launched
  const home = path.join(TMP, 'home')
  const onD = path.join(TMP, 'D-盘-数据')
  const adoptSource = path.join(TMP, '已有数据')

  test.beforeAll(() => {
    rmSync(TMP, { recursive: true, force: true })
    mkdirSync(home, { recursive: true })
    mkdirSync(onD, { recursive: true })
  })

  test.afterAll(async () => {
    if (ctx) await ctx.app.close()
  })

  test('默认位置与「搬到别的盘」：复制过去、原位置保留、重启后生效', async () => {
    ctx = await launchAppAtHome(home, { seedSamples: true })
    const page = ctx.page

    // 1) 默认就在 HOME 目录，没有「自定义」标记
    const base = await info(page)
    expect(base.dataDir).toBe(home)
    expect(base.defaultDataDir).toBe(home)
    expect(base.dataDirIsCustom).toBe(false)
    expect(existsSync(path.join(home, 'database.sqlite'))).toBe(true)
    expect(pointer(home)).toBeNull()

    // 2) 检查目标目录
    const inspect = await seed<{ exists: boolean; hasDatabase: boolean; error?: string }>(
      page,
      'dataDir:inspect',
      onD
    )
    expect(inspect.exists).toBe(true)
    expect(inspect.hasDatabase).toBe(false)
    expect(inspect.error).toBeUndefined()

    // 3) 不许把数据目录放进自己里面
    const bad = await seed<RelocateResult>(page, 'dataDir:relocate', path.join(home, 'sub'))
    expect(bad.ok).toBe(false)
    expect(bad.error).toContain('里面')

    // 4) 真的搬过去
    const moved = await seed<RelocateResult>(page, 'dataDir:relocate', onD)
    expect(moved.ok, moved.error ?? '').toBe(true)
    expect(moved.adopted).toBe(false)
    expect(moved.copiedFiles).toBeGreaterThan(0)
    expect(moved.needsRestart).toBe(true)

    // 目标目录里有完整的一套数据
    expect(existsSync(path.join(onD, 'database.sqlite'))).toBe(true)
    expect(existsSync(path.join(onD, 'settings.json'))).toBe(true)
    expect(existsSync(path.join(onD, 'seed.json'))).toBe(true)
    expect(readdirSync(path.join(onD, 'photos')).length).toBe(2)
    expect(existsSync(path.join(onD, 'backups'))).toBe(true)
    // 缓存目录不搬（runtime/tmp），免得白拷几百兆
    expect(existsSync(path.join(onD, 'runtime'))).toBe(false)

    // 原位置保留一份，指针指到新目录
    expect(existsSync(path.join(home, 'database.sqlite'))).toBe(true)
    expect(pointer(home)?.dataDir).toBe(onD)
    // 没重启之前，程序仍然用老目录
    expect((await info(page)).dataDir).toBe(home)

    // 5) 重启后真的用新目录，数据一条不少
    await ctx.app.close()
    ctx = await launchAppAtHome(home)
    const after = await info(ctx.page)
    expect(after.dataDir).toBe(onD)
    expect(after.dataDirIsCustom).toBe(true)
    expect(after.databaseFile).toBe(path.join(onD, 'database.sqlite'))
    const samples = await seed<{ matches: number; events: number; honors: number; photos: number }>(
      ctx.page,
      'samples:status'
    )
    expect(samples.matches).toBe(10)
    expect(samples.events).toBe(3)
    expect(samples.honors).toBe(2)
    expect(samples.photos).toBe(2)
    // 设置也跟着走（皮肤写在 settings.json 里）
    const settings = await seed<{ theme: string }>(ctx.page, 'settings:get')
    expect(settings.theme).toBe('handbook')

    // 界面上的「数据与关于」会标出这是自定义位置
    await goto(ctx.page, 'settings')
    await expect(ctx.page.locator('[data-testid="data-dir-custom-badge"]')).toHaveCount(1)
    await expect(ctx.page.locator('[data-testid="data-dir-reset"]')).toHaveCount(1)
    // 单独给「数据与关于」面板出一张图（它在页面底部，整屏截图看不到）
    const about = ctx.page.locator('[data-testid="settings-about"]')
    await about.scrollIntoViewIfNeeded()
    await ctx.page.waitForTimeout(300)
    mkdirSync(SHOT_DIR, { recursive: true })
    await about.screenshot({ path: path.join(SHOT_DIR, '23-设置-数据目录.png') })
  })

  test('目标目录里已经有数据时直接沿用，不复制不覆盖', async () => {
    const page = ctx.page
    const current = (await info(page)).dataDir
    expect(current).toBe(onD)

    // 把当前数据复制一份到另一个目录，模拟「我以前已经把数据放到别处了」
    mkdirSync(adoptSource, { recursive: true })
    for (const entry of readdirSync(onD)) {
      if (entry === 'runtime' || entry === 'tmp') continue
      const src = path.join(onD, entry)
      const dest = path.join(adoptSource, entry)
      rmSync(dest, { recursive: true, force: true })
      cpSync(src, dest, { recursive: true })
    }
    expect(existsSync(path.join(adoptSource, 'database.sqlite'))).toBe(true)

    const inspect = await seed<{ hasDatabase: boolean; matchesInTarget: number; photosInTarget: number }>(
      page,
      'dataDir:inspect',
      adoptSource
    )
    expect(inspect.hasDatabase).toBe(true)
    expect(inspect.matchesInTarget).toBe(10)
    expect(inspect.photosInTarget).toBe(2)

    const moved = await seed<RelocateResult>(page, 'dataDir:relocate', adoptSource)
    expect(moved.ok, moved.error ?? '').toBe(true)
    expect(moved.adopted).toBe(true)
    expect(moved.copiedFiles).toBe(0)
    expect(pointer(home)?.dataDir).toBe(adoptSource)

    // 原目录（D 盘那份）没有被删掉
    expect(existsSync(path.join(onD, 'database.sqlite'))).toBe(true)

    await ctx.app.close()
    ctx = await launchAppAtHome(home)
    expect((await info(ctx.page)).dataDir).toBe(adoptSource)
    expect((await seed<{ matches: number }>(ctx.page, 'samples:status')).matches).toBe(10)
  })

  test('恢复默认位置：数据搬回 %APPDATA%\\DebateNotes', async () => {
    const page = ctx.page
    const result = await seed<RelocateResult>(page, 'dataDir:reset')
    expect(result.ok, result.error ?? '').toBe(true)
    // HOME 里本来还留着最早那份数据，所以这里是「沿用已有数据」
    expect(pointer(home)?.dataDir).toBe(home)
    expect(pointer(home)?.note).toContain('默认位置')

    await ctx.app.close()
    ctx = await launchAppAtHome(home)
    const after = await info(ctx.page)
    expect(after.dataDir).toBe(home)
    expect(after.dataDirIsCustom).toBe(false)
    expect((await seed<{ matches: number }>(ctx.page, 'samples:status')).matches).toBe(10)
    await goto(ctx.page, 'settings')
    await expect(ctx.page.locator('[data-testid="data-dir-custom-badge"]')).toHaveCount(0)
    await expect(ctx.page.locator('[data-testid="data-dir-reset"]')).toHaveCount(0)
  })

  test('界面流程：选目录 → 确认 → 提示重启（不重启也能先用着）', async () => {
    const page = ctx.page
    const uiTarget = path.join(TMP, '界面选择的目录')
    mkdirSync(uiTarget, { recursive: true })

    // 只替换系统文件夹对话框，搬迁代码路径照旧
    await ctx.app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as typeof dialog.showOpenDialog
    }, uiTarget)

    await goto(page, 'settings')
    await page.click('[data-testid="data-dir-change"]')
    await expect(page.locator('[data-testid="confirm-dialog"]')).toContainText(uiTarget)
    await page.click('[data-testid="confirm-ok"]')
    await expect(page.locator('[data-testid="data-dir-done"]')).toContainText('数据目录已切换')
    // 选择「稍后手动重启」：提示写进 toast，程序继续可用
    await page.click('[data-testid="confirm-cancel"]')
    await expect(page.locator('[data-testid="toast-info"]')).toContainText('重启程序后生效')

    expect(pointer(home)?.dataDir).toBe(uiTarget)
    expect(existsSync(path.join(uiTarget, 'database.sqlite'))).toBe(true)
    // 程序照常能用：界面还能读数据
    await goto(page, 'matches')
    await expect(page.locator('[data-testid="page-matches"]')).toHaveCount(1)
  })

  test('取消选择目录时什么也不做', async () => {
    const page = ctx.page
    const before = pointer(home)?.dataDir
    await ctx.app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = (async () => ({ canceled: true, filePaths: [] })) as typeof dialog.showOpenDialog
    })
    await goto(page, 'settings')
    await page.click('[data-testid="data-dir-change"]')
    await expect(page.locator('[data-testid="confirm-dialog"]')).toHaveCount(0)
    expect(pointer(home)?.dataDir).toBe(before)
  })
})

