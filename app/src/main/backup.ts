/**
 * 本地备份：日常自动备份（每天首次启动）、完整备份导出、校验式恢复。
 * 备份是单个 zip：database.sqlite + settings.json + photos/* + manifest.json（含 sha256）。
 * 恢复流程严格「先校验、再备份现有数据、最后替换」，损坏的文件绝不会覆盖现有数据。
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { makeWritable, removeFileSafe } from './fsutil'
import path from 'node:path'
import type { BackupEntry, BackupManifest, RestoreResult } from '@shared/types'
import { clearPhotosDir, readPhotoBytes, writePhotoBytes } from './backgrounds'
import { closeDb, getDb, reopenDb } from './db'
import { openDatabase, sqlStringLiteral } from './db/driver'
import { listBackgroundRows } from './db/repo'
import { verifySchema } from './db/schema'
import { getPaths } from './paths'
import { DEFAULT_SETTINGS, loadSettings, replaceSettings, saveSettings, sanitizeSettings } from './settings'
import { createZip, readZip, type ZipInput } from './zip'

const BACKUP_PREFIX: Record<BackupEntry['kind'], string> = {
  auto: 'auto',
  manual: 'manual',
  prerestore: 'prerestore'
}

const KIND_LABEL: Record<string, BackupEntry['kind']> = {
  auto: 'auto',
  manual: 'manual',
  prerestore: 'prerestore'
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

function stamp(d: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function safeStampMs(d: Date = new Date()): string {
  return `${stamp(d)}-${String(d.getMilliseconds()).padStart(3, '0')}`
}

/** VACUUM INTO 生成一致性的数据库快照（避免直接复制 WAL 状态下的文件） */
function snapshotDatabaseBuffer(): Buffer {
  const { tmpDir } = getPaths()
  const out = path.join(tmpDir, `snapshot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.sqlite`)
  const db = getDb()
  let ok = false
  try {
    db.exec(`VACUUM INTO ${sqlStringLiteral(out)}`)
    ok = existsSync(out)
  } catch {
    ok = false
  }
  if (!ok) {
    // 极端情况下退化为直接复制（先做 WAL 检查点）
    try {
      db.exec('PRAGMA wal_checkpoint(FULL)')
    } catch {
      /* ignore */
    }
    const { databaseFile } = getPaths()
    writeFileSync(out, readFileSync(databaseFile))
  }
  const buf = readFileSync(out)
  removeFileSafe(out)
  return buf
}

export function buildManifestAndEntries(): { manifest: BackupManifest; entries: ZipInput[] } {
  const db = getDb()
  const files: BackupManifest['files'] = []
  const entries: ZipInput[] = []

  const dbBuf = snapshotDatabaseBuffer()
  entries.push({ path: 'database.sqlite', data: dbBuf })
  files.push({ path: 'database.sqlite', size: dbBuf.length, sha256: sha256(dbBuf) })

  const settingsBuf = Buffer.from(JSON.stringify(loadSettings(), null, 2), 'utf8')
  entries.push({ path: 'settings.json', data: settingsBuf })
  files.push({ path: 'settings.json', size: settingsBuf.length, sha256: sha256(settingsBuf) })

  const missingPhotos: string[] = []
  for (const row of listBackgroundRows(db)) {
    const bytes = readPhotoBytes(row.file_name)
    if (!bytes) {
      missingPhotos.push(row.file_name)
      continue
    }
    const zipPath = `photos/${row.file_name}`
    entries.push({ path: zipPath, data: bytes })
    files.push({ path: zipPath, size: bytes.length, sha256: sha256(bytes) })
  }

  const counts = {
    matches: Number(db.prepare('SELECT COUNT(*) AS c FROM matches').get<{ c: number }>()?.c ?? 0),
    events: Number(db.prepare('SELECT COUNT(*) AS c FROM events').get<{ c: number }>()?.c ?? 0),
    honors: Number(db.prepare('SELECT COUNT(*) AS c FROM honors').get<{ c: number }>()?.c ?? 0),
    backgrounds: listBackgroundRows(db).length
  }

  const manifest: BackupManifest = {
    format: 'debate-notes-backup',
    formatVersion: 1,
    appVersion: '1.0.0',
    createdAt: new Date().toISOString(),
    counts,
    files,
    ...(missingPhotos.length > 0 ? { missingPhotos } : {})
  }
  return { manifest, entries }
}

export function createBackup(kind: BackupEntry['kind'], targetPath?: string): BackupEntry {
  const { backupsDir } = getPaths()
  if (!existsSync(backupsDir)) mkdirSync(backupsDir, { recursive: true })
  const { manifest, entries } = buildManifestAndEntries()
  const manifestBuf = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8')
  const zip = createZip([{ path: 'manifest.json', data: manifestBuf }, ...entries])

  const full =
    targetPath ?? path.join(backupsDir, `${BACKUP_PREFIX[kind]}-${safeStampMs()}.zip`)
  writeFileSync(full, zip)
  const st = statSync(full)
  return {
    fileName: path.basename(full),
    fullPath: full,
    sizeBytes: st.size,
    createdAt: new Date().toISOString(),
    kind
  }
}

