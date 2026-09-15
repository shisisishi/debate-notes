/**
 * 全应用共享的类型与固定枚举。
 * 说明：胜负状态（MATCH_STATUSES）、正赛／模拟赛（MATCH_CATEGORIES）、正反方（SIDES）
 * 保持固定不可扩展，确保统计口径稳定；辩位／赛事成绩／荣誉名称走可扩展选项表。
 */

export const MATCH_CATEGORIES = ['正赛', '模拟赛'] as const
export type MatchCategory = (typeof MATCH_CATEGORIES)[number]

export const MATCH_STATUSES = ['待赛', '未出结果', '胜', '负', '无胜负'] as const
export type MatchStatus = (typeof MATCH_STATUSES)[number]

export const SIDES = ['正方', '反方'] as const
export type Side = (typeof SIDES)[number]

export const OPTION_KINDS = ['position', 'eventResult', 'honorName'] as const
export type OptionKind = (typeof OPTION_KINDS)[number]

export const OPTION_KIND_LABELS: Record<OptionKind, string> = {
  position: '辩位',
  eventResult: '赛事成绩',
  honorName: '荣誉名称'
}

/** 可扩展选项的初始预设（用户新增的项会被记住并参与后续选择） */
export const DEFAULT_OPTIONS: Record<OptionKind, string[]> = {
  position: ['一辩', '二辩', '三辩', '四辩', '自由辩手'],
  eventResult: ['冠军', '亚军', '四强', '八强', '十六强', '小组出线', '参与'],
  honorName: ['最佳辩手', '优秀辩手', '最佳风度', '优秀团队']
}

export interface DebateEvent {
  id: number
  name: string
  result: string | null
  note: string
  /** 是否是示例数据 */
  isSample: boolean
  createdAt: string
  updatedAt: string
  /** 派生字段：该赛事下的比赛场次与战绩 */
  matchCount: number
  winCount: number
  lossCount: number
  bestDebaterCount: number
  /** 派生字段：赛期（取其下比赛的最早～最晚日期，无比赛时用创建日期兜底） */
  startDate: string | null
  endDate: string | null
  hasExplicitRange: boolean
}

export interface DebateEventInput {
  name: string
  result: string | null
  note: string
}

export interface Match {
  id: number
  /** YYYY-MM-DD */
  date: string
  /** HH:MM，可空 */
  startTime: string | null
  topic: string
  category: MatchCategory
  eventId: number | null
  eventName: string | null
  side: Side | null
  position: string | null
  status: MatchStatus
  isBestDebater: boolean
  comment: string
  /** 是否是首次启动写入的示例数据（可在设置里一键删除） */
  isSample: boolean
  createdAt: string
  updatedAt: string
}

export interface MatchInput {
  date: string
  startTime: string | null
  topic: string
  category: MatchCategory
  eventId: number | null
  side: Side | null
  position: string | null
  status: MatchStatus
  isBestDebater: boolean
  comment: string
}

export interface MatchQuery {
  /** 模糊搜索：辩题／赛事／辩位／简评 */
  keyword?: string
  /** 时间范围（含首尾） */
  from?: string | null
  to?: string | null
  category?: MatchCategory | 'all'
  eventId?: number | 'all' | 'none'
  status?: MatchStatus | 'all'
  order?: 'date-desc' | 'date-asc'
}

export interface Honor {
  id: number
  name: string
  /** YYYY-MM-DD */
  date: string
  eventId: number | null
  eventName: string | null
  note: string
  /** 是否是示例数据 */
  isSample: boolean
  createdAt: string
  updatedAt: string
}

export interface HonorInput {
  name: string
  date: string
  eventId: number | null
  note: string
}

export interface OptionItem {
  id: number
  kind: OptionKind
  value: string
  sortOrder: number
  /** 是否是内置预设（内置项不可删除，只可隐藏式忽略） */
  builtin: boolean
}

