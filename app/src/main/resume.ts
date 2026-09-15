/** 履历数据组装：参赛经历（按赛事分组）、赛事成绩、荣誉（含自动汇总的单场最佳辩手）。 */

import { resolveRange, rangeLabel } from '@shared/date'
import type { ResumeData, ResumeEventGroup } from '@shared/resume'
import type { RangeFilter } from '@shared/types'
import type { SqlDatabase } from './db/driver'
import { listEvents, listHonors, listMatches } from './db/repo'

export function buildResume(db: SqlDatabase, range: RangeFilter): ResumeData {
  const { from, to } = resolveRange(range)
  const matches = listMatches(db, { from, to, order: 'date-asc' })
  const events = listEvents(db)
  const honors = listHonors(db, { from, to })

  const wins = matches.filter((m) => m.status === '胜').length
  const losses = matches.filter((m) => m.status === '负').length
  const draws = matches.filter((m) => m.status === '无胜负').length
  const unknown = matches.filter((m) => m.status === '未出结果').length
  const pending = matches.filter((m) => m.status === '待赛').length
  const bestDebaters = matches.filter((m) => m.isBestDebater).slice().reverse()
  const decisive = wins + losses

  const experience: ResumeEventGroup[] = []
  for (const e of events) {
    const group = matches.filter((m) => m.eventId === e.id)
    if (group.length === 0) continue
    experience.push({
      eventId: e.id,
      eventName: e.name,
      result: e.result,
      note: e.note,
      startDate: e.startDate,
      endDate: e.endDate,
      matches: group,
      wins: group.filter((m) => m.status === '胜').length,
      losses: group.filter((m) => m.status === '负').length,
      draws: group.filter((m) => m.status === '无胜负').length,
      unknown: group.filter((m) => m.status === '未出结果').length,
      pending: group.filter((m) => m.status === '待赛').length,
      bestDebaterCount: group.filter((m) => m.isBestDebater).length
    })
  }
  experience.sort((a, b) => String(b.startDate ?? '').localeCompare(String(a.startDate ?? '')))

  const eventResults = experience.map((g) => ({
    eventId: g.eventId as number,
    name: g.eventName,
    result: g.result,
    startDate: g.startDate,
    endDate: g.endDate,
    matchCount: g.matches.length,
    wins: g.wins,
    losses: g.losses,
    note: g.note
  }))

  return {
    rangeLabel: rangeLabel(range),
    from,
    to,
    generatedAt: new Date().toLocaleString('zh-CN'),
    experience,
    unassigned: matches.filter((m) => m.eventId === null),
    eventResults,
    honors,
    bestDebaters,
    totals: {
      matches: matches.length,
      wins,
      losses,
      draws,
      unknown,
      pending,
      winRate: decisive > 0 ? wins / decisive : null,
      bestDebaterCount: bestDebaters.length,
      honorCount: honors.length
    }
  }
}
