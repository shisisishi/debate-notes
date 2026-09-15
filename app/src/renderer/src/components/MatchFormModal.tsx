/** 比赛新增／编辑弹窗。 */

import React, { useEffect, useMemo, useState } from 'react'
import { todayStr } from '@shared/date'
import { MATCH_CATEGORIES, MATCH_STATUSES, SIDES, type Match, type MatchCategory, type MatchStatus, type Side } from '@shared/types'
import { useStore } from '../store'
import { Modal } from './Modal'
import { Button, Checkbox, ComboBox, Field, Segmented, Select, TextArea, TextInput } from './ui'

interface FormState {
  date: string
  startTime: string
  topic: string
  category: MatchCategory
  eventId: string
  side: string
  position: string
  status: MatchStatus
  isBestDebater: boolean
  comment: string
}

function toForm(initial: Match | null, defaultDate: string): FormState {
  if (!initial) {
    return {
      date: defaultDate,
      startTime: '',
      topic: '',
      category: '正赛',
      eventId: '',
      side: '',
      position: '',
      status: '待赛',
      isBestDebater: false,
      comment: ''
    }
  }
  return {
    date: initial.date,
    startTime: initial.startTime ?? '',
    topic: initial.topic,
    category: initial.category,
    eventId: initial.eventId === null ? '' : String(initial.eventId),
    side: initial.side ?? '',
    position: initial.position ?? '',
    status: initial.status,
    isBestDebater: initial.isBestDebater,
    comment: initial.comment
  }
}

