/** 通用 UI 原子组件。所有交互元素都带 data-testid，便于端到端测试。 */

import React, { useEffect, useRef, useState } from 'react'
import type { MatchCategory, MatchStatus } from '@shared/types'
import { categoryClass, statusClass } from '../lib/format'

/* ---------- 图标 ---------- */

const ICON_PATHS: Record<string, string> = {
  overview: 'M4 19V5m0 14h16M8 19v-6m4 6V8m4 11v-4',
  matches: 'M4 6h16M4 12h16M4 18h10',
  calendar: 'M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 10h16M8 4v3m8-3v3',
  resume: 'M7 4h7l4 4v12H7zM14 4v4h4M9.5 12h5m-5 3h5',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.4-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.4l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 11a2 2 0 1 1 0 4z',
  plus: 'M12 5v14M5 12h14',
  edit: 'M4 20h4l10-10-4-4L4 16zM14 6l4 4',
  trash: 'M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6m4-6v6',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  image: 'M4 6h16v12H4zM4 16l4-4 3 3 3-3 6 6M9 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  back: 'M4 12h16M4 12l6-6M4 12l6 6',
  play: 'M8 5l11 7-11 7z',
  pause: 'M9 5v14M15 5v14',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  check: 'M5 13l4 4L19 7',
  close: 'M6 6l12 12M18 6L6 18',
  download: 'M12 4v10m0 0l-4-4m4 4l4-4M5 19h14',
  upload: 'M12 20V10m0 0L8 14m4-4l4 4M5 5h14',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  trophy: 'M8 4h8v4a4 4 0 0 1-8 0zM8 6H5v2a3 3 0 0 0 3 3M16 6h3v2a3 3 0 0 1-3 3M10 12v3h4v-3M8 20h8M10 17h4v3h-4z'
}

export function Icon({ name, className }: { name: string; className?: string }): React.ReactElement {
  const d = ICON_PATHS[name] ?? ICON_PATHS.matches
  return (
    <svg
      className={className ?? 'nav__icon'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  )
}

/* ---------- 按钮 ---------- */

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'ghost' | 'danger'
  size?: 'md' | 'sm'
  icon?: string
  testId?: string
}

export function Button({
  variant = 'default',
  size = 'md',
  icon,
  children,
  className,
  testId,
  ...rest
}: ButtonProps): React.ReactElement {
  const cls = [
    'btn',
    variant === 'primary' ? 'btn--primary' : '',
    variant === 'ghost' ? 'btn--ghost' : '',
    variant === 'danger' ? 'btn--danger' : '',
    size === 'sm' ? 'btn--sm' : '',
    className ?? ''
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <button type="button" className={cls} data-testid={testId} {...rest}>
      {icon ? <Icon name={icon} className="nav__icon" /> : null}
      {children}
    </button>
  )
}

/* ---------- 分段控件 ---------- */

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  testId?: string
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  testId
}: {
  value: T
  options: Array<SegmentedOption<T>>
  onChange: (v: T) => void
  testId?: string
}): React.ReactElement {
  return (
    <div className="seg" data-testid={testId} role="group">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`seg__item${o.value === value ? ' is-active' : ''}`}
          onClick={() => onChange(o.value)}
          data-testid={o.testId}
          aria-pressed={o.value === value}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ---------- 表单字段 ---------- */

export function Field({
  label,
  hint,
  error,
  children,
  className
}: {
  label?: string
  hint?: string
  error?: string
  children: React.ReactNode
  className?: string
}): React.ReactElement {
  return (
    <div className={['field', className ?? ''].filter(Boolean).join(' ')}>
      {label ? <label className="field__label">{label}</label> : null}
      {children}
      {error ? <span className="field__error">{error}</span> : null}
      {!error && hint ? <span className="field__hint">{hint}</span> : null}
    </div>
  )
}

export interface TextInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  testId?: string
  ref?: React.Ref<HTMLInputElement>
}

export function TextInput({ testId, className, ...rest }: TextInputProps): React.ReactElement {
  return <input className={['input', className ?? ''].filter(Boolean).join(' ')} data-testid={testId} {...rest} />
}

