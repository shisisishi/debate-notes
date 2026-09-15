/**
 * 验收：统计口径。
 * 覆盖混合胜负、全待赛、无胜负、空数据，以及时间范围与类别筛选结果的一致性。
 */

import { expect, test } from '@playwright/test'
import { freshDataDir, goto, launchApp, restart, screenshot, seed, type Launched } from './helpers'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const today = new Date()
const todayStr = iso(today)

interface MatchInput {
  date: string
  startTime: string | null
  topic: string
  category: '正赛' | '模拟赛'
  eventId: number | null
  side: '正方' | '反方' | null
  position: string | null
  status: '待赛' | '未出结果' | '胜' | '负' | '无胜负'
  isBestDebater: boolean
  comment: string
}

function input(partial: Partial<MatchInput> & { date: string; status: MatchInput['status'] }): MatchInput {
  return {
    startTime: null,
    topic: `${partial.date} ${partial.status} 场`,
    category: '正赛',
    eventId: null,
    side: null,
    position: null,
    isBestDebater: false,
    comment: '',
    ...partial
  }
}

let ctx: Launched

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  ctx = await launchApp(freshDataDir('stats'))

  const event = await seed<{ id: number }>(ctx.page, 'events:create', {
    name: '统计测试赛事',
    result: '亚军',
    note: ''
  })

  // 1 胜 2 负 1 无胜负 1 未出结果 1 待赛；其中一场为最佳辩手
  const rows: MatchInput[] = [
    input({ date: '2026-01-10', status: '胜', eventId: event.id, isBestDebater: true, topic: '一月胜场' }),
    input({ date: '2026-01-20', status: '负', eventId: event.id, topic: '一月负场' }),
    input({ date: '2026-02-05', status: '负', eventId: event.id, topic: '二月负场' }),
    input({ date: '2026-02-11', status: '无胜负', category: '模拟赛', topic: '二月无胜负场' }),
    input({ date: '2026-02-12', status: '未出结果', category: '模拟赛', topic: '二月未出结果场' }),
    input({ date: '2026-12-01', status: '待赛', topic: '十二月待赛场' }),
    input({ date: todayStr, status: '胜', topic: '本月胜场', startTime: '19:00' })
  ]
  for (const row of rows) await seed(ctx.page, 'matches:create', row)
  await seed(ctx.page, 'honors:create', { name: '最佳风度', date: '2026-01-15', eventId: event.id, note: '' })

  // 经 IPC 造的数据要重启一次，让界面的数据切片（赛事下拉等）重新加载
  ctx = await restart(ctx)
})

test.afterAll(async () => {
  await ctx.app.close()
})

test('全部范围内：已完成场次与胜率口径正确', async () => {
  const { page } = ctx
  await goto(page, 'overview')
  await page.click('[data-testid="overview-range-all"]')
  await page.click('[data-testid="overview-category-all"]')
  await page.selectOption('[data-testid="overview-event"]', 'all')

  await expect(page.locator('[data-testid="stat-finished"] .stat__value')).toHaveText('6')
  await expect(page.locator('[data-testid="stat-wins"] .stat__value')).toHaveText('2')
  await expect(page.locator('[data-testid="stat-losses"] .stat__value')).toHaveText('2')
  await expect(page.locator('[data-testid="stat-draws"] .stat__value')).toHaveText('1')
  await expect(page.locator('[data-testid="stat-unknown"] .stat__value')).toHaveText('1')
  await expect(page.locator('[data-testid="stat-pending"] .stat__value')).toHaveText('1')
  // 胜率 = 2 / (2 + 2) = 50.0%
  await expect(page.locator('[data-testid="stat-winrate"] .stat__value')).toHaveText('50.0%')
  await expect(page.locator('[data-testid="stat-best"] .stat__value')).toHaveText('1')
  await expect(page.locator('[data-testid="stat-honors"] .stat__value')).toHaveText('1')

  // 类别对照把算式写出来，避免「已完成几场却显示另一个百分比」的误解
  await expect(page.locator('[data-testid="category-formula-正赛"]')).toHaveText('2 ÷（2 + 2）')
  await expect(page.locator('[data-testid="category-winrate-正赛"]')).toHaveText('50.0%')
  await expect(page.locator('[data-testid="category-formula-模拟赛"]')).toHaveText('0 胜 0 负，无胜负场次')
  await expect(page.locator('[data-testid="category-winrate-模拟赛"]')).toHaveText('暂无')
})

