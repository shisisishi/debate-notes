/** 仓储层：比赛 / 赛事 / 荣誉 / 可扩展选项 / 背景照片的读写与校验。 */

import { isDateStr, isTimeStr } from '@shared/date'
import {
  MATCH_CATEGORIES,
  MATCH_STATUSES,
  SIDES,
  type DebateEvent,
  type DebateEventInput,
  type Honor,
  type HonorInput,
  type Match,
  type MatchCategory,
  type MatchInput,
  type MatchQuery,
  type MatchStatus,
  type OptionItem,
  type OptionKind,
  type Side
} from '@shared/types'
import type { SqlDatabase } from './driver'
import { inTransaction } from './driver'
import { isOptionKind } from './schema'

export class AppError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AppError'
  }
}

function nowIso(): string {
  return new Date().toISOString()
}

function asText(v: unknown): string {
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number') return String(v)
  return ''
}

function requireDate(v: unknown, field: string): string {
  const s = asText(v)
  if (!isDateStr(s)) throw new AppError(`${field}必须是合法日期（YYYY-MM-DD）`)
  return s
}

function optionalTime(v: unknown): string | null {
  const s = asText(v)
  if (!s) return null
  if (!isTimeStr(s)) throw new AppError('开赛时间格式应为 HH:MM')
  return s
}

function requireEnum<T extends string>(v: unknown, allowed: readonly T[], field: string): T {
  const s = asText(v)
  if ((allowed as readonly string[]).includes(s)) return s as T
  throw new AppError(`${field}取值不合法`)
}

function optionalEnum<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  const s = asText(v)
  if (!s) return null
  return (allowed as readonly string[]).includes(s) ? (s as T) : null
}

/** ---- 比赛 ---- */

interface MatchRow {
  id: number
  date: string
  start_time: string | null
  topic: string
  category: string
  event_id: number | null
  event_name: string | null
  side: string | null
  position: string | null
  status: string
  is_best_debater: number
  comment: string
  is_sample: number
  created_at: string
  updated_at: string
}

