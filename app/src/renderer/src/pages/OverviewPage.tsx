/** 战绩总览：时间范围 / 类别 / 赛事三重筛选，统计口径统一由主进程给出。 */

import React, { useEffect, useState } from 'react'
import { rangeLabel, resolveRange } from '@shared/date'
import {
  MATCH_CATEGORIES,
  RANGE_PRESET_LABELS,
  type Match,
  type OverviewStats,
  type RangePreset,
  type SettingsPatch
} from '@shared/types'
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
  StatCard,
  StatusBadge,
  TextInput
} from '../components/ui'
import { eventRangeText, winRateText } from '../lib/format'
import { useStore } from '../store'

const RANGE_ORDER: RangePreset[] = ['month', 'year', 'all', 'custom']

type ModalState = { mode: 'new' } | { mode: 'edit'; match: Match } | null

export function OverviewPage(): React.ReactElement {
  const { settings, events, updateSettings, toast, matches, removeMatch } = useStore()
  const filter = settings.overview
  const [stats, setStats] = useState<OverviewStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<ModalState>(null)
  const [pendingDelete, setPendingDelete] = useState<Match | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      try {
        const result = await window.api.invoke('stats:overview', filter)
        if (!cancelled) setStats(result)
      } catch (err) {
        if (!cancelled) toast((err as Error).message, 'error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // 筛选条件或比赛数据变化时重新统计
  }, [
    filter.category,
    filter.eventId,
    filter.range.preset,
    filter.range.from,
    filter.range.to,
    matches.length,
    toast
  ])

  const patch = async (next: SettingsPatch['overview']): Promise<void> => {
    await updateSettings({ overview: next })
  }

  const range = resolveRange(filter.range)
  const decisive = stats ? stats.wins + stats.losses : 0

  return (
    <>
      <PageHead
        title="战绩总览"
        sub={`统计范围：${rangeLabel(filter.range)}${
          range.from ? `（${range.from} ~ ${range.to ?? '至今'}）` : ''
        }`}
        actions={
          <Button icon="plus" variant="primary" data-testid="overview-add" onClick={() => setModal({ mode: 'new' })}>
            新增比赛
          </Button>
        }
      />

      <Panel pad={false} testId="overview-filters">
        <div className="filter-bar">
          <div className="filter-bar__group">
            <span className="filter-bar__label">时间</span>
            <Segmented
              value={filter.range.preset}
              testId="overview-range"
              options={RANGE_ORDER.map((p) => ({
                value: p,
                label: RANGE_PRESET_LABELS[p],
                testId: `overview-range-${p}`
              }))}
              onChange={(p) => void patch({ range: { preset: p } })}
            />
          </div>

          {filter.range.preset === 'custom' ? (
            <div className="range-custom">
              <TextInput
                type="date"
                value={filter.range.from}
                testId="overview-from"
                onChange={(e) => void patch({ range: { from: e.target.value } })}
              />
              <span className="muted small">至</span>
              <TextInput
                type="date"
                value={filter.range.to}
                testId="overview-to"
                onChange={(e) => void patch({ range: { to: e.target.value } })}
              />
            </div>
          ) : null}

          <div className="filter-bar__group">
            <span className="filter-bar__label">类别</span>
            <Segmented
              value={filter.category}
              testId="overview-category"
              options={[
                { value: 'all', label: '全部', testId: 'overview-category-all' },
                ...MATCH_CATEGORIES.map((c) => ({ value: c, label: c, testId: `overview-category-${c}` }))
              ]}
              onChange={(c) => void patch({ category: c })}
            />
          </div>

          <div className="filter-bar__group">
            <span className="filter-bar__label">赛事</span>
            <Select
              value={filter.eventId === 'all' ? 'all' : String(filter.eventId)}
              testId="overview-event"
              style={{ minWidth: 168 }}
              onChange={(e) => {
                const v = e.target.value
                void patch({ eventId: v === 'all' || v === 'none' ? (v as 'all' | 'none') : Number(v) })
              }}
            >
              <option value="all">全部赛事</option>
              <option value="none">未归属赛事</option>
              {events.map((e) => (
                <option key={e.id} value={String(e.id)}>
                  {e.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </Panel>

      <div className="grid-stats" style={{ marginTop: 16 }} data-testid="overview-stats">
        <StatCard
          label="已完成场次"
          value={stats?.finished ?? '—'}
          foot={`共记录 ${stats?.total ?? 0} 场`}
          tone="accent"
          testId="stat-finished"
        />
        <StatCard label="胜场" value={stats?.wins ?? '—'} tone="win" testId="stat-wins" />
        <StatCard label="负场" value={stats?.losses ?? '—'} tone="loss" testId="stat-losses" />
        <StatCard label="无胜负" value={stats?.draws ?? '—'} tone="muted" testId="stat-draws" />
        <StatCard
          label="胜率"
          value={stats ? winRateText(stats.winRate) : '—'}
          foot={decisive > 0 ? `${stats?.wins} ÷（${stats?.wins} + ${stats?.losses}）= ${winRateText(stats?.winRate ?? null)}` : '没有明确胜负的场次'}
          tone="accent"
          testId="stat-winrate"
        />
        <StatCard
          label="单场最佳辩手"
          value={stats?.bestDebaterCount ?? '—'}
          foot="按比赛记录自动汇总"
          testId="stat-best"
        />
        <StatCard
          label="赛事荣誉"
          value={stats?.honorCount ?? '—'}
          foot="按获得日期计入范围"
          testId="stat-honors"
        />
        <StatCard label="未出结果" value={stats?.unknown ?? '—'} tone="muted" testId="stat-unknown" />
        <StatCard
          label="待赛"
          value={stats?.pending ?? '—'}
          foot="不计入已完成场次"
          tone="muted"
          testId="stat-pending"
        />
      </div>

      <div className="cols-2" style={{ marginTop: 16 }}>
        <Panel title="类别对照" desc="正赛与模拟赛分别统计，胜负口径一致" testId="overview-by-category">
          {stats ? (
            <div className="list">
              {MATCH_CATEGORIES.map((c) => {
                const b = stats.byCategory[c]
                const total = b.wins + b.losses + b.draws + b.unknown + b.pending
                return (
                  <div className="list__row" key={c} style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
                    <div className="list__topic">
                      <div className="row" style={{ gap: 8 }}>
                        <CategoryBadge category={c} />
                        <span className="small muted">
                          已完成 {b.finished} 场 · 胜 {b.wins} / 负 {b.losses} / 无胜负 {b.draws}
                          {b.unknown ? ` / 未出结果 ${b.unknown}` : ''}
                          {b.pending ? ` / 待赛 ${b.pending}` : ''}
                        </span>
                      </div>
                      <div className="mini-bar">
                        <div
                          className="mini-bar__fill"
                          style={{
                            width: `${total > 0 ? Math.round(((b.wins + b.losses) / total) * 100) : 0}%`
                          }}
                        />
                      </div>
                    </div>
                    <div className="cat-rate">
                      <div className="tabular cat-rate__value" data-testid={`category-winrate-${c}`}>
                        {winRateText(b.winRate)}
                      </div>
                      <div className="small muted tabular cat-rate__formula" data-testid={`category-formula-${c}`}>
                        {b.wins + b.losses > 0
                          ? `${b.wins} ÷（${b.wins} + ${b.losses}）`
                          : `${b.wins} 胜 ${b.losses} 负，无胜负场次`}
                      </div>
                    </div>
                  </div>
                )
              })}
              <div className="section-note" style={{ padding: '10px 12px 0' }}>
                胜率 = 胜场 ÷（胜场 + 负场），每行括号里就是实际的胜场与负场；「无胜负」「未出结果」「待赛」都不参与胜率计算。
              </div>
            </div>
          ) : (
            <div className="empty">统计中…</div>
          )}
        </Panel>

        <Panel title="赛事成绩" desc="赛期与当前时间范围有交集的赛事" testId="overview-event-results">
          {stats && stats.eventResults.length > 0 ? (
            <div className="list">
              {stats.eventResults.map((e) => (
                <div className="day-row day-row--event" key={e.eventId}>
                  <div className="day-row__range">{eventRangeText(e.startDate, e.endDate)}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>{e.name}</div>
                    <div className="small muted">
                      {e.matchCount} 场 · 胜 {e.wins} 负 {e.losses}
                    </div>
                  </div>
                  <span className={`badge ${e.result ? 'badge--official' : 'badge--outline'}`}>
                    {e.result ?? '成绩未填写'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState text="当前条件下还没有赛事成绩" />
          )}
        </Panel>
      </div>

      <div className="cols-2" style={{ marginTop: 16 }}>
        <Panel
          title="最近比赛"
          desc={loading ? '统计中…' : `范围内共 ${stats?.total ?? 0} 场，显示最近 ${stats?.recent.length ?? 0} 场`}
          testId="overview-recent"
        >
          {stats && stats.recent.length > 0 ? (
            <div className="list">
              {stats.recent.map((m) => (
                <div className="list__row" key={m.id} style={{ gridTemplateColumns: '92px minmax(0,1fr) auto' }}>
                  <div className="list__date">
                    <span className="list__date-main">{m.date}</span>
                    <span className="list__date-sub">{m.startTime ?? '未填写时间'}</span>
                  </div>
                  <div className="list__topic">
                    <span className="list__topic-main">{m.topic}</span>
                    <span className="list__meta">
                      <CategoryBadge category={m.category} />
                      <span>{m.eventName ?? '未归属赛事'}</span>
                      {m.position ? <span>· {m.position}</span> : null}
                      {m.isBestDebater ? <span className="badge badge--best">最佳辩手</span> : null}
                    </span>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <StatusBadge status={m.status} />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setModal({ mode: 'edit', match: m })}
                      data-testid={`overview-edit-${m.id}`}
                    >
                      查看
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              text="当前条件下还没有比赛记录"
              action={
                <Button size="sm" icon="plus" onClick={() => setModal({ mode: 'new' })}>
                  新增第一场比赛
                </Button>
              }
            />
          )}
        </Panel>

        <Panel title="时间范围内的荣誉" desc="来自荣誉记录；单场最佳辩手见上方统计卡" testId="overview-honors">
          {stats && stats.honors.length > 0 ? (
            <div className="list">
              {stats.honors.map((h) => (
                <div className="day-row" key={h.id} style={{ gridTemplateColumns: '92px minmax(0,1fr)' }}>
                  <div className="nowrap small muted tabular">{h.date}</div>
                  <div>
                    <span style={{ fontWeight: 600 }}>{h.name}</span>
                    {h.eventName ? <span className="small muted">（{h.eventName}）</span> : null}
                    {h.note ? <div className="small muted">{h.note}</div> : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState text="当前条件下还没有荣誉记录" />
          )}
        </Panel>
      </div>

      {modal ? (
        <MatchFormModal
          initial={modal.mode === 'edit' ? modal.match : null}
          onClose={() => setModal(null)}
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
          detail={`${pendingDelete.topic}${pendingDelete.eventName ? `（${pendingDelete.eventName}）` : ''}`}
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
