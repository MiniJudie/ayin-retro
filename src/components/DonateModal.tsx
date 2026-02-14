'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useWallet } from '@alephium/web3-react'
import { sendEvent } from '@socialgouv/matomo-next'
import { useWalletBalance } from '@/contexts/WalletBalanceContext'
import { executeDonate } from '@/lib/donate'
import { DONATION_ADDRESS, EXPLORER_URL, ALPH_TOKEN_ID, NODE_URL } from '@/lib/config'
import { web3 } from '@alephium/web3'
import type { TokenInfo } from '@/lib/types'

const ALPH_PLACEHOLDER: TokenInfo = {
  id: ALPH_TOKEN_ID,
  name: 'Alephium',
  symbol: 'ALPH',
  decimals: 18,
  logoURI: 'https://raw.githubusercontent.com/alephium/token-list/master/logos/ALPH.png',
}

function formatAmount(amount: bigint, decimals: number): string {
  const s = amount.toString()
  if (s.length <= decimals) return '0.' + s.padStart(decimals, '0').slice(0, Math.min(decimals, 6))
  const int = s.slice(0, -decimals)
  const frac = s.slice(-decimals).replace(/0+$/, '').slice(0, 6)
  return frac ? `${int}.${frac}` : int
}

function parseAmount(value: string, decimals: number): bigint | null {
  if (!value || !/^[0-9.]*$/.test(value)) return null
  const [int = '0', frac = ''] = value.split('.')
  const fracPadded = frac.slice(0, decimals).padEnd(decimals, '0')
  const combined = int + fracPadded
  if (combined.length > 50) return null
  return BigInt(combined)
}

