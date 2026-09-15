/**
 * 数据目录位置：默认在 %APPDATA%\DebateNotes，可以整体搬到别的盘（比如 D 盘）。
 *
 * 实现方式：默认位置里留一个「指针文件」location.json，记录当前真正在用的数据目录。
 *  - 指针文件很小，跟着系统盘走没关系；真正的数据（库、照片、备份）放在用户选的盘上。
 *  - 环境变量 DEBATE_NOTES_DATA_DIR 优先级最高（测试与绿色版用），DEBATE_NOTES_HOME 可以
 *    把「默认位置」本身挪到别处（测试用，避免动到真实用户目录）。
 *  - 搬迁时把数据复制过去、原位置保留一份，指针写好后再重启程序生效。
 */

import { app } from 'electron'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { DataDirInspection, DataDirRelocateResult } from '@shared/types'
import type { SqlDatabase } from './db/driver'
import { makeWritable } from './fsutil'

const POINTER_FILE = 'location.json'
/** 这些目录是缓存/临时文件，搬迁时跳过（runtime 是 Chromium 缓存，体积大且可重建） */
const SKIP_ON_COPY = new Set(['runtime', 'tmp'])

export interface LocationPointer {
  dataDir: string
  movedAt: string
  note?: string
}

/** 「默认位置」目录：指针文件放在这里；没有指针时它也就是数据目录 */
export function homeDir(): string {
  const override = process.env.DEBATE_NOTES_HOME
  if (override && override.trim()) return path.resolve(override.trim())
  return path.join(app.getPath('appData'), 'DebateNotes')
}

export function locationFilePath(): string {
  return path.join(homeDir(), POINTER_FILE)
}

/** 环境变量指定的数据目录（测试/便携版用），没有则返回 null */
export function envDataDir(): string | null {
  const override = process.env.DEBATE_NOTES_DATA_DIR
  if (override && override.trim()) return path.resolve(override.trim())
  return null
}

export function readLocation(): LocationPointer | null {
  try {
    const p = locationFilePath()
    if (!existsSync(p)) return null
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as Partial<LocationPointer>
    if (!parsed || typeof parsed.dataDir !== 'string' || !parsed.dataDir.trim()) return null
    return {
      dataDir: path.resolve(parsed.dataDir),
      movedAt: typeof parsed.movedAt === 'string' ? parsed.movedAt : '',
      note: typeof parsed.note === 'string' ? parsed.note : undefined
    }
  } catch {
    return null
  }
}

/** 写入指针（dataDir 传 null 表示回到默认位置）；写入后需要重启程序生效 */
export function writeLocation(dataDir: string | null, note = ''): void {
  const p = locationFilePath()
  mkdirSync(path.dirname(p), { recursive: true })
  if (dataDir === null) {
    writeFileSync(p, JSON.stringify({ dataDir: homeDir(), movedAt: new Date().toISOString(), note: '已恢复默认位置' }, null, 2), 'utf8')
  } else {
    writeFileSync(p, JSON.stringify({ dataDir, movedAt: new Date().toISOString(), note }, null, 2), 'utf8')
  }
  makeWritable(p)
}

export type TargetInspection = DataDirInspection

function countRows(dbFile: string, table: string): number {
  try {
    // 只读方式打开，避免在别人的目录里留下 -wal/-shm
    const db = new DatabaseSync(dbFile, { readOnly: true })
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n?: number } | undefined
    db.close()
    return Number(row?.n ?? 0)
  } catch {
    return -1
  }
}

