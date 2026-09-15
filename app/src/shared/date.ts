/** 纯日期工具：全部按本地时间处理，日期字符串统一为 YYYY-MM-DD，时间字符串为 HH:MM。 */

import type { RangeFilter, RangePreset } from './types'

export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function todayStr(): string {
  return toDateStr(new Date())
}

export function parseDateStr(s: string): Date {
  const [y, m, d] = s.split('-').map((v) => Number(v))
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

export function isDateStr(s: string | null | undefined): boolean {
  if (!s) return false
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = parseDateStr(s)
  return toDateStr(d) === s
}

export function isTimeStr(s: string | null | undefined): boolean {
  return !!s && /^([01]\d|2[0-3]):[0-5]\d$/.test(s)
}

export function addDays(s: string, n: number): string {
  const d = parseDateStr(s)
  d.setDate(d.getDate() + n)
  return toDateStr(d)
}

export function addMonths(year: number, month: number, n: number): { year: number; month: number } {
  const base = new Date(year, month - 1 + n, 1)
  return { year: base.getFullYear(), month: base.getMonth() + 1 }
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

export function startOfMonthOf(s: string): string {
  const d = parseDateStr(s)
  return toDateStr(new Date(d.getFullYear(), d.getMonth(), 1))
}

export function endOfMonthOf(s: string): string {
  const d = parseDateStr(s)
  return toDateStr(new Date(d.getFullYear(), d.getMonth() + 1, 0))
}

export function startOfYearOf(s: string): string {
  return `${parseDateStr(s).getFullYear()}-01-01`
}

export function endOfYearOf(s: string): string {
  return `${parseDateStr(s).getFullYear()}-12-31`
}

/** 周一为一周起点 */
export function weekStart(s: string): string {
  const d = parseDateStr(s)
  const dow = (d.getDay() + 6) % 7 // 周一 = 0
  d.setDate(d.getDate() - dow)
  return toDateStr(d)
}

export function weekDates(s: string): string[] {
  const start = weekStart(s)
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

/** 月视图网格：6 行 × 7 列，周一为第一列，含跨月补齐 */
export function monthMatrix(year: number, month: number): string[][] {
  const first = `${year}-${pad2(month)}-01`
  let cursor = weekStart(first)
  const rows: string[][] = []
  for (let r = 0; r < 6; r++) {
    const row: string[] = []
    for (let c = 0; c < 7; c++) {
      row.push(cursor)
      cursor = addDays(cursor, 1)
    }
    rows.push(row)
  }
  return rows
}

const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export function weekdayCn(s: string): string {
  return WEEKDAY_CN[parseDateStr(s).getDay()]
}

export function weekdayShortCn(indexMondayFirst: number): string {
  return ['一', '二', '三', '四', '五', '六', '日'][indexMondayFirst]
}

export function formatCn(s: string): string {
  const d = parseDateStr(s)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${weekdayCn(s)}`
}

export function formatShortCn(s: string): string {
  const d = parseDateStr(s)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

export function monthLabel(year: number, month: number): string {
  return `${year} 年 ${month} 月`
}

/** 解析时间范围预设为闭区间 [from, to]；'all' 时两端为 null */
export function resolveRange(range: RangeFilter): { from: string | null; to: string | null } {
  const anchor = range.anchor || todayStr()
  switch (range.preset) {
    case 'month':
      return { from: startOfMonthOf(anchor), to: endOfMonthOf(anchor) }
    case 'year':
      return { from: startOfYearOf(anchor), to: endOfYearOf(anchor) }
    case 'all':
      return { from: null, to: null }
    case 'custom': {
      let from: string | null = isDateStr(range.from) ? range.from : null
      let to: string | null = isDateStr(range.to) ? range.to : null
      if (from && to && from > to) [from, to] = [to, from]
      return { from, to }
    }
    default:
      return { from: null, to: null }
  }
}

export function rangeLabel(range: RangeFilter): string {
  const { from, to } = resolveRange(range)
  switch (range.preset) {
    case 'month':
      return '本月'
    case 'year':
      return '今年'
    case 'all':
      return '全部'
    case 'custom':
      if (from && to) return `${from} 至 ${to}`
      if (from) return `${from} 起`
      if (to) return `截至 ${to}`
      return '自选日期（未设置）'
    default:
      return '全部'
  }
}

/** [a,b] 与 [from,to] 是否有交集；null 表示该端无界 */
export function rangesOverlap(
  aFrom: string | null,
  aTo: string | null,
  bFrom: string | null,
  bTo: string | null
): boolean {
  if (bFrom && aTo && aTo < bFrom) return false
  if (bTo && aFrom && aFrom > bTo) return false
  return true
}

export function isInRange(s: string | null | undefined, from: string | null, to: string | null): boolean {
  if (!s) return false
  if (from && s < from) return false
  if (to && s > to) return false
  return true
}

export function timeLabel(t: string | null): string {
  return t && isTimeStr(t) ? t : '未填写时间'
}

export function compareMatchesByTime(
  a: { startTime: string | null; date: string; id: number },
  b: { startTime: string | null; date: string; id: number }
): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1
  const at = a.startTime ?? '99:99'
  const bt = b.startTime ?? '99:99'
  if (at !== bt) return at < bt ? -1 : 1
  return a.id - b.id
}

export const DEFAULT_RANGE: RangeFilter = { preset: 'year', from: '', to: '', anchor: '' }

export function makeRange(preset: RangePreset, anchor = todayStr(), from = '', to = ''): RangeFilter {
  return { preset, from, to, anchor }
}
