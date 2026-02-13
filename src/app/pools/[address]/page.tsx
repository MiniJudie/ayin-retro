'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useWallet } from '@alephium/web3-react'
import { web3 } from '@alephium/web3'
import { Header } from '@/components/Header'
import type { PoolInfo } from '@/lib/types'
import { getPoolState } from '@/lib/poolState'
import {
  getLiquidityMinted,
  getAmountsForLiquidity,
  executeAddLiquidity,
  executeRemoveLiquidity,
} from '@/lib/liquidity'
import { useWalletBalance } from '@/contexts/WalletBalanceContext'
import { getLpBalance } from '@/lib/poolUtils'
import { EXPLORER_URL, NODE_URL } from '@/lib/config'

const LP_DECIMALS = 18

function formatAmount(amount: bigint, decimals: number): string {
  const s = amount.toString()
  if (s.length <= decimals) return '0.' + s.padStart(decimals, '0').slice(0, decimals)
  const int = s.slice(0, -decimals)
  const frac = s.slice(-decimals).replace(/0+$/, '')
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

export default function PoolManagePage() {
  const params = useParams()
  const address = typeof params?.address === 'string' ? params.address : ''
  const { account, signer } = useWallet()

  const [pool, setPool] = useState<PoolInfo | null>(null)
  const [poolState, setPoolState] = useState<{ reserve0: string; reserve1: string; totalSupply: string } | null>(null)
  const { balances: allBalances, refreshBalances } = useWalletBalance()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Add liquidity
  const [addAmount0, setAddAmount0] = useState('')
  const [addAmount1, setAddAmount1] = useState('')
  const [addPending, setAddPending] = useState(false)

  // Remove liquidity
  const [removeAmount, setRemoveAmount] = useState('')
  const [removePending, setRemovePending] = useState(false)

  const [lastTxId, setLastTxId] = useState<string | null>(null)
  const [lastTxAction, setLastTxAction] = useState<'add' | 'remove' | null>(null)

  useEffect(() => {
    web3.setCurrentNodeProvider(NODE_URL)
  }, [])

  useEffect(() => {
    if (!address) {
      setLoading(false)
      setPool(null)
      return
    }
    setLoading(true)
    fetch('/api/pools')
      .then((r) => r.json())
      .then((list: PoolInfo[]) => {
        const p = list.find((x) => x.address.toLowerCase() === address.toLowerCase())
        setPool(p ?? null)
        setError(p ? null : 'Pool not found')
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Failed to load pool')
        setPool(null)
      })
      .finally(() => setLoading(false))
  }, [address])

  useEffect(() => {
    if (!pool?.address) {
      setPoolState(null)
      return
    }
    getPoolState(pool.address, pool?.poolType).then((state) => {
      if (state?.reserve0 && state?.reserve1 && state?.totalSupply) {
        setPoolState({
          reserve0: state.reserve0,
          reserve1: state.reserve1,
          totalSupply: state.totalSupply,
        })
      } else {
        setPoolState(null)
      }
    })
  }, [pool?.address, pool?.poolType])

  const lpBalanceRaw = useMemo(
    () => getLpBalance(allBalances ?? null, pool?.address ?? ''),
    [allBalances, pool?.address]
  )

  const lpBalanceStr = lpBalanceRaw != null ? formatAmount(lpBalanceRaw, LP_DECIMALS) : '—'
  const totalSupplyBig = poolState?.totalSupply ? BigInt(poolState.totalSupply) : BigInt(0)
  const sharePercent =
    totalSupplyBig > BigInt(0) && lpBalanceRaw != null && lpBalanceRaw > BigInt(0)
      ? Number((lpBalanceRaw * BigInt(10000)) / totalSupplyBig) / 100
      : 0

  const reserve0Big = poolState ? BigInt(poolState.reserve0) : BigInt(0)
  const reserve1Big = poolState ? BigInt(poolState.reserve1) : BigInt(0)

  const addAmount0Big = parseAmount(addAmount0, pool?.token0.decimals ?? 18)
  const addAmount1Big = parseAmount(addAmount1, pool?.token1.decimals ?? 18)

  const estimatedLp = useMemo(() => {
    if (!poolState || !addAmount0Big || !addAmount1Big || addAmount0Big === BigInt(0) || addAmount1Big === BigInt(0))
      return null
    const ts = BigInt(poolState.totalSupply)
    if (ts === BigInt(0)) return null
    return getLiquidityMinted(addAmount0Big, addAmount1Big, reserve0Big, reserve1Big, ts)
  }, [poolState, addAmount0Big, addAmount1Big, reserve0Big, reserve1Big])

  const token0BalanceRaw = useMemo(() => {
    if (!allBalances || !pool) return null
    if (pool.token0.id === '0000000000000000000000000000000000000000000000000000000000000000') return allBalances.alph
    return allBalances.tokens.get(pool.token0.id.toLowerCase()) ?? BigInt(0)
  }, [allBalances, pool])
  const token1BalanceRaw = useMemo(() => {
    if (!allBalances || !pool) return null
    if (pool.token1.id === '0000000000000000000000000000000000000000000000000000000000000000') return allBalances.alph
    return allBalances.tokens.get(pool.token1.id.toLowerCase()) ?? BigInt(0)
  }, [allBalances, pool])

  const syncAddAmount1FromRatio = useCallback(() => {
    if (!poolState || reserve0Big === BigInt(0) || !addAmount0) return
    const a0 = parseAmount(addAmount0, pool?.token0.decimals ?? 18)
    if (!a0) return
    const a1 = (a0 * reserve1Big) / reserve0Big
    setAddAmount1(formatAmount(a1, pool?.token1.decimals ?? 18))
  }, [poolState, reserve0Big, reserve1Big, addAmount0, pool?.token0.decimals, pool?.token1.decimals])

  const syncAddAmount0FromRatio = useCallback(() => {
    if (!poolState || reserve1Big === BigInt(0) || !addAmount1) return
    const a1 = parseAmount(addAmount1, pool?.token1.decimals ?? 18)
    if (!a1) return
    const a0 = (a1 * reserve0Big) / reserve1Big
    setAddAmount0(formatAmount(a0, pool?.token0.decimals ?? 18))
  }, [poolState, reserve0Big, reserve1Big, addAmount1, pool?.token0.decimals, pool?.token1.decimals])

  const handleAddAmount0Change = (v: string) => {
    setAddAmount0(v)
    if (v && poolState && reserve0Big > BigInt(0)) {
      const a0 = parseAmount(v, pool?.token0.decimals ?? 18)
      if (a0) setAddAmount1(formatAmount((a0 * reserve1Big) / reserve0Big, pool?.token1.decimals ?? 18))
    }
  }
  const handleAddAmount1Change = (v: string) => {
    setAddAmount1(v)
    if (v && poolState && reserve1Big > BigInt(0)) {
      const a1 = parseAmount(v, pool?.token1.decimals ?? 18)
      if (a1) setAddAmount0(formatAmount((a1 * reserve0Big) / reserve1Big, pool?.token0.decimals ?? 18))
    }
  }

  const handleAddMax0 = useCallback(() => {
    if (token0BalanceRaw == null || token0BalanceRaw === BigInt(0) || !pool) return
    const formatted = formatAmount(token0BalanceRaw, pool.token0.decimals)
    setAddAmount0(formatted)
    if (poolState && reserve0Big > BigInt(0)) {
      setAddAmount1(formatAmount((token0BalanceRaw * reserve1Big) / reserve0Big, pool.token1.decimals))
    }
  }, [token0BalanceRaw, pool, poolState, reserve0Big, reserve1Big])

  const handleAddMax1 = useCallback(() => {
    if (token1BalanceRaw == null || token1BalanceRaw === BigInt(0) || !pool) return
    const formatted = formatAmount(token1BalanceRaw, pool.token1.decimals)
    setAddAmount1(formatted)
    if (poolState && reserve1Big > BigInt(0)) {
      setAddAmount0(formatAmount((token1BalanceRaw * reserve0Big) / reserve1Big, pool.token0.decimals))
    }
  }, [token1BalanceRaw, pool, poolState, reserve0Big, reserve1Big])

  const canAdd =
    pool &&
    signer &&
    account?.address &&
    addAmount0Big &&
    addAmount1Big &&
    addAmount0Big > BigInt(0) &&
    addAmount1Big > BigInt(0) &&
    (!token0BalanceRaw || token0BalanceRaw >= addAmount0Big) &&
    (!token1BalanceRaw || token1BalanceRaw >= addAmount1Big)

  const handleAddLiquidity = useCallback(async () => {
    if (!canAdd || !pool || !signer || !account?.address) return
    setError(null)
    setAddPending(true)
    try {
      const { txId } = await executeAddLiquidity(
        pool.address,
        signer,
        account.address,
        pool.token0.id,
        pool.token1.id,
        addAmount0Big!,
        addAmount1Big!
      )
      setLastTxId(txId)
      setLastTxAction('add')
      setAddAmount0('')
      setAddAmount1('')
      getPoolState(pool.address, pool.poolType).then((s) => {
        if (s) setPoolState((prev) => (prev ? { ...prev, reserve0: s.reserve0, reserve1: s.reserve1, totalSupply: s.totalSupply ?? prev.totalSupply } : { reserve0: s.reserve0, reserve1: s.reserve1, totalSupply: s.totalSupply ?? '0' }))
      })
      await refreshBalances()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Add liquidity failed')
    } finally {
      setAddPending(false)
    }
  }, [canAdd, pool, signer, account?.address, addAmount0Big, addAmount1Big, poolState, refreshBalances])

  const removeAmountBig = parseAmount(removeAmount, LP_DECIMALS)
  const [estimated0, estimated1] = useMemo(() => {
    if (!removeAmountBig || removeAmountBig === BigInt(0) || totalSupplyBig === BigInt(0))
      return [BigInt(0), BigInt(0)]
    return getAmountsForLiquidity(removeAmountBig, reserve0Big, reserve1Big, totalSupplyBig)
  }, [removeAmountBig, totalSupplyBig, reserve0Big, reserve1Big])

  const canRemove =
    pool &&
    signer &&
    account?.address &&
    removeAmountBig &&
    removeAmountBig > BigInt(0) &&
    lpBalanceRaw != null &&
    removeAmountBig <= lpBalanceRaw

  const handleRemoveLiquidity = useCallback(async () => {
    if (!canRemove || !pool || !signer || !account?.address) return
    setError(null)
    setRemovePending(true)
    try {
      const { txId } = await executeRemoveLiquidity(pool.address, signer, account.address, removeAmountBig!)
      setLastTxId(txId)
      setLastTxAction('remove')
      setRemoveAmount('')
      getPoolState(pool.address, pool.poolType).then((s) => {
        if (s) setPoolState((prev) => (prev ? { ...prev, reserve0: s.reserve0, reserve1: s.reserve1, totalSupply: s.totalSupply ?? prev.totalSupply } : { reserve0: s.reserve0, reserve1: s.reserve1, totalSupply: s.totalSupply ?? '0' }))
      })
      await refreshBalances()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Remove liquidity failed')
    } finally {
      setRemovePending(false)
    }
  }, [canRemove, pool, signer, account?.address, removeAmountBig, refreshBalances])

  const handleMaxRemove = () => {
    if (lpBalanceRaw != null && lpBalanceRaw > BigInt(0)) setRemoveAmount(formatAmount(lpBalanceRaw, LP_DECIMALS))
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--background)]">
        <Header />
        <main className="pt-28 pb-12 px-4">
          <div className="mx-auto max-w-2xl text-center text-[var(--muted)]">Loading pool…</div>
        </main>
      </div>
    )
  }

  if (!pool || error) {
    return (
      <div className="min-h-screen bg-[var(--background)]">
        <Header />
        <main className="pt-28 pb-12 px-4">
          <div className="mx-auto max-w-2xl rounded-2xl border border-[var(--card-border)] bg-[var(--card)] p-8 text-center">
            <p className="text-red-400">{error ?? 'Pool not found'}</p>
            <Link href="/" className="mt-4 inline-block text-[var(--accent)] hover:underline">
              ← Back to Pools
            </Link>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <Header />
      <main className="pt-28 pb-12 px-4">
        <div className="mx-auto w-full max-w-2xl">
          <Link href="/" className="mb-6 inline-flex items-center gap-1 text-sm text-[var(--muted)] hover:text-white">
            ← Back to Pools
          </Link>

          <div className="mb-8 flex items-center gap-3">
            {pool.token0.logoURI && <img src={pool.token0.logoURI} alt="" className="h-10 w-10 rounded-full" />}
            {pool.token1.logoURI && (
              <img src={pool.token1.logoURI} alt="" className="-ml-2 h-10 w-10 rounded-full ring-2 ring-[var(--background)]" />
            )}
            <div>
              <h1 className="text-2xl font-bold text-white">
                {pool.token0.symbol} / {pool.token1.symbol}
              </h1>
              <p className="text-sm text-[var(--muted)]">Manage liquidity</p>
            </div>
          </div>

          {error && (
            <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Your position */}
          <section className="mb-8 rounded-2xl border border-[var(--card-border)] bg-[var(--card)] p-6">
            <h2 className="mb-4 text-lg font-semibold text-white">Your position</h2>
            {account?.address ? (
              <>
                <div className="flex items-baseline justify-between">
                  <span className="text-[var(--muted)]">LP balance</span>
                  <span className="font-mono text-white">{lpBalanceStr}</span>
                </div>
                {sharePercent > 0 && (
                  <div className="mt-2 flex items-baseline justify-between">
                    <span className="text-[var(--muted)]">Share of pool</span>
                    <span className="font-mono text-white">{sharePercent.toFixed(4)}%</span>
                  </div>
                )}
                {lpBalanceRaw === BigInt(0) && (
                  <p className="mt-2 text-sm text-[var(--muted)]">You have no liquidity in this pool.</p>
                )}
              </>
            ) : (
              <p className="text-sm text-[var(--muted)]">Connect your wallet to see your position.</p>
            )}
          </section>

          {/* Remove liquidity */}
          <section className="mb-8 rounded-2xl border border-[var(--card-border)] bg-[var(--card)] p-6">
            <h2 className="mb-4 text-lg font-semibold text-white">Remove liquidity</h2>
            <p className="mb-4 text-sm text-[var(--muted)]">
              Burn LP tokens to receive {pool.token0.symbol} and {pool.token1.symbol} back.
            </p>
            <div className="space-y-4">
              <div className="rounded-2xl bg-[var(--input-bg)] p-4">
                <div className="mb-1 text-xs text-[var(--muted)]">LP tokens</div>
                <div className="flex items-center justify-between gap-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0.0"
                    value={removeAmount}
                    onChange={(e) => {
                      const v = e.target.value.replace(/,/g, '.')
                      if (/^[0-9.]*$/.test(v) || v === '') setRemoveAmount(v)
                    }}
                    className="min-w-0 flex-1 bg-transparent text-xl font-medium text-white outline-none placeholder:text-[var(--muted)]"
                  />
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-white">LP</span>
                    <button
                      type="button"
                      onClick={handleMaxRemove}
                      className="rounded px-2 py-1 text-xs font-medium text-[var(--accent)] hover:bg-white/10"
                    >
                      Max
                    </button>
                  </div>
                </div>
                {account?.address && (
                  <div className="mt-1 text-right text-xs text-[var(--muted)]">Balance: {lpBalanceStr}</div>
                )}
              </div>
              {(estimated0 > BigInt(0) || estimated1 > BigInt(0)) && (
                <div className="rounded-xl bg-[var(--input-bg)] p-3 text-sm text-[var(--muted)]">
                  You will receive approximately:{' '}
                  {formatAmount(estimated0, pool.token0.decimals)} {pool.token0.symbol},{' '}
                  {formatAmount(estimated1, pool.token1.decimals)} {pool.token1.symbol}
                </div>
              )}
              {lastTxId && lastTxAction === 'remove' && (
                <a
                  href={`${EXPLORER_URL}/transactions/${lastTxId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-xl border border-[var(--card-border)] bg-[var(--card)] px-4 py-2.5 text-center text-sm font-medium text-[var(--accent)] hover:bg-white/5 hover:underline"
                >
                  View transaction in explorer →
                </a>
              )}
              <button
                type="button"
                onClick={handleRemoveLiquidity}
                disabled={!canRemove || removePending}
                className="w-full rounded-xl border border-[var(--card-border)] py-3 font-medium text-white transition-colors hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {removePending ? 'Removing…' : 'Remove liquidity'}
              </button>
            </div>
          </section>

          {/* Add liquidity */}
          <section className="rounded-2xl border border-[var(--card-border)] bg-[var(--card)] p-6">
            <h2 className="mb-4 text-lg font-semibold text-white">Add liquidity</h2>
            <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
              <strong>Warning:</strong> This pool is not maintained. Do not add new liquidity — use it only to remove existing positions.
            </div>
            <p className="mb-4 text-sm text-[var(--muted)]">
              Deposit both tokens in the pool ratio. You will receive LP tokens (same contract as the pool).
            </p>
            <div className="space-y-4">
              <div className="rounded-2xl bg-[var(--input-bg)] p-4">
                <div className="mb-1 text-xs text-[var(--muted)]">{pool.token0.symbol}</div>
                <div className="flex items-center justify-between gap-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0.0"
                    value={addAmount0}
                    onChange={(e) => {
                      const v = e.target.value.replace(/,/g, '.')
                      if (/^[0-9.]*$/.test(v) || v === '') handleAddAmount0Change(v)
                    }}
                    className="min-w-0 flex-1 bg-transparent text-xl font-medium text-white outline-none placeholder:text-[var(--muted)]"
                  />
                  <div className="flex items-center gap-2">
                    {pool.token0.logoURI && <img src={pool.token0.logoURI} alt="" className="h-6 w-6 rounded-full" />}
                    <span className="font-medium text-white">{pool.token0.symbol}</span>
                  </div>
                </div>
                {token0BalanceRaw != null && (
                  <div className="mt-1 flex items-center justify-end gap-2 text-xs text-[var(--muted)]">
                    <span>Balance: {formatAmount(token0BalanceRaw, pool.token0.decimals)}</span>
                    <button
                      type="button"
                      onClick={handleAddMax0}
                      disabled={!token0BalanceRaw || token0BalanceRaw === BigInt(0)}
                      className="rounded px-1.5 py-0.5 font-medium text-[var(--accent)] hover:bg-white/5 hover:text-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Max
                    </button>
                  </div>
                )}
              </div>
              <div className="rounded-2xl bg-[var(--input-bg)] p-4">
                <div className="mb-1 text-xs text-[var(--muted)]">{pool.token1.symbol}</div>
                <div className="flex items-center justify-between gap-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0.0"
                    value={addAmount1}
                    onChange={(e) => {
                      const v = e.target.value.replace(/,/g, '.')
                      if (/^[0-9.]*$/.test(v) || v === '') handleAddAmount1Change(v)
                    }}
                    className="min-w-0 flex-1 bg-transparent text-xl font-medium text-white outline-none placeholder:text-[var(--muted)]"
                  />
                  <div className="flex items-center gap-2">
                    {pool.token1.logoURI && <img src={pool.token1.logoURI} alt="" className="h-6 w-6 rounded-full" />}
                    <span className="font-medium text-white">{pool.token1.symbol}</span>
                  </div>
                </div>
                {token1BalanceRaw != null && (
                  <div className="mt-1 flex items-center justify-end gap-2 text-xs text-[var(--muted)]">
                    <span>Balance: {formatAmount(token1BalanceRaw, pool.token1.decimals)}</span>
                    <button
                      type="button"
                      onClick={handleAddMax1}
                      disabled={!token1BalanceRaw || token1BalanceRaw === BigInt(0)}
                      className="rounded px-1.5 py-0.5 font-medium text-[var(--accent)] hover:bg-white/5 hover:text-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Max
                    </button>
                  </div>
                )}
              </div>
              {estimatedLp != null && estimatedLp > BigInt(0) && (
                <p className="text-sm text-[var(--muted)]">
                  You will receive ~{formatAmount(estimatedLp, LP_DECIMALS)} LP tokens
                </p>
              )}
              {lastTxId && lastTxAction === 'add' && (
                <a
                  href={`${EXPLORER_URL}/transactions/${lastTxId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-xl border border-[var(--card-border)] bg-[var(--card)] px-4 py-2.5 text-center text-sm font-medium text-[var(--accent)] hover:bg-white/5 hover:underline"
                >
                  View transaction in explorer →
                </a>
              )}
              <button
                type="button"
                onClick={handleAddLiquidity}
                disabled={!canAdd || addPending}
                className="w-full rounded-xl bg-[var(--accent)] py-3 font-medium text-white transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {addPending ? 'Adding…' : 'Add liquidity'}
              </button>
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}
