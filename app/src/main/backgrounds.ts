/** 背景照片：导入时复制进数据目录、尺寸解析、示例照片播种。 */

import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { nativeImage } from 'electron'
import os from 'node:os'
import { makeWritable, removeFileSafe } from './fsutil'
import path from 'node:path'
import type { BackgroundPhoto, PhotoAdjustPatch } from '@shared/types'
import type { SqlDatabase } from './db/driver'
import {
  copyBackgroundAdjustToAll,
  deleteAllBackgroundRows,
  deleteBackgroundRow,
  getBackgroundRow,
  insertBackgroundRow,
  listBackgroundRows,
  reorderBackgroundRows,
  updateBackgroundAdjust,
  type AdjustColumn,
  type BackgroundRow
} from './db/repo'
import { getPaths } from './paths'
import { ALLOWED_EXT, detectImageFormat, extForKind, readImageSize, type ImageKind } from './imagefmt'

export const PHOTO_SCHEME = 'debate-photo'

/** 浏览器直接就能渲染的格式，原样保存 */
const RENDERABLE: ReadonlySet<ImageKind> = new Set<ImageKind>(['jpeg', 'png', 'gif', 'bmp', 'webp', 'avif', 'svg', 'ico'])

const KIND_LABEL: Record<ImageKind, string> = {
  jpeg: 'JPEG',
  png: 'PNG',
  gif: 'GIF',
  bmp: 'BMP',
  webp: 'WebP',
  avif: 'AVIF',
  svg: 'SVG',
  ico: 'ICO',
  tiff: 'TIFF',
  heic: 'HEIC/HEIF'
}

export interface SkippedPhoto {
  name: string
  reason: string
}

export interface ImportResult {
  added: BackgroundPhoto[]
  skipped: SkippedPhoto[]
}

export { ALLOWED_EXT, readImageSize }

export function photoUrl(fileName: string): string {
  return `${PHOTO_SCHEME}://local/${encodeURIComponent(fileName)}`
}

function mapRow(row: BackgroundRow): BackgroundPhoto {
  return {
    id: Number(row.id),
    fileName: row.file_name,
    originalName: row.original_name,
    width: row.width === null ? null : Number(row.width),
    height: row.height === null ? null : Number(row.height),
    sizeBytes: Number(row.size_bytes),
    sortOrder: Number(row.sort_order),
    createdAt: row.created_at,
    url: photoUrl(row.file_name),
    offsetX: row.offset_x === null ? null : Number(row.offset_x),
    offsetY: row.offset_y === null ? null : Number(row.offset_y),
    scale: row.scale === null ? null : Number(row.scale),
    opacity: row.opacity === null ? null : Number(row.opacity),
    blur: row.blur === null ? null : Number(row.blur),
    fit: row.fit === 'cover' || row.fit === 'contain' ? row.fit : null
  }
}

