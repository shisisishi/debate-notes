/**
 * 图片格式识别与尺寸解析（不依赖任何第三方库）。
 *
 * 识别以「文件内容」为准而不是扩展名：很多从手机、浏览器、截图工具来的图片
 * 扩展名并不可靠（.jfif、无扩展名、.jpg 里其实是 png 等）。
 * 不认识的格式再尝试用系统解码器读出来并转成 JPEG，这样 HEIC/TIFF 之类
 * 只要系统装了对应解码器也能导入。
 */

export interface ImageFormat {
  /** 规范化扩展名（含点，小写） */
  ext: string
  /** 供自定义协议返回的 Content-Type */
  mime: string
  kind: ImageKind
}

export type ImageKind = 'jpeg' | 'png' | 'gif' | 'bmp' | 'webp' | 'avif' | 'svg' | 'ico' | 'tiff' | 'heic'

/** 选择文件对话框里列出的扩展名 */
export const SUPPORTED_EXTS = [
  'jpg',
  'jpeg',
  'jpe',
  'jfif',
  'png',
  'apng',
  'webp',
  'gif',
  'bmp',
  'avif',
  'svg',
  'ico',
  'heic',
  'heif',
  'tif',
  'tiff'
] as const

/** 旧名字保留：程序内部统一用 SUPPORTED_EXTS */
export const ALLOWED_EXT = new Set(SUPPORTED_EXTS.map((e) => `.${e}`))

const KIND_META: Record<ImageKind, { ext: string; mime: string }> = {
  jpeg: { ext: '.jpg', mime: 'image/jpeg' },
  png: { ext: '.png', mime: 'image/png' },
  gif: { ext: '.gif', mime: 'image/gif' },
  bmp: { ext: '.bmp', mime: 'image/bmp' },
  webp: { ext: '.webp', mime: 'image/webp' },
  avif: { ext: '.avif', mime: 'image/avif' },
  svg: { ext: '.svg', mime: 'image/svg+xml' },
  ico: { ext: '.ico', mime: 'image/x-icon' },
  tiff: { ext: '.tiff', mime: 'image/tiff' },
  heic: { ext: '.heic', mime: 'image/heic' }
}

function at(buf: Buffer, offset: number, text: string): boolean {
  if (buf.length < offset + text.length) return false
  return buf.subarray(offset, offset + text.length).toString('latin1') === text
}

/** 按文件头判断格式；无法判断时返回 null */
export function detectImageFormat(buf: Buffer): ImageFormat | null {
  if (buf.length < 12) return null

  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8) return fmt('jpeg')
  // PNG（含 APNG）
  if (buf.readUInt32BE(0) === 0x89504e47 && at(buf, 4, 'IHDR')) return fmt('png')
  // GIF
  if (at(buf, 0, 'GIF87a') || at(buf, 0, 'GIF89a')) return fmt('gif')
  // BMP
  if (buf[0] === 0x42 && buf[1] === 0x4d) return fmt('bmp')
  // RIFF 容器：WebP
  if (at(buf, 0, 'RIFF') && at(buf, 8, 'WEBP')) return fmt('webp')
  // ISO-BMFF 容器：ftyp 品牌区分 AVIF / HEIC / HEIF
  if (at(buf, 4, 'ftyp')) {
    const brand = buf.subarray(8, 12).toString('latin1').toLowerCase()
    if (brand.startsWith('avi')) return fmt('avif')
    if (brand.startsWith('hei') || brand.startsWith('mif') || brand.startsWith('msf')) return fmt('heic')
  }
  // ICO
  if (buf.readUInt16LE(0) === 0 && (buf.readUInt16LE(2) === 1 || buf.readUInt16LE(2) === 2) && buf[2] === 0) {
    return fmt('ico')
  }
  // TIFF（大小端两种）
  if ((buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2a) || (buf[0] === 0x4d && buf[1] === 0x4d && buf[2] === 0)) {
    return fmt('tiff')
  }
  // SVG：文本，跳过 BOM 与空白后看 <svg 或 <?xml
  const head = buf.subarray(0, Math.min(buf.length, 1024)).toString('utf8').replace(/^\uFEFF/, '').trimStart().toLowerCase()
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return fmt('svg')

  return null
}

