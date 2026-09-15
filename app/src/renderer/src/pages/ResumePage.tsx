/** 履历：参赛经历 / 赛事成绩 / 荣誉，支持按所选时间段复制为纯文本或 Markdown。 */

import React, { useEffect, useMemo, useState } from 'react'
import { rangeLabel, resolveRange } from '@shared/date'
import { buildResumeText, type ResumeData } from '@shared/resume'
import { RANGE_PRESET_LABELS, type RangePreset, type SettingsPatch } from '@shared/types'
import {
  Button,
  CategoryBadge,
  EmptyState,
  PageHead,
  Panel,
  Segmented,
  StatCard,
  StatusBadge,
  TextArea,
  TextInput
} from '../components/ui'
import { copyText, eventRangeText, formatDateTime, winRateText } from '../lib/format'
import { useStore } from '../store'

const RANGE_ORDER: RangePreset[] = ['month', 'year', 'all', 'custom']

export function ResumePage(): React.ReactElement {
  const { settings, updateSettings, toast, matches, resumeDraft, saveResumeDraft, clearResumeDraft } = useStore()
  const range = settings.resume.range
  const [data, setData] = useState<ResumeData | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [previewFormat, setPreviewFormat] = useState<'text' | 'markdown'>('text')
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [draftInput, setDraftInput] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      try {
        const result = await window.api.invoke('resume:build', range)
        if (!cancelled) setData(result)
      } catch (err) {
        if (!cancelled) toast((err as Error).message, 'error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [range.preset, range.from, range.to, matches.length, toast])

  const resolved = resolveRange(range)
  const autoText = useMemo(
    () => (data ? buildResumeText(data, previewFormat) : ''),
    [data, previewFormat]
  )
  const hasDraft = resumeDraft.text !== null
  /** 复制与预览用：手动编辑过就用手动内容，否则用自动汇总 */
  const text = hasDraft ? (resumeDraft.text ?? '') : autoText

  const doCopy = async (format: 'text' | 'markdown'): Promise<void> => {
    if (!data) return
    const payload = hasDraft ? (resumeDraft.text ?? '') : buildResumeText(data, format)
    const ok = await copyText(payload)
    const what = hasDraft ? '手动编辑的履历' : `${format === 'markdown' ? 'Markdown' : '纯文本'}履历（${data.rangeLabel}）`
    if (ok) toast(`已复制${what}`, 'success')
    else toast('复制失败，请手动选择预览文本复制', 'error')
  }

  const startEditing = (): void => {
    setDraftInput(hasDraft ? (resumeDraft.text ?? '') : buildResumeText(data!, 'text'))
    setEditing(true)
    setShowPreview(false)
  }

  const doSaveDraft = async (): Promise<void> => {
    if (draftInput.trim() === '') {
      toast('内容为空，没有保存；若要恢复自动汇总请点「恢复自动生成」', 'error')
      return
    }
    setSaving(true)
    try {
      await saveResumeDraft(draftInput)
      setEditing(false)
      toast('履历已保存，复制按钮复制的就是这份内容', 'success')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const doClearDraft = async (): Promise<void> => {
    await clearResumeDraft()
    setEditing(false)
    toast('已恢复为自动汇总内容', 'success')
  }

  const patchRange = async (next: SettingsPatch['resume']): Promise<void> => {
    await updateSettings({ resume: next })
  }

  return (
    <>
      <PageHead
        title="履历"
        sub={`统计范围：${rangeLabel(range)}${resolved.from ? `（${resolved.from} ~ ${resolved.to ?? '至今'}）` : ''}`}
        actions={
          <>
            <Button icon="copy" onClick={() => void doCopy('text')} data-testid="resume-copy-text">
              复制纯文本
            </Button>
            <Button icon="copy" onClick={() => void doCopy('markdown')} data-testid="resume-copy-markdown">
              复制 Markdown
            </Button>
          </>
        }
      />

      <Panel pad={false} testId="resume-filters">
        <div className="filter-bar">
          <div className="filter-bar__group">
            <span className="filter-bar__label">时间段</span>
            <Segmented
              value={range.preset}
              testId="resume-range"
              options={RANGE_ORDER.map((p) => ({
                value: p,
                label: RANGE_PRESET_LABELS[p],
                testId: `resume-range-${p}`
              }))}
              onChange={(p) => void patchRange({ range: { preset: p } })}
            />
          </div>
          {range.preset === 'custom' ? (
            <div className="range-custom">
              <TextInput
                type="date"
                value={range.from}
                testId="resume-from"
                onChange={(e) => void patchRange({ range: { from: e.target.value } })}
              />
              <span className="muted small">至</span>
              <TextInput
                type="date"
                value={range.to}
                testId="resume-to"
                onChange={(e) => void patchRange({ range: { to: e.target.value } })}
              />
            </div>
          ) : null}
          <span className="spacer" />
          <Button size="sm" variant="ghost" onClick={() => setShowPreview((v) => !v)} data-testid="resume-toggle-preview">
            {showPreview ? '收起文本预览' : '查看文本预览'}
          </Button>
        </div>
      </Panel>

      <div className="grid-stats" style={{ marginTop: 16 }} data-testid="resume-summary">
        <StatCard label="比赛场次" value={data?.totals.matches ?? '—'} tone="accent" testId="resume-total" />
        <StatCard label="胜 / 负" value={data ? `${data.totals.wins} / ${data.totals.losses}` : '—'} tone="win" testId="resume-wl" />
        <StatCard
          label="胜率"
          value={data ? winRateText(data.totals.winRate) : '—'}
          foot="胜 ÷（胜 + 负）"
          tone="accent"
          testId="resume-winrate"
        />
        <StatCard label="赛事" value={data?.experience.length ?? '—'} foot="有比赛的赛事" testId="resume-events" />
        <StatCard
          label="荣誉"
          value={data ? data.honors.length + data.bestDebaters.length : '—'}
          foot={data ? `手动 ${data.honors.length} · 单场最佳 ${data.bestDebaters.length}` : undefined}
          testId="resume-honors"
        />
      </div>

      <Panel
        title="我的履历文字"
        desc="可以直接在程序里改；保存后会一直用你写的内容，两个复制按钮复制的也是它"
        testId="resume-draft"
      >
        {editing ? (
          <div className="stack--sm stack">
            <TextArea
              value={draftInput}
              rows={18}
              className="resume-editor"
              testId="resume-editor"
              onChange={(e) => setDraftInput(e.target.value)}
              placeholder="在这里写你的履历…可以先用「用自动汇总内容填充」，再按自己的语气改。"
            />
            <div className="row">
              <Button variant="primary" disabled={saving} onClick={() => void doSaveDraft()} data-testid="resume-save">
                {saving ? '保存中…' : '保存'}
              </Button>
              <Button onClick={() => setEditing(false)} data-testid="resume-cancel">
                取消
              </Button>
              <Button
                variant="ghost"
                disabled={!data}
                onClick={() => setDraftInput(data ? buildResumeText(data, 'text') : '')}
                data-testid="resume-refill"
              >
                用自动汇总内容填充
              </Button>
              {hasDraft ? (
                <Button variant="ghost" onClick={() => void doClearDraft()} data-testid="resume-restore-auto">
                  删除手动内容
                </Button>
              ) : null}
            </div>
            <div className="section-note">
              自动汇总内容随时可以重新生成（点「用自动汇总内容填充」就是最新的），所以放心改。
            </div>
          </div>
        ) : hasDraft ? (
          <div className="stack--sm stack">
            <div className="row">
              <span className="badge badge--official" data-testid="resume-draft-badge">
                已手动编辑
              </span>
              {resumeDraft.updatedAt ? (
                <span className="small muted" data-testid="resume-draft-time">
                  保存于 {formatDateTime(resumeDraft.updatedAt)}
                </span>
              ) : null}
              <span className="spacer" />
              <Button size="sm" onClick={startEditing} data-testid="resume-edit">
                编辑
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void doClearDraft()}
                data-testid="resume-restore-auto"
              >
                恢复自动生成
              </Button>
            </div>
            <pre className="mono-pre" data-testid="resume-draft-text">
              {resumeDraft.text}
            </pre>
          </div>
        ) : (
          <div className="stack--sm stack">
            <EmptyState
              text="现在用的是按比赛记录自动汇总的内容（口径见下面各区块）。想让语气更像自己的，可以直接编辑并保存。"
              action={
                <Button
                  icon="edit"
                  size="sm"
                  disabled={!data}
                  onClick={startEditing}
                  data-testid="resume-edit"
                >
                  编辑履历
                </Button>
              }
            />
            {data ? (
              <div className="row">
                <Button variant="ghost" size="sm" onClick={() => void doCopy('text')} data-testid="resume-copy-auto">
                  复制当前自动汇总内容
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </Panel>

      {showPreview ? (
        <Panel
          title="复制的文字预览"
          desc={hasDraft ? '这是你手动编辑并保存过的内容' : '这是按比赛记录自动汇总的内容，点「复制」进入剪贴板的就是它'}
          actions={
            hasDraft ? null : (
              <Segmented
                value={previewFormat}
                options={[
                  { value: 'text', label: '纯文本', testId: 'preview-text' },
                  { value: 'markdown', label: 'Markdown', testId: 'preview-markdown' }
                ]}
                onChange={setPreviewFormat}
              />
            )
          }
          testId="resume-preview"
        >
          <pre className="mono-pre" data-testid="resume-preview-text">
            {loading ? '生成中…' : text}
          </pre>
        </Panel>
      ) : null}

      <Panel
        title={`参赛经历（${data?.experience.length ?? 0} 个赛事${data && data.unassigned.length > 0 ? ` + ${data.unassigned.length} 场未归属` : ''}）`}
        desc="按赛事归组，组内按日期排列"
        testId="resume-experience"
      >
        {data && (data.experience.length > 0 || data.unassigned.length > 0) ? (
          <div className="stack">
            {data.experience.map((g) => (
              <div className="resume-block" key={g.eventId} data-testid={`resume-group-${g.eventId}`}>
                <div className="resume-item__head">
                  <span className="resume-item__title">{g.eventName}</span>
                  <span className={`badge ${g.result ? 'badge--official' : 'badge--outline'}`}>
                    {g.result ?? '成绩未填写'}
                  </span>
                  <span className="small muted">赛期 {eventRangeText(g.startDate, g.endDate)}</span>
                  <span className="small muted">
                    战绩 {g.matches.length} 场 · 胜 {g.wins} 负 {g.losses}
                    {g.draws ? ` 无胜负 ${g.draws}` : ''}
                    {g.unknown ? ` 未出结果 ${g.unknown}` : ''}
                    {g.pending ? ` 待赛 ${g.pending}` : ''}
                  </span>
                  {g.bestDebaterCount > 0 ? (
                    <span className="badge badge--best">最佳辩手 {g.bestDebaterCount}</span>
                  ) : null}
                </div>
                {g.matches.map((m) => (
                  <div className="resume-match" key={m.id}>
                    <span className="resume-match__date">
                      {m.date}
                      {m.startTime ? ` ${m.startTime}` : ''}
                    </span>
                    <span className="resume-match__text">
                      {m.topic}
                      <span className="row" style={{ gap: 6, marginTop: 2 }}>
                        <CategoryBadge category={m.category} />
                        <StatusBadge status={m.status} />
                        {m.side ? <span className="small muted">{m.side}</span> : null}
                        {m.position ? <span className="small muted">{m.position}</span> : null}
                        {m.isBestDebater ? <span className="badge badge--best">最佳辩手</span> : null}
                      </span>
                      {m.comment ? <div className="small muted">{m.comment}</div> : null}
                    </span>
                  </div>
                ))}
                {g.note ? <div className="small muted">{g.note}</div> : null}
              </div>
            ))}

            {data.unassigned.length > 0 ? (
              <div className="resume-block" data-testid="resume-unassigned">
                <div className="resume-item__head">
                  <span className="resume-item__title">未归属赛事的比赛</span>
                  <span className="small muted">{data.unassigned.length} 场</span>
                </div>
                {data.unassigned.map((m) => (
                  <div className="resume-match" key={m.id}>
                    <span className="resume-match__date">{m.date}</span>
                    <span className="resume-match__text">
                      {m.topic}
                      <span className="row" style={{ gap: 6, marginTop: 2 }}>
                        <CategoryBadge category={m.category} />
                        <StatusBadge status={m.status} />
                        {m.isBestDebater ? <span className="badge badge--best">最佳辩手</span> : null}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <EmptyState text="当前时间段内还没有参赛经历" />
        )}
      </Panel>

      <Panel title={`赛事成绩（${data?.eventResults.length ?? 0}）`} testId="resume-event-results">
        {data && data.eventResults.length > 0 ? (
          <div className="list">
            {data.eventResults.map((e) => (
              <div className="day-row" key={e.eventId}>
                <span className="nowrap small muted">{eventRangeText(e.startDate, e.endDate)}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 600 }}>{e.name}</span>
                  <span className="small muted">
                    {' '}
                    · {e.matchCount} 场 · 胜 {e.wins} 负 {e.losses}
                  </span>
                  {e.note ? <div className="small muted">{e.note}</div> : null}
                </span>
                <span className={`badge ${e.result ? 'badge--official' : 'badge--outline'}`}>
                  {e.result ?? '成绩未填写'}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState text="当前时间段内没有赛事成绩" />
        )}
      </Panel>

      <Panel
        title="荣誉"
        desc="手动荣誉 + 由比赛记录自动汇总的单场最佳辩手"
        testId="resume-honor-section"
      >
        {data && (data.honors.length > 0 || data.bestDebaters.length > 0) ? (
          <div className="stack">
            {data.honors.map((h) => (
              <div className="resume-match" key={h.id}>
                <span className="resume-match__date tabular">{h.date}</span>
                <span className="resume-match__text">
                  <span style={{ fontWeight: 600 }}>{h.name}</span>
                  {h.eventName ? <span className="muted"> · {h.eventName}</span> : null}
                  {h.note ? <div className="small muted">{h.note}</div> : null}
                </span>
              </div>
            ))}
            {data.bestDebaters.length > 0 ? (
              <>
                <div className="divider" />
                <div className="resume-item__head">
                  <span className="resume-item__title">单场最佳辩手</span>
                  <span className="small muted">共 {data.bestDebaters.length} 次（自动汇总，无需重复录入）</span>
                </div>
                {data.bestDebaters.map((m) => (
                  <div className="resume-match" key={`best-${m.id}`}>
                    <span className="resume-match__date tabular">{m.date}</span>
                    <span className="resume-match__text">
                      <span className="muted">{m.eventName ? `${m.eventName} · ` : ''}</span>
                      {m.topic}
                      {m.position ? <span className="muted">（{m.position}）</span> : null}
                    </span>
                  </div>
                ))}
              </>
            ) : null}
          </div>
        ) : (
          <EmptyState text="当前时间段内没有荣誉记录" />
        )}
      </Panel>
    </>
  )
}
