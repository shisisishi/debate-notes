/** 比赛日历：月视图 / 周视图，点击日期新增、点击比赛查看编辑。 */

import React, { useMemo, useState } from 'react'
import {
  addDays,
  addMonths,
  formatCn,
  monthLabel,
  monthMatrix,
  parseDateStr,
  todayStr,
  weekDates,
  weekStart,
  weekdayShortCn,
  weekdayCn
} from '@shared/date'
import type { Match } from '@shared/types'
import { MatchFormModal } from '../components/MatchFormModal'
import { ConfirmDialog } from '../components/Modal'
import { Button, CategoryBadge, EmptyState, PageHead, Panel, Segmented, StatusBadge } from '../components/ui'
import { chipClass } from '../lib/format'
import { useStore } from '../store'

type View = 'month' | 'week'
type ModalState = { mode: 'new'; date: string } | { mode: 'edit'; match: Match } | null

export function CalendarPage(): React.ReactElement {
  const { matches, removeMatch, toast } = useStore()
  const [view, setView] = useState<View>('month')
  const [anchorDate, setAnchorDate] = useState(todayStr())
  const [selectedDate, setSelectedDate] = useState(todayStr())
  const [modal, setModal] = useState<ModalState>(null)
  const [pendingDelete, setPendingDelete] = useState<Match | null>(null)

  const today = todayStr()
  const byDate = useMemo(() => {
    const map = new Map<string, Match[]>()
    for (const m of matches) {
      const list = map.get(m.date)
      if (list) list.push(m)
      else map.set(m.date, [m])
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99') || a.id - b.id)
    }
    return map
  }, [matches])

  const anchor = parseDateStr(anchorDate)
  const year = anchor.getFullYear()
  const month = anchor.getMonth() + 1
  const matrix = useMemo(() => monthMatrix(year, month), [year, month])
  const week = useMemo(() => weekDates(anchorDate), [anchorDate])

  const move = (delta: number): void => {
    if (view === 'month') {
      const next = addMonths(year, month, delta)
      setAnchorDate(`${next.year}-${String(next.month).padStart(2, '0')}-01`)
    } else {
      setAnchorDate(addDays(anchorDate, delta * 7))
    }
  }

  const goToday = (): void => {
    setAnchorDate(today)
    setSelectedDate(today)
  }

  const openNew = (date: string): void => {
    setSelectedDate(date)
    setModal({ mode: 'new', date })
  }

  const selectedMatches = byDate.get(selectedDate) ?? []
  const weekUntimed = view === 'week' ? week.flatMap((d) => (byDate.get(d) ?? []).filter((m) => !m.startTime)) : []

  return (
    <>
      <PageHead
        title="比赛日历"
        sub="点击日期直接新增比赛；点击日历里的比赛可查看或编辑。颜色区分正赛与模拟赛。"
        actions={
          <>
            <Segmented
              value={view}
              testId="calendar-view"
              options={[
                { value: 'month', label: '月视图', testId: 'view-month' },
                { value: 'week', label: '周视图', testId: 'view-week' }
              ]}
              onChange={setView}
            />
            <Button icon="plus" variant="primary" data-testid="calendar-add" onClick={() => openNew(selectedDate)}>
              新增比赛
            </Button>
          </>
        }
      />

      <Panel
        title={view === 'month' ? monthLabel(year, month) : `${weekStart(anchorDate)} ~ ${addDays(weekStart(anchorDate), 6)}`}
        desc={view === 'month' ? '月视图' : '周视图（按开赛时间排列，未填写时间的比赛在下方单独列出）'}
        actions={
          <div className="cal-toolbar">
            <Button size="sm" icon="left" onClick={() => move(-1)} data-testid="calendar-prev" aria-label="上一页">
              {view === 'month' ? '上月' : '上周'}
            </Button>
            <Button size="sm" onClick={goToday} data-testid="calendar-today">
              回到今天
            </Button>
            <Button size="sm" onClick={() => move(1)} data-testid="calendar-next" aria-label="下一页">
              {view === 'month' ? '下月' : '下周'}
            </Button>
          </div>
        }
        pad={false}
        testId="calendar-panel"
      >
        {view === 'month' ? (
          <div className="cal-grid" data-testid="calendar-month">
            {Array.from({ length: 7 }, (_, i) => (
              <div className="cal-head" key={i}>
                周{weekdayShortCn(i)}
              </div>
            ))}
            {matrix.flat().map((date) => {
              const list = byDate.get(date) ?? []
              const outside = parseDateStr(date).getMonth() + 1 !== month
              const cls = [
                'cal-cell',
                outside ? 'is-outside' : '',
                date === today ? 'is-today' : '',
                date === selectedDate ? 'is-selected' : ''
              ]
                .filter(Boolean)
                .join(' ')
              return (
                <button
                  type="button"
                  className={cls}
                  key={date}
                  data-testid={`cal-cell-${date}`}
                  data-count={list.length}
                  onClick={() => openNew(date)}
                >
                  <span className="cal-cell__top">
                    <span className="cal-cell__num">{parseDateStr(date).getDate()}</span>
                    {list.length > 1 ? <span className="cal-cell__count">{list.length} 场</span> : null}
                  </span>
                  {list.slice(0, 2).map((m) => (
                    <span
                      className={chipClass(m)}
                      key={m.id}
                      data-testid={`cal-chip-${m.id}`}
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedDate(date)
                        setModal({ mode: 'edit', match: m })
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.stopPropagation()
                          setModal({ mode: 'edit', match: m })
                        }
                      }}
                    >
                      <span className="cal-chip__time">{m.startTime ?? '—'}</span>
                      <span className="cal-chip__text">{m.topic}</span>
                    </span>
                  ))}
                  {list.length > 2 ? <span className="cal-more">还有 {list.length - 2} 场…</span> : null}
                </button>
              )
            })}
          </div>
        ) : (
          <>
            <div className="week-grid" data-testid="calendar-week">
              {week.map((date) => {
                const list = (byDate.get(date) ?? []).filter((m) => m.startTime)
                return (
                  <div className="week-col" key={date}>
                    <div
                      className={`week-col__head${date === today ? ' is-today' : ''}`}
                      onClick={() => openNew(date)}
                      data-testid={`week-head-${date}`}
                    >
                      <div className="week-col__day">{parseDateStr(date).getDate()} 日</div>
                      <div className="week-col__wd">{weekdayCn(date)}</div>
                    </div>
                    <div className="week-col__body">
                      {list.map((m) => (
                        <div
                          className={chipClass(m)}
                          key={m.id}
                          data-testid={`week-chip-${m.id}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            setSelectedDate(date)
                            setModal({ mode: 'edit', match: m })
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') setModal({ mode: 'edit', match: m })
                          }}
                        >
                          <span className="cal-chip__time">{m.startTime}</span>
                          <span className="cal-chip__text">{m.topic}</span>
                        </div>
                      ))}
                      {list.length === 0 ? (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => openNew(date)}
                          data-testid={`week-empty-${date}`}
                        >
                          ＋ 新增
                        </button>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>

            {weekUntimed.length > 0 ? (
              <div className="week-untimed" data-testid="week-untimed">
                <div className="week-untimed__title">未填写开赛时间的比赛（本周 {weekUntimed.length} 场）</div>
                <div className="week-untimed__list">
                  {weekUntimed.map((m) => (
                    <span
                      className={chipClass(m)}
                      key={m.id}
                      data-testid={`week-untimed-chip-${m.id}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setSelectedDate(m.date)
                        setModal({ mode: 'edit', match: m })
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') setModal({ mode: 'edit', match: m })
                      }}
                    >
                      <span className="cal-chip__time">{m.date.slice(5)}</span>
                      <span className="cal-chip__text">{m.topic}</span>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}
      </Panel>

      <Panel
        title={`当日比赛：${formatCn(selectedDate)}`}
        desc={`共 ${selectedMatches.length} 场（含待赛）`}
        actions={
          <Button size="sm" icon="plus" onClick={() => openNew(selectedDate)} data-testid="day-add">
            新增一场
          </Button>
        }
        pad={false}
        testId="day-panel"
      >
        {selectedMatches.length === 0 ? (
          <div style={{ padding: 18 }}>
            <EmptyState
              text="这一天还没有比赛记录"
              action={
                <Button size="sm" icon="plus" onClick={() => openNew(selectedDate)}>
                  新增比赛
                </Button>
              }
            />
          </div>
        ) : (
          <div className="day-panel__list">
            {selectedMatches.map((m, index) => (
              <div className="day-row" key={m.id} data-testid={`day-match-${m.id}`}>
                <span className="tabular small muted">{m.startTime ?? `第 ${index + 1} 场`}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 600 }}>{m.topic}</span>
                  <span className="row" style={{ gap: 6, marginTop: 2 }}>
                    <CategoryBadge category={m.category} />
                    <span className="small muted">{m.eventName ?? '未归属赛事'}</span>
                    {m.side ? <span className="small muted">· {m.side}</span> : null}
                    {m.position ? <span className="small muted">· {m.position}</span> : null}
                    {m.isBestDebater ? <span className="badge badge--best">最佳辩手</span> : null}
                  </span>
                </span>
                <span className="row" style={{ gap: 6 }}>
                  <StatusBadge status={m.status} />
                  <Button
                    size="sm"
                    onClick={() => setModal({ mode: 'edit', match: m })}
                    data-testid={`day-edit-${m.id}`}
                  >
                    查看
                  </Button>
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {modal ? (
        <MatchFormModal
          initial={modal.mode === 'edit' ? modal.match : null}
          defaultDate={modal.mode === 'new' ? modal.date : undefined}
          onClose={() => setModal(null)}
          onSaved={(m) => setSelectedDate(m.date)}
          onRequestDelete={(m) => {
            setModal(null)
            setPendingDelete(m)
          }}
        />
      ) : null}

      {pendingDelete ? (
        <ConfirmDialog
          title="删除比赛"
          message={`确定删除 ${pendingDelete.date} 的这场比赛吗？删除后无法撤销。`}
          detail={pendingDelete.topic}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            void (async () => {
              try {
                await removeMatch(pendingDelete.id)
                toast('比赛已删除', 'success')
              } catch (err) {
                toast((err as Error).message, 'error')
              } finally {
                setPendingDelete(null)
              }
            })()
          }}
        />
      ) : null}
    </>
  )
}
