/** 履历（Resume）数据结构与两种导出文本的生成 —— 主进程与渲染进程共用，保证口径一致。 */

import { formatCn, timeLabel, weekdayCn } from './date'
import type { Honor, Match, MatchStatus } from './types'

export interface ResumeEventGroup {
  eventId: number | null
  eventName: string
  result: string | null
  note: string
  startDate: string | null
  endDate: string | null
  matches: Match[]
  wins: number
  losses: number
  draws: number
  unknown: number
  pending: number
  bestDebaterCount: number
}

export interface ResumeEventResult {
  eventId: number
  name: string
  result: string | null
  startDate: string | null
  endDate: string | null
  matchCount: number
  wins: number
  losses: number
  note: string
}

export interface ResumeData {
  rangeLabel: string
  from: string | null
  to: string | null
  generatedAt: string
  /** 参赛经历：按赛事分组，另有未归属赛事的比赛 */
  experience: ResumeEventGroup[]
  unassigned: Match[]
  /** 赛事成绩 */
  eventResults: ResumeEventResult[]
  /** 手动录入的荣誉 */
  honors: Honor[]
  /** 单场最佳辩手：由比赛记录自动汇总，无需重复录入 */
  bestDebaters: Match[]
  totals: {
    matches: number
    wins: number
    losses: number
    draws: number
    unknown: number
    pending: number
    winRate: number | null
    bestDebaterCount: number
    honorCount: number
  }
}

export type ResumeTextFormat = 'text' | 'markdown'

function winRateText(rate: number | null): string {
  return rate === null ? '暂无' : `${(rate * 100).toFixed(1)}%`
}

function matchLine(m: Match): string {
  const bits: string[] = []
  bits.push(m.date)
  if (m.startTime) bits.push(m.startTime)
  bits.push(m.category)
  if (m.side) bits.push(m.side)
  if (m.position) bits.push(m.position)
  bits.push(m.status)
  if (m.isBestDebater) bits.push('最佳辩手')
  const head = bits.join(' · ')
  const tail = m.topic ? `　${m.topic}` : ''
  const comment = m.comment ? `　（${m.comment.replace(/\s+/g, ' ').trim()}）` : ''
  return `${head}${tail}${comment}`
}

function eventRangeText(g: { startDate: string | null; endDate: string | null }): string {
  if (!g.startDate && !g.endDate) return ''
  if (g.startDate && g.endDate && g.startDate !== g.endDate) return `${g.startDate} ~ ${g.endDate}`
  return g.startDate ?? g.endDate ?? ''
}

/** 生成可复制的履历文字 */
export function buildResumeText(data: ResumeData, format: ResumeTextFormat): string {
  const L: string[] = []
  const h = (level: number, text: string): void => {
    if (format === 'markdown') L.push(`${'#'.repeat(level)} ${text}`, '')
    else {
      const marks = ['', '一、', '（一）', '1. ']
      L.push(`${marks[Math.min(level, 3)] ?? ''}${text}`, '')
    }
  }
  const li = (text: string): void => {
    L.push(format === 'markdown' ? `- ${text}` : `　· ${text}`)
  }

  const title = format === 'markdown' ? '辩论履历' : '辩 论 履 历'
  L.push(format === 'markdown' ? `# ${title}` : title, '')
  L.push(`统计范围：${data.rangeLabel}`)
  L.push(
    `共 ${data.totals.matches} 场（胜 ${data.totals.wins} / 负 ${data.totals.losses} / 无胜负 ${data.totals.draws}` +
      `${data.totals.unknown ? ` / 未出结果 ${data.totals.unknown}` : ''}` +
      `${data.totals.pending ? ` / 待赛 ${data.totals.pending}` : ''}），胜率 ${winRateText(data.totals.winRate)}`
  )
  L.push('')

  h(2, '参赛经历')
  if (data.experience.length === 0 && data.unassigned.length === 0) {
    L.push('（本时间段内没有比赛记录）', '')
  }
  for (const g of data.experience) {
    const seg = eventRangeText(g)
    const head = `${g.eventName}${g.result ? `　成绩：${g.result}` : ''}${seg ? `　赛期：${seg}` : ''}`
    if (format === 'markdown') L.push(`### ${head}`, '')
    else L.push(`${head}`, '')
    li(`战绩：${g.matches.length} 场，胜 ${g.wins} / 负 ${g.losses} / 无胜负 ${g.draws}${g.unknown ? ` / 未出结果 ${g.unknown}` : ''}${g.pending ? ` / 待赛 ${g.pending}` : ''}`)
    for (const m of g.matches) li(matchLine(m))
    L.push('')
  }
  if (data.unassigned.length > 0) {
    const head = '未归属赛事的比赛'
    if (format === 'markdown') L.push(`### ${head}`, '')
    else L.push(head, '')
    for (const m of data.unassigned) li(matchLine(m))
    L.push('')
  }

  h(2, '赛事成绩')
  if (data.eventResults.length === 0) {
    L.push('（本时间段内没有赛事成绩）', '')
  } else {
    for (const e of data.eventResults) {
      const seg = eventRangeText(e)
      li(
        `${e.name}　${e.result ?? '成绩未填写'}${seg ? `　赛期：${seg}` : ''}　战绩：${e.matchCount} 场 / 胜 ${e.wins} 负 ${e.losses}`
      )
    }
    L.push('')
  }

  h(2, '荣誉')
  if (data.honors.length === 0 && data.bestDebaters.length === 0) {
    L.push('（本时间段内没有荣誉记录）', '')
  } else {
    for (const o of data.honors) {
      li(`${o.date}　${o.name}${o.eventName ? `（${o.eventName}）` : ''}${o.note ? `　${o.note}` : ''}`)
    }
    if (data.bestDebaters.length > 0) {
      li(`单场最佳辩手 ${data.bestDebaters.length} 次（由比赛记录自动汇总）`)
      for (const m of data.bestDebaters) {
        const where = m.eventName ? `${m.eventName} · ` : ''
        li(`　　${m.date}　${where}${m.topic}${m.position ? `（${m.position}）` : ''}`)
      }
    }
    L.push('')
  }

  L.push(`（生成时间：${data.generatedAt}）`)
  return L.join('\n').replace(/\n{3,}/g, '\n\n')
}

export function statusCounts(matches: Match[]): Record<MatchStatus, number> {
  const out: Record<MatchStatus, number> = { 待赛: 0, 未出结果: 0, 胜: 0, 负: 0, 无胜负: 0 }
  for (const m of matches) out[m.status] += 1
  return out
}

export function matchSummaryLine(m: Match): string {
  return `${formatCn(m.date)}${m.startTime ? ` ${m.startTime}` : ` ${timeLabel(m.startTime)}`} · ${m.status} · ${m.topic}`
}

export function weekdayOf(dateStr: string): string {
  return weekdayCn(dateStr)
}