function fmt(kind: ImageKind): ImageFormat {
  return { kind, ext: KIND_META[kind].ext, mime: KIND_META[kind].mime }
}

/** 自定义协议需要按实际格式返回 Content-Type（文件名后缀可能被转码改过） */
export function mimeForFileName(fileName: string): string | null {
  const ext = (fileName.match(/\.[a-z0-9]+$/i)?.[0] ?? '').toLowerCase()
  for (const kind of Object.keys(KIND_META) as ImageKind[]) {
    if (KIND_META[kind].ext === ext) return KIND_META[kind].mime
  }
  if (ext === '.jpeg' || ext === '.jpe' || ext === '.jfif') return 'image/jpeg'
  if (ext === '.apng') return 'image/png'
  if (ext === '.heif') return 'image/heic'
  if (ext === '.tif') return 'image/tiff'
  return null
}

/** 从文件内容解析像素尺寸；解析不出来返回 null */
export function readImageSize(buf: Buffer): { width: number | null; height: number | null } {
  try {
    const detected = detectImageFormat(buf)
    const kind = detected?.kind
    if (kind === 'png') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
    if (kind === 'gif') return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }
    if (kind === 'bmp') {
      return { width: buf.readInt32LE(18), height: Math.abs(buf.readInt32LE(22)) }
    }
    if (kind === 'ico') {
      const w = buf[6] === 0 ? 256 : buf[6]
      const h = buf[7] === 0 ? 256 : buf[7]
      return { width: w, height: h }
    }
    if (kind === 'webp') {
      const sub = buf.subarray(12, 16).toString('latin1')
      if (sub === 'VP8X') {
        const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16))
        const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16))
        return { width: w, height: h }
      }
      if (sub === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff }
      if (sub === 'VP8L') {
        const b = buf.readUInt32LE(21)
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }
      }
      return { width: null, height: null }
    }
    if (kind === 'svg') return svgSize(buf)
    if (kind === 'avif' || kind === 'heic' || kind === 'tiff') return isoBmffOrTiffSize(buf)
    if (kind === 'jpeg') return jpegSize(buf)
  } catch {
    /* 解析失败不阻断导入 */
  }
  return { width: null, height: null }
}

function jpegSize(buf: Buffer): { width: number | null; height: number | null } {
  let i = 2
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i += 1
      continue
    }
    const marker = buf[i + 1]
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2
      continue
    }
    const len = buf.readUInt16BE(i + 2)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
    }
    i += 2 + len
  }
  return { width: null, height: null }
}

/** AVIF / HEIC：在 ISO-BMFF 里找 ispe box（宽高各 4 字节） */
function isoBmffOrTiffSize(buf: Buffer): { width: number | null; height: number | null } {
  const idx = buf.indexOf('ispe', 0, 'latin1')
  if (idx >= 0 && idx + 16 <= buf.length) {
    return { width: buf.readUInt32BE(idx + 8), height: buf.readUInt32BE(idx + 12) }
  }
  return { width: null, height: null }
}

/** SVG：优先读 width/height 属性，其次 viewBox */
function svgSize(buf: Buffer): { width: number | null; height: number | null } {
  const head = buf.subarray(0, Math.min(buf.length, 4096)).toString('utf8')
  const svgTag = head.match(/<svg[^>]*>/i)?.[0] ?? head
  const w = Number(svgTag.match(/\bwidth\s*=\s*["']?\s*([\d.]+)/i)?.[1] ?? NaN)
  const h = Number(svgTag.match(/\bheight\s*=\s*["']?\s*([\d.]+)/i)?.[1] ?? NaN)
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    return { width: Math.round(w), height: Math.round(h) }
  }
  const vb = svgTag.match(/\bviewBox\s*=\s*["']\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i)
  if (vb) {
    const vw = Number(vb[3])
    const vh = Number(vb[4])
    if (Number.isFinite(vw) && Number.isFinite(vh)) return { width: Math.round(vw), height: Math.round(vh) }
  }
  return { width: null, height: null }
}

export function extForKind(kind: ImageKind): string {
  return KIND_META[kind].ext
}
