'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useWallet } from '@alephium/web3-react'
import { web3 } from '@alephium/web3'
import { Header } from '@/components/Header'
import { TokenInput } from '@/components/TokenInput'
import { TokenSelect } from '@/components/TokenSelect'
import { sendEvent } from '@socialgouv/matomo-next'
import { getAmountOut, executeSwap } from '@/lib/swap'
import type { PairState } from '@/lib/swap'
import { getPoolState } from '@/lib/poolState'
import { useWalletBalance } from '@/contexts/WalletBalanceContext'
import { NODE_URL, EXPLORER_URL, ALPH_TOKEN_ID, DEFAULT_SLIPPAGE_BPS } from '@/lib/config'
import type { TokenInfo, PoolInfo } from '@/lib/types'

const RESERVE_ALPH_FOR_GAS = BigInt('1000000000000000') // 0.001 ALPH

const ALPH_PLACEHOLDER: TokenInfo = {
  id: ALPH_TOKEN_ID,
  name: 'Alephium',
  symbol: 'ALPH',
  decimals: 18,
  logoURI: 'https://raw.githubusercontent.com/alephium/token-list/master/logos/ALPH.png',
}

function formatAmount(amount: bigint, decimals: number): string {
  const s = amount.toString()
  if (s.length <= decimals) return '0.' + s.padStart(decimals, '0').slice(0, decimals)
  const int = s.slice(0, -decimals)
  const frac = s.slice(-decimals).replace(/0+$/, '')
  return frac ? `${int}.${frac}` : int
}

/** Convert human-readable amount (e.g. "1.5") to raw bigint (1.5 * 10^decimals). */
function parseAmount(value: string, decimals: number): bigint | null {
  if (!value || !/^[0-9.]*$/.test(value)) return null
  const [int = '0', frac = ''] = value.split('.')
  const fracPadded = frac.slice(0, decimals).padEnd(decimals, '0')
  const combined = int + fracPadded
  if (combined.length > 50) return null
  return BigInt(combined)
}

