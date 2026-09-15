/**
 * 「调整照片」弹窗：拖动预览调整位置，滑块调整大小、透明度、模糊与显示方式。
 * 所有改动立即保存并同步到真实背景层（预览与窗口用同一套取景算法，所见即所得）。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { BackgroundPhoto, PhotoAdjustPatch, PhotoFit } from '@shared/types'
import { hasCustomAdjust, offsetFromDrag, photoFrame, resolveAdjust } from '../lib/photoFrame'
import { useStore } from '../store'
import { Modal } from './Modal'
import { Button, Field, Segmented } from './ui'

export function PhotoAdjustModal({
  photo,
  onClose
}: {
  photo: BackgroundPhoto
  onClose: () => void
}): React.ReactElement {
  const { settings, photos, adjustPhoto, resetPhotoAdjust: resetAdjust, applyAdjustAll, setActivePhoto, toast } = useStore()
  const current = photos.find((p) => p.id === photo.id) ?? photo
  const resolved = useMemo(() => resolveAdjust(current, settings), [current, settings])

  const [draft, setDraft] = useState({
    offsetX: resolved.offsetX,
    offsetY: resolved.offsetY,
    scale: resolved.scale,
    opacity: Math.round(resolved.opacity * 100),
    blur: resolved.blur,
    fit: resolved.fit
  })
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight })
  const [boxWidth, setBoxWidth] = useState(600)
  const [dragging, setDragging] = useState(false)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null)

  useEffect(() => {
    const onResize = (): void => setViewport({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    const box = boxRef.current
    const observer = box ? new ResizeObserver(() => setBoxWidth(box.clientWidth)) : null
    if (box && observer) observer.observe(box)
    if (box) setBoxWidth(box.clientWidth)
    return () => {
      window.removeEventListener('resize', onResize)
      observer?.disconnect()
    }
  }, [])

  // 预览框按窗口比例呈现，所以预览里看到的就是窗口里的实际取景
  const previewScale = boxWidth / Math.max(1, viewport.width)
  const preview = photoFrame(
    { ...current, offsetX: draft.offsetX, offsetY: draft.offsetY, scale: draft.scale, fit: draft.fit },
    { ...settings, backgroundOpacity: draft.opacity / 100, backgroundBlur: draft.blur },
    viewport.width,
    viewport.height
  )

  const persist = (patch: PhotoAdjustPatch): void => {
    void adjustPhoto(current.id, patch).catch((err: Error) => toast(err.message, 'error'))
  }
  const update = (patch: Partial<typeof draft>, persistPatch: PhotoAdjustPatch): void => {
    setDraft((d) => ({ ...d, ...patch }))
    persist(persistPatch)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { x: e.clientX, y: e.clientY, offsetX: draft.offsetX, offsetY: draft.offsetY }
    setDragging(true)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const start = dragRef.current
    if (!start) return
    const next = offsetFromDrag(
      e.clientX - start.x,
      e.clientY - start.y,
      preview.reachX,
      preview.reachY,
      previewScale,
      start.offsetX,
      start.offsetY
    )
    setDraft((d) => ({ ...d, ...next }))
    persist(next)
  }
  const onPointerUp = (): void => {
    dragRef.current = null
    setDragging(false)
  }
  const onWheel = (e: React.WheelEvent<HTMLDivElement>): void => {
    const step = e.deltaY < 0 ? 0.1 : -0.1
    const scale = Math.min(4, Math.max(1, Math.round((draft.scale + step) * 100) / 100))
    update({ scale }, { scale })
  }

  const doReset = (): void => {
    setDraft({
      offsetX: 0,
      offsetY: 0,
      scale: 1,
      opacity: Math.round(settings.backgroundOpacity * 100),
      blur: settings.backgroundBlur,
      fit: settings.backgroundCover ? 'cover' : 'contain'
    })
    void resetAdjust(current.id)
      .then(() => toast('已恢复默认显示', 'success'))
      .catch((err: Error) => toast(err.message, 'error'))
  }

  const isActive = settings.activeBackgroundId === current.id

  return (
    <Modal
      title={`调整照片：${current.originalName || current.fileName}`}
      onClose={onClose}
      testId="photo-adjust-modal"
      footer={
        <>
          <Button variant="ghost" onClick={doReset} data-testid="adjust-reset">
            恢复默认
          </Button>
          <Button
            variant="ghost"
            disabled={photos.length < 2}
            onClick={() =>
              void applyAdjustAll(current.id)
                .then(() => toast(`已把这套调整套用到另外 ${photos.length - 1} 张照片`, 'success'))
                .catch((err: Error) => toast(err.message, 'error'))
            }
            data-testid="adjust-apply-all"
          >
            套用到其他照片
          </Button>
          <span className="spacer" />
          {!isActive ? (
            <Button onClick={() => void setActivePhoto(current.id)} data-testid="adjust-set-active">
              设为当前背景
            </Button>
          ) : null}
          <Button variant="primary" onClick={onClose} data-testid="adjust-done">
            完成
          </Button>
        </>
      }
    >
      <div className="stack">
        <div
          ref={boxRef}
          className={`photo-editor${dragging ? ' is-dragging' : ''}`}
          style={{ aspectRatio: `${viewport.width} / ${viewport.height}` }}
          data-testid="adjust-preview"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
        >
          <img
            src={current.url}
            alt=""
            draggable={false}
            data-testid="adjust-preview-img"
            style={{
              objectFit: preview.fit,
              objectPosition: `${preview.posX}% ${preview.posY}%`,
              opacity: preview.opacity,
              filter: preview.blur > 0 ? `blur(${(preview.blur * previewScale).toFixed(2)}px)` : undefined,
              transform: `scale(${preview.scale})`
            }}
          />
          <div className="photo-editor__hint" data-testid="adjust-hint">
            {preview.fit === 'cover'
              ? '按住预览拖动即可调整位置（铺满模式下不会露出空白），滚轮缩放'
              : '完整显示会把整张照片放进去，四周可能留白；拖动可以把它摆在框内任意位置'}
          </div>
        </div>

        <div className="cols-2">
          <div className="stack--sm stack">
            <Field label="显示方式">
              <Segmented<PhotoFit>
                value={draft.fit}
                testId="adjust-fit"
                options={[
                  { value: 'cover', label: '铺满裁切', testId: 'adjust-fit-cover' },
                  { value: 'contain', label: '完整显示', testId: 'adjust-fit-contain' }
                ]}
                onChange={(fit) => update({ fit, offsetX: 0, offsetY: 0 }, { fit, offsetX: 0, offsetY: 0 })}
              />
            </Field>
            <Field label={`大小：${draft.scale.toFixed(2)}×`}>
              <input
                type="range"
                min={100}
                max={400}
                step={5}
                value={Math.round(draft.scale * 100)}
                data-testid="adjust-scale"
                onChange={(e) => {
                  const scale = Number(e.target.value) / 100
                  update({ scale }, { scale })
                }}
              />
            </Field>
            <Field label={`水平位置：${offsetLabel(draft.offsetX, '左', '右')}`}>
              <input
                type="range"
                min={-100}
                max={100}
                step={1}
                value={Math.round(draft.offsetX)}
                disabled={!preview.canPanX}
                data-testid="adjust-offset-x"
                onChange={(e) => {
                  const offsetX = Number(e.target.value)
                  update({ offsetX }, { offsetX })
                }}
              />
            </Field>
          </div>

          <div className="stack--sm stack">
            <Field label={`垂直位置：${offsetLabel(draft.offsetY, '上', '下')}`}>
              <input
                type="range"
                min={-100}
                max={100}
                step={1}
                value={Math.round(draft.offsetY)}
                disabled={!preview.canPanY}
                data-testid="adjust-offset-y"
                onChange={(e) => {
                  const offsetY = Number(e.target.value)
                  update({ offsetY }, { offsetY })
                }}
              />
            </Field>
            <Field label={`不透明度：${draft.opacity}%`}>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={draft.opacity}
                data-testid="adjust-opacity"
                onChange={(e) => {
                  const opacity = Number(e.target.value)
                  update({ opacity }, { opacity })
                }}
              />
            </Field>
            <Field label={`模糊：${draft.blur} px`}>
              <input
                type="range"
                min={0}
                max={24}
                step={1}
                value={draft.blur}
                data-testid="adjust-blur"
                onChange={(e) => {
                  const blur = Number(e.target.value)
                  update({ blur }, { blur })
                }}
              />
            </Field>
          </div>
        </div>

        <div className="section-note" data-testid="adjust-status">
          {isActive ? '这张就是当前背景，改动立刻生效。' : '这张还不是当前背景，改动会先存下来，点「设为当前背景」即可看到。'}
          {hasCustomAdjust(current) ? ' 已有手动调整。' : ''}
          {` 原图 ${current.width && current.height ? `${current.width}×${current.height}` : '尺寸未知'}，铺满窗口时约 ${Math.round(preview.renderedWidth)}×${Math.round(preview.renderedHeight)} px。`}
        </div>
      </div>
    </Modal>
  )
}

function offsetLabel(value: number, negative: string, positive: string): string {
  if (Math.round(value) === 0) return '居中'
  return value > 0 ? `${positive} ${Math.round(value)}%` : `${negative} ${Math.round(-value)}%`
}
