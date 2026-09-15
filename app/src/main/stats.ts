/** 战绩统计。为避免口径漂移，统计与列表共用 listMatches 同一条查询路径。 */

import { rangesOverlap, resolveRange } from '@shared/date'
import type { Match, MatchCategory, OverviewFilter, OverviewStats } from '@shared/types'
import { MATCH_CATEGORIES } from '@shared/types'
import type { SqlDatabase } from './db/driver'
import { listEvents, listHonors, listMatches } from './db/repo'

interface Bucket {
  finished: number
  wins: number
  losses: number
  draws: number
  unknown: number
  pending: number
  winRate: number | null
  bestDebaterCount: number
}

function emptyBucket(): Bucket {
  return { finished: 0, wins: 0, losses: 0, draws: 0, unknown: 0, pending: 0, winRate: null, bestDebaterCount: 0 }
}

function finishBucket(b: Bucket): Bucket {
  const decisive = b.wins + b.losses
  b.winRate = decisive > 0 ? b.wins / decisive : null
  b.finished = b.wins + b.losses + b.draws + b.unknown
  return b
}

function accumulate(b: Bucket, m: Match): void {
  switch (m.status) {
    case '待赛':
      b.pending += 1
      break
    case '胜':
      b.wins += 1
      break
    case '负':
      b.losses += 1
      break
    case '无胜负':
      b.draws += 1
      break
    case '未出结果':
      b.unknown += 1
      break
  }
  if (m.isBestDebater) b.bestDebaterCount += 1
}

export function buildOverview(db: SqlDatabase, filter: OverviewFilter): OverviewStats {
  const { from, to } = resolveRange(filter.range)

  const matches = listMatches(db, {
    from,
    to,
    category: filter.category ?? 'all',
    eventId: filter.eventId ?? 'all',
    order: 'date-desc'
  })

  const total = emptyBucket()
  const byCategory = {
    正赛: emptyBucket(),
    模拟赛: emptyBucket()
  } as Record<MatchCategory, Bucket>

  for (const m of matches) {
    accumulate(total, m)
    accumulate(byCategory[m.category], m)
  }
  finishBucket(total)
  for (const c of MATCH_CATEGORIES) finishBucket(byCategory[c])

  const honors = listHonors(db, { from, to, eventId: filter.eventId ?? 'all' })

  // 赛事成绩：在筛选条件下至少有比赛的赛事；另含「没有比赛、只有成绩」且赛期落在范围内的赛事
  const events = listEvents(db)
  const eventResults: OverviewStats['eventResults'] = []
  if (filter.eventId !== 'none') {
    for (const e of events) {
      if (typeof filter.eventId === 'number' && e.id !== filter.eventId) continue
      const inFilter = matches.filter((m) => m.eventId === e.id)
      const include =
        inFilter.length > 0 ||
        (e.matchCount === 0 &&
          (filter.category ?? 'all') === 'all' &&
          rangesOverlap(e.startDate, e.endDate, from, to))
      if (!include) continue
      eventResults.push({
        eventId: e.id,
        name: e.name,
        result: e.result,
        startDate: e.startDate,
        endDate: e.endDate,
        matchCount: inFilter.length,
        wins: inFilter.filter((m) => m.status === '胜').length,
        losses: inFilter.filter((m) => m.status === '负').length
      })
    }
    eventResults.sort((a, b) => String(b.startDate ?? '').localeCompare(String(a.startDate ?? '')))
  }

  return {
    pending: total.pending,
    finished: total.finished,
    wins: total.wins,
    losses: total.losses,
    draws: total.draws,
    unknown: total.unknown,
    total: matches.length,
    winRate: total.winRate,
    bestDebaterCount: total.bestDebaterCount,
    honorCount: honors.length,
    byCategory,
    eventResults,
    recent: matches.slice(0, 8),
    honors: honors.slice(0, 20)
  }
}
