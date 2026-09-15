/**
 * 首次启动的示例数据。
 *
 * 目的：新装好打开就能看到五个页面的完整效果（含统计口径、日历排布、归组与荣誉）。
 * 规则：
 *  - 只在「数据目录还是空的」且从未写过示例时写入一次，之后永不再写（标记文件在数据目录根部，
 *    不进备份，所以恢复旧备份也不会把示例带回来）；
 *  - 示例行带 is_sample 标记，设置页可一键删除，你自己录入的记录不受影响；
 *  - 同时把 sources/ 里的参考照片复制进照片库（只入库，不抢占当前背景）。
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { MatchCategory, MatchStatus, Side } from '@shared/types'
import { getPaths, resolveSourcesDir } from './paths'
import type { SqlDatabase } from './db/driver'
import {
  createEvent,
  createHonor,
  createMatch,
  countSamples,
  deleteSampleData,
  findEventIdByName,
  hasAnyData,
  listBackgroundOriginalNames,
  listSampleHonorNames,
  listSampleMatchTopics,
  type SampleCounts
} from './db/repo'
import { importPhotoBytes } from './backgrounds'
import { makeWritable } from './fsutil'

const MARKER_FILE = 'seed.json'
const SKIP_ENV = 'DEBATE_NOTES_SKIP_SAMPLE'

export interface SeedOutcome {
  seeded: boolean
  reason: string
  counts: SampleCounts
  photos: number
}

function markerPath(): string {
  return path.join(getPaths().dataDir, MARKER_FILE)
}

export function readSeedMarker(): { version: string; seededAt: string; note: string } | null {
  try {
    const p = markerPath()
    if (!existsSync(p)) return null
    return JSON.parse(readFileSync(p, 'utf8')) as { version: string; seededAt: string; note: string }
  } catch {
    return null
  }
}

function writeSeedMarker(note: string): void {
  try {
    const p = markerPath()
    writeFileSync(p, JSON.stringify({ version: '1.0.0', seededAt: new Date().toISOString(), note }, null, 2), 'utf8')
    makeWritable(p)
  } catch {
    /* 标记写不进去不影响使用，最多下次启动再判断一次 */
  }
}