export function MatchFormModal({
  initial,
  defaultDate,
  onClose,
  onSaved,
  onRequestDelete
}: {
  initial: Match | null
  defaultDate?: string
  onClose: () => void
  onSaved?: (m: Match) => void
  onRequestDelete?: (m: Match) => void
}): React.ReactElement {
  const { events, options, saveMatch, saveEvent, addOption, toast } = useStore()
  const [form, setForm] = useState<FormState>(() => toForm(initial, defaultDate ?? todayStr()))
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [newEventMode, setNewEventMode] = useState(false)
  const [newEventName, setNewEventName] = useState('')

  useEffect(() => {
    setForm(toForm(initial, defaultDate ?? todayStr()))
    setErrors({})
    setNewEventMode(false)
    setNewEventName('')
  }, [initial, defaultDate])

  const positions = useMemo(
    () => options.filter((o) => o.kind === 'position').map((o) => o.value),
    [options]
  )

  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const submit = async (): Promise<void> => {
    const next: Record<string, string> = {}
    if (!form.date) next.date = '请选择比赛日期'
    if (!form.topic.trim()) next.topic = '请填写辩题'
    setErrors(next)
    if (Object.keys(next).length > 0) return

    setBusy(true)
    try {
      const saved = await saveMatch(
        {
          date: form.date,
          startTime: form.startTime || null,
          topic: form.topic.trim(),
          category: form.category,
          eventId: form.eventId ? Number(form.eventId) : null,
          side: form.side ? (form.side as Side) : null,
          position: form.position || null,
          status: form.status,
          isBestDebater: form.isBestDebater,
          comment: form.comment
        },
        initial?.id
      )
      toast(initial ? '比赛已更新' : '比赛已保存', 'success')
      onSaved?.(saved)
      onClose()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const createEventInline = async (): Promise<void> => {
    const name = newEventName.trim()
    if (!name) return
    try {
      const created = await saveEvent({ name, result: null, note: '' })
      set('eventId', String(created.id))
      setNewEventMode(false)
      setNewEventName('')
      toast(`已新建赛事「${created.name}」`, 'success')
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  return (
    <Modal
      title={initial ? '编辑比赛' : '新增比赛'}
      onClose={onClose}
      testId="match-modal"
      footer={
        <>
          {initial && onRequestDelete ? (
            <Button variant="danger" onClick={() => onRequestDelete(initial)} data-testid="match-delete">
              删除
            </Button>
          ) : null}
          <span className="spacer" />
          <Button onClick={onClose} data-testid="match-cancel">
            取消
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy} data-testid="match-save">
            {busy ? '保存中…' : '保存'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="form-grid">
          <Field label="比赛日期" error={errors.date}>
            <TextInput
              type="date"
              value={form.date}
              testId="match-date"
              onChange={(e) => set('date', e.target.value)}
            />
          </Field>
          <Field label="开赛时间" hint="可留空；留空的比赛会排在当日最后">
            <TextInput
              type="time"
              value={form.startTime}
              testId="match-time"
              onChange={(e) => set('startTime', e.target.value)}
            />
          </Field>
          <Field label="比赛类型">
            <Segmented
              value={form.category}
              testId="match-category"
              options={MATCH_CATEGORIES.map((c) => ({ value: c, label: c, testId: `match-category-${c}` }))}
              onChange={(v) => set('category', v)}
            />
          </Field>
          <Field label="比赛状态">
            <Segmented
              value={form.status}
              testId="match-status"
              options={MATCH_STATUSES.map((s) => ({ value: s, label: s, testId: `match-status-${s}` }))}
              onChange={(v) => set('status', v)}
            />
          </Field>
        </div>

        <Field label="辩题" error={errors.topic}>
          <TextInput
            value={form.topic}
            testId="match-topic"
            placeholder="例如：网络匿名性有利于／不利于公共议题讨论"
            onChange={(e) => set('topic', e.target.value)}
          />
        </Field>

        <div className="form-grid">
          <Field
            label="所属赛事"
            hint={
              form.category === '正赛' && !form.eventId
                ? '正赛建议归属到一个赛事，便于归组统计（也可以留空）'
                : '模拟赛可以不归属赛事'
            }
          >
            {newEventMode ? (
              <div className="combo-custom">
                <TextInput
                  value={newEventName}
                  placeholder="输入赛事名称"
                  testId="match-new-event-name"
                  onChange={(e) => setNewEventName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void createEventInline()
                    }
                  }}
                />
                <Button size="sm" variant="primary" onClick={() => void createEventInline()} data-testid="match-new-event-confirm">
                  新建
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setNewEventMode(false)}>
                  取消
                </Button>
              </div>
            ) : (
              <Select
                value={form.eventId}
                testId="match-event"
                onChange={(e) => {
                  if (e.target.value === '__new__') {
                    setNewEventMode(true)
                    return
                  }
                  set('eventId', e.target.value)
                }}
              >
                <option value="">不归属赛事</option>
                {events.map((ev) => (
                  <option key={ev.id} value={String(ev.id)}>
                    {ev.name}
                  </option>
                ))}
                <option value="__new__">＋ 新建赛事…</option>
              </Select>
            )}
          </Field>

          <Field label="正反方">
            <Select value={form.side} testId="match-side" onChange={(e) => set('side', e.target.value)}>
              <option value="">不填写</option>
              {SIDES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="辩位" hint="可选择，也可手动输入并记住">
            <ComboBox
              value={form.position}
              options={positions}
              allowEmpty
              testId="match-position"
              onChange={(v) => set('position', v)}
              onCreate={async (v) => {
                await addOption('position', v)
              }}
            />
          </Field>

          <Field label="其他">
            <Checkbox
              checked={form.isBestDebater}
              onChange={(v) => set('isBestDebater', v)}
              label="本场最佳辩手"
              testId="match-best"
            />
          </Field>
        </div>

        <Field label="简评" hint="自由书写：立论、交锋、复盘感受…">
          <TextArea
            value={form.comment}
            testId="match-comment"
            placeholder="例如：一辩立论框架稳，但质询环节被抓住定义问题"
            onChange={(e) => set('comment', e.target.value)}
          />
        </Field>
      </div>
    </Modal>
  )
}
