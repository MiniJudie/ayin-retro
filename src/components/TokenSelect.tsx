'use client'

import { useRef, useEffect } from 'react'
import type { TokenInfo } from '@/lib/types'

function formatBalanceDisplay(val: string | undefined): string {
  if (val == null || val.trim() === '') return '-'
  const n = parseFloat(val.replace(/,/g, ''))
  if (isNaN(n) || n === 0) return '-'
  return val
}

export function TokenSelect({
  tokens,
  balancesFormatted,
  onSelect,
  onClose,
  selectedId,
}: {
  tokens: TokenInfo[]
  balancesFormatted?: Map<string, string>
  onSelect: (t: TokenInfo) => void
  onClose: () => void
  selectedId?: string
}) {
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="max-h-[80vh] w-full max-w-md overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--card)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--card-border)] p-4">
          <h3 className="text-lg font-semibold text-white">Select a token</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-[var(--muted)] hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div ref={listRef} className="max-h-[60vh] overflow-y-auto p-2">
          {tokens.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onSelect(t)}
              className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-white/5 ${
                selectedId === t.id ? 'bg-white/10' : ''
              }`}
            >
              <div className="flex min-w-0 items-center gap-3">
                {t.logoURI ? (
                  <img src={t.logoURI} alt="" className="h-8 w-8 shrink-0 rounded-full" />
                ) : (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--input-bg)] text-xs font-medium text-[var(--muted)]">
                    {t.symbol.slice(0, 2)}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="font-medium text-white">{t.symbol}</div>
                  <div className="truncate text-xs text-[var(--muted)]">{t.name}</div>
                </div>
              </div>
              <div className="shrink-0 text-right text-sm text-[var(--muted)] tabular-nums">
                {formatBalanceDisplay(balancesFormatted?.get(t.id))}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
