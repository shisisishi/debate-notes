/** 设置的文件 IO（settings.json 位于数据目录根）。纯逻辑在 @shared/settings。 */

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { makeWritable } from './fsutil'
import { getPaths } from './paths'
import { applyPatch, DEFAULT_SETTINGS, sanitizeSettings } from '@shared/settings'
import type { AppSettings } from '@shared/types'

export { DEFAULT_SETTINGS, sanitizeSettings, applyPatch }

let memory: AppSettings | null = null

export function loadSettings(): AppSettings {
  if (memory) return memory
  const { settingsFile } = getPaths()
  try {
    if (existsSync(settingsFile)) {
      const raw = JSON.parse(readFileSync(settingsFile, 'utf8'))
      memory = sanitizeSettings(raw)
      return memory
    }
  } catch {
    // 设置文件损坏：用默认值继续，不阻断启动
  }
  memory = { ...DEFAULT_SETTINGS }
  return memory
}

export function saveSettings(next: AppSettings): AppSettings {
  const { settingsFile } = getPaths()
  const clean = sanitizeSettings(next)
  memory = clean
  const tmp = `${settingsFile}.tmp`
  writeFileSync(tmp, JSON.stringify(clean, null, 2), 'utf8')
  // 覆盖已有文件前先去掉只读属性：Windows 上替换只读文件会失败（在本机 Electron 里甚至会崩）
  makeWritable(settingsFile)
  renameSync(tmp, settingsFile)
  return clean
}

/** 直接替换内存与磁盘上的设置（恢复备份时使用） */
export function replaceSettings(raw: unknown): AppSettings {
  memory = null
  return saveSettings(sanitizeSettings(raw, DEFAULT_SETTINGS))
}

export function resetSettingsCache(): void {
  memory = null
}