function SwapContent() {
  const { account, signer, connectionStatus } = useWallet()
  const [tokens, setTokens] = useState<TokenInfo[]>([])
  const [pools, setPools] = useState<PoolInfo[]>([])
  const [tokenIn, setTokenIn] = useState<TokenInfo | null>(ALPH_PLACEHOLDER)
  const [tokenOut, setTokenOut] = useState<TokenInfo | null>(null)
  const [amountIn, setAmountIn] = useState('')
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS)
  const [selecting, setSelecting] = useState<'in' | 'out' | null>(null)
  const [txPending, setTxPending] = useState(false)
  const [txId, setTxId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [poolReserves, setPoolReserves] = useState<{ reserve0: string; reserve1: string } | null>(null)
  const { balances: allBalances } = useWalletBalance()
  const searchParams = useSearchParams()

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

  useEffect(() => {
    const tokenInId = searchParams.get('tokenIn')
    const tokenOutId = searchParams.get('tokenOut')
    if (!tokenInId || !tokenOutId || tokens.length === 0) return
    const tIn = tokens.find((t) => t.id === tokenInId) ?? (tokenInId === ALPH_TOKEN_ID ? ALPH_PLACEHOLDER : null)
    const tOut = tokens.find((t) => t.id === tokenOutId) ?? null
    if (tIn) setTokenIn(tIn)
    if (tOut) setTokenOut(tOut)
  }, [searchParams, tokens])

  useEffect(() => {
    fetch('/api/pools')
      .then((r) => r.json())
      .then((list: PoolInfo[]) => setPools(list))
      .catch(() => setPools([]))
  }, [])

  const pool = useMemo(() => {
    if (!tokenIn || !tokenOut) return null
    const id0 = tokenIn.id.toLowerCase()
    const id1 = tokenOut.id.toLowerCase()
    return pools.find((p) => {
      const a = p.token0.id.toLowerCase()
      const b = p.token1.id.toLowerCase()
      return (a === id0 && b === id1) || (a === id1 && b === id0)
    }) ?? null
  }, [pools, tokenIn, tokenOut])

  useEffect(() => {
    if (!pool?.address) {
      setPoolReserves(null)
      return
    }
    getPoolState(pool.address, pool.poolType).then((state) => {
      if (state) setPoolReserves({ reserve0: state.reserve0, reserve1: state.reserve1 })
      else setPoolReserves(null)
    })
  }, [pool?.address, pool?.poolType])

  const pairState: PairState | null = useMemo(() => {
    if (!pool) return null
    const r0 = poolReserves?.reserve0 ?? pool.reserve0
    const r1 = poolReserves?.reserve1 ?? pool.reserve1
    return {
      token0Id: pool.token0.id,
      token1Id: pool.token1.id,
      reserve0: BigInt(r0),
      reserve1: BigInt(r1),
    }
  }, [pool, poolReserves])

  const decimalsIn = useMemo(
    () => tokens.find((t) => t.id === tokenIn?.id)?.decimals ?? tokenIn?.decimals ?? 18,
    [tokens, tokenIn]
  )
  const decimalsOut = useMemo(
    () => tokens.find((t) => t.id === tokenOut?.id)?.decimals ?? tokenOut?.decimals ?? 18,
    [tokens, tokenOut]
  )

  const tokenInBalanceRaw = useMemo(() => {
    if (!allBalances || !tokenIn) return null
    if (tokenIn.id === ALPH_TOKEN_ID) return allBalances.alph
    return allBalances.tokens.get(tokenIn.id.toLowerCase()) ?? BigInt(0)
  }, [allBalances, tokenIn])

  const tokenOutBalanceRaw = useMemo(() => {
    if (!allBalances || !tokenOut) return null
    if (tokenOut.id === ALPH_TOKEN_ID) return allBalances.alph
    return allBalances.tokens.get(tokenOut.id.toLowerCase()) ?? BigInt(0)
  }, [allBalances, tokenOut])

  const tokenInBalanceStr =
    tokenInBalanceRaw != null ? formatAmount(tokenInBalanceRaw, decimalsIn) : undefined
  const tokenOutBalanceStr =
    tokenOutBalanceRaw != null ? formatAmount(tokenOutBalanceRaw, decimalsOut) : undefined

  const handleMax = useCallback(() => {
    if (tokenInBalanceRaw == null || tokenInBalanceRaw === BigInt(0)) return
    const reserve =
      tokenIn?.id === ALPH_TOKEN_ID
        ? RESERVE_ALPH_FOR_GAS
        : BigInt(1)
    const maxSpendable = tokenInBalanceRaw > reserve ? tokenInBalanceRaw - reserve : BigInt(0)
    if (maxSpendable > BigInt(0)) setAmountIn(formatAmount(maxSpendable, decimalsIn))
  }, [tokenInBalanceRaw, tokenIn?.id, decimalsIn])

  const amountInBig = parseAmount(amountIn, decimalsIn)
  const amountOutBig = useMemo(() => {
    if (!pairState || !tokenIn || amountInBig === null || amountInBig === BigInt(0)) return null
    try {
      return getAmountOut(pairState, tokenIn.id, amountInBig)
    } catch {
      return null
    }
  }, [pairState, tokenIn, amountInBig])

  const amountOutStr = amountOutBig != null ? formatAmount(amountOutBig, decimalsOut) : ''

  const minAmountOut = useMemo(() => {
    if (amountOutBig == null) return null
    return (amountOutBig * BigInt(10000 - slippageBps)) / BigInt(10000)
  }, [amountOutBig, slippageBps])

  const canSwap = Boolean(
    account?.address &&
    signer &&
    pool &&
    pairState &&
    tokenIn &&
    tokenOut &&
    amountInBig &&
    amountInBig > BigInt(0) &&
    amountOutBig &&
    amountOutBig > BigInt(0) &&
    !txPending
  )

  const handleSwap = useCallback(async () => {
    if (!canSwap || !account?.address || !signer || !pool || !pairState || !tokenIn || !tokenOut || amountInBig == null || amountInBig === BigInt(0) || amountOutBig == null) return
    setError(null)
    setTxPending(true)
    try {
      const minOut = minAmountOut ?? amountOutBig
      const { txId: id } = await executeSwap(
        pool.address,
        pairState,
        signer,
        account.address,
        account.address,
        tokenIn.id,
        amountInBig,
        minOut
      )
      sendEvent({
        category: 'swap',
        action: `${tokenIn.symbol}->${tokenOut.symbol}`,
        name: `${amountIn} -> ${amountOutStr}`,
      })
      setTxId(id)
      setAmountIn('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Swap failed')
    } finally {
      setTxPending(false)
    }
  }, [canSwap, account?.address, signer, pool, pairState, tokenIn, tokenOut, amountInBig, amountOutBig, minAmountOut])

  const handleSelectToken = useCallback((t: TokenInfo) => {
    if (selecting === 'in') {
      setTokenIn(t)
      if (tokenOut?.id === t.id) setTokenOut(tokenIn)
    } else {
      setTokenOut(t)
      if (tokenIn?.id === t.id) setTokenIn(tokenOut)
    }
    setSelecting(null)
  }, [selecting, tokenIn, tokenOut])

  const flip = useCallback(() => {
    setTokenIn(tokenOut)
    setTokenOut(tokenIn)
    setAmountIn('')
  }, [tokenIn, tokenOut])

  const filteredTokens = useMemo(() => {
    const other = selecting === 'in' ? tokenOut : tokenIn
    return other ? tokens.filter((t) => t.id !== other.id) : tokens
  }, [tokens, selecting, tokenIn, tokenOut])

  const sortedFilteredTokens = useMemo(() => {
    if (!allBalances) return filteredTokens
    return [...filteredTokens].sort((a, b) => {
      const rawA = a.id === ALPH_TOKEN_ID ? allBalances.alph : allBalances.tokens.get(a.id.toLowerCase()) ?? BigInt(0)
      const rawB = b.id === ALPH_TOKEN_ID ? allBalances.alph : allBalances.tokens.get(b.id.toLowerCase()) ?? BigInt(0)
      return rawB > rawA ? 1 : rawB < rawA ? -1 : 0
    })
  }, [filteredTokens, allBalances])

  const tokenBalancesFormatted = useMemo(() => {
    const m = new Map<string, string>()
    for (const t of filteredTokens) {
      const raw = allBalances
        ? (t.id === ALPH_TOKEN_ID ? allBalances.alph : allBalances.tokens.get(t.id.toLowerCase()) ?? BigInt(0))
        : BigInt(0)
      m.set(t.id, formatAmount(raw, t.decimals))
    }
    return m
  }, [filteredTokens, allBalances])

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <Header />
      <main className="pt-[12.5rem] pb-12 px-4 md:pt-28">
        <div className="mx-auto max-w-lg space-y-6">
          <div className="rounded-xl border border-orange-500/40 bg-orange-950/30 px-4 py-3 text-sm text-orange-200/90 space-y-3">
            <p>This swap tool should not be used as a primary tool. It is here to allow users to swap old tokens that may not be available elsewhere. </p>
            <p>For fully functionals, maintained DEXes please use:</p>
            <div className="flex gap-3">
              <a
                href="https://elexium.finance/swap"
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center rounded-xl border border-orange-500/40 bg-black px-4 py-3 transition-colors hover:bg-black/80 hover:border-orange-400/50"
              >
                <img src="/dex-logos/elexium.svg" alt="Elexium" className="h-8 w-auto max-w-full object-contain" />
              </a>
              <a
                href="https://nightshade.finance/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center rounded-xl border border-orange-500/40 bg-black px-4 py-3 transition-colors hover:bg-black/80 hover:border-orange-400/50"
              >
                <img src="/dex-logos/nightshade.png" alt="Nightshade" className="h-8 w-auto object-contain" />
                &nbsp;NIGHTSHADE
              </a>
            </div>
            <p>Users may experience high slippage depending on LP depth.</p>
          </div>
          <div className="rounded-3xl border border-[var(--card-border)] bg-[var(--card)] p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h1 className="text-xl font-semibold text-white">Swap</h1>
              <button
                type="button"
                className="rounded-lg p-2 text-[var(--muted)] hover:bg-white/5 hover:text-white"
                title="Slippage"
              >
                <span className="text-xs">Slippage {slippageBps / 100}%</span>
              </button>
            </div>

            <div className="space-y-2">
              <TokenInput
                label="You pay"
                token={tokenIn}
                amount={amountIn}
                onAmountChange={setAmountIn}
                onTokenClick={() => setSelecting('in')}
                placeholder="0.0"
                balance={connectionStatus === 'connected' ? tokenInBalanceStr : undefined}
                onMaxClick={connectionStatus === 'connected' ? handleMax : undefined}
              />
              <div className="flex justify-center -my-1 relative z-10">
                <button
                  type="button"
                  onClick={flip}
                  className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-[var(--card)] bg-[var(--input-bg)] text-[var(--muted)] transition-colors hover:bg-white/10 hover:text-white"
                  aria-label="Flip"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M7 16V4M7 4L3 8M7 4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
                  </svg>
                </button>
              </div>
              <TokenInput
                label="You receive"
                token={tokenOut}
                amount={amountOutStr}
                onAmountChange={() => {}}
                onTokenClick={() => setSelecting('out')}
                disabled
                placeholder="0.0"
                balance={connectionStatus === 'connected' ? tokenOutBalanceStr : undefined}
              />
            </div>

            {!pool && tokenIn && tokenOut && (
              <p className="mt-4 text-center text-sm text-amber-500">No pool for this pair</p>
            )}

            {error && (
              <p className="mt-4 text-center text-sm text-red-400">{error}</p>
            )}

            {txId && (
              <p className="mt-4 text-center text-sm">
                <a
                  href={`${EXPLORER_URL}/transactions/${txId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--accent)] hover:underline"
                >
                  View transaction
                </a>
              </p>
            )}

            {connectionStatus !== 'connected' ? (
              <button
                type="button"
                disabled
                className="mt-6 w-full rounded-2xl bg-[var(--muted)]/30 py-4 font-semibold text-[var(--muted)]"
              >
                Connect wallet
              </button>
            ) : (
              <button
                type="button"
                disabled={!canSwap}
                onClick={handleSwap}
                className="mt-6 w-full rounded-2xl bg-[var(--accent)] py-4 font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-[var(--accent)]"
              >
                {txPending ? 'Swapping…' : 'Swap'}
              </button>
            )}
          </div>

          <p className="mt-6 text-center text-xs text-[var(--muted)]">
            Ayin Retro — Swap on TokenPair (V1 AMM)
          </p>
        </div>
      </main>

      {selecting !== null && (
        <TokenSelect
          tokens={sortedFilteredTokens}
          balancesFormatted={connectionStatus === 'connected' ? tokenBalancesFormatted : undefined}
          onSelect={handleSelectToken}
          onClose={() => setSelecting(null)}
          selectedId={selecting === 'in' ? tokenIn?.id : tokenOut?.id}
        />
      )}
    </div>
  )
}

export default function SwapPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[var(--background)] pt-[12.5rem] flex items-center justify-center text-[var(--muted)] md:pt-28">
          Loading…
        </div>
      }
    >
      <SwapContent />
    </Suspense>
  )
}