export function listBackgrounds(db: SqlDatabase): BackgroundPhoto[] {
  return listBackgroundRows(db).map(mapRow)
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

/**
 * 保存一张照片的手动调整。前端传 null 表示该项恢复「跟随全局设置」。
 * 数值在这里统一夹到合法区间，界面与图层都不必再防越界。
 */
export function setPhotoAdjust(db: SqlDatabase, id: number, patch: PhotoAdjustPatch): BackgroundPhoto[] {
  const row = getBackgroundRow(db, id)
  if (!row) return listBackgrounds(db)

  const next: Partial<Record<AdjustColumn, number | string | null>> = {}
  const num = (v: number, min: number, max: number): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? clamp(v, min, max) : null

  if ('offsetX' in patch) next.offset_x = patch.offsetX === null ? null : num(patch.offsetX as number, -100, 100)
  if ('offsetY' in patch) next.offset_y = patch.offsetY === null ? null : num(patch.offsetY as number, -100, 100)
  if ('scale' in patch) next.scale = patch.scale === null ? null : num(patch.scale as number, 1, 4)
  if ('opacity' in patch) next.opacity = patch.opacity === null ? null : num(patch.opacity as number, 0, 100)
  if ('blur' in patch) next.blur = patch.blur === null ? null : num(patch.blur as number, 0, 24)
  if ('fit' in patch) next.fit = patch.fit === null ? null : patch.fit === 'contain' ? 'contain' : 'cover'

  updateBackgroundAdjust(db, id, next)
  return listBackgrounds(db)
}

/** 恢复一张照片的默认显示（等同跟随全局设置） */
export function resetPhotoAdjust(db: SqlDatabase, id: number): BackgroundPhoto[] {
  updateBackgroundAdjust(db, id, {
    offset_x: null,
    offset_y: null,
    scale: null,
    opacity: null,
    blur: null,
    fit: null
  })
  return listBackgrounds(db)
}

/** 把一张照片的调整套用到其余照片 */
export function applyAdjustToAll(db: SqlDatabase, sourceId: number): BackgroundPhoto[] {
  copyBackgroundAdjustToAll(db, sourceId)
  return listBackgrounds(db)
}

/** 从文件头解析图片尺寸（不引入图像库）——实现见 imagefmt.ts，这里保留导出兼容旧调用 */
export function uniquePhotoName(original: string, extOverride?: string): string {
  const rawExt = (extOverride ?? path.extname(original)).toLowerCase()
  const safeExt = ALLOWED_EXT.has(rawExt) ? rawExt : '.jpg'
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
  const rand = Math.random().toString(36).slice(2, 8)
  return `bg-${stamp}-${rand}${safeExt}`
}

/**
 * 把系统解码器能读、但浏览器渲染不了的格式（HEIC/TIFF 等）转成 PNG。
 * 两级兜底：先试 Electron 的 nativeImage，再试 Windows 自带的 GDI+（装了 HEIF 扩展就能读 HEIC）。
 */
function transcodeUnrenderable(srcPath: string, kind: ImageKind | null): Buffer | null {
  // 1) Electron 自带解码器
  try {
    const img = nativeImage.createFromPath(srcPath)
    if (!img.isEmpty()) {
      const png = img.toPNG()
      if (png.length > 0) return png
    }
  } catch {
    /* 继续尝试系统解码器 */
  }

  // 2) Windows 图像组件（GDI+）。注意 stdio 必须 ignore：本机管道 stdio 会挂住
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'debate-photo-'))
  const out = path.join(tmpDir, 'converted.png')
  const script =
    'Add-Type -AssemblyName System.Drawing;' +
    `$img=[System.Drawing.Image]::FromFile('${srcPath.replace(/'/g, "''")}');` +
    `$img.Save('${out.replace(/'/g, "''")}',[System.Drawing.Imaging.ImageFormat]::Png);` +
    '$img.Dispose()'
  try {
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
      stdio: 'ignore',
      timeout: 20_000
    })
    if (existsSync(out)) {
      const bytes = readFileSync(out)
      if (bytes.length > 0) return bytes
    }
  } catch {
    /* 系统也解不了 */
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }

  void kind
  return null
}

/** 复制/转码一个文件进数据目录并登记 */
export function importPhotoFile(db: SqlDatabase, srcPath: string): BackgroundPhoto | null {
  const { added, skipped } = importOne(db, srcPath)
  void skipped
  return added
}

function importOne(db: SqlDatabase, srcPath: string): { added: BackgroundPhoto | null; skipped: SkippedPhoto | null } {
  const { photosDir } = getPaths()
  const base = path.basename(srcPath)
  let stat: ReturnType<typeof statSync>
  try {
    stat = statSync(srcPath)
  } catch {
    return { added: null, skipped: { name: base, reason: '文件读不到' } }
  }
  if (!stat.isFile()) return { added: null, skipped: { name: base, reason: '不是一个文件' } }

  let bytes: Buffer
  try {
    bytes = readFileSync(srcPath)
  } catch {
    return { added: null, skipped: { name: base, reason: '文件读取失败' } }
  }

  const detected = detectImageFormat(bytes)
  let payload = bytes
  let ext = detected?.ext ?? path.extname(srcPath).toLowerCase()

  if (!detected || !RENDERABLE.has(detected.kind)) {
    const converted = transcodeUnrenderable(srcPath, detected?.kind ?? null)
    if (!converted) {
      const label = detected ? KIND_LABEL[detected.kind] : '未知'
      return {
        added: null,
        skipped: {
          name: base,
          reason: detected
            ? `${label} 格式本机无法解码，请先另存为 JPG/PNG 再导入`
            : '不是可识别的图片文件（支持 JPG/PNG/WebP/GIF/BMP/AVIF/SVG/ICO/TIFF/HEIC）'
        }
      }
    }
    payload = converted
    ext = '.png'
    if (detected) ext = detected.kind === 'heic' || detected.kind === 'tiff' ? '.png' : extForKind(detected.kind)
  }

  const fileName = uniquePhotoName(base, ext)
  const dest = path.join(photosDir, fileName)
  try {
    writeFileSync(dest, payload)
  } catch {
    try {
      copyFileSync(srcPath, dest)
    } catch {
      return { added: null, skipped: { name: base, reason: '写入数据目录失败' } }
    }
  }
  // 复制/写入的副本若是只读（源文件只读属性被继承），删除时会让主进程崩溃，统一改成可写
  makeWritable(dest)

  const size = readImageSize(readFileSync(dest))
  const row = insertBackgroundRow(db, {
    fileName,
    originalName: base,
    width: size.width,
    height: size.height,
    sizeBytes: payload.length
  })
  return { added: mapRow(row), skipped: null }
}

