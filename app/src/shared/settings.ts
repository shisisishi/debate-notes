/** 设置的纯逻辑：默认值、容错收敛、补丁合并。主进程与渲染进程共用（不含任何 IO）。 */

import type { AppSettings, MatchCategory, PageKey, RangePreset, SettingsPatch, ThemeId } from './types'
import { PAGE_KEYS, THEME_IDS } from './types'

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'handbook',
  backgroundEnabled: true,
  backgroundOpacity: 0.7,
  panelOpacity: 0.86,
  backgroundBlur: 0,
  rotationEnabled: true,
  rotationIntervalMs: 5 * 60 * 1000,
  activeBackgroundId: null,
  backgroundCover: true,
  overview: {
    category: 'all',
    eventId: 'all',
    range: { preset: 'year', from: '', to: '', anchor: '' }
  },
  resume: { range: { preset: 'all', from: '', to: '', anchor: '' } },
  lastAutoBackupDate: null,
  lastPage: 'overview',
  autoBackupEnabled: true,
  autoBackupKeep: 30
}

/** 轮播间隔的可调范围：10 秒 ~ 24 小时 */
export const MIN_ROTATION_MS = 10_000
export const MAX_ROTATION_MS = 24 * 60 * 60 * 1000

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

function asNum(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function asStr(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback
}

const PRESETS: RangePreset[] = ['month', 'year', 'all', 'custom']

function sanitizeRange(raw: unknown, fallback: AppSettings['overview']['range']): AppSettings['overview']['range'] {
  if (!raw || typeof raw !== 'object') return { ...fallback }
  const r = raw as Record<string, unknown>
  const preset = PRESETS.includes(r.preset as RangePreset) ? (r.preset as RangePreset) : fallback.preset
  return {
    preset,
    from: asStr(r.from, fallback.from),
    to: asStr(r.to, fallback.to),
    anchor: asStr(r.anchor, '')
  }
}

/** 把任意来源（磁盘设置、恢复的备份）的对象收敛为合法设置 */
export function sanitizeSettings(raw: unknown, fallback: AppSettings = DEFAULT_SETTINGS): AppSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const ov = (o.overview && typeof o.overview === 'object' ? o.overview : {}) as Record<string, unknown>
  const rs = (o.resume && typeof o.resume === 'object' ? o.resume : {}) as Record<string, unknown>
  const category = ov.category
  const eventId = ov.eventId
  const activeId = o.activeBackgroundId

  return {
    theme: THEME_IDS.includes(o.theme as ThemeId) ? (o.theme as ThemeId) : fallback.theme,
    backgroundEnabled: asBool(o.backgroundEnabled, fallback.backgroundEnabled),
    backgroundOpacity: clamp(asNum(o.backgroundOpacity, fallback.backgroundOpacity), 0, 1),
    panelOpacity: clamp(asNum(o.panelOpacity, fallback.panelOpacity), 0.4, 1),
    backgroundBlur: clamp(asNum(o.backgroundBlur, fallback.backgroundBlur), 0, 30),
    rotationEnabled: asBool(o.rotationEnabled, fallback.rotationEnabled),
    rotationIntervalMs: clamp(
      asNum(o.rotationIntervalMs, fallback.rotationIntervalMs),
      MIN_ROTATION_MS,
      MAX_ROTATION_MS
    ),
    activeBackgroundId: typeof activeId === 'number' && Number.isInteger(activeId) ? activeId : null,
    backgroundCover: asBool(o.backgroundCover, fallback.backgroundCover),
    overview: {
      category: category === '正赛' || category === '模拟赛' ? (category as MatchCategory) : 'all',
      eventId:
        typeof eventId === 'number' && Number.isInteger(eventId)
          ? eventId
          : eventId === 'none'
            ? 'none'
            : 'all',
      range: sanitizeRange(ov.range, fallback.overview.range)
    },
    resume: { range: sanitizeRange(rs.range, fallback.resume.range) },
    lastAutoBackupDate: typeof o.lastAutoBackupDate === 'string' ? o.lastAutoBackupDate : null,
    lastPage: PAGE_KEYS.includes(o.lastPage as PageKey) ? (o.lastPage as PageKey) : fallback.lastPage,
    autoBackupEnabled: asBool(o.autoBackupEnabled, fallback.autoBackupEnabled),
    autoBackupKeep: Math.round(clamp(asNum(o.autoBackupKeep, fallback.autoBackupKeep), 1, 200))
  }
}

/** 深合并补丁（overview / resume 是嵌套对象，需逐层合并） */
export function applyPatch(current: AppSettings, patch: SettingsPatch): AppSettings {
  const merged = {
    ...current,
    ...patch,
    overview: {
      ...current.overview,
      ...(patch.overview ?? {}),
      range: { ...current.overview.range, ...(patch.overview?.range ?? {}) }
    },
    resume: {
      ...current.resume,
      ...(patch.resume ?? {}),
      range: { ...current.resume.range, ...(patch.resume?.range ?? {}) }
    }
  } as unknown
  return sanitizeSettings(merged)
}
