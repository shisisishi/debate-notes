/** 应用数据目录解析。所有持久化内容都集中在数据目录下，便于整体备份与迁移。 */

import { app } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { envDataDir, homeDir, readLocation } from './datadir'

export interface AppPaths {
  dataDir: string
  photosDir: string
  backupsDir: string
  tmpDir: string
  runtimeDir: string
  databaseFile: string
  settingsFile: string
}

let cached: AppPaths | null = null

/**
 * 数据目录优先级：
 *  1. 环境变量 DEBATE_NOTES_DATA_DIR（E2E 测试与绿色版便携使用）
 *  2. 指针文件 location.json 里记的目录（用户在「设置 → 数据与关于」里改到别的盘）
 *  3. 默认位置 %APPDATA%\DebateNotes
 */
export function resolveDataDir(): string {
  const override = envDataDir()
  if (override) return override
  const pointer = readLocation()
  if (pointer) return pointer.dataDir
  return homeDir()
}

/** 是否用了自定义位置（不是默认目录） */
export function isCustomDataDir(): boolean {
  if (envDataDir()) return false
  const pointer = readLocation()
  return pointer !== null && path.resolve(pointer.dataDir) !== path.resolve(homeDir())
}

export function defaultDataDir(): string {
  return homeDir()
}

/** 示例照片来源目录：开发时读仓库 sources/，打包后读 resources/seed-photos */
export function resolveSourcesDir(): string | null {
  const candidates: string[] = []
  if (app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, 'seed-photos'))
  } else {
    candidates.push(path.resolve(app.getAppPath(), '..', 'sources'))
    candidates.push(path.join(process.cwd(), '..', 'sources'))
    candidates.push(path.join(process.cwd(), 'sources'))
  }
  for (const c of candidates) {
    try {
      if (existsSync(c)) return c
    } catch {
      /* ignore */
    }
  }
  return null
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export function ensurePaths(): AppPaths {
  const dataDir = resolveDataDir()
  ensureDir(dataDir)
  const photosDir = path.join(dataDir, 'photos')
  const backupsDir = path.join(dataDir, 'backups')
  const tmpDir = path.join(dataDir, 'tmp')
  const runtimeDir = path.join(dataDir, 'runtime')
  for (const d of [photosDir, backupsDir, tmpDir, runtimeDir]) ensureDir(d)
  cached = {
    dataDir,
    photosDir,
    backupsDir,
    tmpDir,
    runtimeDir,
    databaseFile: path.join(dataDir, 'database.sqlite'),
    settingsFile: path.join(dataDir, 'settings.json')
  }
  return cached
}

export function getPaths(): AppPaths {
  if (!cached) return ensurePaths()
  return cached
}
