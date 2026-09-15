/** 主进程 ↔ 渲染进程的 IPC 契约（单一 invoke 通道 + 白名单），类型贯穿两层。 */

import type { ResumeData } from './resume'

/** 手动编辑后的履历文字（null 表示没有手动编辑，用自动汇总内容） */
export interface ResumeDraft {
  text: string | null
  updatedAt: string | null
}
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
  MatchQuery,
  OptionItem,
  OptionKind,
  OverviewFilter,
  OverviewStats,
  PhotoAdjustPatch,
  RangeFilter,
  RestoreResult,
  SettingsPatch
} from './types'

export interface IpcContract {
  'app:info': { args: []; result: AppInfo }
  /** 选一个文件夹作为新的数据目录（系统对话框），返回 null 表示取消 */
  'dataDir:choose': { args: []; result: { canceled: boolean; path: string | null } }
  /** 切换前检查目标目录，用于确认框文案 */
  'dataDir:inspect': { args: [dir: string]; result: DataDirInspection }
  /** 切换数据目录：复制过去或直接沿用，写完指针后需要重启生效 */
  'dataDir:relocate': { args: [target: string]; result: DataDirRelocateResult }
  /** 恢复默认位置（%APPDATA%\DebateNotes） */
  'dataDir:reset': { args: []; result: DataDirRelocateResult }
  /** 立即重启程序 */
  'app:relaunch': { args: []; result: { ok: boolean } }
  'app:openDataDir': { args: []; result: void }
  'app:openPath': { args: [path: string]; result: void }

  'settings:get': { args: []; result: AppSettings }
  'settings:update': { args: [patch: SettingsPatch]; result: AppSettings }

  'matches:list': { args: [query?: MatchQuery]; result: Match[] }
  'matches:get': { args: [id: number]; result: Match | null }
  'matches:create': { args: [input: MatchInput]; result: Match }
  'matches:update': { args: [id: number, input: MatchInput]; result: Match }
  'matches:remove': { args: [id: number]; result: void }

  'events:list': { args: []; result: DebateEvent[] }
  'events:create': { args: [input: DebateEventInput]; result: DebateEvent }
  'events:update': { args: [id: number, input: DebateEventInput]; result: DebateEvent }
  'events:remove': { args: [id: number]; result: void }

  'honors:list': {
    args: [query?: { from?: string | null; to?: string | null; eventId?: number | 'all' | 'none' }]
    result: Honor[]
  }
  'honors:create': { args: [input: HonorInput]; result: Honor }
  'honors:update': { args: [id: number, input: HonorInput]; result: Honor }
  'honors:remove': { args: [id: number]; result: void }

  'options:list': { args: []; result: OptionItem[] }
  'options:add': { args: [kind: OptionKind, value: string]; result: OptionItem }
  'options:remove': { args: [id: number]; result: void }

  'stats:overview': { args: [filter: OverviewFilter]; result: OverviewStats }

  'resume:build': { args: [range: RangeFilter]; result: ResumeData }
  'resume:draft': { args: []; result: ResumeDraft }
  'resume:saveDraft': { args: [text: string]; result: ResumeDraft }
  'resume:clearDraft': { args: []; result: ResumeDraft }

  'backgrounds:list': { args: []; result: BackgroundPhoto[] }
  'backgrounds:add': {
    args: []
    result: {
      added: number
      skipped: { name: string; reason: string }[]
      canceled: boolean
      photos: BackgroundPhoto[]
    }
  }
  'backgrounds:remove': { args: [id: number]; result: { settings: AppSettings; photos: BackgroundPhoto[] } }
  'backgrounds:removeAll': { args: []; result: { settings: AppSettings; photos: BackgroundPhoto[] } }
  'backgrounds:reorder': { args: [ids: number[]]; result: BackgroundPhoto[] }
  'backgrounds:setActive': { args: [id: number | null]; result: AppSettings }
  'backgrounds:next': { args: [direction?: 1 | -1]; result: AppSettings }
  'backgrounds:adjust': { args: [id: number, patch: PhotoAdjustPatch]; result: BackgroundPhoto[] }
  'backgrounds:resetAdjust': { args: [id: number]; result: BackgroundPhoto[] }
  'backgrounds:applyAdjustAll': { args: [sourceId: number]; result: BackgroundPhoto[] }

  'backup:list': { args: []; result: BackupEntry[] }
  'backup:createNow': { args: []; result: BackupEntry }
  'backup:export': { args: []; result: { ok: boolean; canceled: boolean; path?: string; error?: string } }
  'backup:restoreFromFile': { args: []; result: RestoreResult }
  'backup:restore': { args: [fullPath: string]; result: RestoreResult }
  'backup:remove': { args: [fileName: string]; result: BackupEntry[] }

  'samples:status': { args: []; result: { matches: number; events: number; honors: number; photos: number } }
  'samples:remove': { args: []; result: { removed: { matches: number; events: number; honors: number } } },
  /** 重新写入示例：幂等，只补缺失的部分 */
  'samples:reseed': {
    args: []
    result: {
      added: { matches: number; events: number; honors: number }
      counts: { matches: number; events: number; honors: number }
      photos: number
      photoCount: number
    }
  }
}

export type IpcChannel = keyof IpcContract
export type IpcArgs<K extends IpcChannel> = IpcContract[K]['args']
export type IpcResult<K extends IpcChannel> = IpcContract[K]['result']

export const IPC_CHANNELS: IpcChannel[] = [
  'app:info',
  'dataDir:choose',
  'dataDir:inspect',
  'dataDir:relocate',
  'dataDir:reset',
  'app:relaunch',
  'app:openDataDir',
  'app:openPath',
  'settings:get',
  'settings:update',
  'matches:list',
  'matches:get',
  'matches:create',
  'matches:update',
  'matches:remove',
  'events:list',
  'events:create',
  'events:update',
  'events:remove',
  'honors:list',
  'honors:create',
  'honors:update',
  'honors:remove',
  'options:list',
  'options:add',
  'options:remove',
  'stats:overview',
  'resume:build',
  'resume:draft',
  'resume:saveDraft',
  'resume:clearDraft',
  'backgrounds:list',
  'backgrounds:add',
  'backgrounds:remove',
  'backgrounds:removeAll',
  'backgrounds:reorder',
  'backgrounds:setActive',
  'backgrounds:next',
  'backgrounds:adjust',
  'backgrounds:resetAdjust',
  'backgrounds:applyAdjustAll',
  'backup:list',
  'backup:createNow',
  'backup:export',
  'backup:restoreFromFile',
  'backup:restore',
  'backup:remove',
  'samples:status',
  'samples:remove',
  'samples:reseed'
]

/** 渲染进程可见的 API（由 preload 注入为 window.api） */
export interface RendererApi {
  invoke<K extends IpcChannel>(channel: K, ...args: IpcArgs<K>): Promise<IpcResult<K>>
}

declare global {
  interface Window {
    api: RendererApi
  }
}