/** 生成相对今天的日期字符串（跨年时收敛到今年年初，保证「今年」范围里看得到） */
function dayOffset(offset: number): string {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
  if (d.getFullYear() < now.getFullYear()) return `${now.getFullYear()}-01-02`
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface SampleMatch {
  day: number
  time: string | null
  topic: string
  category: MatchCategory
  event: string | null
  side: Side | null
  position: string | null
  status: MatchStatus
  best?: boolean
  comment: string
}

const SAMPLE_EVENTS: Array<{ name: string; result: string | null; note: string }> = [
  { name: '市大学生辩论赛', result: '冠军', note: '示例赛事：可以改名、改成绩，或者直接删掉' },
  { name: '校内辩论联赛', result: '四强', note: '示例赛事：小组赛 + 淘汰赛共三场' },
  { name: '网辩邀请赛', result: '亚军', note: '示例赛事：线上比赛，时间都在晚上' }
]

const SAMPLE_MATCHES: SampleMatch[] = [
  {
    day: 3,
    time: '14:00',
    topic: '人工智能应该拥有著作权',
    category: '正赛',
    event: '市大学生辩论赛',
    side: '正方',
    position: '一辩',
    status: '待赛',
    comment: '示例：还没比的比赛也会出现在日历里，赛前可以先把资料填上'
  },
  {
    day: 9,
    time: null,
    topic: '短视频对青少年利大于弊',
    category: '正赛',
    event: '校内辩论联赛',
    side: '反方',
    position: '二辩',
    status: '待赛',
    comment: '示例：待赛的比赛不计入已完成场次，也不进胜率'
  },
  {
    day: -2,
    time: '19:30',
    topic: '大学生创业应当缓行',
    category: '正赛',
    event: '市大学生辩论赛',
    side: '正方',
    position: '一辩',
    status: '未出结果',
    comment: '示例：比赛打完了但结果还没出来，可以先用「未出结果」占位'
  },
  {
    day: -5,
    time: '20:00',
    topic: '城市应该限制私家车',
    category: '正赛',
    event: '市大学生辩论赛',
    side: '反方',
    position: '四辩',
    status: '胜',
    best: true,
    comment: '示例：自由辩抓住对方数据口径的漏洞，总结陈词收得比较稳'
  },
  {
    day: -9,
    time: '14:30',
    topic: '网络实名制利大于弊',
    category: '正赛',
    event: '校内辩论联赛',
    side: '正方',
    position: '三辩',
    status: '胜',
    comment: '示例：质询环节把对方逼到了「隐私」单点上'
  },
  {
    day: -14,
    time: '19:00',
    topic: '高校应当取消绩点排名',
    category: '正赛',
    event: '市大学生辩论赛',
    side: '反方',
    position: '二辩',
    status: '负',
    comment: '示例：对「取消之后用什么替代」准备不足，被连续追问'
  },
  {
    day: -16,
    time: null,
    topic: '网辩是否降低了辩论的门槛',
    category: '正赛',
    event: '网辩邀请赛',
    side: '正方',
    position: '一辩',
    status: '胜',
    comment: '示例：没有填开赛时间，周视图里会单独放在「未填时间」区域'
  },
  {
    day: -19,
    time: '21:00',
    topic: '算法推荐应该公开源代码',
    category: '正赛',
    event: '网辩邀请赛',
    side: '反方',
    position: '三辩',
    status: '负',
    comment: '示例：晚上打比赛状态一般，立论偏保守'
  },
  {
    day: -23,
    time: '13:00',
    topic: '校内联赛模拟：应不应该给流浪猫绝育',
    category: '模拟赛',
    event: '校内辩论联赛',
    side: '正方',
    position: '一辩',
    status: '胜',
    best: true,
    comment: '示例：模拟赛也可以挂在赛事下面，统计时能单独筛出来'
  },
  {
    day: -27,
    time: null,
    topic: '模辩：大学该不该禁止外卖',
    category: '模拟赛',
    event: null,
    side: null,
    position: null,
    status: '无胜负',
    best: false,
    comment: '示例：模拟赛可以不挂赛事，也不一定分正反方'
  }
]

const SAMPLE_HONORS: Array<{ name: string; day: number; event: string | null; note: string }> = [
  { name: '最佳辩手', day: -5, event: '市大学生辩论赛', note: '示例荣誉：这条来自赛事，和单场最佳辩手分开统计' },
  { name: '优秀团队', day: -14, event: '校内辩论联赛', note: '示例荣誉：可以按获得日期归入时间范围' }
]

/** 把 sources/ 里的参考照片导入照片库（不设为当前背景）；skip 里的文件名不再重复导入 */
function seedPhotos(db: SqlDatabase, skip: Set<string> = new Set()): number {
  const dir = resolveSourcesDir()
  if (!dir) return 0
  let files: string[] = []
  try {
    files = readdirSync(dir)
      .filter((f) => /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f))
      .sort((a, b) => a.localeCompare(b, 'zh-CN'))
  } catch {
    return 0
  }
  let n = 0
  for (const f of files) {
    if (skip.has(f)) continue
    try {
      const bytes = readFileSync(path.join(dir, f))
      if (importPhotoBytes(db, f, bytes)) n += 1
    } catch {
      /* 单张失败不影响其它 */
    }
  }
  return n
}