test('类别筛选：正赛与模拟赛分别统计，待赛只计入正赛', async () => {
  const { page } = ctx
  await goto(page, 'overview')
  await page.click('[data-testid="overview-range-all"]')

  await page.click('[data-testid="overview-category-正赛"]')
  await expect(page.locator('[data-testid="stat-finished"] .stat__value')).toHaveText('4')
  await expect(page.locator('[data-testid="stat-wins"] .stat__value')).toHaveText('2')
  await expect(page.locator('[data-testid="stat-losses"] .stat__value')).toHaveText('2')
  await expect(page.locator('[data-testid="stat-draws"] .stat__value')).toHaveText('0')
  await expect(page.locator('[data-testid="stat-unknown"] .stat__value')).toHaveText('0')
  await expect(page.locator('[data-testid="stat-pending"] .stat__value')).toHaveText('1')
  await expect(page.locator('[data-testid="stat-winrate"] .stat__value')).toHaveText('50.0%')

  await page.click('[data-testid="overview-category-模拟赛"]')
  await expect(page.locator('[data-testid="stat-finished"] .stat__value')).toHaveText('2')
  await expect(page.locator('[data-testid="stat-wins"] .stat__value')).toHaveText('0')
  await expect(page.locator('[data-testid="stat-losses"] .stat__value')).toHaveText('0')
  await expect(page.locator('[data-testid="stat-draws"] .stat__value')).toHaveText('1')
  await expect(page.locator('[data-testid="stat-unknown"] .stat__value')).toHaveText('1')
  await expect(page.locator('[data-testid="stat-pending"] .stat__value')).toHaveText('0')
  // 没有明确胜负 → 暂无
  await expect(page.locator('[data-testid="stat-winrate"] .stat__value')).toHaveText('暂无')

  await page.click('[data-testid="overview-category-all"]')
})

test('时间范围：本月只统计本月，自选日期按闭区间筛选', async () => {
  const { page } = ctx
  await goto(page, 'overview')
  await page.click('[data-testid="overview-category-all"]')

  // 本月
  await page.click('[data-testid="overview-range-month"]')
  await expect(page.locator('[data-testid="stat-finished"] .stat__value')).toHaveText('1')
  await expect(page.locator('[data-testid="stat-wins"] .stat__value')).toHaveText('1')
  await expect(page.locator('[data-testid="stat-winrate"] .stat__value')).toHaveText('100.0%')
  await expect(page.locator('[data-testid="stat-honors"] .stat__value')).toHaveText('0')

  // 今年（2026 年含全部 2026 数据）
  await page.click('[data-testid="overview-range-year"]')
  await expect(page.locator('[data-testid="stat-finished"] .stat__value')).toHaveText('6')
  await expect(page.locator('[data-testid="stat-pending"] .stat__value')).toHaveText('1')

  // 自选：同一天（今天）→ 只有本月那一场
  await page.click('[data-testid="overview-range-custom"]')
  await page.fill('[data-testid="overview-from"]', todayStr)
  await page.fill('[data-testid="overview-to"]', todayStr)
  await expect(page.locator('[data-testid="stat-finished"] .stat__value')).toHaveText('1')
  await expect(page.locator('[data-testid="stat-honors"] .stat__value')).toHaveText('0')

  await page.fill('[data-testid="overview-from"]', '2026-01-01')
  await page.fill('[data-testid="overview-to"]', '2026-01-31')
  await expect(page.locator('[data-testid="stat-finished"] .stat__value')).toHaveText('2')
  await expect(page.locator('[data-testid="stat-wins"] .stat__value')).toHaveText('1')
  await expect(page.locator('[data-testid="stat-losses"] .stat__value')).toHaveText('1')
  await expect(page.locator('[data-testid="stat-winrate"] .stat__value')).toHaveText('50.0%')
  await expect(page.locator('[data-testid="stat-best"] .stat__value')).toHaveText('1')
  await expect(page.locator('[data-testid="stat-honors"] .stat__value')).toHaveText('1')
  await expect(page.locator('[data-testid="stat-pending"] .stat__value')).toHaveText('0')
  await screenshot(page, '03-总览-自选时间范围')
})