function mapMatch(row: MatchRow): Match {
  return {
    id: Number(row.id),
    date: row.date,
    startTime: row.start_time,
    topic: row.topic,
    category: row.category as MatchCategory,
    eventId: row.event_id === null ? null : Number(row.event_id),
    eventName: row.event_name ?? null,
    side: (row.side as Side | null) ?? null,
    position: row.position,
    status: row.status as MatchStatus,
    isBestDebater: Number(row.is_best_debater) === 1,
    comment: row.comment,
    isSample: Number(row.is_sample) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

const MATCH_SELECT = `
SELECT m.id, m.date, m.start_time, m.topic, m.category, m.event_id, e.name AS event_name,
       m.side, m.position, m.status, m.is_best_debater, m.comment, m.is_sample, m.created_at, m.updated_at
FROM matches m
LEFT JOIN events e ON e.id = m.event_id
`

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`)
}

export function listMatches(db: SqlDatabase, query: MatchQuery = {}): Match[] {
  const where: string[] = []
  const params: Array<string | number | null> = []

  const keyword = asText(query.keyword)
  if (keyword) {
    const like = `%${escapeLike(keyword)}%`
    where.push(
      "(m.topic LIKE ? ESCAPE '\\' OR m.comment LIKE ? ESCAPE '\\' OR m.position LIKE ? ESCAPE '\\' OR IFNULL(e.name,'') LIKE ? ESCAPE '\\')"
    )
    params.push(like, like, like, like)
  }
  if (query.from) {
    where.push('m.date >= ?')
    params.push(query.from)
  }
  if (query.to) {
    where.push('m.date <= ?')
    params.push(query.to)
  }
  if (query.category && query.category !== 'all') {
    where.push('m.category = ?')
    params.push(query.category)
  }
  if (query.eventId !== undefined && query.eventId !== 'all') {
    if (query.eventId === 'none') {
      where.push('m.event_id IS NULL')
    } else {
      where.push('m.event_id = ?')
      params.push(query.eventId)
    }
  }
  if (query.status && query.status !== 'all') {
    where.push('m.status = ?')
    params.push(query.status)
  }

  const order =
    query.order === 'date-asc'
      ? 'ORDER BY m.date ASC, (m.start_time IS NULL) ASC, m.start_time ASC, m.id ASC'
      : 'ORDER BY m.date DESC, (m.start_time IS NULL) ASC, m.start_time DESC, m.id DESC'

  const sql = `${MATCH_SELECT}${where.length ? `WHERE ${where.join(' AND ')}` : ''} ${order}`
  return db.prepare(sql).all<MatchRow>(...params).map(mapMatch)
}

export function getMatch(db: SqlDatabase, id: number): Match | null {
  const row = db.prepare(`${MATCH_SELECT} WHERE m.id = ?`).get<MatchRow>(id)
  return row ? mapMatch(row) : null
}

function normalizeMatchInput(db: SqlDatabase, input: MatchInput): {
  date: string
  startTime: string | null
  topic: string
  category: MatchCategory
  eventId: number | null
  side: Side | null
  position: string | null
  status: MatchStatus
  isBestDebater: number
  comment: string
} {
  const date = requireDate(input?.date, '比赛日期')
  const topic = asText(input?.topic)
  if (!topic) throw new AppError('辩题不能为空')
  const category = requireEnum<MatchCategory>(input?.category, MATCH_CATEGORIES, '比赛类型')
  const status = requireEnum<MatchStatus>(input?.status, MATCH_STATUSES, '比赛状态')
  const side = optionalEnum<Side>(input?.side, SIDES)
  const startTime = optionalTime(input?.startTime)
  const position = asText(input?.position) || null

  let eventId: number | null = null
  if (input?.eventId !== null && input?.eventId !== undefined && `${input.eventId}` !== '') {
    const id = Number(input.eventId)
    if (!Number.isInteger(id) || id <= 0) throw new AppError('所属赛事不合法')
    const exists = db.prepare('SELECT id FROM events WHERE id = ?').get<{ id: number }>(id)
    if (!exists) throw new AppError('所选赛事不存在，可能已被删除')
    eventId = id
  }

  return {
    date,
    startTime,
    topic,
    category,
    eventId,
    side,
    position,
    status,
    isBestDebater: input?.isBestDebater ? 1 : 0,
    comment: asText(input?.comment)
  }
}

export function createMatch(db: SqlDatabase, input: MatchInput, opts: { isSample?: boolean } = {}): Match {
  const v = normalizeMatchInput(db, input)
  const ts = nowIso()
  const res = db
    .prepare(
      `INSERT INTO matches (date, start_time, topic, category, event_id, side, position, status, is_best_debater, comment, is_sample, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      v.date,
      v.startTime,
      v.topic,
      v.category,
      v.eventId,
      v.side,
      v.position,
      v.status,
      v.isBestDebater,
      v.comment,
      opts.isSample ? 1 : 0,
      ts,
      ts
    )
  const created = getMatch(db, res.lastInsertRowid)
  if (!created) throw new AppError('保存比赛失败')
  return created
}

export function updateMatch(db: SqlDatabase, id: number, input: MatchInput): Match {
  const existing = getMatch(db, id)
  if (!existing) throw new AppError('要修改的比赛不存在')
  const v = normalizeMatchInput(db, input)
  db.prepare(
    `UPDATE matches SET date = ?, start_time = ?, topic = ?, category = ?, event_id = ?, side = ?, position = ?,
       status = ?, is_best_debater = ?, comment = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    v.date,
    v.startTime,
    v.topic,
    v.category,
    v.eventId,
    v.side,
    v.position,
    v.status,
    v.isBestDebater,
    v.comment,
    nowIso(),
    id
  )
  const updated = getMatch(db, id)
  if (!updated) throw new AppError('保存比赛失败')
  return updated
}

export function deleteMatch(db: SqlDatabase, id: number): void {
  const res = db.prepare('DELETE FROM matches WHERE id = ?').run(id)
  if (res.changes === 0) throw new AppError('要删除的比赛不存在')
}

/** ---- 赛事 ---- */

interface EventRow {
  id: number
  name: string
  result: string | null
  note: string
  is_sample: number
  created_at: string
  updated_at: string
  match_count: number
  win_count: number
  loss_count: number
  best_debater_count: number
  min_date: string | null
  max_date: string | null
}

function mapEvent(row: EventRow): DebateEvent {
  return {
    id: Number(row.id),
    name: row.name,
    result: row.result,
    note: row.note,
    isSample: Number(row.is_sample) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    matchCount: Number(row.match_count ?? 0),
    winCount: Number(row.win_count ?? 0),
    lossCount: Number(row.loss_count ?? 0),
    bestDebaterCount: Number(row.best_debater_count ?? 0),
    startDate: row.min_date ?? row.created_at.slice(0, 10),
    endDate: row.max_date ?? row.created_at.slice(0, 10),
    hasExplicitRange: row.min_date !== null
  }
}

const EVENT_SELECT = `
SELECT e.id, e.name, e.result, e.note, e.is_sample, e.created_at, e.updated_at,
  (SELECT COUNT(*) FROM matches m WHERE m.event_id = e.id) AS match_count,
  (SELECT COUNT(*) FROM matches m WHERE m.event_id = e.id AND m.status = '胜') AS win_count,
  (SELECT COUNT(*) FROM matches m WHERE m.event_id = e.id AND m.status = '负') AS loss_count,
  (SELECT COUNT(*) FROM matches m WHERE m.event_id = e.id AND m.is_best_debater = 1) AS best_debater_count,
  (SELECT MIN(m.date) FROM matches m WHERE m.event_id = e.id) AS min_date,
  (SELECT MAX(m.date) FROM matches m WHERE m.event_id = e.id) AS max_date
FROM events e
`

export function listEvents(db: SqlDatabase): DebateEvent[] {
  return db.prepare(`${EVENT_SELECT} ORDER BY (min_date IS NULL) ASC, min_date DESC, e.name ASC`).all<EventRow>().map(mapEvent)
}

export function getEvent(db: SqlDatabase, id: number): DebateEvent | null {
  const row = db.prepare(`${EVENT_SELECT} WHERE e.id = ?`).get<EventRow>(id)
  return row ? mapEvent(row) : null
}

function findEventByName(db: SqlDatabase, name: string): DebateEvent | null {
  const row = db.prepare(`${EVENT_SELECT} WHERE e.name = ? COLLATE NOCASE`).get<EventRow>(name)
  return row ? mapEvent(row) : null
}

function normalizeEventInput(input: DebateEventInput): { name: string; result: string | null; note: string } {
  const name = asText(input?.name)
  if (!name) throw new AppError('赛事名称不能为空')
  if (name.length > 120) throw new AppError('赛事名称过长')
  return { name, result: asText(input?.result) || null, note: asText(input?.note) }
}

/** 新建赛事；若同名赛事已存在则直接返回它（避免用户重复创建） */
export function createEvent(db: SqlDatabase, input: DebateEventInput, opts: { isSample?: boolean } = {}): DebateEvent {
  const v = normalizeEventInput(input)
  const existing = findEventByName(db, v.name)
  if (existing) {
    if (v.result && !existing.result) {
      db.prepare('UPDATE events SET result = ?, updated_at = ? WHERE id = ?').run(v.result, nowIso(), existing.id)
      return getEvent(db, existing.id) as DebateEvent
    }
    return existing
  }
  const ts = nowIso()
  const res = db
    .prepare('INSERT INTO events (name, result, note, is_sample, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(v.name, v.result, v.note, opts.isSample ? 1 : 0, ts, ts)
  const created = getEvent(db, res.lastInsertRowid)
  if (!created) throw new AppError('保存赛事失败')
  return created
}

export function updateEvent(db: SqlDatabase, id: number, input: DebateEventInput): DebateEvent {
  const existing = getEvent(db, id)
  if (!existing) throw new AppError('要修改的赛事不存在')
  const v = normalizeEventInput(input)
  const clash = db
    .prepare('SELECT id FROM events WHERE name = ? COLLATE NOCASE AND id <> ?')
    .get<{ id: number }>(v.name, id)
  if (clash) throw new AppError(`已存在同名赛事「${v.name}」`)
  db.prepare('UPDATE events SET name = ?, result = ?, note = ?, updated_at = ? WHERE id = ?').run(
    v.name,
    v.result,
    v.note,
    nowIso(),
    id
  )
  const updated = getEvent(db, id)
  if (!updated) throw new AppError('保存赛事失败')
  return updated
}

export function deleteEvent(db: SqlDatabase, id: number): void {
  const res = db.prepare('DELETE FROM events WHERE id = ?').run(id)
  if (res.changes === 0) throw new AppError('要删除的赛事不存在')
}

export function countMatchesOfEvent(db: SqlDatabase, id: number): number {
  const row = db.prepare('SELECT COUNT(*) AS c FROM matches WHERE event_id = ?').get<{ c: number }>(id)
  return row ? Number(row.c) : 0
}

/** ---- 荣誉 ---- */

interface HonorRow {
  id: number
  name: string
  date: string
  event_id: number | null
  event_name: string | null
  note: string
  is_sample: number
  created_at: string
  updated_at: string
}

function mapHonor(row: HonorRow): Honor {
  return {
    id: Number(row.id),
    name: row.name,
    date: row.date,
    eventId: row.event_id === null ? null : Number(row.event_id),
    eventName: row.event_name ?? null,
    note: row.note,
    isSample: Number(row.is_sample) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

const HONOR_SELECT = `
SELECT h.id, h.name, h.date, h.event_id, e.name AS event_name, h.note, h.is_sample, h.created_at, h.updated_at
FROM honors h
LEFT JOIN events e ON e.id = h.event_id
`

export function listHonors(
  db: SqlDatabase,
  query: { from?: string | null; to?: string | null; eventId?: number | 'all' | 'none' } = {}
): Honor[] {
  const where: string[] = []
  const params: Array<string | number> = []
  if (query.from) {
    where.push('h.date >= ?')
    params.push(query.from)
  }
  if (query.to) {
    where.push('h.date <= ?')
    params.push(query.to)
  }
  if (query.eventId !== undefined && query.eventId !== 'all') {
    if (query.eventId === 'none') where.push('h.event_id IS NULL')
    else {
      where.push('h.event_id = ?')
      params.push(query.eventId)
    }
  }
  const sql = `${HONOR_SELECT}${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY h.date DESC, h.id DESC`
  return db.prepare(sql).all<HonorRow>(...params).map(mapHonor)
}

export function getHonor(db: SqlDatabase, id: number): Honor | null {
  const row = db.prepare(`${HONOR_SELECT} WHERE h.id = ?`).get<HonorRow>(id)
  return row ? mapHonor(row) : null
}

function normalizeHonorInput(db: SqlDatabase, input: HonorInput): { name: string; date: string; eventId: number | null; note: string } {
  const name = asText(input?.name)
  if (!name) throw new AppError('荣誉名称不能为空')
  const date = requireDate(input?.date, '获得日期')
  let eventId: number | null = null
  if (input?.eventId !== null && input?.eventId !== undefined && `${input.eventId}` !== '') {
    const id = Number(input.eventId)
    if (!Number.isInteger(id) || id <= 0) throw new AppError('所属赛事不合法')
    const exists = db.prepare('SELECT id FROM events WHERE id = ?').get<{ id: number }>(id)
    if (!exists) throw new AppError('所选赛事不存在，可能已被删除')
    eventId = id
  }
  return { name, date, eventId, note: asText(input?.note) }
}

export function createHonor(db: SqlDatabase, input: HonorInput, opts: { isSample?: boolean } = {}): Honor {
  const v = normalizeHonorInput(db, input)
  const ts = nowIso()
  const res = db
    .prepare('INSERT INTO honors (name, date, event_id, note, is_sample, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(v.name, v.date, v.eventId, v.note, opts.isSample ? 1 : 0, ts, ts)
  const created = getHonor(db, res.lastInsertRowid)
  if (!created) throw new AppError('保存荣誉失败')
  return created
}

export function updateHonor(db: SqlDatabase, id: number, input: HonorInput): Honor {
  const existing = getHonor(db, id)
  if (!existing) throw new AppError('要修改的荣誉不存在')
  const v = normalizeHonorInput(db, input)
  db.prepare('UPDATE honors SET name = ?, date = ?, event_id = ?, note = ?, updated_at = ? WHERE id = ?').run(
    v.name,
    v.date,
    v.eventId,
    v.note,
    nowIso(),
    id
  )
  const updated = getHonor(db, id)
  if (!updated) throw new AppError('保存荣誉失败')
  return updated
}

export function deleteHonor(db: SqlDatabase, id: number): void {
  const res = db.prepare('DELETE FROM honors WHERE id = ?').run(id)
  if (res.changes === 0) throw new AppError('要删除的荣誉不存在')
}

/** ---- 示例数据 ---- */

export interface SampleCounts {
  matches: number
  events: number
  honors: number
}

export function countSamples(db: SqlDatabase): SampleCounts {
  const one = (table: string): number => {
    const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE is_sample = 1`).get<{ c: number }>()
    return row ? Number(row.c) : 0
  }
  return { matches: one('matches'), events: one('events'), honors: one('honors') }
}

export function hasAnyData(db: SqlDatabase): boolean {
  const c = countAll(db)
  return c.matches + c.events + c.honors + c.backgrounds > 0
}

/** 只删除示例行，用户自己录入的数据不受影响（照片也不会被删） */
export function deleteSampleData(db: SqlDatabase): SampleCounts {
  const before = countSamples(db)
  inTransaction(db, () => {
    db.prepare('DELETE FROM matches WHERE is_sample = 1').run()
    db.prepare('DELETE FROM honors WHERE is_sample = 1').run()
    db.prepare('DELETE FROM events WHERE is_sample = 1').run()
  })
  return before
}

/** ---- 重新写入示例时的去重查询 ---- */

export function findEventIdByName(db: SqlDatabase, name: string): number | null {
  const row = db.prepare('SELECT id FROM events WHERE name = ? ORDER BY id LIMIT 1').get<{ id: number }>(name)
  return row ? Number(row.id) : null
}

export function listSampleMatchTopics(db: SqlDatabase): string[] {
  return db
    .prepare('SELECT topic FROM matches WHERE is_sample = 1')
    .all<{ topic: string }>()
    .map((r) => r.topic)
}

export function listSampleHonorNames(db: SqlDatabase): string[] {
  return db
    .prepare('SELECT name FROM honors WHERE is_sample = 1')
    .all<{ name: string }>()
    .map((r) => r.name)
}

export function listBackgroundOriginalNames(db: SqlDatabase): string[] {
  return db
    .prepare('SELECT original_name FROM backgrounds')
    .all<{ original_name: string }>()
    .map((r) => r.original_name)
}

/** ---- 可扩展选项 ---- */

export function listOptions(db: SqlDatabase): OptionItem[] {
  const rows = db
    .prepare('SELECT id, kind, value, sort_order, builtin FROM options ORDER BY kind ASC, sort_order ASC, id ASC')
    .all<{ id: number; kind: string; value: string; sort_order: number; builtin: number }>()
  return rows
    .filter((r) => isOptionKind(r.kind))
    .map((r) => ({
      id: Number(r.id),
      kind: r.kind as OptionKind,
      value: r.value,
      sortOrder: Number(r.sort_order),
      builtin: Number(r.builtin) === 1
    }))
}

export function addOption(db: SqlDatabase, kind: OptionKind, value: string): OptionItem {
  if (!isOptionKind(kind)) throw new AppError('选项类别不合法')
  const v = asText(value)
  if (!v) throw new AppError('选项内容不能为空')
  if (v.length > 60) throw new AppError('选项内容过长')
  const existing = db.prepare('SELECT id, kind, value, sort_order, builtin FROM options WHERE kind = ? AND value = ?').get<{
    id: number
    kind: string
    value: string
    sort_order: number
    builtin: number
  }>(kind, v)
  if (existing) {
    return {
      id: Number(existing.id),
      kind: existing.kind as OptionKind,
      value: existing.value,
      sortOrder: Number(existing.sort_order),
      builtin: Number(existing.builtin) === 1
    }
  }
  const maxRow = db.prepare('SELECT IFNULL(MAX(sort_order), 0) AS m FROM options WHERE kind = ?').get<{ m: number }>(kind)
  const nextOrder = Number(maxRow?.m ?? 0) + 1
  return inTransaction(db, () => {
    const res = db
      .prepare('INSERT INTO options (kind, value, sort_order, builtin) VALUES (?, ?, ?, 0)')
      .run(kind, v, nextOrder)
    return { id: res.lastInsertRowid, kind, value: v, sortOrder: nextOrder, builtin: false }
  })
}

export function removeOption(db: SqlDatabase, id: number): void {
  const res = db.prepare('DELETE FROM options WHERE id = ?').run(id)
  if (res.changes === 0) throw new AppError('要删除的选项不存在')
}

/** ---- 背景照片（数据库记录） ---- */

export interface BackgroundRow {
  id: number
  file_name: string
  original_name: string
  width: number | null
  height: number | null
  size_bytes: number
  sort_order: number
  created_at: string
  offset_x: number | null
  offset_y: number | null
  scale: number | null
  opacity: number | null
  blur: number | null
  fit: string | null
}

const BACKGROUND_SELECT =
  'SELECT id, file_name, original_name, width, height, size_bytes, sort_order, created_at, offset_x, offset_y, scale, opacity, blur, fit FROM backgrounds'

export function listBackgroundRows(db: SqlDatabase): BackgroundRow[] {
  return db.prepare(`${BACKGROUND_SELECT} ORDER BY sort_order ASC, id ASC`).all<BackgroundRow>()
}

export function insertBackgroundRow(
  db: SqlDatabase,
  row: { fileName: string; originalName: string; width: number | null; height: number | null; sizeBytes: number }
): BackgroundRow {
  const maxRow = db.prepare('SELECT IFNULL(MAX(sort_order), 0) AS m FROM backgrounds').get<{ m: number }>()
  const order = Number(maxRow?.m ?? 0) + 1
  const res = db
    .prepare(
      'INSERT INTO backgrounds (file_name, original_name, width, height, size_bytes, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(row.fileName, row.originalName, row.width, row.height, row.sizeBytes, order, nowIso())
  return {
    id: res.lastInsertRowid,
    file_name: row.fileName,
    original_name: row.originalName,
    width: row.width,
    height: row.height,
    size_bytes: row.sizeBytes,
    sort_order: order,
    created_at: nowIso(),
    offset_x: null,
    offset_y: null,
    scale: null,
    opacity: null,
    blur: null,
    fit: null
  }
}

export function getBackgroundRow(db: SqlDatabase, id: number): BackgroundRow | null {
  const row = db.prepare(`${BACKGROUND_SELECT} WHERE id = ?`).get<BackgroundRow>(id)
  return row ?? null
}

const ADJUST_COLUMNS = ['offset_x', 'offset_y', 'scale', 'opacity', 'blur', 'fit'] as const
export type AdjustColumn = (typeof ADJUST_COLUMNS)[number]

/** 只更新传入的调整字段（传 null 表示恢复为「跟随全局设置」） */
export function updateBackgroundAdjust(
  db: SqlDatabase,
  id: number,
  patch: Partial<Record<AdjustColumn, number | string | null>>
): void {
  const entries = ADJUST_COLUMNS.filter((c) => c in patch)
  if (entries.length === 0) return
  const sql = `UPDATE backgrounds SET ${entries.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`
  db.prepare(sql).run(...entries.map((c) => patch[c] ?? null), id)
}

/** 把一张照片的调整复制到所有照片 */
export function copyBackgroundAdjustToAll(db: SqlDatabase, sourceId: number): void {
  const src = getBackgroundRow(db, sourceId)
  if (!src) return
  db.prepare(
    `UPDATE backgrounds SET offset_x = ?, offset_y = ?, scale = ?, opacity = ?, blur = ?, fit = ? WHERE id <> ?`
  ).run(src.offset_x, src.offset_y, src.scale, src.opacity, src.blur, src.fit, sourceId)
}

/** 清空所有照片的调整，全部回到跟随全局设置 */
export function resetAllBackgroundAdjust(db: SqlDatabase): void {
  db.prepare('UPDATE backgrounds SET offset_x = NULL, offset_y = NULL, scale = NULL, opacity = NULL, blur = NULL, fit = NULL').run()
}

export function deleteBackgroundRow(db: SqlDatabase, id: number): void {
  db.prepare('DELETE FROM backgrounds WHERE id = ?').run(id)
}

export function deleteAllBackgroundRows(db: SqlDatabase): void {
  db.prepare('DELETE FROM backgrounds').run()
}

export function reorderBackgroundRows(db: SqlDatabase, ids: number[]): void {
  inTransaction(db, () => {
    ids.forEach((id, index) => {
      db.prepare('UPDATE backgrounds SET sort_order = ? WHERE id = ?').run(index + 1, id)
    })
  })
}

export function countAll(db: SqlDatabase): { matches: number; events: number; honors: number; backgrounds: number } {
  const one = (t: string): number => {
    const r = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get<{ c: number }>()
    return r ? Number(r.c) : 0
  }
  return { matches: one('matches'), events: one('events'), honors: one('honors'), backgrounds: one('backgrounds') }
}
