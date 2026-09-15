/**
 * 验收：比赛日历。
 * 覆盖月视图/周视图、跨月、一天多场、未填写开赛时间的比赛、点击日期新增、点击比赛查看编辑、提前录入待赛。
 */

import { expect, test } from '@playwright/test'
import { fillMatchForm, freshDataDir, goto, launchApp, restart, screenshot, seed, type Launched } from './helpers'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
function iso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const today = iso(new Date())
const d = new Date()
const nextMonthDate = new Date(d.getFullYear(), d.getMonth() + 1, 1)
const nextMonthFirst = iso(nextMonthDate)

interface Created {
  id: number
  topic: string
}

let ctx: Launched
let timed: Created
let evening: Created
let untimed: Created
let crossMonth: Created

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  ctx = await launchApp(freshDataDir('calendar'))
  const base = {
    startTime: null as string | null,
    category: '正赛' as const,
    eventId: null,
    side: null,
    position: null,
    comment: ''
  }
  timed = await seed<Created>(ctx.page, 'matches:create', {
    ...base,
    date: today,
    startTime: '08:30',
    topic: '今天早场正赛',
    status: '胜'
  })
  evening = await seed<Created>(ctx.page, 'matches:create', {
    ...base,
    date: today,
    startTime: '19:00',
    category: '模拟赛',
    topic: '今晚模拟赛',
    status: '负'
  })
  untimed = await seed<Created>(ctx.page, 'matches:create', {
    ...base,
    date: today,
    topic: '今天未填时间的比赛',
    status: '无胜负'
  })
  crossMonth = await seed<Created>(ctx.page, 'matches:create', {
    ...base,
    date: nextMonthFirst,
    startTime: '10:00',
    topic: '下月一号的比赛',
    status: '待赛'
  })

  // 经 IPC 造的数据要重启一次，让界面的数据切片重新加载
  ctx = await restart(ctx)
})

test.afterAll(async () => {
  await ctx.app.close()
})

test('月视图：显示当日场次数、跨月日期也在网格中', async () => {
  const { page } = ctx
  await goto(page, 'calendar')

  const todayCell = page.locator(`[data-testid="cal-cell-${today}"]`)
  await expect(todayCell).toHaveAttribute('data-count', '3')
  await expect(todayCell).toHaveClass(/is-today/)

  // 下月一号落在本月网格里（跨月显示），标记为 is-outside
  const otherCell = page.locator(`[data-testid="cal-cell-${nextMonthFirst}"]`)
  await expect(otherCell).toHaveAttribute('data-count', '1')
  await expect(otherCell).toHaveClass(/is-outside/)
  await expect(page.locator(`[data-testid="cal-chip-${crossMonth.id}"]`)).toContainText('下月一号的比赛')

  // 一天多场：格子内最多 2 个条 + 「还有 N 场」
  await expect(todayCell).toContainText('3 场')
  await expect(todayCell).toContainText('还有 1 场')
  await screenshot(page, '05-日历-月视图')
})

test('点击日期直接新增比赛，日期预填为该日', async () => {
  const { page } = ctx
  await goto(page, 'calendar')

  // 取本月内的一个日期（避开今天），保证一定在当前显示的月网格里
  const base = new Date()
  const day = base.getDate() === 15 ? 16 : 15
  const target = `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(day)}`
  await page.click(`[data-testid="cal-cell-${target}"] .cal-cell__num`)
  await page.waitForSelector('[data-testid="match-modal"]')
  await expect(page.locator('[data-testid="match-date"]')).toHaveValue(target)
  await page.click('[data-testid="match-cancel"]')
  await expect(page.locator('[data-testid="match-modal"]')).toHaveCount(0)

  // 真正保存一场，落在那一天
  await page.click(`[data-testid="cal-cell-${target}"] .cal-cell__num`)
  await page.waitForSelector('[data-testid="match-modal"]')
  await page.fill('[data-testid="match-topic"]', '本月十五日临时加的一场')
  await page.click('[data-testid="match-save"]')
  await expect(page.locator(`[data-testid="cal-cell-${target}"]`)).toHaveAttribute('data-count', '1')
  await expect(page.locator('[data-testid="day-panel"]')).toContainText('本月十五日临时加的一场')
})

test('点击日历中的比赛可查看/编辑', async () => {
  const { page } = ctx
  await goto(page, 'calendar')

  await page.click(`[data-testid="cal-chip-${timed.id}"]`)
  await page.waitForSelector('[data-testid="match-modal"]')
  await expect(page.locator('[data-testid="match-topic"]')).toHaveValue('今天早场正赛')
  await expect(page.locator('[data-testid="match-date"]')).toHaveValue(today)
  await page.click('[data-testid="match-cancel"]')

  // 当日面板里也能看到全部 3 场（含未填时间的）
  const dayPanel = page.locator('[data-testid="day-panel"]')
  await expect(dayPanel).toContainText('今天早场正赛')
  await expect(dayPanel).toContainText('今晚模拟赛')
  await expect(dayPanel).toContainText('今天未填时间的比赛')
  await expect(dayPanel).toContainText('共 3 场')
})

