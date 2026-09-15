/**
 * 背景层：固定定位、不参与页面布局的独立图层。
 * 所有照片叠放并通过 opacity 交叉淡入；每张照片可以单独调整位置、大小、透明度与模糊。
 * 轮播定时器在启用且有多张照片时运行。
 */

import React, { useEffect, useState } from 'react'
import { frameStyle, photoFrame } from '../lib/photoFrame'
import { useStore } from '../store'

function useViewport(): { width: number; height: number } {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight })
  useEffect(() => {
    const onResize = (): void => setSize({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return size
}

export function BackgroundLayer(): React.ReactElement {
  const { photos, settings, cyclePhoto } = useStore()
  const { backgroundEnabled, rotationEnabled, rotationIntervalMs } = settings
  const viewport = useViewport()

  useEffect(() => {
    if (!rotationEnabled || !backgroundEnabled || photos.length < 2) return
    const timer = window.setInterval(() => {
      void cyclePhoto(1)
    }, rotationIntervalMs)
    return () => window.clearInterval(timer)
  }, [rotationEnabled, backgroundEnabled, photos.length, rotationIntervalMs, cyclePhoto])

  const activeId = backgroundEnabled ? settings.activeBackgroundId : null

  return (
    <div className="bg-layer" data-testid="background-layer">
      {photos.map((p) => {
        const frame = photoFrame(p, settings, viewport.width, viewport.height)
        const isActive = activeId === p.id
        return (
          <img
            key={p.id}
            className={`bg-layer__img ${isActive ? 'is-active' : ''}`}
            src={p.url}
            alt=""
            draggable={false}
            data-testid="bg-image"
            data-active={isActive ? 'true' : 'false'}
            data-photo-id={p.id}
            data-scale={frame.scale}
            data-offset-x={frame.offsetX}
            data-offset-y={frame.offsetY}
            data-fit={frame.fit}
            style={{ ...frameStyle(frame), opacity: isActive ? frame.opacity : 0 }}
          />
        )
      })}
      <div className="bg-layer__blur" />
      <div className="bg-layer__grain" />
    </div>
  )
}