/** 单张背景照片的手动调整（null = 跟随全局设置） */
export interface PhotoAdjust {
  /** 水平位置 -100 ~ 100，0 为居中；范围会自动限制在不露出空白的余量内 */
  offsetX: number | null
  /** 垂直位置 -100 ~ 100，0 为居中 */
  offsetY: number | null
  /** 缩放倍数 1 ~ 4 */
  scale: number | null
  /** 不透明度 0 ~ 100（%），null 跟随全局 */
  opacity: number | null
  /** 模糊 0 ~ 24 px，null 跟随全局 */
  blur: number | null
  /** 铺满裁切 / 完整留白，null 跟随全局 */
  fit: PhotoFit | null
}

export type PhotoFit = 'cover' | 'contain'

export const PHOTO_ADJUST_DEFAULT: PhotoAdjust = {
  offsetX: null,
  offsetY: null,
  scale: null,
  opacity: null,
  blur: null,
  fit: null
}

export type PhotoAdjustPatch = Partial<PhotoAdjust>

export interface BackgroundPhoto extends PhotoAdjust {
  id: number
  fileName: string
  originalName: string
  width: number | null
  height: number | null
  sizeBytes: number
  sortOrder: number
  createdAt: string
  /** 渲染进程可直接使用的 URL（自定义协议） */
  url: string
}

export type RangePreset = 'month' | 'year' | 'all' | 'custom'

export const RANGE_PRESET_LABELS: Record<RangePreset, string> = {
  month: '本月',
  year: '今年',
  all: '全部',
  custom: '自选日期'
}

export interface RangeFilter {
  preset: RangePreset
  from: string
  to: string
  /** 用哪个「今天」去解析本月／今年 */
  anchor: string
}

export interface OverviewFilter {
  category: MatchCategory | 'all'
  eventId: number | 'all' | 'none'
  range: RangeFilter
}

export interface OverviewStats {
  /** 待赛（不计入已完成） */
  pending: number
  /** 已完成 = 胜 + 负 + 无胜负 + 未出结果 */
  finished: number
  wins: number
  losses: number
  draws: number
  unknown: number
  total: number
  /** 胜 ÷ (胜 + 负)；无明确胜负时为 null，界面显示「暂无」 */
  winRate: number | null
  bestDebaterCount: number
  honorCount: number
  /** 分赛事类别统计 */
  byCategory: Record<MatchCategory, { finished: number; wins: number; losses: number; draws: number; unknown: number; pending: number; winRate: number | null; bestDebaterCount: number }>
  /** 各赛事成绩（在时间范围内有赛期的赛事） */
  eventResults: Array<{ eventId: number; name: string; result: string | null; startDate: string | null; endDate: string | null; matchCount: number; wins: number; losses: number }>
  /** 时间范围内最近若干场比赛 */
  recent: Match[]
  /** 时间范围内的荣誉明细 */
  honors: Honor[]
}