export function DonateModal({ onClose }: { onClose: () => void }) {
  const { account, signer } = useWallet()
  const { balances } = useWalletBalance()
  const [tokens, setTokens] = useState<TokenInfo[]>([])
  const [selectedId, setSelectedId] = useState<string>(ALPH_TOKEN_ID)
  const [amount, setAmount] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [txId, setTxId] = useState<string | null>(null)

  useEffect(() => {
    web3.setCurrentNodeProvider(NODE_URL)
  }, [])

  useEffect(() => {
    fetch('/api/tokens')
      .then((r) => r.json())
      .then((list: TokenInfo[]) => {
        const hasAlph = list.some((t) => t.id === ALPH_TOKEN_ID)
        setTokens(hasAlph ? list : [ALPH_PLACEHOLDER, ...list])
      })
      .catch(() => setTokens([ALPH_PLACEHOLDER]))
  }, [])

  const selectedToken = useMemo(
    () => tokens.find((t) => t.id === selectedId) ?? ALPH_PLACEHOLDER,
    [tokens, selectedId]
  )
  const isAlph = selectedId === ALPH_TOKEN_ID
  const balanceRaw = useMemo(() => {
    if (!balances) return null
    if (isAlph) return balances.alph
    const key = selectedId.toLowerCase().replace(/^0x/, '')
    return balances.tokens.get(key) ?? balances.tokens.get(selectedId) ?? BigInt(0)
  }, [balances, selectedId, isAlph])
  const balanceStr = balanceRaw != null ? formatAmount(balanceRaw, selectedToken.decimals) : '—'
  const amountBig = parseAmount(amount, selectedToken.decimals)
  const canDonate = Boolean(
    account?.address &&
      signer &&
      amountBig &&
      amountBig > BigInt(0) &&
      balanceRaw != null &&
      amountBig <= balanceRaw &&
      !pending
  )

  const handleMax = useCallback(() => {
    if (balanceRaw != null && balanceRaw > BigInt(0)) {
      setAmount(formatAmount(balanceRaw, selectedToken.decimals))
    }
  }, [balanceRaw, selectedToken.decimals])

  const handleDonate = useCallback(async () => {
    if (!canDonate || !account?.address || !signer || !amountBig) return
    setError(null)
    setPending(true)
    try {
      const { txId: id } = await executeDonate(
        signer,
        account.address,
        isAlph,
        isAlph ? null : selectedId,
        amountBig
      )
      sendEvent({
        category: 'donate',
        action: 'send',
        name: selectedToken.symbol,
        value: amount,
      })
      setTxId(id)
      setAmount('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Donation failed')
    } finally {
      setPending(false)
    }
  }, [canDonate, account?.address, signer, amountBig, isAlph, selectedId, selectedToken.symbol, amount])

  const assetsWithBalance = useMemo(() => {
    if (!balances) return [ALPH_PLACEHOLDER]
    const out: TokenInfo[] = []
    if (balances.alph > BigInt(0)) out.push(ALPH_PLACEHOLDER)
    for (const t of tokens) {
      if (t.id === ALPH_TOKEN_ID) continue
      const key = t.id.toLowerCase().replace(/^0x/, '')
      const amt = balances.tokens.get(key) ?? balances.tokens.get(t.id) ?? BigInt(0)
      if (amt > BigInt(0)) out.push(t)
    }
    return out.length ? out : [ALPH_PLACEHOLDER]
  }, [tokens, balances])

  if (!account?.address) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
        <div
          className="w-full max-w-md rounded-2xl border border-[var(--card-border)] bg-[var(--card)] p-6 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">Donate</h3>
            <button type="button" onClick={onClose} className="rounded p-1 text-[var(--muted)] hover:bg-white/10 hover:text-white" aria-label="Close">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <p className="text-center text-sm text-[var(--muted)]">Connect your wallet to send a donation.</p>
        </div>
      </div>
    )
  }

  if (txId) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
        <div
          className="w-full max-w-md rounded-2xl border border-[var(--card-border)] bg-[var(--card)] p-6 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="mb-4 text-center font-medium text-white">Thank you for your donation!</p>
          <a
            href={`${EXPLORER_URL}/transactions/${txId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mb-4 flex w-full items-center justify-center rounded-xl bg-[var(--accent)] py-3 font-medium text-white hover:bg-[var(--accent-hover)]"
          >
            View transaction
          </a>
          <button type="button" onClick={onClose} className="w-full rounded-xl border border-[var(--card-border)] py-2.5 text-sm font-medium text-[var(--muted)] hover:bg-white/5 hover:text-white">
            Close
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-[var(--card-border)] bg-[var(--card)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Donate</h3>
          <button type="button" onClick={onClose} className="rounded p-1 text-[var(--muted)] hover:bg-white/10 hover:text-white" aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p className="mb-3 text-xs text-[var(--muted)]">
          <p>Send any token from your wallet to support Ayin Retro.</p>
          <div>
           Recipient:{' '}
             <span className="mt-1 inline-block px-2 py-1.5 font-mono text-xs text-white break-all">
              {DONATION_ADDRESS}
            </span>
          </div>
        </p>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-[var(--muted)]">Token</label>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-white"
            >
              {assetsWithBalance.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.symbol}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--muted)]">Amount</label>
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="decimal"
                placeholder="0.0"
                value={amount}
                onChange={(e) => {
                  const v = e.target.value.replace(/,/g, '.')
                  if (/^[0-9.]*$/.test(v) || v === '') setAmount(v)
                }}
                className="min-w-0 flex-1 rounded-lg border border-[var(--card-border)] bg-[var(--input-bg)] px-3 py-2 font-mono text-sm text-white placeholder:text-[var(--muted)]"
              />
              <button
                type="button"
                onClick={handleMax}
                className="rounded-lg border border-[var(--card-border)] px-3 py-2 text-xs text-[var(--muted)] hover:bg-white/5 hover:text-white"
              >
                Max
              </button>
            </div>
            <p className="mt-1 text-xs text-[var(--muted)]">Balance: {balanceStr}</p>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            type="button"
            onClick={handleDonate}
            disabled={!canDonate}
            className="w-full rounded-xl bg-[var(--accent)] py-3 font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
          >
            {pending ? 'Sending…' : 'Send donation'}
          </button>
        </div>
      </div>
    </div>
  )
}
