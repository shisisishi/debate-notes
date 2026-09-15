/** 弹窗与确认框。 */

import React, { useEffect } from 'react'
import { Button, Icon } from './ui'

export function Modal({
  title,
  onClose,
  children,
  footer,
  size = 'md',
  testId
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  size?: 'md' | 'sm'
  testId?: string
}): React.ReactElement {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="modal-mask"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className={`modal${size === 'sm' ? ' modal--sm' : ''}`} role="dialog" aria-modal="true" data-testid={testId}>
        <div className="modal__head">
          <div className="modal__title">{title}</div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="关闭" data-testid="modal-close">
            <Icon name="close" />
          </Button>
        </div>
        <div className="modal__body">{children}</div>
        {footer ? <div className="modal__foot">{footer}</div> : null}
      </div>
    </div>
  )
}

export function ConfirmDialog({
  title,
  message,
  detail,
  confirmLabel = '确认删除',
  cancelLabel = '取消',
  danger = true,
  busy = false,
  onConfirm,
  onCancel,
  testId = 'confirm-dialog'
}: {
  title: string
  message: string
  detail?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
  testId?: string
}): React.ReactElement {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      size="sm"
      testId={testId}
      footer={
        <>
          <span className="spacer" />
          <Button onClick={onCancel} data-testid="confirm-cancel">
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={onConfirm}
            disabled={busy}
            data-testid="confirm-ok"
          >
            {busy ? '处理中…' : confirmLabel}
          </Button>
        </>
      }
    >
      <div style={{ fontSize: 14 }}>{message}</div>
      {detail ? (
        <div className="section-note" style={{ marginTop: 10 }}>
          {detail}
        </div>
      ) : null}
    </Modal>
  )
}
