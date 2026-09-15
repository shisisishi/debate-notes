/** 赛事与荣誉的新增／编辑弹窗。 */

import React, { useEffect, useMemo, useState } from 'react'
import { todayStr } from '@shared/date'
import type { DebateEvent, Honor } from '@shared/types'
import { useStore } from '../store'
import { Modal } from './Modal'
import { Button, ComboBox, Field, Select, TextArea, TextInput } from './ui'

/* ---------- 赛事 ---------- */

export function EventFormModal({
  initial,
  onClose,
  onSaved,
  onRequestDelete
}: {
  initial: DebateEvent | null
  onClose: () => void
  onSaved?: (e: DebateEvent) => void
  onRequestDelete?: (e: DebateEvent) => void
}): React.ReactElement {
  const { options, saveEvent, addOption, toast, matches } = useStore()
  const [name, setName] = useState(initial?.name ?? '')
  const [result, setResult] = useState(initial?.result ?? '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setName(initial?.name ?? '')
    setResult(initial?.result ?? '')
    setNote(initial?.note ?? '')
    setError('')
  }, [initial])

  const results = useMemo(() => options.filter((o) => o.kind === 'eventResult').map((o) => o.value), [options])
  const linkedCount = initial ? matches.filter((m) => m.eventId === initial.id).length : 0

  const submit = async (): Promise<void> => {
    if (!name.trim()) {
      setError('请填写赛事名称')
      return
    }
    setBusy(true)
    try {
      const saved = await saveEvent({ name: name.trim(), result: result || null, note }, initial?.id)
      toast(initial ? '赛事已更新' : '赛事已保存', 'success')
      onSaved?.(saved)
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={initial ? '编辑赛事' : '新增赛事'}
      onClose={onClose}
      size="sm"
      testId="event-modal"
      footer={
        <>
          {initial && onRequestDelete ? (
            <Button variant="danger" onClick={() => onRequestDelete(initial)} data-testid="event-delete">
              删除
            </Button>
          ) : null}
          <span className="spacer" />
          <Button onClick={onClose} data-testid="event-cancel">
            取消
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy} data-testid="event-save">
            {busy ? '保存中…' : '保存'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label="赛事名称" error={error}>
          <TextInput value={name} testId="event-name" onChange={(e) => setName(e.target.value)} placeholder="例如：校辩论联赛春季赛" />
        </Field>
        <Field label="赛事成绩" hint="常用选项可选，也可手动输入并记住">
          <ComboBox
            value={result}
            options={results}
            allowEmpty
            emptyLabel="暂未填写"
            testId="event-result"
            onChange={setResult}
            onCreate={async (v) => {
              await addOption('eventResult', v)
            }}
          />
        </Field>
        <Field label="备注">
          <TextArea value={note} testId="event-note" onChange={(e) => setNote(e.target.value)} />
        </Field>
        {initial ? (
          <div className="section-note">
            该赛事下有 {linkedCount} 场比赛。删除赛事不会删除比赛，这些比赛会变为「未归属赛事」。
          </div>
        ) : null}
      </div>
    </Modal>
  )
}

/* ---------- 荣誉 ---------- */

export function HonorFormModal({
  initial,
  onClose,
  onSaved,
  onRequestDelete
}: {
  initial: Honor | null
  onClose: () => void
  onSaved?: (h: Honor) => void
  onRequestDelete?: (h: Honor) => void
}): React.ReactElement {
  const { options, events, saveHonor, addOption, toast } = useStore()
  const names = useMemo(() => options.filter((o) => o.kind === 'honorName').map((o) => o.value), [options])
  const [name, setName] = useState(() => initial?.name ?? names[0] ?? '')
  const [date, setDate] = useState(() => initial?.date ?? todayStr())
  const [eventId, setEventId] = useState(() => (initial?.eventId ? String(initial.eventId) : ''))
  const [note, setNote] = useState(initial?.note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setName(initial?.name ?? names[0] ?? '')
    setDate(initial?.date ?? todayStr())
    setEventId(initial?.eventId ? String(initial.eventId) : '')
    setNote(initial?.note ?? '')
    setError('')
    // names 仅用于默认值，依赖 initial 变化即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial])

  const submit = async (): Promise<void> => {
    if (!name.trim()) {
      setError('请填写荣誉名称')
      return
    }
    if (!date) {
      setError('请选择获得日期')
      return
    }
    setBusy(true)
    try {
      const saved = await saveHonor(
        { name: name.trim(), date, eventId: eventId ? Number(eventId) : null, note },
        initial?.id
      )
      toast(initial ? '荣誉已更新' : '荣誉已保存', 'success')
      onSaved?.(saved)
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={initial ? '编辑荣誉' : '新增荣誉'}
      onClose={onClose}
      size="sm"
      testId="honor-modal"
      footer={
        <>
          {initial && onRequestDelete ? (
            <Button variant="danger" onClick={() => onRequestDelete(initial)} data-testid="honor-delete">
              删除
            </Button>
          ) : null}
          <span className="spacer" />
          <Button onClick={onClose} data-testid="honor-cancel">
            取消
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy} data-testid="honor-save">
            {busy ? '保存中…' : '保存'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label="荣誉名称" error={error}>
          <ComboBox
            value={name}
            options={names}
            testId="honor-name"
            onChange={setName}
            onCreate={async (v) => {
              await addOption('honorName', v)
            }}
          />
        </Field>
        <Field label="获得日期">
          <TextInput type="date" value={date} testId="honor-date" onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="关联赛事" hint="可留空">
          <Select value={eventId} testId="honor-event" onChange={(e) => setEventId(e.target.value)}>
            <option value="">不关联赛事</option>
            {events.map((ev) => (
              <option key={ev.id} value={String(ev.id)}>
                {ev.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="备注">
          <TextArea value={note} testId="honor-note" onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="section-note">单场最佳辩手不需要在这里录入，会从比赛记录自动汇总到履历中。</div>
      </div>
    </Modal>
  )
}
