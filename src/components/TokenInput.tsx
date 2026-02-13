'use client'

import type { TokenInfo } from '@/lib/types'

export function TokenInput({
  label,
  token,
  amount,
  onAmountChange,
  onTokenClick,
  balance,
  onMaxClick,
  disabled,
  placeholder = '0.0',
}: {
  label?: string
  token: TokenInfo | null
  amount: string
  onAmountChange: (v: string) => void
  onTokenClick: () => void
  balance?: string
  onMaxClick?: () => void
  disabled?: boolean
  placeholder?: string
}) {
  return (
    <div className="rounded-2xl bg-[var(--input-bg)] p-4">
      {label && (
        <div className="mb-2 text-xs text-[var(--muted)]">{label}</div>
      )}
      <div className="flex items-center justify-between gap-2">
        <input
          type="text"
          inputMode="decimal"
          placeholder={placeholder}
          value={amount}
          onChange={(e) => {
            const v = e.target.value.replace(/,/g, '.')
            if (/^[0-9.]*$/.test(v) || v === '') onAmountChange(v)
          }}
          disabled={disabled}
          className="min-w-0 flex-1 bg-transparent text-2xl font-medium text-white outline-none placeholder:text-[var(--muted)] disabled:opacity-60"
        />
        <button
          type="button"
          onClick={onTokenClick}
          className="flex items-center gap-2 rounded-xl bg-[var(--card)] px-3 py-2.5 font-medium text-white transition-colors hover:bg-white/10"
        >
          {token ? (
            <>
              {token.logoURI ? (
                <img src={token.logoURI} alt="" className="h-6 w-6 rounded-full" />
              ) : (
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--input-bg)] text-xs">
                  {token.symbol.slice(0, 2)}
                </div>
              )}
              <span>{token.symbol}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </>
          ) : (
            <>
              <span className="text-[var(--muted)]">Select</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </>
          )}
        </button>
      </div>
      {(balance !== undefined || onMaxClick) && (
        <div className="mt-2 flex items-center justify-end gap-2 text-xs text-[var(--muted)]">
          {balance !== undefined && <span>Balance: {balance}</span>}
          {onMaxClick && (
            <button
              type="button"
              onClick={onMaxClick}
              className="rounded px-1.5 py-0.5 font-medium text-[var(--accent)] hover:bg-white/5 hover:text-[var(--accent-hover)]"
            >
              Max
            </button>
          )}
        </div>
      )}
    </div>
  )
}