/** 首次启动写入示例；返回本次实际做了什么 */
export function seedSamplesIfNeeded(db: SqlDatabase): SeedOutcome {
  const empty: SampleCounts = { matches: 0, events: 0, honors: 0 }
  if (process.env[SKIP_ENV] === '1') {
    return { seeded: false, reason: 'skip-env', counts: empty, photos: 0 }
  }
  if (readSeedMarker()) {
    return { seeded: false, reason: 'already-marked', counts: countSamples(db), photos: 0 }
  }
  if (hasAnyData(db)) {
    writeSeedMarker('已有数据，未写入示例')
    return { seeded: false, reason: 'existing-data', counts: empty, photos: 0 }
  }

  const eventIds = new Map<string, number>()
  for (const e of SAMPLE_EVENTS) {
    const created = createEvent(db, { name: e.name, result: e.result, note: e.note }, { isSample: true })
    eventIds.set(e.name, created.id)
  }
  for (const m of SAMPLE_MATCHES) {
    createMatch(
      db,
      {
        date: dayOffset(m.day),
        startTime: m.time,
        topic: m.topic,
        category: m.category,
        eventId: m.event ? (eventIds.get(m.event) ?? null) : null,
        side: m.side,
        position: m.position,
        status: m.status,
        isBestDebater: Boolean(m.best),
        comment: m.comment
      },
      { isSample: true }
    )
  }
  for (const h of SAMPLE_HONORS) {
    createHonor(
      db,
      {
        name: h.name,
        date: dayOffset(h.day),
        eventId: h.event ? (eventIds.get(h.event) ?? null) : null,
        note: h.note
      },
      { isSample: true }
    )
  }
  const photos = seedPhotos(db)
  writeSeedMarker(`已写入示例数据（照片 ${photos} 张）`)
  return { seeded: true, reason: 'seeded', counts: countSamples(db), photos }
}

/** 删除全部示例数据（照片保留） */
export function removeSamples(db: SqlDatabase): SampleCounts {
  return deleteSampleData(db)
}

export interface ReseedOutcome {
  /** 写入后的示例总数 */
  counts: SampleCounts
  /** 本次实际补上的数量 */
  added: SampleCounts
  /** 本次补进来的照片张数 */
  photos: number
}

/**
 * 手动重新写入示例数据（设置页「重新写入示例数据」按钮）。
 * 与首次启动的区别：不管之前有没有删过、标记文件在不在，都会补齐缺失的部分。
 *  - 同名的赛事直接复用，同辩题的示例比赛、同名的示例荣誉、同名的照片一律跳过，所以可以反复点；
 *  - 你自己录入的记录完全不动；
 *  - 日期按「今天」重新计算，所以赛期会跟着当前时间走。
 */
export function reseedSamples(db: SqlDatabase): ReseedOutcome {
  const existingTopics = new Set(listSampleMatchTopics(db))
  const existingHonors = new Set(listSampleHonorNames(db))
  const existingPhotos = new Set(listBackgroundOriginalNames(db))

  const added: SampleCounts = { matches: 0, events: 0, honors: 0 }
  const eventIds = new Map<string, number>()

  for (const e of SAMPLE_EVENTS) {
    const found = findEventIdByName(db, e.name)
    if (found !== null) {
      eventIds.set(e.name, found)
      continue
    }
    const created = createEvent(db, { name: e.name, result: e.result, note: e.note }, { isSample: true })
    eventIds.set(e.name, created.id)
    added.events += 1
  }

  for (const m of SAMPLE_MATCHES) {
    if (existingTopics.has(m.topic)) continue
    createMatch(
      db,
      {
        date: dayOffset(m.day),
        startTime: m.time,
        topic: m.topic,
        category: m.category,
        eventId: m.event ? (eventIds.get(m.event) ?? null) : null,
        side: m.side,
        position: m.position,
        status: m.status,
        isBestDebater: Boolean(m.best),
        comment: m.comment
      },
      { isSample: true }
    )
    added.matches += 1
  }

  for (const h of SAMPLE_HONORS) {
    if (existingHonors.has(h.name)) continue
    createHonor(
      db,
      {
        name: h.name,
        date: dayOffset(h.day),
        eventId: h.event ? (eventIds.get(h.event) ?? null) : null,
        note: h.note
      },
      { isSample: true }
    )
    added.honors += 1
  }

  const photos = seedPhotos(db, existingPhotos)
  writeSeedMarker(`已按设置页操作重新写入示例数据（新增照片 ${photos} 张）`)
  return { counts: countSamples(db), added, photos }
}
