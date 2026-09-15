/** 比赛记录：比赛 / 赛事 / 荣誉 三类记录的查询与增删改。 */

import React, { useMemo, useState } from 'react'
import { isInRange, rangeLabel, resolveRange } from '@shared/date'
import {
  MATCH_CATEGORIES,
  MATCH_STATUSES,
  RANGE_PRESET_LABELS,
  type DebateEvent,
  type Honor,
  type Match,
  type RangePreset
} from '@shared/types'
import { EventFormModal, HonorFormModal } from '../components/EntityForms'
import { MatchFormModal } from '../components/MatchFormModal'
import { ConfirmDialog } from '../components/Modal'
import {
  Button,
  CategoryBadge,
  EmptyState,
  PageHead,
  Panel,
  Segmented,
  Select,
  StatusBadge,
  TextInput
} from '../components/ui'
import { eventRangeText, formatDateTime, winRateText } from '../lib/format'
import { useStore } from '../store'

type Tab = 'matches' | 'events' | 'honors'
type MatchModal = { mode: 'new' } | { mode: 'edit'; match: Match } | null
type EventModal = { mode: 'new' } | { mode: 'edit'; event: DebateEvent } | null
type HonorModal = { mode: 'new' } | { mode: 'edit'; honor: Honor } | null

const RANGE_ORDER: RangePreset[] = ['month', 'year', 'all', 'custom']