export function listBackups(): BackupEntry[] {
  const { backupsDir } = getPaths()
  if (!existsSync(backupsDir)) return []
  const out: BackupEntry[] = []
  for (const f of readdirSync(backupsDir)) {
    if (!f.toLowerCase().endsWith('.zip')) continue
    const full = path.join(backupsDir, f)
    try {
      const st = statSync(full)
      if (!st.isFile()) continue
      const prefix = f.split('-')[0]
      out.push({
        fileName: f,
        fullPath: full,
        sizeBytes: st.size,
        createdAt: st.mtime.toISOString(),
        kind: KIND_LABEL[prefix] ?? 'manual'
      })
    } catch {
      /* ignore */
    }
  }
  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  return out
}

export function pruneAutoBackups(keep: number): number {
  const autos = listBackups().filter((b) => b.kind === 'auto')
  let removed = 0
  for (let i = Math.max(0, keep); i < autos.length; i++) {
    try {
      removeFileSafe(autos[i].fullPath)
      removed += 1
    } catch {
      /* ignore */
    }
  }
  return removed
}

function hasData(): boolean {
  const db = getDb()
  const count = (t: string): number => Number(db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get<{ c: number }>()?.c ?? 0)
  return count('matches') + count('events') + count('honors') + count('backgrounds') > 0
}

/** 每天首次启动且已有数据时创建自动备份 */
export function performAutoBackupIfNeeded(): BackupEntry | null {
  const settings = loadSettings()
  if (!settings.autoBackupEnabled) return null
  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  if (settings.lastAutoBackupDate === todayStr) return null
  if (!hasData()) {
    saveSettings({ ...settings, lastAutoBackupDate: todayStr })
    return null
  }
  const entry = createBackup('auto')
  pruneAutoBackups(settings.autoBackupKeep)
  saveSettings({ ...loadSettings(), lastAutoBackupDate: todayStr })
  return entry
}

export function deleteBackup(fileName: string): void {
  const { backupsDir } = getPaths()
  const full = path.join(backupsDir, path.basename(fileName))
  removeFileSafe(full)
  if (existsSync(full)) throw new Error('备份文件删除失败，可能正被其他程序占用')
}

interface Extracted {
  db: Buffer
  settings: unknown | null
  photos: Array<{ name: string; data: Buffer }>
  manifest: BackupManifest
}

/** 第一步：把 zip 拆开并逐项校验（任何问题都在动现有数据之前返回失败） */
function extractAndValidate(zipPath: string): { ok: true; data: Extracted } | { ok: false; error: string } {
  let buf: Buffer
  try {
    buf = readFileSync(zipPath)
  } catch {
    return { ok: false, error: '备份文件无法读取' }
  }

  let entries
  try {
    entries = readZip(buf)
  } catch (err) {
    return { ok: false, error: `备份文件不是有效的 zip 或已损坏：${(err as Error).message}` }
  }

  const byPath = new Map(entries.map((e) => [e.path, e.data]))
  const manifestBuf = byPath.get('manifest.json')
  if (!manifestBuf) return { ok: false, error: '备份文件缺少 manifest.json，无法确认来源' }

  let manifest: BackupManifest
  try {
    manifest = JSON.parse(manifestBuf.toString('utf8')) as BackupManifest
  } catch {
    return { ok: false, error: '备份清单无法解析，文件可能已损坏' }
  }
  if (manifest.format !== 'debate-notes-backup') {
    return { ok: false, error: '该文件不是「辩论手记」的备份' }
  }
  if (typeof manifest.formatVersion !== 'number' || manifest.formatVersion > 1) {
    return { ok: false, error: `备份格式版本（${manifest.formatVersion}）高于当前程序支持的版本` }
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    return { ok: false, error: '备份清单缺少文件列表，文件可能已损坏' }
  }

  for (const item of manifest.files) {
    const data = byPath.get(item.path)
    if (!data) return { ok: false, error: `备份内缺少文件：${item.path}` }
    if (typeof item.size === 'number' && data.length !== item.size) {
      return { ok: false, error: `文件大小与清单不符：${item.path}` }
    }
    if (typeof item.sha256 === 'string' && sha256(data) !== item.sha256) {
      return { ok: false, error: `文件校验和不符（备份已损坏）：${item.path}` }
    }
  }

  const dbData = byPath.get('database.sqlite')
  if (!dbData) return { ok: false, error: '备份内缺少数据库文件' }

  let settings: unknown | null = null
  const settingsData = byPath.get('settings.json')
  if (settingsData) {
    try {
      settings = JSON.parse(settingsData.toString('utf8'))
    } catch {
      return { ok: false, error: '备份内的设置文件已损坏，无法解析' }
    }
  }

  const photos = entries
    .filter((e) => e.path.startsWith('photos/') && e.path.length > 'photos/'.length)
    .map((e) => ({ name: path.basename(e.path), data: e.data }))

  return { ok: true, data: { db: dbData, settings, photos, manifest } }
}

