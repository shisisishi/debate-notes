/** 全局状态：一次性加载各数据切片，所有写入都经由此处并自动刷新相关切片。 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ResumeDraft } from '@shared/ipc'
import { DEFAULT_SETTINGS } from '@shared/settings'
import type {
  AppInfo,
  AppSettings,
  BackgroundPhoto,
  BackupEntry,
  DataDirInspection,
  DataDirRelocateResult,
  DebateEvent,
  DebateEventInput,
  Honor,
  HonorInput,
  Match,
  MatchInput,
  OptionItem,
  OptionKind,
  PhotoAdjustPatch,
  RestoreResult,
  SettingsPatch
} from '@shared/types'

export type ToastKind = 'info' | 'success' | 'error'

export interface ToastItem {
  id: number
  message: string
  kind: ToastKind
}

export interface StoreValue {
  ready: boolean
  info: AppInfo | null
  settings: AppSettings
  matches: Match[]
  events: DebateEvent[]
  honors: Honor[]
  options: OptionItem[]
  photos: BackgroundPhoto[]
  backups: BackupEntry[]
  toasts: ToastItem[]
  toast: (message: string, kind?: ToastKind) => void
  dismissToast: (id: number) => void
  setSettings: (settings: AppSettings) => void
  updateSettings: (patch: SettingsPatch) => Promise<AppSettings>
  reloadAll: () => Promise<void>
  reloadSettings: () => Promise<void>
  reloadMatches: () => Promise<void>
  reloadEvents: () => Promise<void>
  reloadHonors: () => Promise<void>
  reloadOptions: () => Promise<void>
  reloadPhotos: () => Promise<void>
  reloadBackups: () => Promise<void>
  saveMatch: (input: MatchInput, id?: number) => Promise<Match>
  removeMatch: (id: number) => Promise<void>
  saveEvent: (input: DebateEventInput, id?: number) => Promise<DebateEvent>
  removeEvent: (id: number) => Promise<void>
  saveHonor: (input: HonorInput, id?: number) => Promise<Honor>
  removeHonor: (id: number) => Promise<void>
  addOption: (kind: OptionKind, value: string) => Promise<OptionItem>
  removeOption: (id: number) => Promise<void>
  addPhotos: () => Promise<{ added: number; skipped: { name: string; reason: string }[]; canceled: boolean }>
  removePhoto: (id: number) => Promise<void>
  removeAllPhotos: () => Promise<void>
  setActivePhoto: (id: number | null) => Promise<void>
  cyclePhoto: (direction: 1 | -1) => Promise<void>
  reorderPhotos: (ids: number[]) => Promise<void>
  adjustPhoto: (id: number, patch: PhotoAdjustPatch) => Promise<BackgroundPhoto[]>
  resetPhotoAdjust: (id: number) => Promise<BackgroundPhoto[]>
  applyAdjustAll: (sourceId: number) => Promise<BackgroundPhoto[]>
  createBackupNow: () => Promise<BackupEntry>
  exportBackup: () => Promise<{ ok: boolean; canceled: boolean; path?: string; error?: string }>
  restoreFromFile: () => Promise<RestoreResult>
  restoreBackup: (fullPath: string) => Promise<RestoreResult>
  removeBackup: (fileName: string) => Promise<void>
  sampleStatus: () => Promise<{ matches: number; events: number; honors: number; photos: number }>
  removeSamples: () => Promise<{ matches: number; events: number; honors: number }>
  /** 重新写入示例：只补缺失的部分，已存在的不会重复；返回本次补上的数量 */
  reseedSamples: () => Promise<{ added: { matches: number; events: number; honors: number }; photos: number }>
  /** 选一个新的数据目录（系统对话框） */
  chooseDataDir: () => Promise<{ canceled: boolean; path: string | null }>
  /** 切换前检查目标目录 */
  inspectDataDir: (dir: string) => Promise<DataDirInspection>
  /** 把数据搬到新目录（原位置保留一份），需要重启生效 */
  relocateDataDir: (target: string) => Promise<DataDirRelocateResult>
  /** 搬回默认位置 */
  resetDataDir: () => Promise<DataDirRelocateResult>
  /** 立即重启程序 */
  relaunchApp: () => Promise<void>
  /** 手动编辑过的履历文字（null 表示用自动汇总内容） */
  resumeDraft: ResumeDraft
  reloadResumeDraft: () => Promise<ResumeDraft>
  saveResumeDraft: (text: string) => Promise<ResumeDraft>
  clearResumeDraft: () => Promise<ResumeDraft>
}

