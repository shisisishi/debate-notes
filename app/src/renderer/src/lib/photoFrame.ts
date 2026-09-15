/**
 * 背景照片的取景计算：图层与「调整照片」预览共用同一套算法，
 * 保证预览里看到的就是窗口里实际显示的效果。
 *
 * 位置用 -100 ~ 100 表示（0 居中），通过 object-position 百分比实现：
 * 铺满裁切时照片永远盖住整个窗口，怎么拖都不会露出空白。
 * 大小用 scale（1 ~ 4 倍）绕中心缩放；不透明度与模糊同理。
 */

import type React from 'react'
import type { AppSettings, BackgroundPhoto, PhotoFit } from '@shared/types'

export interface ResolvedAdjust {
  offsetX: number
  offsetY: number
  scale: number
  fit: PhotoFit
  /** 0 ~ 1 */
  opacity: number
  /** px */
  blur: number
}

export interface PhotoFrame extends ResolvedAdjust {
  /** object-position 的百分比（0% 左/上，50% 居中，100% 右/下） */
  posX: number
  posY: number
  /** 该方向还有多少可移动的像素余量（0 表示摆不开） */
  reachX: number
  reachY: number
  canPanX: boolean
  canPanY: boolean
  /** 照片按当前设置渲染出来的尺寸（px） */
  renderedWidth: number
  renderedHeight: number
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

export function resolveAdjust(photo: BackgroundPhoto, settings: AppSettings): ResolvedAdjust {
  const fit: PhotoFit = photo.fit ?? (settings.backgroundCover ? 'cover' : 'contain')
  return {
    offsetX: clamp(photo.offsetX ?? 0, -100, 100),
    offsetY: clamp(photo.offsetY ?? 0, -100, 100),
    scale: clamp(photo.scale ?? 1, 1, 4),
    fit,
    opacity: clamp((photo.opacity ?? settings.backgroundOpacity * 100) / 100, 0, 1),
    blur: clamp(photo.blur ?? settings.backgroundBlur, 0, 24)
  }
}

/** 是否做过手动调整（用于卡片上显示「已调整」标记） */
export function hasCustomAdjust(photo: BackgroundPhoto): boolean {
  return (
    photo.offsetX !== null ||
    photo.offsetY !== null ||
    photo.scale !== null ||
    photo.opacity !== null ||
    photo.blur !== null ||
    photo.fit !== null
  )
}

export function photoFrame(
  photo: BackgroundPhoto,
  settings: AppSettings,
  viewportWidth: number,
  viewportHeight: number
): PhotoFrame {
  const a = resolveAdjust(photo, settings)
  const vw = Math.max(1, viewportWidth)
  const vh = Math.max(1, viewportHeight)
  const iw = photo.width && photo.width > 0 ? photo.width : vw
  const ih = photo.height && photo.height > 0 ? photo.height : vh

  const base = a.fit === 'cover' ? Math.max(vw / iw, vh / ih) : Math.min(vw / iw, vh / ih)
  const renderedWidth = iw * base * a.scale
  const renderedHeight = ih * base * a.scale

  // 铺满裁切：照片比窗口大出来的部分就是可移动余量，铺满时永远不会有空隙。
  // 完整显示：照片比窗口小的方向可以在框内摆放（会留白，这是「完整显示」本身的含义）。
  const reachX = a.fit === 'cover' ? Math.max(0, renderedWidth - vw) : Math.max(0, vw - renderedWidth)
  const reachY = a.fit === 'cover' ? Math.max(0, renderedHeight - vh) : Math.max(0, vh - renderedHeight)

  // 位置值越大 = 照片越往右/下移动，换算成 object-position 正好相反
  const posX = 50 - a.offsetX / 2
  const posY = 50 - a.offsetY / 2

  return {
    ...a,
    posX,
    posY,
    reachX,
    reachY,
    canPanX: reachX > 0.5,
    canPanY: reachY > 0.5,
    renderedWidth,
    renderedHeight
  }
}

/**
 * 拖动换算：把预览里的像素位移换算成 -100 ~ 100 的位置值。
 * reach 是窗口里的可移动余量（px），previewScale 是预览相对窗口的缩放比。
 */
export function offsetFromDrag(
  dxPreview: number,
  dyPreview: number,
  reachX: number,
  reachY: number,
  previewScale: number,
  startX: number,
  startY: number
): { offsetX: number; offsetY: number } {
  const dx = dxPreview / Math.max(0.0001, previewScale)
  const dy = dyPreview / Math.max(0.0001, previewScale)
  return {
    offsetX: reachX > 0.5 ? clamp(startX + (dx / reachX) * 200, -100, 100) : 0,
    offsetY: reachY > 0.5 ? clamp(startY + (dy / reachY) * 200, -100, 100) : 0
  }
}

/** 图层与预览共用：把一帧换算成行内样式 */
export function frameStyle(frame: PhotoFrame): React.CSSProperties {
  return {
    objectFit: frame.fit,
    objectPosition: `${frame.posX}% ${frame.posY}%`,
    opacity: frame.opacity,
    filter: frame.blur > 0 ? `blur(${frame.blur}px)` : undefined,
    transform: `scale(${frame.scale})`
  }
}
