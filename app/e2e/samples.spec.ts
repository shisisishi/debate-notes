/**
 * 验收：首次启动的示例数据（含照片入库）、一键删除示例、多格式图片导入。
 */

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { APP_ROOT, freshDataDir, goto, launchApp, readDbCounts, readSettingsFile, screenshot, seed, type Launched } from './helpers'

const TMP = path.join(APP_ROOT, '.e2e-tmp-samples')

async function stubOpenDialog(app: ElectronApplication, filePaths: string[]): Promise<void> {
  await app.evaluate(({ dialog }, paths) => {
    ;(dialog as unknown as Record<string, unknown>).showOpenDialog = async () => ({
      canceled: (paths as string[]).length === 0,
      filePaths: paths as string[]
    })
  }, filePaths)
}

/** 用 Windows 自带的 GDI+ 生成各格式测试图片（含 TIFF，用于验证转码兜底） */
function makeTestImages(dir: string): string[] {
  const save = (name: string, fmt: string): string =>
    `$bmp.Save('${path.join(dir, name)}', [System.Drawing.Imaging.ImageFormat]::${fmt});`
  const script =
    'Add-Type -AssemblyName System.Drawing;' +
    '$bmp = New-Object System.Drawing.Bitmap 240,160;' +
    '$g = [System.Drawing.Graphics]::FromImage($bmp);' +
    '$g.Clear([System.Drawing.Color]::FromArgb(210,190,160));' +
    save('fmt.png', 'Png') +
    save('fmt.gif', 'Gif') +
    save('fmt.bmp', 'Bmp') +
    save('fmt.tiff', 'Tiff') +
    save('fmt.jpg', 'Jpeg') +
    '$g.Dispose(); $bmp.Dispose()'
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore', timeout: 60_000 })
  return ['fmt.png', 'fmt.gif', 'fmt.bmp', 'fmt.tiff', 'fmt.jpg'].map((f) => path.join(dir, f))
}

async function sampleStatus(page: Page): Promise<{ matches: number; events: number; honors: number; photos: number }> {
  return page.evaluate(async () =>
    (globalThis as unknown as { api: { invoke: (c: string) => Promise<unknown> } }).api.invoke('samples:status')
  ) as Promise<{ matches: number; events: number; honors: number; photos: number }>
}

async function photoList(page: Page): Promise<Array<{ fileName: string; originalName: string }>> {
  return page.evaluate(async () =>
    (globalThis as unknown as { api: { invoke: (c: string) => Promise<unknown> } }).api.invoke('backgrounds:list')
  ) as Promise<Array<{ fileName: string; originalName: string }>>
}

test.describe.configure({ mode: 'serial' })

