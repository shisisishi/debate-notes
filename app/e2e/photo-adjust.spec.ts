/**
 * 验收：背景照片可以单独手动调整（位置 / 大小 / 透明度 / 模糊 / 显示方式），并会持久化。
 */

import { expect, test, type ElectronApplication } from '@playwright/test'
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { APP_ROOT, freshDataDir, goto, launchApp, readSettingsFile, screenshot, type Launched } from './helpers'

const TMP = path.join(APP_ROOT, '.e2e-tmp-adjust')
const SOURCES = path.resolve(APP_ROOT, '..', 'sources')

async function stubOpenDialog(app: ElectronApplication, filePaths: string[]): Promise<void> {
  await app.evaluate(({ dialog }, paths) => {
    ;(dialog as unknown as Record<string, unknown>).showOpenDialog = async () => ({
      canceled: (paths as string[]).length === 0,
      filePaths: paths as string[]
    })
  }, filePaths)
}

/** 读当前激活背景图的实际渲染帧（行内样式 + 相对窗口的位置） */
async function activeFrame(page: import('@playwright/test').Page): Promise<{
  transform: string
  opacity: string
  fit: string
  position: string
  scale: string
  offsetX: string
  offsetY: string
  covers: boolean
}> {
  return page.evaluate(() => {
    const img = document.querySelector('[data-testid="bg-image"][data-active="true"]') as HTMLImageElement | null
    if (!img) throw new Error('没有激活的背景图')
    const r = img.getBoundingClientRect()
    const cs = getComputedStyle(img)
    return {
      transform: cs.transform,
      opacity: cs.opacity,
      fit: cs.objectFit,
      position: cs.objectPosition,
      scale: img.dataset.scale ?? '',
      offsetX: img.dataset.offsetX ?? '',
      offsetY: img.dataset.offsetY ?? '',
      // 换算后的照片是否仍然盖满窗口（不出现空白）
      covers: r.left <= 0.5 && r.top <= 0.5 && r.right >= window.innerWidth - 0.5 && r.bottom >= window.innerHeight - 0.5
    }
  })
}

async function photoList(page: import('@playwright/test').Page): Promise<
  Array<{ id: number; offsetX: number | null; offsetY: number | null; scale: number | null; opacity: number | null; blur: number | null; fit: string | null }>
> {
  return page.evaluate(async () =>
    (globalThis as unknown as { api: { invoke: (c: string) => Promise<unknown> } }).api.invoke('backgrounds:list')
  ) as Promise<
    Array<{ id: number; offsetX: number | null; offsetY: number | null; scale: number | null; opacity: number | null; blur: number | null; fit: string | null }>
  >
}

/** 浏览器会把 transform 规范化成 matrix(a, b, c, d, tx, ty) */
function matrixOf(transform: string): { scale: number; tx: number; ty: number } {
  const inner = transform.match(/matrix\(([^)]+)\)/)
  if (!inner) return { scale: NaN, tx: NaN, ty: NaN }
  const parts = inner[1].split(',').map((v) => Number(v.trim()))
  return { scale: parts[0], tx: parts[4], ty: parts[5] }
}

test.describe.configure({ mode: 'serial' })

