/** 右下角提示条。 */

import React from 'react'
import { useStore } from '../store'

export function Toasts(): React.ReactElement | null {
  const { toasts, dismissToast } = useStore()
  if (toasts.length === 0) return null
  return (
    <div className="toasts" data-testid="toasts">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast${t.kind === 'error' ? ' toast--error' : t.kind === 'success' ? ' toast--success' : ''}`}
          onClick={() => dismissToast(t.id)}
          data-testid={`toast-${t.kind}`}
          role="status"
        >
          {t.message}
        </div>
      ))}
    </div>
  )
}
