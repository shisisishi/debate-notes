/** IPC 处理器注册：所有通道在 preload 白名单内，错误统一转成可直接展示的中文信息。 */

import { app, dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import path from 'node:path'
import { IPC_CHANNELS, type IpcArgs, type IpcChannel, type IpcResult } from '@shared/ipc'
import type {
  AppInfo,
  AppSettings,
  BackgroundPhoto,
  OptionKind,
  OverviewFilter,
  PhotoAdjustPatch,
  RangeFilter
} from '@shared/types'
import {
  applyAdjustToAll,
  importPhotoFiles,
  listBackgrounds,
  removeAllPhotos,
  removePhoto,
  reorderPhotos,
  resetPhotoAdjust,
  setPhotoAdjust
} from './backgrounds'
import {
  createBackup,
  deleteBackup,
  listBackups,
  performAutoBackupIfNeeded,
  restoreFromBackup
} from './backup'
import { getDb } from './db'
import { checkpointDatabase, inspectTarget, relocate, relocateToDefault } from './datadir'
import { SUPPORTED_EXTS } from './imagefmt'
import { removeSamples, reseedSamples } from './samples'
import * as repo from './db/repo'
import { detectDriverName } from './db/driver'
import { defaultDataDir, getPaths, isCustomDataDir } from './paths'
import { buildResume } from './resume'
import { clearResumeDraft, readResumeDraft, saveResumeDraft } from './resumeDraft'
import { applyPatch, loadSettings, saveSettings } from './settings'
import { buildOverview } from './stats'

function cleanError(err: unknown): Error {
  if (err instanceof repo.AppError) return new Error(err.message)
  if (err instanceof Error) return new Error(err.message)
  return new Error(String(err))
}

function pickActive(photos: BackgroundPhoto[], current: number | null, avoid?: number): number | null {
  if (photos.length === 0) return null
  const remaining = photos.filter((p) => p.id !== avoid)
  if (remaining.length === 0) return photos[0].id
  if (current !== null && remaining.some((p) => p.id === current)) return current
  const idx = photos.findIndex((p) => p.id === current)
  if (idx >= 0) return photos[(idx + 1) % photos.length].id
  return remaining[0].id
}

function buildAppInfo(): AppInfo {
  const p = getPaths()
  return {
    version: app.getVersion(),
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    nodeVersion: process.versions.node,
    sqliteDriver: detectDriverName(),
    dataDir: p.dataDir,
    photosDir: p.photosDir,
    backupsDir: p.backupsDir,
    databaseFile: p.databaseFile,
    dataDirIsCustom: isCustomDataDir(),
    defaultDataDir: defaultDataDir()
  }
}

type Handler<K extends IpcChannel> = (...args: IpcArgs<K>) => IpcResult<K> | Promise<IpcResult<K>>

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  const handlers: { [K in IpcChannel]: Handler<K> } = {
    'app:info': () => buildAppInfo(),

    'app:openDataDir': async () => {
      await shell.openPath(getPaths().dataDir)
    },

    'dataDir:choose': async () => {
      const window = getWindow()
      const options: Electron.OpenDialogOptions = {
        title: '选择新的数据目录（例如 D 盘上的文件夹）',
        buttonLabel: '用这个文件夹',
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: getPaths().dataDir
      }
      const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
      if (result.canceled || result.filePaths.length === 0) return { canceled: true, path: null }
      return { canceled: false, path: result.filePaths[0] }
    },

    'dataDir:inspect': (dir) => inspectTarget(dir),

    'dataDir:relocate': (target) => {
      // 先把 WAL 落盘，保证复制出去的 database.sqlite 是完整的
      checkpointDatabase(getDb())
      return relocate(getPaths().dataDir, target)
    },

    'dataDir:reset': () => {
      checkpointDatabase(getDb())
      return relocateToDefault(getPaths().dataDir)
    },

    'app:relaunch': () => {
      app.relaunch()
      setTimeout(() => app.exit(0), 120)
      return { ok: true }
    },

    'app:openPath': async (target) => {
      const err = await shell.openPath(target)
      if (err) shell.showItemInFolder(target)
    },

    'settings:get': () => loadSettings(),

    'settings:update': (patch) => saveSettings(applyPatch(loadSettings(), patch)),

    'matches:list': (query) => repo.listMatches(getDb(), query),

    'matches:get': (id) => repo.getMatch(getDb(), id),

    'matches:create': (input) => repo.createMatch(getDb(), input),

    'matches:update': (id, input) => repo.updateMatch(getDb(), id, input),

    'matches:remove': (id) => {
      repo.deleteMatch(getDb(), id)
    },

    'events:list': () => repo.listEvents(getDb()),

    'events:create': (input) => repo.createEvent(getDb(), input),

    'events:update': (id, input) => repo.updateEvent(getDb(), id, input),

    'events:remove': (id) => {
      repo.deleteEvent(getDb(), id)
    },

    'honors:list': (query) => repo.listHonors(getDb(), query ?? {}),

    'honors:create': (input) => repo.createHonor(getDb(), input),

    'honors:update': (id, input) => repo.updateHonor(getDb(), id, input),

    'honors:remove': (id) => {
      repo.deleteHonor(getDb(), id)
    },

    'options:list': () => repo.listOptions(getDb()),

    'options:add': (kind: OptionKind, value: string) => repo.addOption(getDb(), kind, value),

    'options:remove': (id) => {
      repo.removeOption(getDb(), id)
    },

    'stats:overview': (filter: OverviewFilter) => buildOverview(getDb(), filter),

    'resume:build': (range: RangeFilter) => buildResume(getDb(), range),

    'resume:draft': () => readResumeDraft(getDb()),

    'resume:saveDraft': (text: string) => saveResumeDraft(getDb(), text),

    'resume:clearDraft': () => clearResumeDraft(getDb()),

    'backgrounds:list': () => listBackgrounds(getDb()),

    'backgrounds:add': async () => {
      const win = getWindow()
      const filters = [{ name: '图片', extensions: [...SUPPORTED_EXTS] }, { name: '所有文件', extensions: ['*'] }]
      const result = win
        ? await dialog.showOpenDialog(win, {
            title: '选择背景照片（可多选）',
            properties: ['openFile', 'multiSelections'],
            filters
          })
        : await dialog.showOpenDialog({
            title: '选择背景照片（可多选）',
            properties: ['openFile', 'multiSelections'],
            filters
          })
      if (result.canceled || result.filePaths.length === 0) {
        return { added: 0, skipped: [], canceled: true, photos: listBackgrounds(getDb()) }
      }
      const { added, skipped } = importPhotoFiles(getDb(), result.filePaths)
      const photos = listBackgrounds(getDb())
      const settings = loadSettings()
      if (settings.activeBackgroundId === null && photos.length > 0) {
        saveSettings({ ...settings, activeBackgroundId: photos[0].id })
      }
      return { added: added.length, skipped, canceled: false, photos }
    },

    'backgrounds:remove': (id: number) => {
      const { removed } = removePhoto(getDb(), id)
      const photos = listBackgrounds(getDb())
      const settings = loadSettings()
      const next: AppSettings =
        removed && settings.activeBackgroundId === id
          ? { ...settings, activeBackgroundId: pickActive(photos, null, id) }
          : settings
      return { settings: saveSettings(next), photos }
    },

    'backgrounds:removeAll': () => {
      removeAllPhotos(getDb())
      const settings = saveSettings({ ...loadSettings(), activeBackgroundId: null })
      return { settings, photos: [] }
    },

    'backgrounds:reorder': (ids: number[]) => {
      reorderPhotos(getDb(), ids)
      return listBackgrounds(getDb())
    },

    'backgrounds:setActive': (id: number | null) => {
      const photos = listBackgrounds(getDb())
      const valid = id !== null && photos.some((p) => p.id === id) ? id : null
      return saveSettings({ ...loadSettings(), activeBackgroundId: valid })
    },

    'backgrounds:next': (direction: 1 | -1 = 1) => {
      const photos = listBackgrounds(getDb())
      const settings = loadSettings()
      if (photos.length === 0) return saveSettings({ ...settings, activeBackgroundId: null })
      const idx = photos.findIndex((p) => p.id === settings.activeBackgroundId)
      const nextIdx = idx < 0 ? 0 : (idx + direction + photos.length) % photos.length
      return saveSettings({ ...settings, activeBackgroundId: photos[nextIdx].id })
    },

    'backgrounds:adjust': (id: number, patch: PhotoAdjustPatch) => setPhotoAdjust(getDb(), id, patch),

    'backgrounds:resetAdjust': (id: number) => resetPhotoAdjust(getDb(), id),

    'backgrounds:applyAdjustAll': (sourceId: number) => applyAdjustToAll(getDb(), sourceId),

    'backup:list': () => listBackups(),

    'backup:createNow': () => createBackup('manual'),

    'backup:export': async () => {
      const win = getWindow()
      const now = new Date()
      const p = (n: number): string => String(n).padStart(2, '0')
      const def = `辩论手记-完整备份-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.zip`
      const result = win
        ? await dialog.showSaveDialog(win, { title: '导出完整备份', defaultPath: def, filters: [{ name: '备份文件', extensions: ['zip'] }] })
        : await dialog.showSaveDialog({ title: '导出完整备份', defaultPath: def })
      if (result.canceled || !result.filePath) return { ok: false, canceled: true }
      try {
        const entry = createBackup('manual', result.filePath)
        return { ok: true, canceled: false, path: entry.fullPath }
      } catch (err) {
        return { ok: false, canceled: false, error: (err as Error).message }
      }
    },

    'backup:restoreFromFile': async () => {
      const win = getWindow()
      const result = win
        ? await dialog.showOpenDialog(win, {
            title: '选择要恢复的备份文件',
            properties: ['openFile'],
            filters: [{ name: '备份文件', extensions: ['zip'] }]
          })
        : await dialog.showOpenDialog({ title: '选择要恢复的备份文件', properties: ['openFile'] })
      if (result.canceled || result.filePaths.length === 0) return { ok: false, error: '已取消' }
      return restoreFromBackup(result.filePaths[0])
    },

    'backup:restore': (fullPath: string) => restoreFromBackup(path.resolve(fullPath)),

    'backup:remove': (fileName: string) => {
      deleteBackup(fileName)
      return listBackups()
    },

    'samples:status': () => {
      const counts = repo.countSamples(getDb())
      return { ...counts, photos: listBackgrounds(getDb()).length }
    },

    'samples:remove': () => {
      const removed = removeSamples(getDb())
      return { removed }
    },

    'samples:reseed': () => {
      const outcome = reseedSamples(getDb())
      return {
        added: outcome.added,
        counts: outcome.counts,
        photos: outcome.photos,
        photoCount: listBackgrounds(getDb()).length
      }
    }
  }

  for (const channel of IPC_CHANNELS) {
    ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
      try {
        const fn = handlers[channel] as (...a: unknown[]) => unknown
        return await fn(...args)
      } catch (err) {
        throw cleanError(err)
      }
    })
  }
}

/** 启动时的自动备份（每天首次、且已有数据） */
export function runStartupBackup(): void {
  try {
    performAutoBackupIfNeeded()
  } catch {
    /* 自动备份失败不应阻断启动 */
  }
}
