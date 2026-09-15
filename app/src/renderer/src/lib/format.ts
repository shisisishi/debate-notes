/** 渲染层通用格式化与剪贴板工具。 */

import type { Match, MatchCategory, MatchStatus } from '@shared/types'

export function statusClass(status: MatchStatus): string {
  switch (status) {
    case '待赛':
      return 'badge--pending'
    case '未出结果':
      return 'badge--unknown'
    case '胜':
      return 'badge--win'
    case '负':
      return 'badge--loss'
    case '无胜负':
      return 'badge--draw'
    default:
      return 'badge--plain'
  }
}

export function categoryClass(category: MatchCategory): string {
  return category === '正赛' ? 'badge--official' : 'badge--mock'
}

export function categoryDotClass(category: MatchCategory): string {
  return category === '正赛' ? 'dot-cat--official' : 'dot-cat--mock'
}

export function chipClass(m: Match): string {
  const parts = ['cal-chip', m.category === '正赛' ? 'cal-chip--official' : 'cal-chip--mock']
  if (m.status === '胜') parts.push('cal-chip--win')
  if (m.status === '负') parts.push('cal-chip--loss')
  if (m.status === '待赛') parts.push('cal-chip--pending')
  return parts.join(' ')
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i += 1
  }
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function formatInterval(ms: number): string {
  if (ms % 3600000 === 0) return `${ms / 3600000} 小时`
  if (ms % 60000 === 0) return `${ms / 60000} 分钟`
  if (ms % 1000 === 0) return `${ms / 1000} 秒`
  return `${(ms / 1000).toFixed(1)} 秒`
}

export function winRateText(rate: number | null): string {
  return rate === null ? '暂无' : `${(rate * 100).toFixed(1)}%`
}

/** 复制到剪贴板：优先 Clipboard API，失败时退回 textarea + execCommand */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* 继续走兜底方案 */
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '-1000px'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}

export function eventRangeText(start: string | null, end: string | null): string {
  if (!start && !end) return '赛期未定'
  if (start && end && start !== end) return `${start} ~ ${end}`
  return (start ?? end) as string
}

export function matchDateLabel(date: string): { main: string; sub: string } {
  const [y, m, d] = date.split('-')
  return { main: `${Number(m)}月${Number(d)}日`, sub: `${y} 年` }
}
