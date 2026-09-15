/**
 * 验收：比赛录入 / 修改 / 查找 / 重启后仍在；
 * 同一赛事多场归组；赛事荣誉与单场最佳辩手分别汇总。
 */

import { expect, test } from '@playwright/test'
import {
  fillMatchForm,
  freshDataDir,
  goto,
  launchApp,
  readDbCounts,
  readSettingsFile,
  restart,
  screenshot,
  seed,
  type Launched
} from './helpers'

let ctx: Launched

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  ctx = await launchApp(freshDataDir('records'))
})

test.afterAll(async () => {
  await ctx.app.close()
})

test('新增比赛：界面完整录入并出现在记录列表中', async () => {
  const { page } = ctx
  await goto(page, 'matches')
  await page.click('[data-testid="matches-add"]')
  await fillMatchForm(page, {
    date: '2026-03-08',
    time: '19:30',
    topic: '网络匿名性有利于公共议题讨论',
    category: '正赛',
    side: '正方',
    position: '一辩',
    status: '胜',
    best: true,
    comment: '一辩立论框架稳，质询守住了定义'
  })

  await expect(page.locator('[data-testid="matches-list"]')).toContainText('网络匿名性有利于公共议题讨论')
  await expect(page.locator('[data-testid="matches-list"]')).toContainText('最佳辩手')

  const counts = await readDbCounts(ctx.dataDir)
  expect(counts.matches).toBe(1)
})

test('搜索、编辑与新增辩位选项', async () => {
  const { page } = ctx
  await goto(page, 'matches')

  // 搜索命中
  await page.fill('[data-testid="matches-search"]', '匿名性')
  await expect(page.locator('[data-testid="matches-list"]')).toContainText('网络匿名性有利于公共议题讨论')
  // 搜索未命中
  await page.fill('[data-testid="matches-search"]', '不存在的关键词')
  await expect(page.locator('[data-testid="matches-list"]')).toContainText('没有符合条件的比赛')
  await page.fill('[data-testid="matches-search"]', '')

  // 编辑：改状态并换辩位（手动输入新辩位，应被记住）
  await page.click('[data-testid="match-edit-1"]')
  await page.waitForSelector('[data-testid="match-modal"]')
  await page.click('[data-testid="match-status-负"]')
  await page.selectOption('[data-testid="match-position"]', '__custom__')
  await page.fill('[data-testid="match-position-input"]', '结辩')
  await page.click('[data-testid="match-position-confirm"]')
  await page.click('[data-testid="match-save"]')
  await expect(page.locator('[data-testid="match-modal"]')).toHaveCount(0)

  await expect(page.locator('[data-testid="matches-list"]')).toContainText('结辩')

  // 新选项被记住：再开一次表单，下拉里应该已有「结辩」
  await page.click('[data-testid="match-edit-1"]')
  await page.waitForSelector('[data-testid="match-modal"]')
  await expect(page.locator('[data-testid="match-position"] option[value="结辩"]')).toHaveCount(1)
  await page.click('[data-testid="match-cancel"]')
})

test('同一赛事多场比赛正确归组，荣誉与单场最佳辩手分别汇总', async () => {
  const { page } = ctx

  // 新建赛事并挂 3 场比赛（2 胜 1 负，其中 1 场最佳辩手）
  await goto(page, 'matches')
  await page.click('[data-testid="tab-events"]')
  await page.click('[data-testid="events-add"]')
  await page.waitForSelector('[data-testid="event-modal"]')
  await page.fill('[data-testid="event-name"]', '校辩论联赛春季赛')
  await page.selectOption('[data-testid="event-result"]', '冠军')
  await page.click('[data-testid="event-save"]')
  await expect(page.locator('[data-testid="event-modal"]')).toHaveCount(0)

  await page.click('[data-testid="tab-matches"]')
  for (const m of [
    { date: '2026-04-11', topic: '小组赛第一场', status: '胜' as const, best: false },
    { date: '2026-04-12', topic: '小组赛第二场', status: '胜' as const, best: true },
    { date: '2026-04-19', topic: '半决赛', status: '负' as const, best: false }
  ]) {
    await page.click('[data-testid="matches-add"]')
    await fillMatchForm(page, { ...m, time: '14:00', category: '正赛', eventName: '校辩论联赛春季赛' })
  }

  // 赛事列表：3 场归组，胜 2 负 1，最佳辩手 1
  await page.click('[data-testid="tab-events"]')
  const eventRow = page.locator('[data-testid="event-row-1"]')
  await expect(eventRow).toContainText('3 场 · 胜 2 负 1')
  await expect(eventRow).toContainText('最佳辩手 1')
  await expect(eventRow).toContainText('校辩论联赛春季赛')

  // 荣誉页:手动荣誉 vs 自动汇总的最佳辩手
  await page.click('[data-testid="tab-honors"]')
  await page.click('[data-testid="honors-add"]')
  await page.waitForSelector('[data-testid="honor-modal"]')
  await page.fill('[data-testid="honor-date"]', '2026-04-20')
  await page.selectOption('[data-testid="honor-name"]', '优秀辩手')
  await page.click('[data-testid="honor-save"]')
  await expect(page.locator('[data-testid="honors-list"]')).toContainText('优秀辩手')

  const autoBest = page.locator('[data-testid="honors-auto-best"]')
  await expect(autoBest).toContainText('小组赛第二场')
  await expect(autoBest).toContainText('1')

  // 总览：赛事荣誉 = 1（手动录入），单场最佳辩手 = 2（本用例 1 场 + 用例一中的 1 场），两者分开统计
  await goto(page, 'overview')
  await page.click('[data-testid="overview-range-all"]')
  await expect(page.locator('[data-testid="stat-honors"] .stat__value')).toHaveText('1')
  await expect(page.locator('[data-testid="stat-best"] .stat__value')).toHaveText('2')
  await expect(page.locator('[data-testid="overview-event-results"]')).toContainText('校辩论联赛春季赛')
  await expect(page.locator('[data-testid="overview-event-results"]')).toContainText('冠军')

  await screenshot(page, '02-总览-全部数据')
})