export function MatchesPage(): React.ReactElement {
  const { matches, events, removeMatch, removeEvent, removeHonor, toast } = useStore()
  const [tab, setTab] = useState<Tab>('matches')

  const [keyword, setKeyword] = useState('')
  const [category, setCategory] = useState<'all' | '正赛' | '模拟赛'>('all')
  const [status, setStatus] = useState<'all' | (typeof MATCH_STATUSES)[number]>('all')
  const [eventFilter, setEventFilter] = useState<string>('all')
  const [preset, setPreset] = useState<RangePreset>('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [order, setOrder] = useState<'desc' | 'asc'>('desc')
  const [visible, setVisible] = useState(40)

  const [matchModal, setMatchModal] = useState<MatchModal>(null)
  const [eventModal, setEventModal] = useState<EventModal>(null)
  const [honorModal, setHonorModal] = useState<HonorModal>(null)
  const [deleteMatch, setDeleteMatch] = useState<Match | null>(null)
  const [deleteEvent, setDeleteEvent] = useState<DebateEvent | null>(null)
  const [deleteHonor, setDeleteHonor] = useState<Honor | null>(null)

  const range = useMemo(
    () => resolveRange({ preset, from: customFrom, to: customTo, anchor: '' }),
    [preset, customFrom, customTo]
  )

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    const list = matches.filter((m) => {
      if (category !== 'all' && m.category !== category) return false
      if (status !== 'all' && m.status !== status) return false
      if (eventFilter === 'none' && m.eventId !== null) return false
      if (eventFilter !== 'all' && eventFilter !== 'none' && String(m.eventId) !== eventFilter) return false
      if (!isInRange(m.date, range.from, range.to)) return false
      if (kw) {
        const haystack = [m.topic, m.comment, m.position ?? '', m.eventName ?? '', m.side ?? '']
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(kw)) return false
      }
      return true
    })
    list.sort((a, b) => {
      const cmp = a.date === b.date ? (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99') : a.date.localeCompare(b.date)
      const withId = cmp === 0 ? a.id - b.id : cmp
      return order === 'desc' ? -withId : withId
    })
    return list
  }, [matches, keyword, category, status, eventFilter, range.from, range.to, order])

  const shown = filtered.slice(0, visible)
  const resetFilters = (): void => {
    setKeyword('')
    setCategory('all')
    setStatus('all')
    setEventFilter('all')
    setPreset('all')
    setCustomFrom('')
    setCustomTo('')
  }

  const headActions = (
    <>
      {tab === 'matches' ? (
        <Button icon="plus" variant="primary" data-testid="matches-add" onClick={() => setMatchModal({ mode: 'new' })}>
          新增比赛
        </Button>
      ) : null}
      {tab === 'events' ? (
        <Button icon="plus" variant="primary" data-testid="events-add" onClick={() => setEventModal({ mode: 'new' })}>
          新增赛事
        </Button>
      ) : null}
      {tab === 'honors' ? (
        <Button icon="plus" variant="primary" data-testid="honors-add" onClick={() => setHonorModal({ mode: 'new' })}>
          新增荣誉
        </Button>
      ) : null}
    </>
  )

  return (
    <>
      <PageHead
        title="比赛记录"
        sub={`共 ${matches.length} 场比赛 · ${events.length} 个赛事`}
        actions={
          <div className="row">
            <Segmented
              value={tab}
              testId="records-tabs"
              options={[
                { value: 'matches', label: '比赛', testId: 'tab-matches' },
                { value: 'events', label: '赛事', testId: 'tab-events' },
                { value: 'honors', label: '荣誉', testId: 'tab-honors' }
              ]}
              onChange={setTab}
            />
            {headActions}
          </div>
        }
      />

      {tab === 'matches' ? (
        <>
          <Panel pad={false} testId="matches-filters">
            <div className="filter-bar">
              <TextInput
                value={keyword}
                testId="matches-search"
                placeholder="搜索辩题、简评、辩位、赛事…"
                style={{ width: 240 }}
                onChange={(e) => {
                  setKeyword(e.target.value)
                  setVisible(40)
                }}
              />
              <Select
                value={category}
                testId="matches-category"
                onChange={(e) => setCategory(e.target.value as typeof category)}
              >
                <option value="all">全部类型</option>
                {MATCH_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
              <Select
                value={status}
                testId="matches-status"
                onChange={(e) => setStatus(e.target.value as typeof status)}
              >
                <option value="all">全部状态</option>
                {MATCH_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
              <Select
                value={eventFilter}
                testId="matches-event"
                style={{ maxWidth: 190 }}
                onChange={(e) => setEventFilter(e.target.value)}
              >
                <option value="all">全部赛事</option>
                <option value="none">未归属赛事</option>
                {events.map((e) => (
                  <option key={e.id} value={String(e.id)}>
                    {e.name}
                  </option>
                ))}
              </Select>
              <Segmented
                value={preset}
                testId="matches-range"
                options={RANGE_ORDER.map((p) => ({
                  value: p,
                  label: RANGE_PRESET_LABELS[p],
                  testId: `matches-range-${p}`
                }))}
                onChange={(p) => setPreset(p)}
              />
              {preset === 'custom' ? (
                <div className="range-custom">
                  <TextInput
                    type="date"
                    value={customFrom}
                    testId="matches-from"
                    onChange={(e) => setCustomFrom(e.target.value)}
                  />
                  <span className="muted small">至</span>
                  <TextInput
                    type="date"
                    value={customTo}
                    testId="matches-to"
                    onChange={(e) => setCustomTo(e.target.value)}
                  />
                </div>
              ) : null}
              <span className="spacer" />
              <Button size="sm" onClick={() => setOrder(order === 'desc' ? 'asc' : 'desc')} testId="matches-order">
                {order === 'desc' ? '最近优先' : '最早优先'}
              </Button>
              <Button size="sm" variant="ghost" onClick={resetFilters} testId="matches-reset">
                重置
              </Button>
            </div>
          </Panel>

          <Panel
            title={`比赛列表（${filtered.length}）`}
            desc={`时间范围：${rangeLabel({ preset, from: customFrom, to: customTo, anchor: '' })}`}
            pad={false}
            testId="matches-list"
          >
            {shown.length === 0 ? (
              <div style={{ padding: 18 }}>
                <EmptyState
                  text={
                    matches.length === 0 ? '还没有任何比赛记录，先录入第一场吧' : '没有符合条件的比赛，试试调整筛选或搜索词'
                  }
                  action={
                    matches.length === 0 ? (
                      <Button size="sm" icon="plus" onClick={() => setMatchModal({ mode: 'new' })}>
                        新增比赛
                      </Button>
                    ) : null
                  }
                />
              </div>
            ) : (
              <div className="list">
                {shown.map((m) => (
                  <div className="list__row" key={m.id} data-testid={`match-row-${m.id}`}>
                    <div className="list__date">
                      <span className="list__date-main">{m.date}</span>
                      <span className="list__date-sub">{m.startTime ?? '未填写时间'}</span>
                    </div>
                    <div className="nowrap">
                      <StatusBadge status={m.status} />
                    </div>
                    <div className="list__topic">
                      <span className="list__topic-main" title={m.topic}>
                        {m.isSample ? <span className="badge badge--sample" data-testid={`sample-tag-${m.id}`}>示例</span> : null}
                        {m.topic}
                      </span>
                      <span className="list__meta">
                        <CategoryBadge category={m.category} />
                        <span>{m.eventName ?? '未归属赛事'}</span>
                        {m.side ? <span>· {m.side}</span> : null}
                        {m.position ? <span>· {m.position}</span> : null}
                        {m.isBestDebater ? <span className="badge badge--best">最佳辩手</span> : null}
                      </span>
                      {m.comment ? <span className="list__comment">{m.comment}</span> : null}
                    </div>
                    <div className="list__actions">
                      <Button
                        size="sm"
                        onClick={() => setMatchModal({ mode: 'edit', match: m })}
                        data-testid={`match-edit-${m.id}`}
                      >
                        编辑
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => setDeleteMatch(m)}
                        data-testid={`match-remove-${m.id}`}
                      >
                        删除
                      </Button>
                    </div>
                  </div>
                ))}
                {filtered.length > shown.length ? (
                  <div style={{ padding: 14, textAlign: 'center' }}>
                    <Button size="sm" onClick={() => setVisible((v) => v + 40)} data-testid="matches-more">
                      显示更多（还有 {filtered.length - shown.length} 场）
                    </Button>
                  </div>
                ) : null}
              </div>
            )}
          </Panel>
        </>
      ) : null}

      {tab === 'events' ? (
        <Panel title={`赛事列表（${events.length}）`} desc="赛事可包含多场比赛；成绩可自行填写" pad={false} testId="events-list">
          {events.length === 0 ? (
            <div style={{ padding: 18 }}>
              <EmptyState
                text="还没有赛事。赛事用于把同一场比赛的多场对局归组统计"
                action={
                  <Button size="sm" icon="plus" onClick={() => setEventModal({ mode: 'new' })}>
                    新增赛事
                  </Button>
                }
              />
            </div>
          ) : (
            <div className="list">
              {events.map((e) => (
                <div className="list__row" key={e.id} style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }} data-testid={`event-row-${e.id}`}>
                  <div className="list__topic">
                    <span className="list__topic-main" style={{ fontSize: 14, fontWeight: 600 }}>
                      {e.isSample ? <span className="badge badge--sample" data-testid={`sample-tag-event-${e.id}`}>示例</span> : null}
                      {e.name}
                    </span>
                    <span className="list__meta">
                      <span className={`badge ${e.result ? 'badge--official' : 'badge--outline'}`}>
                        {e.result ?? '成绩未填写'}
                      </span>
                      <span>
                        赛期 {eventRangeText(e.startDate, e.endDate)}
                        {e.hasExplicitRange ? '' : '（由创建时间推算）'}
                      </span>
                      <span>
                        · {e.matchCount} 场 · 胜 {e.winCount} 负 {e.lossCount}
                        {e.winCount + e.lossCount > 0
                          ? ` · 胜率 ${winRateText(e.winCount / (e.winCount + e.lossCount))}`
                          : ''}
                      </span>
                      {e.bestDebaterCount > 0 ? <span className="badge badge--best">最佳辩手 {e.bestDebaterCount}</span> : null}
                    </span>
                    {e.note ? <span className="list__comment">{e.note}</span> : null}
                  </div>
                  <div className="list__actions">
                    <Button
                      size="sm"
                      onClick={() => setEventModal({ mode: 'edit', event: e })}
                      data-testid={`event-edit-${e.id}`}
                    >
                      编辑
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => setDeleteEvent(e)}
                      data-testid={`event-remove-${e.id}`}
                    >
                      删除
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      ) : null}

      {tab === 'honors' ? <HonorsTab onEdit={(h) => setHonorModal({ mode: 'edit', honor: h })} onDelete={setDeleteHonor} /> : null}

      {matchModal ? (
        <MatchFormModal
          initial={matchModal.mode === 'edit' ? matchModal.match : null}
          onClose={() => setMatchModal(null)}
          onRequestDelete={(m) => {
            setMatchModal(null)
            setDeleteMatch(m)
          }}
        />
      ) : null}

      {eventModal ? (
        <EventFormModal
          initial={eventModal.mode === 'edit' ? eventModal.event : null}
          onClose={() => setEventModal(null)}
          onRequestDelete={(e) => {
            setEventModal(null)
            setDeleteEvent(e)
          }}
        />
      ) : null}

      {honorModal ? (
        <HonorFormModal
          initial={honorModal.mode === 'edit' ? honorModal.honor : null}
          onClose={() => setHonorModal(null)}
          onRequestDelete={(h) => {
            setHonorModal(null)
            setDeleteHonor(h)
          }}
        />
      ) : null}

      {deleteMatch ? (
        <ConfirmDialog
          title="删除比赛"
          message={`确定删除 ${deleteMatch.date} 的这场比赛吗？删除后无法撤销。`}
          detail={`${deleteMatch.topic}${deleteMatch.eventName ? `（${deleteMatch.eventName}）` : ''}`}
          onCancel={() => setDeleteMatch(null)}
          onConfirm={() => {
            void (async () => {
              try {
                await removeMatch(deleteMatch.id)
                toast('比赛已删除', 'success')
              } catch (err) {
                toast((err as Error).message, 'error')
              } finally {
                setDeleteMatch(null)
              }
            })()
          }}
        />
      ) : null}

      {deleteEvent ? (
        <ConfirmDialog
          title="删除赛事"
          message={`确定删除赛事「${deleteEvent.name}」吗？`}
          detail={
            deleteEvent.matchCount > 0
              ? `该赛事下有 ${deleteEvent.matchCount} 场比赛，删除后这些比赛不会被删除，但会变为「未归属赛事」。`
              : '该赛事下没有比赛。'
          }
          onCancel={() => setDeleteEvent(null)}
          onConfirm={() => {
            void (async () => {
              try {
                await removeEvent(deleteEvent.id)
                toast('赛事已删除', 'success')
              } catch (err) {
                toast((err as Error).message, 'error')
              } finally {
                setDeleteEvent(null)
              }
            })()
          }}
        />
      ) : null}

      {deleteHonor ? (
        <ConfirmDialog
          title="删除荣誉"
          message={`确定删除荣誉「${deleteHonor.name}」（${deleteHonor.date}）吗？`}
          onCancel={() => setDeleteHonor(null)}
          onConfirm={() => {
            void (async () => {
              try {
                await removeHonor(deleteHonor.id)
                toast('荣誉已删除', 'success')
              } catch (err) {
                toast((err as Error).message, 'error')
              } finally {
                setDeleteHonor(null)
              }
            })()
          }}
        />
      ) : null}
    </>
  )
}

function HonorsTab({
  onEdit,
  onDelete
}: {
  onEdit: (h: Honor) => void
  onDelete: (h: Honor) => void
}): React.ReactElement {
  const { honors, matches, events } = useStore()

  const autoBest = useMemo(
    () => matches.filter((m) => m.isBestDebater).sort((a, b) => b.date.localeCompare(a.date)),
    [matches]
  )

  return (
    <>
      <Panel title={`荣誉记录（${honors.length}）`} desc="额外荣誉需要手动记录名称与获得日期" pad={false} testId="honors-list">
        {honors.length === 0 ? (
          <div style={{ padding: 18 }}>
            <EmptyState text="还没有荣誉记录。单场最佳辩手不需要在这里录入，会自动汇总到履历。" />
          </div>
        ) : (
          <div className="list">
            {honors.map((h) => (
              <div className="list__row" key={h.id} style={{ gridTemplateColumns: '110px minmax(0,1fr) auto' }} data-testid={`honor-row-${h.id}`}>
                <div className="list__date">
                  <span className="list__date-main tabular">{h.date}</span>
                </div>
                <div className="list__topic">
                  <span className="list__topic-main" style={{ fontWeight: 600 }}>
                    {h.isSample ? <span className="badge badge--sample" data-testid={`sample-tag-honor-${h.id}`}>示例</span> : null}
                    {h.name}
                  </span>
                  <span className="list__meta">
                    <span>{h.eventName ?? '未关联赛事'}</span>
                    <span className="small muted">录入于 {formatDateTime(h.createdAt)}</span>
                  </span>
                  {h.note ? <span className="list__comment">{h.note}</span> : null}
                </div>
                <div className="list__actions">
                  <Button size="sm" onClick={() => onEdit(h)} data-testid={`honor-edit-${h.id}`}>
                    编辑
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => onDelete(h)} data-testid={`honor-remove-${h.id}`}>
                    删除
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel
        title={`单场最佳辩手自动汇总（${autoBest.length}）`}
        desc="来自比赛记录中的「本场最佳辩手」标记，无需重复录入"
        pad={false}
        testId="honors-auto-best"
      >
        {autoBest.length === 0 ? (
          <div style={{ padding: 18 }}>
            <EmptyState text="还没有标记过单场最佳辩手" />
          </div>
        ) : (
          <div className="list">
            {autoBest.map((m) => (
              <div className="day-row" key={m.id} style={{ gridTemplateColumns: '96px 60px minmax(0,1fr)' }}>
                <span className="tabular small muted">{m.date}</span>
                <CategoryBadge category={m.category} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 600 }}>{m.eventName ?? '未归属赛事'}</span>
                  <span className="muted"> · {m.topic}</span>
                  {m.position ? <span className="muted">（{m.position}）</span> : null}
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>
      <div className="section-note" style={{ marginTop: 10 }}>
        提示：履历页的「荣誉」分区会把上面的自动汇总与手动荣誉合并展示。当前共 {events.length} 个赛事、
        {matches.length} 场比赛。
      </div>
    </>
  )
}
