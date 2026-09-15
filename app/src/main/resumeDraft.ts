/**
 * 履历草稿：手动编辑并保存的履历文字。
 * 存在数据库 meta 表里，所以导出备份/恢复备份时会跟着走。
 */

import type { ResumeDraft } from '@shared/ipc'
import type { SqlDatabase } from './db/driver'
import { getMeta, setMeta } from './db/schema'

const KEY_TEXT = 'resume_draft'
const KEY_AT = 'resume_draft_updated_at'

/** 履历正文上限，避免异常的长文本撑爆数据库 */
export const RESUME_DRAFT_MAX = 60_000

export function readResumeDraft(db: SqlDatabase): ResumeDraft {
  const text = getMeta(db, KEY_TEXT)
  if (text === null || text.trim() === '') return { text: null, updatedAt: null }
  return { text, updatedAt: getMeta(db, KEY_AT) }
}

export function saveResumeDraft(db: SqlDatabase, text: string): ResumeDraft {
  const trimmed = text.slice(0, RESUME_DRAFT_MAX)
  if (trimmed.trim() === '') return clearResumeDraft(db)
  const at = new Date().toISOString()
  setMeta(db, KEY_TEXT, trimmed)
  setMeta(db, KEY_AT, at)
  return { text: trimmed, updatedAt: at }
}

export function clearResumeDraft(db: SqlDatabase): ResumeDraft {
  db.prepare('DELETE FROM meta WHERE key IN (?, ?)').run(KEY_TEXT, KEY_AT)
  return { text: null, updatedAt: null }
}