/** 第二步：用临时文件打开备份数据库，检查表结构与完整性，并核对照片引用 */
function validateDatabase(
  data: Extracted,
  missingPhotos: string[]
): { ok: true } | { ok: false; error: string } {
  const { tmpDir } = getPaths()
  const tmpFile = path.join(tmpDir, `restore-check-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.sqlite`)
  try {
    writeFileSync(tmpFile, data.db)
    const db = openDatabase(tmpFile)
    try {
      const v = verifySchema(db)
      if (!v.ok) return { ok: false, error: v.error ?? '备份数据库校验失败' }
      const rows = listBackgroundRows(db)
      const available = new Set([...data.photos.map((p) => p.name), ...missingPhotos])
      const orphan = rows.map((r) => r.file_name).filter((n) => !available.has(n))
      if (orphan.length > 0) {
        return { ok: false, error: `备份内缺少背景照片文件：${orphan.join('、')}` }
      }
      return { ok: true }
    } finally {
      try {
        db.close()
      } catch {
        /* ignore */
      }
    }
  } catch (err) {
    return { ok: false, error: `备份数据库无法打开：${(err as Error).message}` }
  } finally {
    removeFileSafe(tmpFile)
  }
}

export function restoreFromBackup(zipPath: string): RestoreResult {
  const trace = (m: string): void => {
    if (process.env.DEBUG_RESTORE) console.error(`[restore] ${m}`)
  }
  trace('1 读取并校验 zip')
  const validated = extractAndValidate(zipPath)
  if (!validated.ok) return { ok: false, error: validated.error }

  const missingPhotos = Array.isArray(validated.data.manifest.missingPhotos)
    ? validated.data.manifest.missingPhotos
    : []

  trace('2 校验备份数据库')
  const dbCheck = validateDatabase(validated.data, missingPhotos)
  if (!dbCheck.ok) return { ok: false, error: dbCheck.error }
  trace('2b 数据库校验通过')

  // 校验全部通过 —— 先给当前数据做一份安全备份，失败则不动现场
  let safety: BackupEntry
  try {
    trace('3 恢复前安全备份')
    safety = createBackup('prerestore')
    trace('3b 安全备份完成')
  } catch (err) {
    return { ok: false, error: `恢复前备份当前数据失败，已中止恢复：${(err as Error).message}` }
  }

  const { databaseFile } = getPaths()
  try {
    trace('4 关闭数据库')
    closeDb()
    trace('4b 写入新数据库文件')
    // 数据库：写入新文件并清掉旧的 WAL/SHM
    makeWritable(databaseFile)
    writeFileSync(databaseFile, validated.data.db)
    for (const suffix of ['-wal', '-shm']) {
      removeFileSafe(`${databaseFile}${suffix}`)
    }
    trace('5 替换照片文件')
    // 照片：整体替换
    clearPhotosDir()
    for (const p of validated.data.photos) writePhotoBytes(p.name, p.data)
    trace('6 替换设置')
    // 设置
    let settingsRestored = false
    if (validated.data.settings) {
      replaceSettings(sanitizeSettings(validated.data.settings, DEFAULT_SETTINGS))
      settingsRestored = true
    }
    trace('7 重新打开数据库')
    const db = reopenDb()
    trace('7b 数据库已重开')

    // 收敛 activeBackgroundId：确保指向存在的照片
    const settings = loadSettings()
    const ids = new Set(listBackgroundRows(db).map((r) => Number(r.id)))
    if (settings.activeBackgroundId !== null && !ids.has(settings.activeBackgroundId)) {
      saveSettings({ ...settings, activeBackgroundId: ids.size > 0 ? Math.min(...ids) : null })
    }

    const counts = {
      matches: Number(db.prepare('SELECT COUNT(*) AS c FROM matches').get<{ c: number }>()?.c ?? 0),
      events: Number(db.prepare('SELECT COUNT(*) AS c FROM events').get<{ c: number }>()?.c ?? 0),
      honors: Number(db.prepare('SELECT COUNT(*) AS c FROM honors').get<{ c: number }>()?.c ?? 0),
      backgrounds: listBackgroundRows(db).length
    }
    return { ok: true, restored: { ...counts, settingsRestored }, safetyBackup: safety.fullPath }
  } catch (err) {
    try {
      reopenDb()
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      error: `恢复过程中出错：${(err as Error).message}（恢复前数据已备份到 ${safety.fullPath}）`
    }
  }
}
