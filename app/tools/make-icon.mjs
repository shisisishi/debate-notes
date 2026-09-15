/**
 * 生成程序图标：build/icon.ico（多尺寸）与 build/icon.png。
 * 纯 Node 实现（自带 PNG 编码与 ICO 组装），不依赖任何图形库。
 * 用法：npm run icon
 *
 * 图形：暖棕色圆角方块 + 米白对话气泡 + 三条记录线（首行用主题金色）
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.resolve(HERE, '..')
const BUILD_DIR = path.join(APP_ROOT, 'build')

const SIZES = [16, 24, 32, 48, 64, 128, 256]
const SUP = 4 // 超采样倍数（先画大图再缩小，得到抗锯齿边缘）

// 主题配色
const BG_FROM = [0x6f, 0x63, 0x55]
const BG_TO = [0x38, 0x32, 0x2a]
const BUBBLE = [0xf8, 0xf3, 0xe8]
const LINE = [0x4a, 0x42, 0x39]
const ACCENT = [0xc0, 0xa2, 0x65]

/* ---------------- 绘制 ---------------- */

/** 预乘 alpha 的浮点画布 */
function makeCanvas(size) {
  return { size, px: new Float64Array(size * size * 4) }
}

function over(px, i, r, g, b, a) {
  const dr = px[i]
  const dg = px[i + 1]
  const db = px[i + 2]
  const da = px[i + 3]
  px[i] = r + dr * (1 - a)
  px[i + 1] = g + dg * (1 - a)
  px[i + 2] = b + db * (1 - a)
  px[i + 3] = a + da * (1 - a)
}

function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false
  const cx = Math.min(Math.max(x, x0 + r), x1 - r)
  const cy = Math.min(Math.max(y, y0 + r), y1 - r)
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= r * r
}

/** 圆角矩形，color 为 [r,g,b]（0-255）；getColor 可覆盖为渐变 */
function fillRoundRect(canvas, box, radius, color, getColor) {
  const { size, px } = canvas
  const x0 = box[0] * size
  const y0 = box[1] * size
  const x1 = box[2] * size
  const y1 = box[3] * size
  const r = radius * size
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
    for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
      if (!inRoundRect(x + 0.5, y + 0.5, x0, y0, x1, y1, r)) continue
      const c = getColor ? getColor(x / size, y / size) : color
      const i = (y * size + x) * 4
      over(px, i, (c[0] / 255) * 1, (c[1] / 255) * 1, (c[2] / 255) * 1, 1)
    }
  }
}

function fillTriangle(canvas, p1, p2, p3, color) {
  const { size, px } = canvas
  const [ax, ay] = [p1[0] * size, p1[1] * size]
  const [bx, by] = [p2[0] * size, p2[1] * size]
  const [cx, cy] = [p3[0] * size, p3[1] * size]
  const minX = Math.floor(Math.min(ax, bx, cx))
  const maxX = Math.ceil(Math.max(ax, bx, cx))
  const minY = Math.floor(Math.min(ay, by, cy))
  const maxY = Math.ceil(Math.max(ay, by, cy))
  const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
  for (let y = Math.max(0, minY); y < Math.min(size, maxY); y++) {
    for (let x = Math.max(0, minX); x < Math.min(size, maxX); x++) {
      const pxx = x + 0.5
      const pyy = y + 0.5
      const w1 = ((bx - pxx) * (cy - pyy) - (cx - pxx) * (by - pyy)) / area
      const w2 = ((cx - pxx) * (ay - pyy) - (ax - pxx) * (cy - pyy)) / area
      const w3 = 1 - w1 - w2
      if (w1 < 0 || w2 < 0 || w3 < 0) continue
      const i = (y * size + x) * 4
      over(px, i, color[0] / 255, color[1] / 255, color[2] / 255, 1)
    }
  }
}

