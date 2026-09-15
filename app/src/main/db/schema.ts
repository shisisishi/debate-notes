/** 表结构与版本迁移。首版即 1，后续升级在这里追加步骤。 */

import { DEFAULT_OPTIONS, OPTION_KINDS, type OptionKind } from '@shared/types'
import type { SqlDatabase } from './driver'
import { inTransaction } from './driver'

export const SCHEMA_VERSION = 3

export const REQUIRED_TABLES = ['meta', 'events', 'matches', 'honors', 'options', 'backgrounds'] as const

const DDL = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  result     TEXT,
  note       TEXT NOT NULL DEFAULT '',
  is_sample  INTEGER NOT NULL DEFAULT 0 CHECK (is_sample IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS matches (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  date            TEXT NOT NULL,
  start_time      TEXT,
  topic           TEXT NOT NULL DEFAULT '',
  category        TEXT NOT NULL CHECK (category IN ('正赛','模拟赛')),
  event_id        INTEGER REFERENCES events(id) ON DELETE SET NULL,
  side            TEXT CHECK (side IS NULL OR side IN ('正方','反方')),
  position        TEXT,
  status          TEXT NOT NULL CHECK (status IN ('待赛','未出结果','胜','负','无胜负')),
  is_best_debater INTEGER NOT NULL DEFAULT 0 CHECK (is_best_debater IN (0,1)),
  comment         TEXT NOT NULL DEFAULT '',
  is_sample       INTEGER NOT NULL DEFAULT 0 CHECK (is_sample IN (0,1)),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_matches_date ON matches(date);
CREATE INDEX IF NOT EXISTS idx_matches_event ON matches(event_id);
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);

CREATE TABLE IF NOT EXISTS honors (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  date       TEXT NOT NULL,
  event_id   INTEGER REFERENCES events(id) ON DELETE SET NULL,
  note       TEXT NOT NULL DEFAULT '',
  is_sample  INTEGER NOT NULL DEFAULT 0 CHECK (is_sample IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_honors_date ON honors(date);
CREATE INDEX IF NOT EXISTS idx_honors_event ON honors(event_id);

CREATE TABLE IF NOT EXISTS options (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL CHECK (kind IN ('position','eventResult','honorName')),
  value      TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  builtin    INTEGER NOT NULL DEFAULT 0 CHECK (builtin IN (0,1)),
  UNIQUE (kind, value)
);

CREATE TABLE IF NOT EXISTS backgrounds (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  file_name     TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL DEFAULT '',
  width         INTEGER,
  height        INTEGER,
  size_bytes    INTEGER NOT NULL DEFAULT 0,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);
`

export function getMeta(db: SqlDatabase, key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get<{ value: string }>(key)
  return row ? row.value : null
}

export function setMeta(db: SqlDatabase, key: string, value: string): void {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    value
  )
}

/** 建立表结构、记录版本、写入选项预设 */
export function migrate(db: SqlDatabase): void {
  inTransaction(db, () => {
    db.exec(DDL)
    const current = Number(getMeta(db, 'schema_version') ?? '0')
    if (current < 1) {
      // 初始预设：辩位 / 赛事成绩 / 荣誉名称，标记为内置项
      for (const kind of OPTION_KINDS) {
        DEFAULT_OPTIONS[kind].forEach((value, index) => {
          db.prepare('INSERT OR IGNORE INTO options (kind, value, sort_order, builtin) VALUES (?, ?, ?, 1)').run(
            kind,
            value,
            index
          )
        })
      }
    }
    if (current < 2) {
      // v2：给比赛/赛事/荣誉加「示例数据」标记，便于一键删除示例
      for (const table of ['matches', 'events', 'honors']) {
        if (!hasColumn(db, table, 'is_sample')) {
          db.exec(`ALTER TABLE ${table} ADD COLUMN is_sample INTEGER NOT NULL DEFAULT 0`)
        }
      }
    }
    if (current < 3) {
      // v3：每张背景照片可以单独调整位置、大小、透明度、模糊与显示方式
      const cols: Array<[string, string]> = [
        ['offset_x', 'REAL'],
        ['offset_y', 'REAL'],
        ['scale', 'REAL'],
        ['opacity', 'REAL'],
        ['blur', 'REAL'],
        ['fit', 'TEXT']
      ]
      for (const [name, type] of cols) {
        if (!hasColumn(db, 'backgrounds', name)) {
          db.exec(`ALTER TABLE backgrounds ADD COLUMN ${name} ${type}`)
        }
      }
    }
    setMeta(db, 'schema_version', String(SCHEMA_VERSION))
  })
}

function hasColumn(db: SqlDatabase, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>()
  return rows.some((r) => r.name === column)
}

/** 校验一个数据库文件是否具备本应用所需的表（用于恢复备份前检查） */
export function verifySchema(db: SqlDatabase): { ok: boolean; error?: string } {
  try {
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>()
    const names = new Set(rows.map((r) => r.name))
    const missing = REQUIRED_TABLES.filter((t) => !names.has(t))
    if (missing.length > 0) return { ok: false, error: `备份数据库缺少必要的表：${missing.join('、')}` }
    const check = db.prepare('PRAGMA integrity_check').get<{ integrity_check: string }>()
    if (!check || check.integrity_check !== 'ok') {
      return { ok: false, error: `备份数据库完整性检查未通过：${check?.integrity_check ?? '未知'}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: `备份数据库无法读取：${(err as Error).message}` }
  }
}

export function countRows(db: SqlDatabase, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get<{ c: number }>()
  return row ? Number(row.c) : 0
}

export function isOptionKind(v: unknown): v is OptionKind {
  return typeof v === 'string' && (OPTION_KINDS as readonly string[]).includes(v)
}