test.describe('照片手动调整', () => {
  let ctx: Launched

  test.beforeAll(async () => {
    rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
    copyFileSync(path.join(SOURCES, '参考照片-01.jpg'), path.join(TMP, '竖幅照片.jpg'))
    copyFileSync(path.join(SOURCES, '参考照片-02.jpg'), path.join(TMP, '另一张.jpg'))
    ctx = await launchApp(freshDataDir('adjust'))
    await stubOpenDialog(ctx.app, [path.join(TMP, '竖幅照片.jpg'), path.join(TMP, '另一张.jpg')])
    await goto(ctx.page, 'settings')
    await ctx.page.click('[data-testid="bg-add"]')
    await expect(ctx.page.locator('[data-testid="bg-cards"] .bg-card')).toHaveCount(2)
  })

  test.afterAll(async () => {
    if (ctx) await ctx.app.close()
    rmSync(TMP, { recursive: true, force: true })
  })

  test('调整弹窗：位置 / 大小 / 透明度 / 模糊都能改，实时反映到背景层', async () => {
    const { page } = ctx
    const first = (await photoList(page))[0]
    await expect(page.locator('[data-testid="bg-adjusted-' + first.id + '"]')).toHaveCount(0)

    await page.click(`[data-testid="bg-adjust-${first.id}"]`)
    await expect(page.locator('[data-testid="photo-adjust-modal"]')).toHaveCount(1)
    await expect(page.locator('[data-testid="adjust-preview-img"]')).toHaveCount(1)
    await screenshot(page, '20-照片调整-弹窗')

    const before = await activeFrame(page)
    expect(before.scale).toBe('1')
    expect(before.offsetX).toBe('0')

    // 放大：行内 transform 里的 scale 跟着变，并且照片仍然盖满窗口
    await page.locator('[data-testid="adjust-scale"]').fill('220')
    await expect
      .poll(async () => (await activeFrame(page)).scale)
      .toBe('2.2')
    const zoomed = await activeFrame(page)
    expect(zoomed.covers).toBe(true)
    expect(matrixOf(zoomed.transform).scale).toBeCloseTo(2.2, 3)

    // 位置：拉到最右，照片不应露出空白（位移被裁切余量限制住了）
    await page.locator('[data-testid="adjust-offset-x"]').fill('100')
    await page.locator('[data-testid="adjust-offset-y"]').fill('-100')
    await expect
      .poll(async () => (await activeFrame(page)).offsetX)
      .toBe('100')
    const panned = await activeFrame(page)
    expect(panned.offsetY).toBe('-100')
    expect(panned.covers).toBe(true)
    // 位移真的发生了：object-position 从居中变成两个方向都到头（0% / 100%）
    expect(panned.position).toBe('0% 100%')
    expect(panned.position).not.toBe(zoomed.position)

    // 透明度与模糊
    await page.locator('[data-testid="adjust-opacity"]').fill('35')
    await page.locator('[data-testid="adjust-blur"]').fill('6')
    await expect.poll(async () => Number((await activeFrame(page)).opacity)).toBeCloseTo(0.35, 2)
    const blurred = await page.locator('[data-testid="bg-image"][data-active="true"]').evaluate((el) => getComputedStyle(el).filter)
    expect(blurred).toContain('blur(6px)')

    await page.click('[data-testid="adjust-done"]')
    await expect(page.locator('[data-testid="photo-adjust-modal"]')).toHaveCount(0)

    // 卡片上出现「已调整」，数据也确实落库
    await expect(page.locator(`[data-testid="bg-adjusted-${first.id}"]`)).toHaveCount(1)
    const saved = (await photoList(page)).find((p) => p.id === first.id)
    expect(saved?.scale).toBe(2.2)
    expect(saved?.offsetX).toBe(100)
    expect(saved?.offsetY).toBe(-100)
    expect(saved?.opacity).toBe(35)
    expect(saved?.blur).toBe(6)
  })

  test('完整显示与铺满裁切：可移动方向随裁切余量变化，拖动预览能改位置且不露白', async () => {
    const { page } = ctx
    const first = (await photoList(page))[0]
    await page.click(`[data-testid="bg-adjust-${first.id}"]`)
    // 先回到默认（上一轮用过放大 + 位移），否则两个方向都有余量，看不出「可移动方向」的差别
    await page.click('[data-testid="adjust-reset"]')
    await expect.poll(async () => (await activeFrame(page)).scale).toBe('1')

    // 竖幅照片「完整显示」时左右有留白可以摆放，上下正好铺满所以不能移动
    await page.click('[data-testid="adjust-fit-contain"]')
    await expect(page.locator('[data-testid="adjust-hint"]')).toContainText('四周可能留白')
    await expect(page.locator('[data-testid="adjust-offset-x"]')).toBeEnabled()
    await expect(page.locator('[data-testid="adjust-offset-y"]')).toBeDisabled()
    await expect.poll(async () => (await activeFrame(page)).fit).toBe('contain')

    // 切回铺满：上下可以移动，左右没有余量；拖动预览能改变位置且不会露白
    await page.click('[data-testid="adjust-fit-cover"]')
    await expect(page.locator('[data-testid="adjust-hint"]')).toContainText('不会露出空白')
    await expect(page.locator('[data-testid="adjust-offset-y"]')).toBeEnabled()
    await expect(page.locator('[data-testid="adjust-offset-x"]')).toBeDisabled()
    await expect.poll(async () => (await activeFrame(page)).fit).toBe('cover')

    const box = await page.locator('[data-testid="adjust-preview"]').boundingBox()
    expect(box).not.toBeNull()
    const before = Number((await activeFrame(page)).offsetY)
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.mouse.down()
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2 - 70, { steps: 8 })
    await page.mouse.up()
    await expect.poll(async () => Number((await activeFrame(page)).offsetY)).toBeLessThan(before)
    expect((await activeFrame(page)).covers).toBe(true)

    await page.click('[data-testid="adjust-reset"]')
    await expect.poll(async () => (await activeFrame(page)).scale).toBe('1')
    await expect(page.locator(`[data-testid="bg-adjusted-${first.id}"]`)).toHaveCount(0)
    await page.click('[data-testid="adjust-done"]')
  })

  test('调整只作用于当前这一张，可以一键套用到其他照片', async () => {
    const { page } = ctx
    const list = await photoList(page)
    const [first, second] = list
    await page.click(`[data-testid="bg-adjust-${first.id}"]`)
    await page.locator('[data-testid="adjust-scale"]').fill('160')
    await page.locator('[data-testid="adjust-opacity"]').fill('60')
    await expect.poll(async () => (await photoList(page)).find((p) => p.id === first.id)?.scale).toBe(1.6)
    // 第二张仍然没被动过
    expect((await photoList(page)).find((p) => p.id === second.id)?.scale).toBeNull()

    await page.click('[data-testid="adjust-apply-all"]')
    await expect.poll(async () => (await photoList(page)).find((p) => p.id === second.id)?.scale).toBe(1.6)
    expect((await photoList(page)).find((p) => p.id === second.id)?.opacity).toBe(60)
    await page.click('[data-testid="adjust-done"]')

    // 切到第二张：取景确实用了它自己那套参数
    await page.click(`[data-testid="bg-set-active-${second.id}"]`)
    await expect
      .poll(async () => page.locator('[data-testid="bg-image"][data-active="true"]').getAttribute('data-photo-id'))
      .toBe(String(second.id))
    const frame = await activeFrame(page)
    expect(frame.scale).toBe('1.6')
    expect(frame.covers).toBe(true)
    await screenshot(page, '21-照片调整-套用后')
  })

  test('调整会持久化：重启后仍然生效', async () => {
    const { dataDir } = ctx
    ctx = await launchApp(dataDir)
    await goto(ctx.page, 'settings')
    const list = await photoList(ctx.page)
    const zoomed = list.filter((p) => p.scale === 1.6)
    expect(zoomed.length).toBe(2)
    const activeId = (await readSettingsFile(dataDir)).activeBackgroundId
    expect(list.some((p) => p.id === activeId)).toBe(true)
    const frame = await activeFrame(ctx.page)
    expect(frame.scale).toBe('1.6')
    expect(Number(frame.opacity)).toBeCloseTo(0.6, 2)
  })
})