/** 检查目标目录能不能用（用于确认框里的提示） */
export function inspectTarget(dir: string): TargetInspection {
  const resolved = path.resolve(dir)
  const info: TargetInspection = {
    path: resolved,
    exists: false,
    hasDatabase: false,
    hasOtherFiles: false,
    matchesInTarget: 0,
    photosInTarget: 0
  }
  if (!existsSync(resolved)) return info
  info.exists = true
  try {
    if (!statSync(resolved).isDirectory()) {
      info.error = '这不是一个文件夹'
      return info
    }
  } catch (err) {
    info.error = `读不到这个文件夹：${(err as Error).message}`
    return info
  }
  let entries: string[] = []
  try {
    entries = readdirSync(resolved)
  } catch (err) {
    info.error = `读不到这个文件夹：${(err as Error).message}`
    return info
  }
  info.hasOtherFiles = entries.length > 0
  const dbFile = path.join(resolved, 'database.sqlite')
  if (existsSync(dbFile)) {
    info.hasDatabase = true
    info.matchesInTarget = countRows(dbFile, 'matches')
    info.photosInTarget = countRows(dbFile, 'backgrounds')
  }
  return info
}

export type RelocateResult = DataDirRelocateResult

/** 搬迁前把 WAL 落盘，保证复制出来的 database.sqlite 是完整的 */
export function checkpointDatabase(db: SqlDatabase | null): void {
  try {
    db?.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  } catch {
    /* 落盘失败不阻断：复制时连 -wal/-shm 一起拷 */
  }
}

/** 复制数据目录内容（跳过缓存目录），返回复制过去的文件数 */
function copyDataDir(from: string, to: string): number {
  mkdirSync(to, { recursive: true })
  let count = 0
  for (const entry of readdirSync(from)) {
    if (SKIP_ON_COPY.has(entry)) continue
    if (entry === POINTER_FILE) continue
    const src = path.join(from, entry)
    const dest = path.join(to, entry)
    cpSync(src, dest, { recursive: true, force: true })
    count += countFiles(dest)
  }
  return count
}

function countFiles(dir: string): number {
  try {
    const st = statSync(dir)
    if (!st.isDirectory()) return 1
    let n = 0
    for (const entry of readdirSync(dir)) n += countFiles(path.join(dir, entry))
    return n
  } catch {
    return 0
  }
}

/**
 * 切换数据目录。
 *  - 目标里已经有 database.sqlite → 直接改用它（不复制、不覆盖）；
 *  - 否则把当前数据整套复制过去（原位置保留一份，确认没问题后可以自己删掉）。
 * 无论哪种，都是写完指针后返回，程序重启才生效。
 */
export function relocate(currentDataDir: string, target: string): RelocateResult {
  const dest = path.resolve(target)
  const result: RelocateResult = {
    ok: false,
    dataDir: dest,
    copiedFiles: 0,
    adopted: false,
    needsRestart: true
  }
  const inspection = inspectTarget(dest)
  if (inspection.error) return { ...result, error: inspection.error }
  if (dest === path.resolve(currentDataDir)) {
    return { ...result, error: '这就是当前正在用的数据目录' }
  }
  // 不许把数据目录放在自己里面（会递归复制）
  const rel = path.relative(path.resolve(currentDataDir), dest)
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
    return { ...result, error: '不能把数据目录放到当前数据目录里面' }
  }

  try {
    if (inspection.hasDatabase) {
      result.adopted = true
      result.ok = true
      writeLocation(dest, '直接改用目标目录里已有的数据')
      return result
    }
    result.copiedFiles = copyDataDir(path.resolve(currentDataDir), dest)
    if (!existsSync(path.join(dest, 'database.sqlite'))) {
      return { ...result, error: '复制之后没找到 database.sqlite，已放弃切换（原数据未被改动）' }
    }
    writeLocation(dest, '搬迁数据目录')
    result.ok = true
    return result
  } catch (err) {
    return { ...result, error: `复制失败：${(err as Error).message}` }
  }
}

/** 恢复默认位置：把当前数据复制回默认目录（默认目录里已有数据时直接改用它） */
export function relocateToDefault(currentDataDir: string): RelocateResult {
  const home = homeDir()
  const result = relocate(currentDataDir, home)
  if (result.ok) writeLocation(home, result.adopted ? '恢复默认位置（沿用该目录已有数据）' : '恢复默认位置')
  return result
}