export function TextArea({
  testId,
  className,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { testId?: string }): React.ReactElement {
  return <textarea className={['textarea', className ?? ''].filter(Boolean).join(' ')} data-testid={testId} {...rest} />
}

export function Select({
  testId,
  className,
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement> & { testId?: string }): React.ReactElement {
  return (
    <select className={['select', className ?? ''].filter(Boolean).join(' ')} data-testid={testId} {...rest}>
      {children}
    </select>
  )
}

const CUSTOM_SENTINEL = '__custom__'

export interface ComboBoxProps {
  value: string
  options: string[]
  onChange: (v: string) => void
  /** 允许留空（会多一个「不填写」选项） */
  allowEmpty?: boolean
  emptyLabel?: string
  /** 提供后，选择「手动输入…」会走这里记住新项 */
  onCreate?: (v: string) => Promise<void> | void
  testId?: string
  customLabel?: string
}

/** 可选可填的下拉：选项来自数据库（含历史新增项），也支持手动输入并记住 */
export function ComboBox({
  value,
  options,
  onChange,
  allowEmpty,
  emptyLabel = '不填写',
  onCreate,
  testId,
  customLabel = '＋ 手动输入…'
}: ComboBoxProps): React.ReactElement {
  const [custom, setCustom] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (custom) inputRef.current?.focus()
  }, [custom])

  const known = Array.from(new Set(options.filter((o) => o !== '')))
  const hasValue = value !== '' && !known.includes(value)

  const handleSelect = (v: string): void => {
    if (v === CUSTOM_SENTINEL) {
      setDraft('')
      setCustom(true)
      return
    }
    onChange(v)
  }

  const confirmCustom = async (): Promise<void> => {
    const v = draft.trim()
    if (!v) {
      setCustom(false)
      return
    }
    if (onCreate) await onCreate(v)
    onChange(v)
    setCustom(false)
    setDraft('')
  }

  if (custom) {
    return (
      <div className="combo-custom">
        <TextInput
          ref={inputRef}
          value={draft}
          placeholder="输入新选项后点「确定」"
          data-testid={testId ? `${testId}-input` : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void confirmCustom()
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              setCustom(false)
            }
          }}
        />
        <Button size="sm" variant="primary" onClick={() => void confirmCustom()} data-testid={testId ? `${testId}-confirm` : undefined}>
          确定
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setCustom(false)}>
          取消
        </Button>
      </div>
    )
  }

  return (
    <Select value={value} data-testid={testId} onChange={(e) => handleSelect(e.target.value)}>
      {allowEmpty ? <option value="">{emptyLabel}</option> : null}
      {!allowEmpty && value === '' ? <option value="">请选择…</option> : null}
      {hasValue ? <option value={value}>{value}</option> : null}
      {known.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
      {onCreate ? <option value={CUSTOM_SENTINEL}>{customLabel}</option> : null}
    </Select>
  )
}

export function Checkbox({
  checked,
  onChange,
  label,
  testId
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  testId?: string
}): React.ReactElement {
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={checked}
        data-testid={testId}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  )
}

/* ---------- 徽标 ---------- */

export function StatusBadge({ status, testId }: { status: MatchStatus; testId?: string }): React.ReactElement {
  return (
    <span className={`badge ${statusClass(status)}`} data-testid={testId}>
      {status}
    </span>
  )
}

export function CategoryBadge({
  category,
  testId
}: {
  category: MatchCategory
  testId?: string
}): React.ReactElement {
  return (
    <span className={`badge ${categoryClass(category)}`} data-testid={testId}>
      {category}
    </span>
  )
}

/* ---------- 容器 ---------- */

export function Panel({
  title,
  desc,
  actions,
  children,
  pad = true,
  testId
}: {
  title?: string
  desc?: string
  actions?: React.ReactNode
  children: React.ReactNode
  pad?: boolean
  testId?: string
}): React.ReactElement {
  return (
    <section className="panel" data-testid={testId}>
      {title ? (
        <div className="panel__head">
          <div>
            <div className="panel__title">{title}</div>
            {desc ? <div className="panel__desc">{desc}</div> : null}
          </div>
          {actions ? <div className="row">{actions}</div> : null}
        </div>
      ) : null}
      <div className={pad ? 'panel__body' : ''}>{children}</div>
    </section>
  )
}

export function StatCard({
  label,
  value,
  foot,
  tone = 'plain',
  testId
}: {
  label: string
  value: React.ReactNode
  foot?: React.ReactNode
  tone?: 'plain' | 'win' | 'loss' | 'accent' | 'muted'
  testId?: string
}): React.ReactElement {
  const cls = ['stat', tone !== 'plain' ? `stat--${tone}` : ''].filter(Boolean).join(' ')
  return (
    <div className={cls} data-testid={testId}>
      <div className="stat__label">{label}</div>
      <div className="stat__value">{value}</div>
      {foot ? <div className="stat__foot">{foot}</div> : null}
    </div>
  )
}

export function EmptyState({
  text,
  action
}: {
  text: string
  action?: React.ReactNode
}): React.ReactElement {
  return (
    <div className="empty">
      <div>{text}</div>
      {action ? <div style={{ marginTop: 10 }}>{action}</div> : null}
    </div>
  )
}

export function PageHead({
  title,
  sub,
  actions
}: {
  title: string
  sub?: string
  actions?: React.ReactNode
}): React.ReactElement {
  return (
    <header className="page-head">
      <div>
        <h1 className="page-head__title">{title}</h1>
        {sub ? <div className="page-head__sub">{sub}</div> : null}
      </div>
      {actions ? <div className="page-head__actions">{actions}</div> : null}
    </header>
  )
}