const StoreContext = createContext<StoreValue | null>(null)

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore 必须在 AppProvider 内使用')
  return ctx
}

export function AppProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [ready, setReady] = useState(false)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [settings, setSettingsState] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [matches, setMatches] = useState<Match[]>([])
  const [events, setEvents] = useState<DebateEvent[]>([])
  const [honors, setHonors] = useState<Honor[]>([])
  const [options, setOptions] = useState<OptionItem[]>([])
  const [photos, setPhotos] = useState<BackgroundPhoto[]>([])
  const [resumeDraft, setResumeDraft] = useState<ResumeDraft>({ text: null, updatedAt: null })
  const [backups, setBackups] = useState<BackupEntry[]>([])
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const toastId = useRef(0)

  const toast = useCallback((message: string, kind: ToastKind = 'info') => {
    toastId.current += 1
    const id = toastId.current
    setToasts((prev) => [...prev, { id, message, kind }])
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, kind === 'error' ? 6000 : 3200)
  }, [])

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const reloadSettings = useCallback(async () => {
    const s = await window.api.invoke('settings:get')
    setSettingsState(s)
  }, [])

  const reloadMatches = useCallback(async () => {
    const rows = await window.api.invoke('matches:list', { order: 'date-desc' })
    setMatches(rows)
  }, [])

  const reloadEvents = useCallback(async () => {
    setEvents(await window.api.invoke('events:list'))
  }, [])

  const reloadHonors = useCallback(async () => {
    setHonors(await window.api.invoke('honors:list'))
  }, [])

  const reloadOptions = useCallback(async () => {
    setOptions(await window.api.invoke('options:list'))
  }, [])

  const reloadPhotos = useCallback(async () => {
    setPhotos(await window.api.invoke('backgrounds:list'))
  }, [])

  const reloadBackups = useCallback(async () => {
    setBackups(await window.api.invoke('backup:list'))
  }, [])

  const reloadAll = useCallback(async () => {
    const [i, s, m, e, h, o, p, b, d] = await Promise.all([
      window.api.invoke('app:info'),
      window.api.invoke('settings:get'),
      window.api.invoke('matches:list', { order: 'date-desc' }),
      window.api.invoke('events:list'),
      window.api.invoke('honors:list'),
      window.api.invoke('options:list'),
      window.api.invoke('backgrounds:list'),
      window.api.invoke('backup:list'),
      window.api.invoke('resume:draft')
    ])
    setInfo(i)
    setSettingsState(s)
    setMatches(m)
    setEvents(e)
    setHonors(h)
    setOptions(o)
    setPhotos(p)
    setBackups(b)
    setResumeDraft(d)
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        await reloadAll()
      } catch (err) {
        toast(`初始化失败：${(err as Error).message}`, 'error')
      } finally {
        setReady(true)
      }
    })()
  }, [reloadAll, toast])

  const updateSettings = useCallback(
    async (patch: SettingsPatch) => {
      const next = await window.api.invoke('settings:update', patch)
      setSettingsState(next)
      return next
    },
    []
  )

  const saveMatch = useCallback(
    async (input: MatchInput, id?: number) => {
      const saved = id
        ? await window.api.invoke('matches:update', id, input)
        : await window.api.invoke('matches:create', input)
      await Promise.all([reloadMatches(), reloadEvents()])
      return saved
    },
    [reloadMatches, reloadEvents]
  )

  const removeMatch = useCallback(
    async (id: number) => {
      await window.api.invoke('matches:remove', id)
      await Promise.all([reloadMatches(), reloadEvents()])
    },
    [reloadMatches, reloadEvents]
  )

  const saveEvent = useCallback(
    async (input: DebateEventInput, id?: number) => {
      const saved = id
        ? await window.api.invoke('events:update', id, input)
        : await window.api.invoke('events:create', input)
      await Promise.all([reloadEvents(), reloadMatches()])
      return saved
    },
    [reloadEvents, reloadMatches]
  )

  const removeEvent = useCallback(
    async (id: number) => {
      await window.api.invoke('events:remove', id)
      await Promise.all([reloadEvents(), reloadMatches(), reloadHonors()])
    },
    [reloadEvents, reloadMatches, reloadHonors]
  )

  const saveHonor = useCallback(
    async (input: HonorInput, id?: number) => {
      const saved = id
        ? await window.api.invoke('honors:update', id, input)
        : await window.api.invoke('honors:create', input)
      await reloadHonors()
      return saved
    },
    [reloadHonors]
  )

  const removeHonor = useCallback(
    async (id: number) => {
      await window.api.invoke('honors:remove', id)
      await reloadHonors()
    },
    [reloadHonors]
  )

  const addOption = useCallback(
    async (kind: OptionKind, value: string) => {
      const item = await window.api.invoke('options:add', kind, value)
      await reloadOptions()
      return item
    },
    [reloadOptions]
  )

  const removeOption = useCallback(
    async (id: number) => {
      await window.api.invoke('options:remove', id)
      await reloadOptions()
    },
    [reloadOptions]
  )

  const addPhotos = useCallback(async () => {
    const result = await window.api.invoke('backgrounds:add')
    setPhotos(result.photos)
    if (result.added > 0) {
      const s = await window.api.invoke('settings:get')
      setSettingsState(s)
    }
    return { added: result.added, skipped: result.skipped, canceled: result.canceled }
  }, [])

  const removePhoto = useCallback(async (id: number) => {
    const result = await window.api.invoke('backgrounds:remove', id)
    setPhotos(result.photos)
    setSettingsState(result.settings)
  }, [])

  const removeAllPhotos = useCallback(async () => {
    const result = await window.api.invoke('backgrounds:removeAll')
    setPhotos(result.photos)
    setSettingsState(result.settings)
  }, [])

  const setActivePhoto = useCallback(async (id: number | null) => {
    setSettingsState(await window.api.invoke('backgrounds:setActive', id))
  }, [])

  const cyclePhoto = useCallback(async (direction: 1 | -1) => {
    setSettingsState(await window.api.invoke('backgrounds:next', direction))
  }, [])

  const reorderPhotosFn = useCallback(async (ids: number[]) => {
    setPhotos(await window.api.invoke('backgrounds:reorder', ids))
  }, [])

  const adjustPhoto = useCallback(async (id: number, patch: PhotoAdjustPatch) => {
    const next = await window.api.invoke('backgrounds:adjust', id, patch)
    setPhotos(next)
    return next
  }, [])

  const resetPhotoAdjust = useCallback(async (id: number) => {
    const next = await window.api.invoke('backgrounds:resetAdjust', id)
    setPhotos(next)
    return next
  }, [])

  const applyAdjustAll = useCallback(async (sourceId: number) => {
    const next = await window.api.invoke('backgrounds:applyAdjustAll', sourceId)
    setPhotos(next)
    return next
  }, [])

  const reloadResumeDraft = useCallback(async () => {
    const draft = await window.api.invoke('resume:draft')
    setResumeDraft(draft)
    return draft
  }, [])

  const saveResumeDraft = useCallback(async (text: string) => {
    const draft = await window.api.invoke('resume:saveDraft', text)
    setResumeDraft(draft)
    return draft
  }, [])

  const clearResumeDraft = useCallback(async () => {
    const draft = await window.api.invoke('resume:clearDraft')
    setResumeDraft(draft)
    return draft
  }, [])

  const createBackupNow = useCallback(async () => {
    const entry = await window.api.invoke('backup:createNow')
    await reloadBackups()
    return entry
  }, [reloadBackups])

  const exportBackup = useCallback(async () => {
    const result = await window.api.invoke('backup:export')
    if (result.ok) await reloadBackups()
    return result
  }, [reloadBackups])

  const finishRestore = useCallback(
    async (result: RestoreResult) => {
      await reloadAll()
      return result
    },
    [reloadAll]
  )

  const restoreFromFile = useCallback(async () => {
    const result = await window.api.invoke('backup:restoreFromFile')
    if (result.ok) return finishRestore(result)
    return result
  }, [finishRestore])

  const restoreBackup = useCallback(
    async (fullPath: string) => {
      const result = await window.api.invoke('backup:restore', fullPath)
      if (result.ok) return finishRestore(result)
      return result
    },
    [finishRestore]
  )

  const removeBackup = useCallback(async (fileName: string) => {
    setBackups(await window.api.invoke('backup:remove', fileName))
  }, [])

  const sampleStatus = useCallback(async () => window.api.invoke('samples:status'), [])

  const removeSamples = useCallback(async () => {
    const { removed } = await window.api.invoke('samples:remove')
    await reloadAll()
    return removed
  }, [reloadAll])

  const reseedSamples = useCallback(async () => {
    const result = await window.api.invoke('samples:reseed')
    await reloadAll()
    return { added: result.added, photos: result.photos }
  }, [reloadAll])

  const chooseDataDir = useCallback(async () => window.api.invoke('dataDir:choose'), [])

  const inspectDataDir = useCallback(async (dir: string) => window.api.invoke('dataDir:inspect', dir), [])

  const relocateDataDir = useCallback(async (target: string) => window.api.invoke('dataDir:relocate', target), [])

  const resetDataDir = useCallback(async () => window.api.invoke('dataDir:reset'), [])

  const relaunchApp = useCallback(async () => {
    await window.api.invoke('app:relaunch')
  }, [])

  const value = useMemo<StoreValue>(
    () => ({
      ready,
      info,
      settings,
      matches,
      events,
      honors,
      options,
      photos,
      backups,
      toasts,
      toast,
      dismissToast,
      setSettings: setSettingsState,
      updateSettings,
      reloadAll,
      reloadSettings,
      reloadMatches,
      reloadEvents,
      reloadHonors,
      reloadOptions,
      reloadPhotos,
      reloadBackups,
      saveMatch,
      removeMatch,
      saveEvent,
      removeEvent,
      saveHonor,
      removeHonor,
      addOption,
      removeOption,
      addPhotos,
      removePhoto,
      removeAllPhotos,
      setActivePhoto,
      cyclePhoto,
      reorderPhotos: reorderPhotosFn,
      adjustPhoto,
      resetPhotoAdjust,
      applyAdjustAll,
      createBackupNow,
      exportBackup,
      restoreFromFile,
      restoreBackup,
      removeBackup,
      sampleStatus,
      removeSamples,
      reseedSamples,
      chooseDataDir,
      inspectDataDir,
      relocateDataDir,
      resetDataDir,
      relaunchApp,
      resumeDraft,
      reloadResumeDraft,
      saveResumeDraft,
      clearResumeDraft
    }),
    [
      ready,
      info,
      settings,
      matches,
      events,
      honors,
      options,
      photos,
      backups,
      toasts,
      toast,
      dismissToast,
      updateSettings,
      reloadAll,
      reloadSettings,
      reloadMatches,
      reloadEvents,
      reloadHonors,
      reloadOptions,
      reloadPhotos,
      reloadBackups,
      saveMatch,
      removeMatch,
      saveEvent,
      removeEvent,
      saveHonor,
      removeHonor,
      addOption,
      removeOption,
      addPhotos,
      removePhoto,
      removeAllPhotos,
      setActivePhoto,
      cyclePhoto,
      reorderPhotosFn,
      adjustPhoto,
      resetPhotoAdjust,
      applyAdjustAll,
      createBackupNow,
      exportBackup,
      restoreFromFile,
      restoreBackup,
      removeBackup,
      sampleStatus,
      removeSamples,
      reseedSamples,
      chooseDataDir,
      inspectDataDir,
      relocateDataDir,
      resetDataDir,
      relaunchApp,
      resumeDraft,
      reloadResumeDraft,
      saveResumeDraft,
      clearResumeDraft
    ]
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}