test('时间与类别筛选组合结果一致', async () => {
  const { page } = ctx
  await goto(page, 'overview')
  await page.click('[data-testid="overview-range-custom"]')
  await page.fill('[data-testid="overview-from"]', '2026-02-01')
  await page.fill('[data-testid="overview-to"]', '2026-02-28')

  await page.click('[data-testid="overview-category-all"]')
  await expect(page.locator('[data-testid="stat-finished"] .stat__value')).toHaveText('3')
  await expect(page.locator('[data-testid="stat-wins"] .stat__value')).toHaveText('0')
  await expect(page.locator('[data-testid="stat-losses"] .stat__value')).toHaveText('1')
  await expect(page.locator('[data-testid="stat-winrate"] .stat__value')).toHaveText('0.0%')

  await page.click('[data-testid="overview-category-模拟赛"]')
  await expect(page.locator('[data-testid="stat-finished"] .stat__value')).toHaveText('2')
  await expect(page.locator('[data-testid="stat-winrate"] .stat__value')).toHaveText('暂无')

  await page.click('[data-testid="overview-category-正赛"]')
  await expect(page.locator('[data-testid="stat-finished"] .stat__value')).toHaveText('1')
  await expect(page.locator('[data-testid="stat-losses"] .stat__value')).toHaveText('1')
  await expect(page.locator('[data-testid="stat-winrate"] .stat__value')).toHaveText('0.0%')
})

test('赛事筛选：只统计该赛事，未归属赛事单独可选', async () => {
  const { page } = ctx
  await goto(page, 'overview')
  await page.click('[data-testid="overview-range-all"]')
  await page.click('[data-testid="overview-category-all"]')

  await page.selectOption('[data-testid="overview-event"]', '1')
  await expect(page.locator('[data-testid="stat-finished"] .stat__value')).toHaveText('3')
  await expect(page.locator('[data-testid="stat-wins"] .stat__value')).toHaveText('1')
  await expect(page.locator('[data-testid="stat-losses"] .stat__value')).toHaveText('2')
  await expect(page.locator('[data-testid="stat-winrate"] .stat__value')).toHaveText('33.3%')

  await page.selectOption('[data-testid="overview-event"]', 'none')
  await expect(page.locator('[data-testid="stat-finished"] .stat__value')).toHaveText('3')
  await expect(page.locator('[data-testid="stat-wins"] .stat__value')).toHaveText('1')
  await expect(page.locator('[data-testid="stat-losses"] .stat__value')).toHaveText('0')
  await expect(page.locator('[data-testid="stat-pending"] .stat__value')).toHaveText('1')

  await page.selectOption('[data-testid="overview-event"]', 'all')
})

test('全部待赛时：已完成为 0、胜率暂无、待赛计数正确', async () => {
  const allPending = await launchApp(freshDataDir('stats-pending'))
  try {
    for (const date of ['2026-05-01', '2026-05-02', '2026-05-03']) {
      await seed(allPending.page, 'matches:create', input({ date, status: '待赛' }))
    }
    await goto(allPending.page, 'overview')
    await allPending.page.click('[data-testid="overview-range-all"]')
    await expect(allPending.page.locator('[data-testid="stat-finished"] .stat__value')).toHaveText('0')
    await expect(allPending.page.locator('[data-testid="stat-pending"] .stat__value')).toHaveText('3')
    await expect(allPending.page.locator('[data-testid="stat-winrate"] .stat__value')).toHaveText('暂无')
    await screenshot(allPending.page, '04-总览-全部待赛')
  } finally {
    await allPending.app.close()
  }
})

test('无胜负与未出结果都不进胜率分母', async () => {
  const draws = await launchApp(freshDataDir('stats-draws'))
  try {
    for (const [date, status] of [
      ['2026-06-01', '无胜负'],
      ['2026-06-02', '未出结果'],
      ['2026-06-03', '无胜负']
    ] as const) {
      await seed(draws.page, 'matches:create', input({ date, status }))
    }
    await goto(draws.page, 'overview')
    await draws.page.click('[data-testid="overview-range-all"]')
    await expect(draws.page.locator('[data-testid="stat-finished"] .stat__value')).toHaveText('3')
    await expect(draws.page.locator('[data-testid="stat-winrate"] .stat__value')).toHaveText('暂无')
  } finally {
    await draws.app.close()
  }
})
