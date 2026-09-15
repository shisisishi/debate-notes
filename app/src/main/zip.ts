/**
 * 最小 ZIP 读写实现（只用 node:zlib，无第三方依赖）。
 * 写：deflate（压缩无收益时退化 store）；读：严格校验 CRC32、拒绝 zip64/加密/路径穿越。
 * 备份文件用 Windows 资源管理器与 7-Zip 均可直接打开。
 */

import { deflateRawSync, inflateRawSync } from 'node:zlib'

export interface ZipInput {
  path: string
  data: Buffer
}

export interface ZipEntry {
  path: string
  data: Buffer
}

let CRC_TABLE: Uint32Array | null = null

function crcTable(): Uint32Array {
  if (CRC_TABLE) return CRC_TABLE
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  CRC_TABLE = table
  return table
}

export function crc32(buf: Buffer): number {
  const table = crcTable()
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function dosDateTime(d: Date): { time: number; date: number } {
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | (Math.floor(d.getSeconds() / 2) & 31)
  const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31)
  return { time, date }
}

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50

export function createZip(entries: ZipInput[], when: Date = new Date()): Buffer {
  if (entries.length > 0xffff) throw new Error('zip 条目过多')
  const { time, date } = dosDateTime(when)
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.path.replace(/\\/g, '/'), 'utf8')
    const crc = crc32(entry.data)
    const deflated = deflateRawSync(entry.data, { level: 9 })
    const useDeflate = deflated.length < entry.data.length
    const payload = useDeflate ? deflated : entry.data
    const method = useDeflate ? 8 : 0

    const local = Buffer.alloc(30)
    local.writeUInt32LE(SIG_LOCAL, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // UTF-8 文件名
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    localParts.push(local, nameBuf, payload)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(SIG_CENTRAL, 0)
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(date, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(payload.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt16LE(0, 30) // extra
    central.writeUInt16LE(0, 32) // comment
    central.writeUInt16LE(0, 34) // disk start
    central.writeUInt16LE(0, 36) // internal attrs
    central.writeUInt32LE(0, 38) // external attrs
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, nameBuf)

    offset += local.length + nameBuf.length + payload.length
  }

  const centralBuf = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(SIG_EOCD, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...localParts, centralBuf, eocd])
}

function safeEntryName(raw: string): string | null {
  const name = raw.replace(/\\/g, '/')
  if (!name || name.endsWith('/')) return null // 目录项忽略
  if (name.startsWith('/') || /^[a-zA-Z]:/.test(name)) return null // 绝对路径
  const parts = name.split('/')
  if (parts.some((p) => p === '..' || p === '')) return null // 路径穿越
  return name
}

/** 解析 zip。任何结构性问题/CRC 不符都会抛错，交由上层判定「备份已损坏」。 */
export function readZip(buf: Buffer): ZipEntry[] {
  if (buf.length < 22) throw new Error('文件过小，不是有效的 zip')
  const maxComment = 65535
  const scanStart = Math.max(0, buf.length - 22 - maxComment)
  let eocd = -1
  for (let i = buf.length - 22; i >= scanStart; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('找不到 zip 结束标记')

  const totalEntries = buf.readUInt16LE(eocd + 10)
  const cdSize = buf.readUInt32LE(eocd + 12)
  const cdOffset = buf.readUInt32LE(eocd + 16)
  if (cdOffset === 0xffffffff || cdSize === 0xffffffff || totalEntries === 0xffff) {
    throw new Error('暂不支持 zip64 格式的备份文件')
  }
  if (cdOffset + cdSize > buf.length) throw new Error('zip 目录区越界，文件已损坏')

  const entries: ZipEntry[] = []
  let cursor = cdOffset
  let totalOut = 0
  const MAX_TOTAL = 2 * 1024 * 1024 * 1024

  for (let i = 0; i < totalEntries; i++) {
    if (cursor + 46 > buf.length) throw new Error('zip 目录项越界，文件已损坏')
    if (buf.readUInt32LE(cursor) !== SIG_CENTRAL) throw new Error('zip 目录项签名错误，文件已损坏')
    const flags = buf.readUInt16LE(cursor + 8)
    const method = buf.readUInt16LE(cursor + 10)
    const crc = buf.readUInt32LE(cursor + 16)
    const compSize = buf.readUInt32LE(cursor + 20)
    const uncompSize = buf.readUInt32LE(cursor + 24)
    const nameLen = buf.readUInt16LE(cursor + 28)
    const extraLen = buf.readUInt16LE(cursor + 30)
    const commentLen = buf.readUInt16LE(cursor + 32)
    const localOffset = buf.readUInt32LE(cursor + 42)
    const rawName = buf.subarray(cursor + 46, cursor + 46 + nameLen).toString('utf8')
    cursor += 46 + nameLen + extraLen + commentLen

    if (flags & 0x1) throw new Error('备份文件被加密，无法读取')
    if (compSize === 0xffffffff || uncompSize === 0xffffffff) throw new Error('暂不支持 zip64 格式的备份文件')
    if (method !== 0 && method !== 8) throw new Error(`不支持的压缩方式（${method}）`)

    const name = safeEntryName(rawName)
    if (!name) continue

    if (localOffset + 30 > buf.length) throw new Error('zip 数据区越界，文件已损坏')
    if (buf.readUInt32LE(localOffset) !== SIG_LOCAL) throw new Error('zip 局部头签名错误，文件已损坏')
    const lNameLen = buf.readUInt16LE(localOffset + 26)
    const lExtraLen = buf.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + lNameLen + lExtraLen
    if (dataStart + compSize > buf.length) throw new Error('zip 数据区越界，文件已损坏')
    const raw = buf.subarray(dataStart, dataStart + compSize)

    let data: Buffer
    if (method === 8) {
      data = inflateRawSync(raw)
    } else {
      data = Buffer.from(raw)
    }
    if (data.length !== uncompSize) throw new Error(`条目 ${name} 解压长度不符，文件已损坏`)
    if (crc32(data) !== crc) throw new Error(`条目 ${name} 校验和不符，文件已损坏`)
    totalOut += data.length
    if (totalOut > MAX_TOTAL) throw new Error('备份内容过大，已中止读取')

    entries.push({ path: name, data })
  }

  return entries
}
