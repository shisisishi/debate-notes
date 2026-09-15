/**
 * 验收：履历可以手动编辑并保存，复制按钮复制的就是编辑后的内容，重启与恢复自动生成都正确。
 */

import { expect, test } from '@playwright/test'
import { freshDataDir, goto, launchApp, screenshot, seed, type Launched } from './helpers'

const MATCH = {
  date: '2026-09-12',
  startTime: '19:00',
  topic: '履历编辑用例：高校应当取消绩点排名',
  category: '正赛',
  eventId: null,
  side: '正方',
  position: '一辩',
  status: '胜',
  isBestDebater: true,
  comment: '自由辩论阶段连追三问'
}

async function draftOf(page: import('@playwright/test').Page): Promise<{ text: string | null; updatedAt: string | null }> {
  return page.evaluate(async () =>
    (globalThis as unknown as { api: { invoke: (c: string) => Promise<unknown> } }).api.invoke('resume:draft')
  ) as Promise<{ text: string | null; updatedAt: string | null }>
}

test.describe.configure({ mode: 'serial' })

test.describe('履历编辑', () => {
  let ctx: Launched

  test.beforeAll(async () => {
    ctx = await launchApp(freshDataDir('resume'))
    await seed(ctx.page, 'matches:create', MATCH)
    await goto(ctx.page, 'resume')
  })

  test.afterAll(async () => {
    if (ctx) await ctx.app.close()
  })

  test('编辑并保存：内容替换自动汇总，复制复制的是编辑后的文字', async () => {
    const { page } = ctx
    await expect(page.locator('[data-testid="resume-draft"]')).toContainText('自动汇总')
    expect((await draftOf(page)).text).toBeNull()

    await page.click('[data-testid="resume-edit"]')
    await expect(page.locator('[data-testid="resume-editor"]')).toHaveCount(1)
    // 编辑器预填的是自动汇总内容，说明可以从这里改
    const prefilled = await page.locator('[data-testid="resume-editor"]').inputValue()
    expect(prefilled).toContain('参赛经历')
    expect(prefilled).toContain(MATCH.topic)

    const mine = ['我 的 辩 论 履 历', '', '一、个人简介', '打了三年辩论，一辩与四辩都常打。', '', '二、代表赛事', '市大学生辩论赛（冠军）'].join('\n')
    await page.locator('[data-testid="resume-editor"]').fill(mine)
    await page.click('[data-testid="resume-save"]')

    await expect(page.locator('[data-testid="resume-draft-badge"]')).toHaveCount(1)
    await expect(page.locator('[data-testid="resume-draft-text"]')).toContainText('个人简介')
    await expect(page.locator('[data-testid="resume-draft-time"]')).toContainText('保存于')

    const saved = await draftOf(page)
    expect(saved.text).toBe(mine)
    expect(saved.updatedAt).not.toBeNull()

    // 复制走的就是编辑后的内容
    await page.evaluate(() => {
      ;(window as unknown as { __copied: string }).__copied = ''
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (t: string) => { (window as unknown as { __copied: string }).__copied = t } }
      })
    })
    await page.click('[data-testid="resume-copy-text"]')
    await expect.poll(async () => page.evaluate(() => (window as unknown as { __copied: string }).__copied)).toBe(mine)

    // 预览面板显示的也是编辑后的文字
    await page.click('[data-testid="resume-toggle-preview"]')
    await expect(page.locator('[data-testid="resume-preview-text"]')).toContainText('个人简介')
    await expect(page.locator('[data-testid="resume-preview"]')).toContainText('你手动编辑并保存过的内容')
    await screenshot(page, '22-履历-手动编辑')
  })

  test('手动内容与时间范围无关；可以随时恢复自动生成', async () => {
    const { page } = ctx
    // 切时间范围：手动内容不变，下方自动汇总结论仍然跟着范围走
    await page.click('[data-testid="resume-range-month"]')
    await page.click('[data-testid="resume-range-all"]')
    await expect(page.locator('[data-testid="resume-draft-text"]')).toContainText('个人简介')

    // 重新编辑时，可以把最新的自动汇总内容填进来
    await page.click('[data-testid="resume-edit"]')
    await page.click('[data-testid="resume-refill"]')
    await expect.poll(async () => page.locator('[data-testid="resume-editor"]').inputValue()).toContain(MATCH.topic)
    await page.click('[data-testid="resume-cancel"]')
    await expect(page.locator('[data-testid="resume-draft-text"]')).toContainText('个人简介')

    // 恢复自动生成
    await page.click('[data-testid="resume-restore-auto"]')
    await expect(page.locator('[data-testid="resume-draft-text"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="resume-draft"]')).toContainText('自动汇总')
    expect((await draftOf(page)).text).toBeNull()
    await page.click('[data-testid="resume-toggle-preview"]')
    await expect(page.locator('[data-testid="resume-preview-text"]')).toContainText(MATCH.topic)
  })

  test('空内容不会覆盖：保存空文本应当被拒绝', async () => {
    const { page } = ctx
    await page.click('[data-testid="resume-edit"]')
    await page.locator('[data-testid="resume-editor"]').fill('   \n  ')
    await page.click('[data-testid="resume-save"]')
    await expect(page.locator('[data-testid="toast-error"]')).toContainText('内容为空')
    expect((await draftOf(page)).text).toBeNull()
    await page.click('[data-testid="resume-cancel"]')
  })

  test('重启后手动内容仍在', async () => {
    const { page, dataDir } = ctx
    await page.click('[data-testid="resume-edit"]')
    await page.locator('[data-testid="resume-editor"]').fill('重启也要保留的履历内容')
    await page.click('[data-testid="resume-save"]')
    await expect(page.locator('[data-testid="resume-draft-badge"]')).toHaveCount(1)

    ctx = await launchApp(dataDir)
    await goto(ctx.page, 'resume')
    await expect(ctx.page.locator('[data-testid="resume-draft-text"]')).toContainText('重启也要保留的履历内容')
    expect((await draftOf(ctx.page)).text).toBe('重启也要保留的履历内容')
  })
})