test('删除前确认，取消则不删除', async () => {
  const { page } = ctx
  await goto(page, 'matches')
  const before = await readDbCounts(ctx.dataDir)

  await page.click('[data-testid="match-remove-1"]')
  await expect(page.locator('[data-testid="confirm-dialog"]')).toBeVisible()
  await page.click('[data-testid="confirm-cancel"]')
  await expect(page.locator('[data-testid="confirm-dialog"]')).toHaveCount(0)
  expect((await readDbCounts(ctx.dataDir)).matches).toBe(before.matches)

  // 重新打开并确认删除
  await page.click('[data-testid="match-remove-1"]')
  await page.click('[data-testid="confirm-ok"]')
  await expect(page.locator('[data-testid="confirm-dialog"]')).toHaveCount(0)
  await expect.poll(async () => (await readDbCounts(ctx.dataDir)).matches).toBe(before.matches - 1)
})

test('重启后记录与设置仍在', async () => {
  // 先改一个设置（没有背景照片时轮播相关控件不显示，改用「保留自动备份份数」）
  await goto(ctx.page, 'settings')
  await ctx.page.locator('[data-testid="backup-keep"]').evaluate((el) => {
    const input = el as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, '12')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await expect.poll(async () => (await readSettingsFile(ctx.dataDir)).autoBackupKeep).toBe(12)
  await goto(ctx.page, 'resume')

  const before = await readDbCounts(ctx.dataDir)

  ctx = await restart(ctx)

  const after = await readDbCounts(ctx.dataDir)
  expect(after).toEqual(before)

  // 重启后仍停在履历页，且设置保持
  await expect(ctx.page.locator('[data-testid="page-resume"]')).toBeVisible()
  expect((await readSettingsFile(ctx.dataDir)).autoBackupKeep).toBe(12)

  await goto(ctx.page, 'matches')
  await expect(ctx.page.locator('[data-testid="matches-list"]')).toContainText('小组赛第一场')
})

test('空数据时统计显示暂无胜率', async () => {
  const empty = await launchApp(freshDataDir('records-empty'))
  try {
    await goto(empty.page, 'overview')
    await empty.page.click('[data-testid="overview-range-all"]')
    await expect(empty.page.locator('[data-testid="stat-finished"] .stat__value')).toHaveText('0')
    await expect(empty.page.locator('[data-testid="stat-winrate"] .stat__value')).toHaveText('暂无')
    await expect(empty.page.locator('[data-testid="overview-recent"]')).toContainText('还没有比赛记录')
  } finally {
    await empty.app.close()
  }
})

test('默认没有背景照片，页面用纯色底色且不显示背景图', async () => {
  const { page } = ctx
  await goto(page, 'settings')
  await expect(page.locator('[data-testid="settings-background"]')).toContainText('还没有背景照片')
  await expect(page.locator('[data-testid="bg-image"]')).toHaveCount(0)

  // 通过 IPC 再确认照片列表确实是空的
  const photos = await seed<Array<unknown>>(page, 'backgrounds:list')
  expect(photos).toEqual([])
})