export interface AppSettings {
  /** 皮肤（外观风格） */
  theme: ThemeId
  backgroundEnabled: boolean
  /** 背景照片不透明度 0~1 */
  backgroundOpacity: number
  /** 内容面板底色强度 0~1，越高文字越清楚 */
  panelOpacity: number
  /** 背景模糊 px */
  backgroundBlur: number
  rotationEnabled: boolean
  rotationIntervalMs: number
  activeBackgroundId: number | null
  /** 是否铺满裁切（false 为完整留白显示） */
  backgroundCover: boolean
  overview: OverviewFilter
  resume: { range: RangeFilter }
  lastAutoBackupDate: string | null
  lastPage: PageKey
  autoBackupEnabled: boolean
  autoBackupKeep: number
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

/**
 * 设置补丁：允许只带嵌套对象里被改动的那一层。
 * 渲染进程必须发「叶子」改动，避免用旧快照整体覆盖导致并发写入互相回退。
 */
export type SettingsPatch = DeepPartial<AppSettings>

export const PAGE_KEYS = ['overview', 'matches', 'calendar', 'resume', 'settings'] as const
export type PageKey = (typeof PAGE_KEYS)[number]

/** ---- 皮肤 ---- */

export const THEME_IDS = ['handbook', 'minimal', 'chinese', 'ink'] as const
export type ThemeId = (typeof THEME_IDS)[number]

export interface ThemeMeta {
  id: ThemeId
  name: string
  desc: string
  /** 选择卡片上的示意色（背景 / 面板 / 强调色） */
  swatch: { bg: string; panel: string; accent: string }
}

export const THEMES: ThemeMeta[] = [
  {
    id: 'handbook',
    name: '极简手账',
    desc: '默认皮肤：暖米底色、低饱和木色强调，像一本纸质手账。',
    swatch: { bg: '#f4f0e8', panel: '#fffdf9', accent: '#9a8259' }
  },
  {
    id: 'minimal',
    name: '极简白',
    desc: '纯白面板、细灰描边、无阴影，信息密度最高，适合专心录入。',
    swatch: { bg: '#f7f7f8', panel: '#ffffff', accent: '#2f3336' }
  },
  {
    id: 'chinese',
    name: '中式雅致',
    desc: '宣纸底色、朱红与墨色、宋体与回纹描边，装饰丰富的中式手卷风。',
    swatch: { bg: '#f2e7d3', panel: '#fbf5e8', accent: '#9e2b25' }
  },
  {
    id: 'ink',
    name: '水墨夜色',
    desc: '深色底、留白式卡片，夜里看不刺眼，适合当桌面常驻。',
    swatch: { bg: '#1c1e21', panel: '#262a2e', accent: '#c8a15f' }
  }
]

export const PAGE_LABELS: Record<PageKey, string> = {
  overview: '战绩总览',
  matches: '比赛记录',
  calendar: '比赛日历',
  resume: '履历',
  settings: '设置'
}

export interface AppInfo {
  version: string
  electronVersion: string
  chromeVersion: string
  nodeVersion: string
  sqliteDriver: string
  dataDir: string
  photosDir: string
  backupsDir: string
  databaseFile: string
  /** 数据目录是否在自定义位置（例如 D 盘） */
  dataDirIsCustom: boolean
  /** 默认位置（%APPDATA%\DebateNotes），用于提示与「恢复默认位置」 */
  defaultDataDir: string
}

/** 切换数据目录前对目标目录的检查结果 */
export interface DataDirInspection {
  path: string
  exists: boolean
  /** 里面已经有 database.sqlite：可以直接改用它 */
  hasDatabase: boolean
  /** 里面有其它文件 */
  hasOtherFiles: boolean
  matchesInTarget: number
  photosInTarget: number
  error?: string
}

export interface DataDirRelocateResult {
  ok: boolean
  /** 切换之后的实际数据目录 */
  dataDir: string
  /** 本次复制过去的文件数（直接沿用已有数据时为 0） */
  copiedFiles: number
  /** 是否沿用了目标目录里已有的数据 */
  adopted: boolean
  /** 是否需要重启程序才生效（始终为 true） */
  needsRestart: boolean
  error?: string
}

export interface BackupEntry {
  fileName: string
  fullPath: string
  sizeBytes: number
  createdAt: string
  kind: 'auto' | 'manual' | 'prerestore'
}

export interface RestoreResult {
  ok: boolean
  /** 失败原因（校验不通过时不会改动现有数据） */
  error?: string
  restored?: {
    matches: number
    events: number
    honors: number
    backgrounds: number
    settingsRestored: boolean
  }
  safetyBackup?: string
}

export interface BackupManifest {
  format: 'debate-notes-backup'
  formatVersion: 1
  appVersion: string
  createdAt: string
  counts: { matches: number; events: number; honors: number; backgrounds: number }
  files: Array<{ path: string; size: number; sha256: string }>
  /** 备份时磁盘上已缺失、因而未纳入包内的照片文件名（恢复时视为可接受） */
  missingPhotos?: string[]
}