test.describe('示例数据与多格式导入', () => {
  let ctx: Launched

  test.beforeAll(() => {
    rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
  })

  test.afterAll(async () => {
    if (ctx) await ctx.app.close()
  })

  test('首次启动写入示例数据：比赛、赛事、荣誉齐全，照片只入库不设为背景', async () => {
    ctx = await launchApp(freshDataDir('samples'), { seedSamples: true })
    const { page, dataDir } = ctx

    const counts = await readDbCounts(dataDir)
    expect(counts.matches).toBe(10)
    expect(counts.events).toBe(3)
    expect(counts.honors).toBe(2)
    expect(counts.backgrounds).toBe(2)

    // 照片进库了，但没有抢占当前背景：没有任何一张被设为显示
    expect((await photoList(page)).length).toBe(2)
    expect((await readSettingsFile(dataDir)).activeBackgroundId).toBeNull()
    await expect(page.locator('[data-testid="bg-image"][data-active="true"]')).toHaveCount(0)
    const opacities = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid="bg-image"]')).map(
        (el) => getComputedStyle(el as HTMLElement).opacity
      )
    )
    expect(opacities.length).toBe(2)
    expect(opacities.every((o) => Number(o) === 0)).toBe(true)

    // 比赛记录：每条示例都带「示例」标记
    await goto(page, 'matches')
    expect(await page.locator('[data-testid^="sample-tag-"]').count()).toBe(10)
    await screenshot(page, '12-示例数据-比赛记录')

    await page.click('[data-testid="tab-events"]')
    expect(await page.locator('[data-testid^="sample-tag-event-"]').count()).toBe(3)
    await page.click('[data-testid="tab-honors"]')
    expect(await page.locator('[data-testid^="sample-tag-honor-"]').count()).toBe(2)

    // 总览：统计不再是空的
    await goto(page, 'overview')
    await expect(page.locator('[data-testid="stat-finished"]')).not.toHaveText('0')
    await screenshot(page, '13-示例数据-战绩总览')

    // 日历：这个月能看到比赛
    await goto(page, 'calendar')
    expect(await page.locator('[data-testid^="cal-chip-"]').count()).toBeGreaterThan(0)

    // 设置页显示示例数量
    await goto(page, 'settings')
    await expect(page.locator('[data-testid="settings-samples"]')).toContainText('10 场比赛')
    await expect(page.locator('[data-testid="settings-samples"]')).toContainText('3 个赛事')
    await expect(page.locator('[data-testid="settings-samples"]')).toContainText('2 条荣誉')
    await screenshot(page, '14-设置-示例数据与皮肤')

    // 重启不会重复写入
    ctx = await launchApp(dataDir, { seedSamples: true })
    const after = await readDbCounts(dataDir)
    expect(after.matches).toBe(10)
    expect(after.backgrounds).toBe(2)
    expect(existsSync(path.join(dataDir, 'seed.json'))).toBe(true)
  })

  test('多格式导入：PNG/GIF/BMP/TIFF/JPG 都能进来，不认识的文件给出提示', async () => {
    const { page, app } = ctx
    const files = makeTestImages(TMP)
    const bogus = path.join(TMP, 'not-an-image.jpg')
    writeFileSync(bogus, 'this file is not an image at all', 'utf8')
    await stubOpenDialog(app, [...files, bogus])

    await goto(page, 'settings')
    await page.click('[data-testid="bg-add"]')

    // 5 张真实图片全部导入成功（TIFF 走转码路径），坏文件被跳过并给出原因
    await expect(page.locator('[data-testid="bg-cards"] .bg-card')).toHaveCount(7)
    await expect(page.locator('[data-testid="toast-error"]')).toContainText('not-an-image.jpg')
    await expect(page.locator('[data-testid="toast-error"]')).toContainText('不是可识别的图片文件')

    // 导入的格式都真的能渲染出来（naturalWidth > 0）
    const widths = await page.evaluate(async () => {
      const api = (globalThis as unknown as { api: { invoke: (c: string) => Promise<unknown> } }).api
      const list = (await api.invoke('backgrounds:list')) as Array<{ fileName: string }>
      const out: number[] = []
      for (const p of list) {
        const img = new Image()
        img.src = `debate-photo://local/${encodeURIComponent(p.fileName)}`
        await img.decode().catch(() => undefined)
        out.push(img.naturalWidth)
      }
      return out
    })
    expect(widths.length).toBe(7)
    expect(widths.filter((w) => w > 0).length).toBe(7)

    // TIFF 是转码进来的：落盘后缀改成 .png
    const list = await photoList(page)
    expect(list.find((p) => p.originalName === 'fmt.tiff')?.fileName.endsWith('.png')).toBe(true)
    for (const name of ['fmt.png', 'fmt.gif', 'fmt.bmp', 'fmt.jpg']) {
      expect(list.some((p) => p.originalName === name)).toBe(true)
    }
  })

  test('删除全部示例数据：示例清空、照片与自己的记录都保留，重启不再写入', async () => {
    const { page, dataDir } = ctx

    // 自己录一条真实记录，验证删除示例不会带走它
    const mine = await seed<{ id: number }>(page, 'matches:create', {
      date: '2026-09-10',
      startTime: null,
      topic: '我自己录入的比赛',
      category: '正赛',
      eventId: null,
      side: null,
      position: null,
      status: '胜',
      isBestDebater: false,
      comment: ''
    })

    ctx = await launchApp(dataDir, { seedSamples: true })
    await goto(ctx.page, 'settings')
    expect((await sampleStatus(ctx.page)).matches).toBe(10)

    await ctx.page.click('[data-testid="samples-clear"]')
    await ctx.page.click('[data-testid="confirm-ok"]')
    await expect(ctx.page.locator('[data-testid="settings-samples"]')).toContainText('没有示例数据')

    const after = await sampleStatus(ctx.page)
    expect(after.matches).toBe(0)
    expect(after.events).toBe(0)
    expect(after.honors).toBe(0)
    // 照片不在示例删除范围内
    expect(after.photos).toBe(7)

    // 自己的记录还在，示例标记全部消失
    await goto(ctx.page, 'matches')
    await expect(ctx.page.locator(`[data-testid="match-row-${mine.id}"]`)).toHaveCount(1)
    expect(await ctx.page.locator('[data-testid^="sample-tag-"]').count()).toBe(0)

    // 重启：数据为空也不会再写一次示例
    ctx = await launchApp(dataDir, { seedSamples: true })
    const finalStatus = await sampleStatus(ctx.page)
    expect(finalStatus.matches).toBe(0)
    const dbCounts = await readDbCounts(dataDir)
    expect(dbCounts.matches).toBe(1)
    expect(dbCounts.events).toBe(0)
    expect(dbCounts.honors).toBe(0)
    expect(dbCounts.backgrounds).toBe(7)
    expect(readdirSync(path.join(dataDir, 'photos')).length).toBe(7)
  })

  test('删除后可以重新写入示例：补齐且不重复，自己的记录与照片都不动', async () => {
    const { page, dataDir } = ctx

    await goto(page, 'settings')
    await expect(page.locator('[data-testid="settings-samples"]')).toContainText('没有示例数据')

    await page.click('[data-testid="samples-reseed"]')
    await page.click('[data-testid="confirm-ok"]')
    await expect(page.locator('[data-testid="toast-success"]')).toContainText('已补回示例：10 场比赛 / 3 个赛事 / 2 条荣誉')

    const status = await sampleStatus(page)
    expect(status.matches).toBe(10)
    expect(status.events).toBe(3)
    expect(status.honors).toBe(2)
    // 两张示例照片已经在库里，不会重复导入
    expect(status.photos).toBe(7)

    await expect(page.locator('[data-testid="settings-samples"]')).toContainText('10 场比赛')
    await goto(page, 'matches')
    expect(await page.locator('[data-testid^="sample-tag-"]').count()).toBe(10)

    // 自己录的那场还在，没被动过；示例日期按当天重算（都落在今年）
    const rows = await seed<Array<{ id: number; date: string; topic: string }>>(page, 'matches:list', { order: 'date-desc' })
    const mine = rows.find((r) => r.topic === '我自己录入的比赛')
    expect(mine, '自己的记录应保留').toBeTruthy()
    await expect(page.locator(`[data-testid="match-row-${mine!.id}"]`)).toContainText('我自己录入的比赛')
    const year = new Date().getFullYear()
    expect(rows.every((r) => r.date.startsWith(String(year)))).toBe(true)

    // 再点一次：幂等，一条也不会多出来
    await goto(page, 'settings')
    await page.click('[data-testid="samples-reseed"]')
    await page.click('[data-testid="confirm-ok"]')
    await expect(page.locator('[data-testid="toast-info"]')).toContainText('本来就是齐的')
    const again = await sampleStatus(page)
    expect(again.matches).toBe(10)
    expect(again.events).toBe(3)
    expect(again.honors).toBe(2)

    const dbCounts = await readDbCounts(dataDir)
    expect(dbCounts.matches).toBe(11)
    expect(dbCounts.events).toBe(3)
    expect(dbCounts.honors).toBe(2)
    expect(dbCounts.backgrounds).toBe(7)

    // 重启后示例仍在，也不会再重复写入
    ctx = await launchApp(dataDir, { seedSamples: true })
    const afterRestart = await sampleStatus(ctx.page)
    expect(afterRestart.matches).toBe(10)
    expect(afterRestart.photos).toBe(7)
  })
})