test('周视图：按时开赛时间排列，未填时间单独区域', async () => {
  const { page } = ctx
  await goto(page, 'calendar')
  await page.click('[data-testid="view-week"]')
  await expect(page.locator('[data-testid="calendar-week"]')).toBeVisible()

  // 有时间的比赛在周列里
  await expect(page.locator(`[data-testid="week-chip-${timed.id}"]`)).toContainText('08:30')
  await expect(page.locator(`[data-testid="week-chip-${evening.id}"]`)).toContainText('19:00')

  // 未填时间的比赛进入单独区域
  const untimedArea = page.locator('[data-testid="week-untimed"]')
  await expect(untimedArea).toBeVisible()
  await expect(untimedArea).toContainText('今天未填时间的比赛')
  await expect(untimedArea).toContainText('未填写开赛时间的比赛')

  // 点击未填时间的条也可编辑
  await page.click(`[data-testid="week-untimed-chip-${untimed.id}"]`)
  await page.waitForSelector('[data-testid="match-modal"]')
  await expect(page.locator('[data-testid="match-topic"]')).toHaveValue('今天未填时间的比赛')
  await page.click('[data-testid="match-cancel"]')

  await screenshot(page, '06-日历-周视图')
})

test('周视图导航与回到今天', async () => {
  const { page } = ctx
  await goto(page, 'calendar')
  await page.click('[data-testid="view-week"]')
  await page.click('[data-testid="calendar-next"]')
  await expect(page.locator('[data-testid="calendar-week"]')).toBeVisible()
  // 下周不含今天的比赛
  await expect(page.locator(`[data-testid="week-chip-${timed.id}"]`)).toHaveCount(0)
  await page.click('[data-testid="calendar-today"]')
  await expect(page.locator(`[data-testid="week-chip-${timed.id}"]`)).toHaveCount(1)
})

test('月视图导航回本月，待赛比赛可见且状态正确', async () => {
  const { page } = ctx
  await goto(page, 'calendar')
  await page.click('[data-testid="view-month"]')
  await page.click('[data-testid="calendar-prev"]')
  await page.click('[data-testid="calendar-next"]')
  await expect(page.locator(`[data-testid="cal-cell-${today}"]`)).toHaveAttribute('data-count', '3')

  // 下月一号的待赛比赛：切到下个月看它
  await page.click('[data-testid="calendar-next"]')
  const cell = page.locator(`[data-testid="cal-cell-${nextMonthFirst}"]`)
  await expect(cell).toHaveAttribute('data-count', '1')
  await page.click(`[data-testid="cal-cell-${nextMonthFirst}"] .cal-cell__num`)
  await page.waitForSelector('[data-testid="match-modal"]')
  await expect(page.locator('[data-testid="match-status-待赛"]')).toHaveAttribute('aria-pressed', 'true')
  await page.click('[data-testid="match-cancel"]')
  await expect(page.locator('[data-testid="day-panel"]')).toContainText('待赛')
})

test('日历颜色区分正赛与模拟赛', async () => {
  const { page } = ctx
  await goto(page, 'calendar')
  await page.click('[data-testid="calendar-today"]')
  const official = page.locator(`[data-testid="cal-chip-${timed.id}"]`)
  const mock = page.locator(`[data-testid="cal-chip-${evening.id}"]`)
  await expect(official).toHaveClass(/chip--official/)
  await expect(mock).toHaveClass(/chip--mock/)
})

test('在日历里新增一场并直接保存到指定未来日期（提前录入待赛）', async () => {
  const { page } = ctx
  await goto(page, 'calendar')
  await page.click('[data-testid="view-month"]')
  // 下个月 20 号：先翻到下个月，日期一定在网格里
  const nm = new Date(d.getFullYear(), d.getMonth() + 1, 20)
  const future = `${nm.getFullYear()}-${pad(nm.getMonth() + 1)}-${pad(nm.getDate())}`
  await page.click('[data-testid="calendar-next"]')
  await page.click(`[data-testid="cal-cell-${future}"] .cal-cell__num`)
  await fillMatchForm(page, {
    date: future,
    time: '13:00',
    topic: '提前录入的待赛比赛',
    category: '正赛',
    status: '待赛'
  })
  await expect(page.locator(`[data-testid="cal-cell-${future}"]`)).toHaveAttribute('data-count', '1')
  await expect(page.locator('[data-testid="day-panel"]')).toContainText('提前录入的待赛比赛')
})

test('履历页汇总日历中录入的比赛', async () => {
  const { page } = ctx
  await goto(page, 'resume')
  await page.click('[data-testid="resume-range-all"]')
  await expect(page.locator('[data-testid="resume-experience"]')).toContainText('今天早场正赛')
  await expect(page.locator('[data-testid="resume-experience"]')).toContainText('提前录入的待赛比赛')
  await page.click('[data-testid="resume-toggle-preview"]')
  const preview = page.locator('[data-testid="resume-preview-text"]')
  await expect(preview).toContainText('参赛经历')
  await expect(preview).toContainText('提前录入的待赛比赛')
  await screenshot(page, '07-履历')
})