/** 画一张图标，返回 RGBA Buffer */
function renderIcon(size) {
  const big = makeCanvas(size * SUP)
  // 背景：圆角方块 + 对角渐变
  fillRoundRect(
    big,
    [0.05, 0.05, 0.95, 0.95],
    0.22,
    null,
    (u, v) => {
      const t = Math.min(1, Math.max(0, (u + v) / 2))
      return [
        BG_FROM[0] + (BG_TO[0] - BG_FROM[0]) * t,
        BG_FROM[1] + (BG_TO[1] - BG_FROM[1]) * t,
        BG_FROM[2] + (BG_TO[2] - BG_FROM[2]) * t
      ]
    }
  )
  // 对话气泡 + 小尾巴
  fillRoundRect(big, [0.19, 0.22, 0.81, 0.63], 0.11, BUBBLE)
  fillTriangle(big, [0.31, 0.6], [0.27, 0.79], [0.47, 0.6], BUBBLE)
  // 三条记录线：首行金色
  fillRoundRect(big, [0.29, 0.325, 0.71, 0.375], 0.025, ACCENT)
  fillRoundRect(big, [0.29, 0.41, 0.71, 0.46], 0.025, LINE)
  fillRoundRect(big, [0.29, 0.495, 0.56, 0.545], 0.025, LINE)

  // 缩小（预乘平均）
  const out = Buffer.alloc(size * size * 4)
  const n = SUP * SUP
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SUP; sy++) {
        for (let sx = 0; sx < SUP; sx++) {
          const i = ((y * SUP + sy) * size * SUP + (x * SUP + sx)) * 4
          r += big.px[i]
          g += big.px[i + 1]
          b += big.px[i + 2]
          a += big.px[i + 3]
        }
      }
      r /= n
      g /= n
      b /= n
      a /= n
      const o = (y * size + x) * 4
      if (a > 0) {
        out[o] = Math.round(Math.min(1, r / a) * 255)
        out[o + 1] = Math.round(Math.min(1, g / a) * 255)
        out[o + 2] = Math.round(Math.min(1, b / a) * 255)
      }
      out[o + 3] = Math.round(a * 255)
    }
  }
  return out
}

/* ---------------- PNG 编码 ---------------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

function encodePng(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

/* ---------------- ICO 组装 ---------------- */

/** 单个尺寸转成 ICO 里的 DIB 数据（BITMAPINFOHEADER + 自下而上的 BGRA + AND 掩码） */
function dibEntry(size, rgba) {
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0)
  header.writeInt32LE(size, 4)
  header.writeInt32LE(size * 2, 8) // ICO 里高度是两倍
  header.writeUInt16LE(1, 12)
  header.writeUInt16LE(32, 14)
  header.writeUInt32LE(0, 16)
  header.writeUInt32LE(size * size * 4, 20)

  const pixels = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = (y * size + x) * 4
      const d = ((size - 1 - y) * size + x) * 4
      pixels[d] = rgba[s + 2]
      pixels[d + 1] = rgba[s + 1]
      pixels[d + 2] = rgba[s]
      pixels[d + 3] = rgba[s + 3]
    }
  }
  const maskRow = Math.ceil(size / 32) * 4
  const mask = Buffer.alloc(maskRow * size) // 全 0：不透明由 alpha 决定
  return Buffer.concat([header, pixels, mask])
}

function buildIco(images) {
  const dir = Buffer.alloc(6)
  dir.writeUInt16LE(0, 0)
  dir.writeUInt16LE(1, 2)
  dir.writeUInt16LE(images.length, 4)

  const entries = []
  const blobs = []
  let offset = 6 + images.length * 16
  for (const { size, dib } of images) {
    const e = Buffer.alloc(16)
    e[0] = size >= 256 ? 0 : size
    e[1] = size >= 256 ? 0 : size
    e[2] = 0
    e[3] = 0
    e.writeUInt16LE(1, 4)
    e.writeUInt16LE(32, 6)
    e.writeUInt32LE(dib.length, 8)
    e.writeUInt32LE(offset, 12)
    entries.push(e)
    blobs.push(dib)
    offset += dib.length
  }
  return Buffer.concat([dir, ...entries, ...blobs])
}

/* ---------------- 主流程 ---------------- */

mkdirSync(BUILD_DIR, { recursive: true })

const images = SIZES.map((size) => ({ size, rgba: renderIcon(size) }))
const ico = buildIco(images.map(({ size, rgba }) => ({ size, dib: dibEntry(size, rgba) })))
const icoPath = path.join(BUILD_DIR, 'icon.ico')
writeFileSync(icoPath, ico)

const png256 = encodePng(256, images[images.length - 1].rgba)
const pngPath = path.join(BUILD_DIR, 'icon.png')
writeFileSync(pngPath, png256)

console.log(`已生成 ${path.relative(APP_ROOT, icoPath)}（${SIZES.join('/')}，${ico.length} 字节）`)
console.log(`已生成 ${path.relative(APP_ROOT, pngPath)}（256×256，${png256.length} 字节）`)
