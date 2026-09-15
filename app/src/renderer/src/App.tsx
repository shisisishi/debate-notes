/** 应用外壳：背景层 + 侧边导航 + 页面容器。 */

import React, { useEffect } from 'react'
import { PAGE_KEYS, PAGE_LABELS, type PageKey } from '@shared/types'
import { BackgroundLayer } from './components/BackgroundLayer'
import { Toasts } from './components/Toasts'
import { Button, Icon } from './components/ui'
import { CalendarPage } from './pages/CalendarPage'
import { MatchesPage } from './pages/MatchesPage'
import { OverviewPage } from './pages/OverviewPage'
import { ResumePage } from './pages/ResumePage'
import { SettingsPage } from './pages/SettingsPage'
import { useStore } from './store'

const NAV_ICONS: Record<PageKey, string> = {
  overview: 'overview',
  matches: 'matches',
  calendar: 'calendar',
  resume: 'resume',
  settings: 'settings'
}

export default function App(): React.ReactElement {
  const { ready, settings, updateSettings, photos, cyclePhoto, toast } = useStore()
  const page = settings.lastPage

  const go = (next: PageKey): void => {
    if (next === page) return
    void updateSettings({ lastPage: next }).catch((err: unknown) => toast((err as Error).message, 'error'))
  }

  useEffect(() => {
    // 皮肤：把主题写到 <html data-theme>，所有颜色都由 CSS 变量切换
    document.documentElement.dataset.theme = settings.theme
  }, [settings.theme])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return
      const index = Number(e.key)
      if (index >= 1 && index <= PAGE_KEYS.length) {
        e.preventDefault()
        go(PAGE_KEYS[index - 1])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!ready) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>
        <div className="muted">正在载入数据…</div>
      </div>
    )
  }

  const shellStyle = {
    '--panel-alpha': String(settings.panelOpacity)
  } as React.CSSProperties

  return (
    <div className="app-shell" style={shellStyle}>
      <BackgroundLayer />

      <aside className="sidebar">
        <div className="brand">
          <div className="brand__title">辩论手记</div>
          <div className="brand__sub">Debate Notes</div>
        </div>

        <nav className="nav" data-testid="nav">
          {PAGE_KEYS.map((key, i) => (
            <button
              key={key}
              type="button"
              className={`nav__item${key === page ? ' is-active' : ''}`}
              onClick={() => go(key)}
              data-testid={`nav-${key}`}
            >
              <Icon name={NAV_ICONS[key]} />
              <span>{PAGE_LABELS[key]}</span>
              <span className="nav__hint">{i + 1}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar__foot">
          <div className="bg-mini">
            <Button
              size="sm"
              variant="ghost"
              icon="left"
              aria-label="上一张背景"
              disabled={photos.length < 2}
              onClick={() => void cyclePhoto(-1)}
              data-testid="bg-prev"
            />
            <span className="bg-mini__label" title={photos.length > 0 ? `${photos.length} 张背景照片` : '未设置背景'}>
              {photos.length === 0 ? '未设置背景' : `背景 ${photos.length} 张`}
            </span>
            <Button
              size="sm"
              variant="ghost"
              icon="right"
              aria-label="下一张背景"
              disabled={photos.length < 2}
              onClick={() => void cyclePhoto(1)}
              data-testid="bg-next"
            />
          </div>

          <div className="bg-mini">
            <Button
              size="sm"
              variant="ghost"
              icon={settings.rotationEnabled ? 'pause' : 'play'}
              onClick={() =>
                void updateSettings({ rotationEnabled: !settings.rotationEnabled }).then(
                  () => undefined,
                  (err: unknown) => toast((err as Error).message, 'error')
                )
              }
              data-testid="rotation-toggle"
            >
              {settings.rotationEnabled ? '暂停轮播' : '继续轮播'}
            </Button>
          </div>

          {photos.length > 1 ? (
            <div className="bg-mini__dots" data-testid="bg-dots">
              {photos.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`dot${p.id === settings.activeBackgroundId ? ' is-active' : ''}`}
                  aria-label="切换到此背景"
                  title={p.originalName || p.fileName}
                  data-testid={`bg-dot-${p.id}`}
                  onClick={() => void updateSettings({ activeBackgroundId: p.id }).then(() => undefined)}
                />
              ))}
            </div>
          ) : null}
        </div>
      </aside>

      <main className="main" data-testid={`page-${page}`}>
        {page === 'overview' ? <OverviewPage /> : null}
        {page === 'matches' ? <MatchesPage /> : null}
        {page === 'calendar' ? <CalendarPage /> : null}
        {page === 'resume' ? <ResumePage /> : null}
        {page === 'settings' ? <SettingsPage /> : null}
      </main>

      <Toasts />
    </div>
  )
}