/** 批量导入：返回成功与跳过的明细，界面据此给出真实反馈 */
export function importPhotoFiles(db: SqlDatabase, srcPaths: string[]): ImportResult {
  const added: BackgroundPhoto[] = []
  const skipped: SkippedPhoto[] = []
  for (const p of srcPaths) {
    const r = importOne(db, p)
    if (r.added) added.push(r.added)
    if (r.skipped) skipped.push(r.skipped)
  }
  return { added, skipped }
}

/** 直接从字节登记一张照片（示例照片播种用，不经过系统对话框） */
export function importPhotoBytes(
  db: SqlDatabase,
  originalName: string,
  bytes: Buffer,
  extOverride?: string
): BackgroundPhoto | null {
  const { photosDir } = getPaths()
  const detected = detectImageFormat(bytes)
  const ext = extOverride ?? detected?.ext ?? path.extname(originalName).toLowerCase()
  const fileName = uniquePhotoName(originalName, ext)
  const dest = path.join(photosDir, fileName)
  try {
    writeFileSync(dest, bytes)
  } catch {
    return null
  }
  makeWritable(dest)
  const size = readImageSize(bytes)
  const row = insertBackgroundRow(db, {
    fileName,
    originalName,
    width: size.width,
    height: size.height,
    sizeBytes: bytes.length
  })
  return mapRow(row)
}

/** 从数据目录写回一条记录（恢复备份时用） */
export function registerExistingPhoto(
  db: SqlDatabase,
  fileName: string,
  originalName: string,
  sizeBytes: number,
  createdAt: string
): void {
  const { photosDir } = getPaths()
  const full = path.join(photosDir, fileName)
  const size = existsSync(full) ? readImageSize(readFileSync(full)) : { width: null, height: null }
  db.prepare(
    'INSERT OR IGNORE INTO backgrounds (file_name, original_name, width, height, size_bytes, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(fileName, originalName, size.width, size.height, sizeBytes, 0, createdAt)
}

/** 删除一张背景（同时移除磁盘文件） */
export function removePhoto(db: SqlDatabase, id: number): { removed: boolean; fileName: string | null } {
  const row = getBackgroundRow(db, id)
  if (!row) return { removed: false, fileName: null }
  deleteBackgroundRow(db, id)
  removeFileSafe(path.join(getPaths().photosDir, row.file_name))
  return { removed: true, fileName: row.file_name }
}

/** 清空所有背景（记录 + 文件） */
export function removeAllPhotos(db: SqlDatabase): void {
  const rows = listBackgroundRows(db)
  deleteAllBackgroundRows(db)
  const { photosDir } = getPaths()
  for (const r of rows) {
    removeFileSafe(path.join(photosDir, r.file_name))
  }
}

export function reorderPhotos(db: SqlDatabase, ids: number[]): void {
  reorderBackgroundRows(db, ids)
}

/** 供备份用：把照片目录里的文件读成字节 */
export function readPhotoBytes(fileName: string): Buffer | null {
  const full = path.join(getPaths().photosDir, fileName)
  try {
    if (!existsSync(full)) return null
    return readFileSync(full)
  } catch {
    return null
  }
}

export function writePhotoBytes(fileName: string, data: Buffer): void {
  const { photosDir } = getPaths()
  const full = path.join(photosDir, path.basename(fileName))
  // 目标若已存在且是只读（例如旧版本拷进来的），覆盖会失败，先去掉只读属性
  makeWritable(full)
  writeFileSync(full, data)
  makeWritable(full)
}

export function clearPhotosDir(): void {
  const { photosDir } = getPaths()
  try {
    for (const f of readdirSync(photosDir)) {
      removeFileSafe(path.join(photosDir, f))
    }
  } catch {
    /* ignore */
  }
}
