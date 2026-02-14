'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useWallet } from '@alephium/web3-react'
import { web3, binToHex, tokenIdFromAddress } from '@alephium/web3'
import { Header } from '@/components/Header'
import {
  AYIN_TOKEN_ID,
  XAYIN_TOKEN_ID,
  XAYIN_LIQUID_STAKING_ADDRESS,
  ALPHAYIN_TOKEN_ID,
  POUNDER_VAULT_ADDRESS,
  SINGLE_ALPHAYIN_STAKE_ADDRESS,
  SINGLE_ALPHAYIN_STAKE_DEPOSIT_TOKEN,
  STAKING_POOLS_DEPLOYMENT,
  EXPLORER_URL,
  NODE_URL,
} from '@/lib/config'
import { useWalletBalance } from '@/contexts/WalletBalanceContext'
import { getLpBalance, formatLpAmount } from '@/lib/poolUtils'
import { executePounderDeposit, executePounderWithdraw } from '@/lib/vault'
import { executeMintXAyin, executeBurnXAyin } from '@/lib/xayin'
import { sendEvent } from '@socialgouv/matomo-next'
import {
  executeStakeLp,
  executeUnstakeLp,
  executeClaimRewards,
  getEarnedReward,
  getStakedBalance,
  isStakingV4,
} from '@/lib/lpStaking'
import type { PoolInfo } from '@/lib/types'

const DECIMALS = 18

const TOKEN_LOGOS = {
  ayin: 'https://raw.githubusercontent.com/alephium/token-list/master/logos/AYIN.png',
  xayin: 'https://raw.githubusercontent.com/alephium/token-list/master/logos/XAYIN.png',
  alph: 'https://raw.githubusercontent.com/alephium/token-list/master/logos/ALPH.png',
} as const

function formatTokenAmount(amount: bigint, decimals: number): string {
  const s = amount.toString()
  if (s.length <= decimals) return '0.' + s.padStart(decimals, '0').slice(0, Math.min(decimals, 6))
  const int = s.slice(0, -decimals)
  const frac = s.slice(-decimals).replace(/0+$/, '').slice(0, 6)
  return frac ? `${int}.${frac}` : int
}

function parseTokenAmount(value: string, decimals: number): bigint | null {
  if (!value || !/^[0-9.]*$/.test(value)) return null
  const [int = '0', frac = ''] = value.split('.')
  const fracPadded = frac.slice(0, decimals).padEnd(decimals, '0')
  const combined = int + fracPadded
  if (combined.length > 50) return null
  return BigInt(combined)
}

/** Get token balance held by an address (e.g. contract). */
async function getAddressTokenBalance(address: string, tokenIdHex: string): Promise<bigint> {
  const provider = web3.getCurrentNodeProvider()
  if (!provider) return 0n
  try {
    const b = await provider.addresses.getAddressesAddressBalance(address)
    const normalizedId = tokenIdHex.toLowerCase().replace(/^0x/, '')
    for (const t of b.tokenBalances ?? []) {
      const id = (t.id ?? '').trim().toLowerCase().replace(/^0x/, '')
      if (id === normalizedId) return BigInt(t.amount ?? 0)
    }
  } catch {
    // ignore
  }
  return 0n
}

export default function StakingPage() {
  const { account, signer } = useWallet()
  const { balances, refreshBalances } = useWalletBalance()
  const [pools, setPools] = useState<PoolInfo[]>([])
  const [mintAmount, setMintAmount] = useState('')
  const [burnAmount, setBurnAmount] = useState('')
  const [depositAmount, setDepositAmount] = useState('')
  const [withdrawAmount, setWithdrawAmount] = useState('')
  const [stakeAmounts, setStakeAmounts] = useState<Record<string, string>>({})
  const [unstakeAmounts, setUnstakeAmounts] = useState<Record<string, string>>({})
  const [rewardsByKey, setRewardsByKey] = useState<Record<string, bigint>>({})
  const [stakedByKey, setStakedByKey] = useState<Record<string, bigint>>({})
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [successTxId, setSuccessTxId] = useState<string | null>(null)
  const [refreshingStaking, setRefreshingStaking] = useState(false)
  const [xAyinContractAyin, setXAyinContractAyin] = useState<bigint | null>(null)
  const [pounderContractAlphayin, setPounderContractAlphayin] = useState<bigint | null>(null)
  const [pounderContractAyin, setPounderContractAyin] = useState<bigint | null>(null)
  const [singleStaked, setSingleStaked] = useState<bigint>(0n)
  const [singleEarned, setSingleEarned] = useState<bigint>(0n)
  const SINGLE_STAKING_KEY = 'single_alphayin'

  useEffect(() => {
    web3.setCurrentNodeProvider(NODE_URL)
  }, [])

  const fetchContractBalances = useCallback(async () => {
    const [xayinAyin, pounderAlphayin, pounderAyin] = await Promise.all([
      getAddressTokenBalance(XAYIN_LIQUID_STAKING_ADDRESS, AYIN_TOKEN_ID),
      getAddressTokenBalance(POUNDER_VAULT_ADDRESS, ALPHAYIN_TOKEN_ID),
      getAddressTokenBalance(POUNDER_VAULT_ADDRESS, AYIN_TOKEN_ID),
    ])
    setXAyinContractAyin(xayinAyin)
    setPounderContractAlphayin(pounderAlphayin)
    setPounderContractAyin(pounderAyin)
  }, [])

  useEffect(() => {
    fetchContractBalances()
  }, [fetchContractBalances])

  const refetchStakingPoolsAndPositions = useCallback(async () => {
    setRefreshingStaking(true)
    try {
      const [list] = await Promise.all([
        fetch('/api/pools').then((r) => r.json()).then((list: PoolInfo[]) => list).catch(() => []),
      ])
      setPools(list)
      if (account?.address) {
        const addr = account.address
        await Promise.all([
          ...STAKING_POOLS_DEPLOYMENT.flatMap((entry) => [
            getEarnedReward(entry.stakingAddress, addr, isStakingV4(entry.key)).then((earned) =>
              setRewardsByKey((prev) => (prev[entry.key] === earned ? prev : { ...prev, [entry.key]: earned }))
            ),
            getStakedBalance(entry.stakingAddress, addr, isStakingV4(entry.key)).then((staked) =>
              setStakedByKey((prev) => (prev[entry.key] === staked ? prev : { ...prev, [entry.key]: staked }))
            ),
          ]),
          getEarnedReward(SINGLE_ALPHAYIN_STAKE_ADDRESS, addr, false).then(setSingleEarned),
          getStakedBalance(SINGLE_ALPHAYIN_STAKE_ADDRESS, addr, false).then(setSingleStaked),
        ])
      }
      refreshBalances()
      fetchContractBalances()
    } finally {
      setRefreshingStaking(false)
    }
  }, [account?.address, refreshBalances, fetchContractBalances])

  useEffect(() => {
    if (!account?.address) {
      setRewardsByKey({})
      setStakedByKey({})
      setSingleEarned(0n)
      setSingleStaked(0n)
      return
    }
    const addr = account.address
    STAKING_POOLS_DEPLOYMENT.forEach((entry) => {
      getEarnedReward(entry.stakingAddress, addr, isStakingV4(entry.key)).then((earned) =>
        setRewardsByKey((prev) => (prev[entry.key] === earned ? prev : { ...prev, [entry.key]: earned }))
      )
      getStakedBalance(entry.stakingAddress, addr, isStakingV4(entry.key)).then((staked) =>
        setStakedByKey((prev) => (prev[entry.key] === staked ? prev : { ...prev, [entry.key]: staked }))
      )
    })
    getEarnedReward(SINGLE_ALPHAYIN_STAKE_ADDRESS, addr, false).then(setSingleEarned)
    getStakedBalance(SINGLE_ALPHAYIN_STAKE_ADDRESS, addr, false).then(setSingleStaked)
  }, [account?.address])

  useEffect(() => {
    fetch('/api/pools')
      .then((r) => r.json())
      .then((list: PoolInfo[]) => setPools(list))
      .catch(() => setPools([]))
  }, [])

  const ayinBalance = balances?.tokens.get(AYIN_TOKEN_ID) ?? balances?.tokens.get('0x' + AYIN_TOKEN_ID) ?? BigInt(0)
  const xAyinBalance = balances?.tokens.get(XAYIN_TOKEN_ID) ?? balances?.tokens.get('0x' + XAYIN_TOKEN_ID) ?? BigInt(0)
  const alphaAyinBalance = balances?.tokens.get(ALPHAYIN_TOKEN_ID) ?? balances?.tokens.get('0x' + ALPHAYIN_TOKEN_ID) ?? BigInt(0)
  const valphAyinTokenId = useMemo(
    () => binToHex(tokenIdFromAddress(POUNDER_VAULT_ADDRESS)),
    []
  )
  const singleStakingDepositTokenId = useMemo(
    () => binToHex(tokenIdFromAddress(SINGLE_ALPHAYIN_STAKE_DEPOSIT_TOKEN)),
    []
  )
  const singleStakingDepositBalance =
    balances?.tokens.get(singleStakingDepositTokenId) ??
    balances?.tokens.get('0x' + singleStakingDepositTokenId) ??
    BigInt(0)
  const valphAyinBalance =
    balances?.tokens.get(valphAyinTokenId) ??
    balances?.tokens.get('0x' + valphAyinTokenId) ??
    BigInt(0)

  const poolAddressByStakingKey = useCallback(
    (tokenA: string, tokenB: string) => {
      const na = tokenA.toLowerCase().replace(/^0x/, '')
      const nb = tokenB.toLowerCase().replace(/^0x/, '')
      return pools.find((p) => {
        const p0 = (p.token0.id ?? '').toLowerCase().replace(/^0x/, '')
        const p1 = (p.token1.id ?? '').toLowerCase().replace(/^0x/, '')
        return (p0 === na && p1 === nb) || (p0 === nb && p1 === na)
      })?.address ?? null
    },
    [pools]
  )

  const run = useCallback(
    async (key: string, fn: () => Promise<{ txId: string }>, onSuccess?: () => void) => {
      if (!signer || !account?.address) return
      setError(null)
      setPending(key)
      try {
        const { txId } = await fn()
        onSuccess?.()
        refreshBalances?.()
        setError(null)
        setSuccessTxId(txId)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Transaction failed')
      } finally {
        setPending(null)
      }
    },
    [signer, account?.address, refreshBalances]
  )

  const handleMint = useCallback(() => {
    const amount = parseTokenAmount(mintAmount, DECIMALS)
    if (!amount || amount <= BigInt(0)) {
      setError('Enter a valid amount')
      return
    }
    run('xayin', () => executeMintXAyin(signer!, amount), () => {
      sendEvent({ category: 'xAyin', action: 'mint', name: mintAmount })
      setMintAmount('')
      fetchContractBalances()
    })
  }, [mintAmount, run, signer, fetchContractBalances])

  const handleBurn = useCallback(() => {
    const amount = parseTokenAmount(burnAmount, DECIMALS)
    if (!amount || amount <= BigInt(0)) {
      setError('Enter a valid amount')
      return
    }
    run('xayin', () => executeBurnXAyin(signer!, amount), () => {
      sendEvent({ category: 'xAyin', action: 'burn', name: burnAmount })
      setBurnAmount('')
      fetchContractBalances()
    })
  }, [burnAmount, run, signer, fetchContractBalances])

  const alphaAyinTokenIdForTx =
    balances?.tokens.has(ALPHAYIN_TOKEN_ID)
      ? ALPHAYIN_TOKEN_ID
      : balances?.tokens.has('0x' + ALPHAYIN_TOKEN_ID)
        ? '0x' + ALPHAYIN_TOKEN_ID
        : ALPHAYIN_TOKEN_ID

  const handleDeposit = useCallback(() => {
    const amount = parseTokenAmount(depositAmount, DECIMALS)
    if (!amount || amount <= BigInt(0)) {
      setError('Enter a valid amount')
      return
    }
    run(
      'pounder',
      () => executePounderDeposit(signer!, account!.address, amount, alphaAyinTokenIdForTx),
      () => {
        sendEvent({ category: 'pounder', action: 'deposit', name: depositAmount })
        setDepositAmount('')
        fetchContractBalances()
      }
    )
  }, [depositAmount, run, signer, account, alphaAyinTokenIdForTx, fetchContractBalances])

  const handleWithdraw = useCallback(() => {
    const shares = parseTokenAmount(withdrawAmount, DECIMALS)
    if (!shares || shares <= BigInt(0)) {
      setError('Enter valid shares')
      return
    }
    run('pounder', () => executePounderWithdraw(signer!, shares), () => {
      sendEvent({ category: 'pounder', action: 'withdraw', name: withdrawAmount })
      setWithdrawAmount('')
      fetchContractBalances()
    })
  }, [withdrawAmount, run, signer, fetchContractBalances])

  const handleStake = useCallback(
    (entry: (typeof STAKING_POOLS_DEPLOYMENT)[0]) => {
      const amount = parseTokenAmount(stakeAmounts[entry.key] ?? '', DECIMALS)
      if (!amount || amount <= BigInt(0)) {
        setError('Enter stake amount')
        return
      }
      run(
        entry.key,
        () =>
          executeStakeLp(
            signer!,
            entry.stakingAddress,
            amount,
            isStakingV4(entry.key)
          ),
        () => {
          sendEvent({ category: 'stake', action: 'stake', name: entry.label, value: stakeAmounts[entry.key] ?? '' })
          setStakeAmounts((p) => ({ ...p, [entry.key]: '' }))
          if (account?.address) {
            getEarnedReward(entry.stakingAddress, account.address, isStakingV4(entry.key)).then((earned) =>
              setRewardsByKey((p) => ({ ...p, [entry.key]: earned }))
            )
            getStakedBalance(entry.stakingAddress, account.address, isStakingV4(entry.key)).then((staked) =>
              setStakedByKey((p) => ({ ...p, [entry.key]: staked }))
            )
          }
        }
      )
    },
    [stakeAmounts, poolAddressByStakingKey, run, signer, account?.address]
  )

  const handleUnstake = useCallback(
    (entry: (typeof STAKING_POOLS_DEPLOYMENT)[0]) => {
      const amount = parseTokenAmount(unstakeAmounts[entry.key] ?? '', DECIMALS)
      if (!amount || amount <= BigInt(0)) {
        setError('Enter unstake amount')
        return
      }
      run(
        entry.key,
        () => executeUnstakeLp(signer!, entry.stakingAddress, amount, isStakingV4(entry.key)),
        () => {
          sendEvent({ category: 'stake', action: 'unstake', name: entry.label, value: unstakeAmounts[entry.key] ?? '' })
          setUnstakeAmounts((p) => ({ ...p, [entry.key]: '' }))
          if (account?.address) {
            getEarnedReward(entry.stakingAddress, account.address, isStakingV4(entry.key)).then((earned) =>
              setRewardsByKey((p) => ({ ...p, [entry.key]: earned }))
            )
            getStakedBalance(entry.stakingAddress, account.address, isStakingV4(entry.key)).then((staked) =>
              setStakedByKey((p) => ({ ...p, [entry.key]: staked }))
            )
          }
        }
      )
    },
    [unstakeAmounts, run, signer, account?.address]
  )

  const handleClaim = useCallback(
    (entry: (typeof STAKING_POOLS_DEPLOYMENT)[0]) => {
      run(
        entry.key,
        () => executeClaimRewards(signer!, entry.stakingAddress, isStakingV4(entry.key)),
        () => {
          if (account?.address) {
            getEarnedReward(entry.stakingAddress, account.address, isStakingV4(entry.key)).then((earned) =>
              setRewardsByKey((p) => ({ ...p, [entry.key]: earned }))
            )
          }
        }
      )
    },
    [run, signer, account?.address]
  )

  const handleSingleStake = useCallback(() => {
    const amount = parseTokenAmount(stakeAmounts[SINGLE_STAKING_KEY] ?? '', DECIMALS)
    if (!amount || amount <= BigInt(0)) {
      setError('Enter stake amount')
      return
    }
    run(
      SINGLE_STAKING_KEY,
      () => executeStakeLp(signer!, SINGLE_ALPHAYIN_STAKE_ADDRESS, amount, false),
      () => {
        sendEvent({ category: 'stake', action: 'stake', name: 'Single ALPHAYIN', value: stakeAmounts[SINGLE_STAKING_KEY] ?? '' })
        setStakeAmounts((p) => ({ ...p, [SINGLE_STAKING_KEY]: '' }))
        if (account?.address) {
          getEarnedReward(SINGLE_ALPHAYIN_STAKE_ADDRESS, account.address, false).then(setSingleEarned)
          getStakedBalance(SINGLE_ALPHAYIN_STAKE_ADDRESS, account.address, false).then(setSingleStaked)
        }
      }
    )
  }, [stakeAmounts, run, signer, account?.address])

  const handleSingleUnstake = useCallback(() => {
    const amount = parseTokenAmount(unstakeAmounts[SINGLE_STAKING_KEY] ?? '', DECIMALS)
    if (!amount || amount <= BigInt(0)) {
      setError('Enter unstake amount')
      return
    }
    run(
      SINGLE_STAKING_KEY,
      () => executeUnstakeLp(signer!, SINGLE_ALPHAYIN_STAKE_ADDRESS, amount, false),
      () => {
        sendEvent({ category: 'stake', action: 'unstake', name: 'Single ALPHAYIN', value: unstakeAmounts[SINGLE_STAKING_KEY] ?? '' })
        setUnstakeAmounts((p) => ({ ...p, [SINGLE_STAKING_KEY]: '' }))
        if (account?.address) {
          getEarnedReward(SINGLE_ALPHAYIN_STAKE_ADDRESS, account.address, false).then(setSingleEarned)
          getStakedBalance(SINGLE_ALPHAYIN_STAKE_ADDRESS, account.address, false).then(setSingleStaked)
        }
      }
    )
  }, [unstakeAmounts, run, signer, account?.address])

  const handleSingleClaim = useCallback(() => {
    run(
      SINGLE_STAKING_KEY,
      () => executeClaimRewards(signer!, SINGLE_ALPHAYIN_STAKE_ADDRESS, false),
      () => {
        sendEvent({ category: 'stake', action: 'claim', name: 'Single ALPHAYIN' })
        if (account?.address) {
          getEarnedReward(SINGLE_ALPHAYIN_STAKE_ADDRESS, account.address, false).then(setSingleEarned)
        }
      }
    )
  }, [run, signer, account?.address])

  const handleStakeMax = useCallback(
    (entry: (typeof STAKING_POOLS_DEPLOYMENT)[0]) => {
      const poolAddr = poolAddressByStakingKey(entry.tokenA, entry.tokenB)
      if (!poolAddr || !balances) return
      const lp = getLpBalance(balances, poolAddr) ?? BigInt(0)
      if (lp === BigInt(0)) return
      setStakeAmounts((p) => ({ ...p, [entry.key]: formatTokenAmount(lp, DECIMALS) }))
    },
    [poolAddressByStakingKey, balances]
  )

  const handleUnstakeMax = useCallback((entry: (typeof STAKING_POOLS_DEPLOYMENT)[0]) => {
    const staked = stakedByKey[entry.key] ?? BigInt(0)
    if (staked === BigInt(0)) return
    setUnstakeAmounts((p) => ({ ...p, [entry.key]: formatTokenAmount(staked, DECIMALS) }))
  }, [stakedByKey])

  /** Pool list sorted: first pools with staked LP, then pools with LP available to stake, then rest. */
  const sortedPoolEntries = useMemo(() => {
    return [...STAKING_POOLS_DEPLOYMENT].sort((a, b) => {
      const stakedA = stakedByKey[a.key] ?? BigInt(0)
      const stakedB = stakedByKey[b.key] ?? BigInt(0)
      const lpA = poolAddressByStakingKey(a.tokenA, a.tokenB) && balances
        ? getLpBalance(balances, poolAddressByStakingKey(a.tokenA, a.tokenB)!) ?? BigInt(0)
        : BigInt(0)
      const lpB = poolAddressByStakingKey(b.tokenA, b.tokenB) && balances
        ? getLpBalance(balances, poolAddressByStakingKey(b.tokenA, b.tokenB)!) ?? BigInt(0)
        : BigInt(0)
      const hasStakedA = stakedA > BigInt(0)
      const hasStakedB = stakedB > BigInt(0)
      if (hasStakedA && !hasStakedB) return -1
      if (!hasStakedA && hasStakedB) return 1
      if (hasStakedA && hasStakedB) return stakedB > stakedA ? 1 : stakedA > stakedB ? -1 : 0
      const hasLpA = lpA > BigInt(0)
      const hasLpB = lpB > BigInt(0)
      if (hasLpA && !hasLpB) return -1
      if (!hasLpA && hasLpB) return 1
      if (hasLpA && hasLpB) return lpB > lpA ? 1 : lpA > lpB ? -1 : 0
      return 0
    })
  }, [stakedByKey, balances, poolAddressByStakingKey])

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <Header />
      <main className="pt-28 pb-12 px-4">
        <div className="mx-auto max-w-5xl w-full min-w-0">
          <h1 className="text-2xl font-bold text-white">Staking</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            xAyin, Pounder vault, single ALPHAYIN staking, and LP pool staking.
          </p>

          {error && account?.address && (
            <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* xAyin section — separate card, 3 equal columns: Balance | Mint | Burn */}
          <section className="mt-6 overflow-hidden rounded-xl border border-[var(--card-border)] bg-[var(--card)]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--card-border)] px-4 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <img src={TOKEN_LOGOS.xayin} alt="" className="h-6 w-6 rounded-full shrink-0" />
                  <h2 className="text-sm font-semibold text-white">xAyin</h2>
                </div>
                <span className="text-xs text-[var(--muted)]">
                  AYIN in contract:{' '}
                  <span className="font-mono text-white">
                    {xAyinContractAyin !== null ? formatTokenAmount(xAyinContractAyin, DECIMALS) : '—'}
                  </span>
                </span>
              </div>
              <a
                href={`${EXPLORER_URL}/addresses/${XAYIN_LIQUID_STAKING_ADDRESS}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[var(--muted)] hover:text-white transition shrink-0"
              >
                Contract
              </a>
            </div>
            {account?.address ? (
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 px-4 py-3">
                  <div className="min-w-0 font-mono text-sm">
                    <div className="text-xs uppercase tracking-wider text-[var(--muted)]">Balance</div>
                    <div className="mt-1">
                      <span className="text-[var(--muted)]">AYIN: </span>
                      <span className={ayinBalance > BigInt(0) ? 'font-medium text-white' : 'text-[var(--muted)]'}>
                        {formatTokenAmount(ayinBalance, DECIMALS)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[var(--muted)]">xAyin: </span>
                      <span className={xAyinBalance > BigInt(0) ? 'font-medium text-white' : 'text-[var(--muted)]'}>
                        {formatTokenAmount(xAyinBalance, DECIMALS)}
                      </span>
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-col gap-2">
                    <div className="text-xs uppercase tracking-wider text-[var(--muted)]">Mint</div>
                    <div className="flex flex-nowrap items-center gap-2">
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="0.0"
                        value={mintAmount}
                        onChange={(e) => setMintAmount(e.target.value)}
                        className="min-w-0 flex-1 rounded border border-[var(--card-border)] bg-[var(--input-bg)] px-2 py-1.5 font-mono text-sm text-white placeholder:text-[var(--muted)]"
                      />
                      <button
                        type="button"
                        onClick={() => setMintAmount(formatTokenAmount(ayinBalance, DECIMALS))}
                        className="shrink-0 rounded border border-[var(--card-border)] px-2 py-1.5 text-xs text-[var(--muted)] hover:bg-white/5 hover:text-white"
                      >
                        Max
                      </button>
                      <button
                        type="button"
                        onClick={handleMint}
                        disabled={!!pending}
                        className="shrink-0 rounded border border-[var(--card-border)] px-3 py-1.5 text-sm font-medium text-white hover:bg-white/5 disabled:opacity-50"
                      >
                        {pending === 'xayin' ? '…' : 'Mint'}
                      </button>
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-col gap-2">
                    <div className="text-xs uppercase tracking-wider text-[var(--muted)]">Burn</div>
                    <div className="flex flex-nowrap items-center gap-2">
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="0.0"
                        value={burnAmount}
                        onChange={(e) => setBurnAmount(e.target.value)}
                        className="min-w-0 flex-1 rounded border border-[var(--card-border)] bg-[var(--input-bg)] px-2 py-1.5 font-mono text-sm text-white placeholder:text-[var(--muted)]"
                      />
                      <button
                        type="button"
                        onClick={() => setBurnAmount(formatTokenAmount(xAyinBalance, DECIMALS))}
                        className="shrink-0 rounded border border-[var(--card-border)] px-2 py-1.5 text-xs text-[var(--muted)] hover:bg-white/5 hover:text-white"
                      >
                        Max
                      </button>
                      <button
                        type="button"
                        onClick={handleBurn}
                        disabled={!!pending}
                        className="shrink-0 rounded bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
                      >
                        {pending === 'xayin' ? '…' : 'Burn'}
                      </button>
                    </div>
                  </div>
                </div>
            ) : (
              <div className="px-4 py-6 text-center text-sm text-[var(--muted)]">
                Connect your wallet to view balances and mint or burn xAyin.
              </div>
            )}
          </section>

          {/* Pounder section — separate card, 3 equal columns: Balance | Deposit | Withdraw */}
          <section className="mt-4 overflow-hidden rounded-xl border border-[var(--card-border)] bg-[var(--card)]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--card-border)] px-4 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <img src={TOKEN_LOGOS.alph} alt="" className="h-6 w-6 rounded-full shrink-0" />
                  <img src={TOKEN_LOGOS.ayin} alt="" className="-ml-2 h-6 w-6 rounded-full ring-2 ring-[var(--card)] shrink-0" />
                  <h2 className="text-sm font-semibold text-white">Pounder</h2>
                </div>
                <span className="text-xs text-[var(--muted)]">
                  ALPHAYIN:{' '}
                  <span className="font-mono text-white">
                    {pounderContractAlphayin !== null ? formatTokenAmount(pounderContractAlphayin, DECIMALS) : '—'}
                  </span>
                  {' · '}
                  AYIN:{' '}
                  <span className="font-mono text-white">
                    {pounderContractAyin !== null ? formatTokenAmount(pounderContractAyin, DECIMALS) : '—'}
                  </span>
                </span>
              </div>
              <a
                href={`${EXPLORER_URL}/addresses/${POUNDER_VAULT_ADDRESS}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[var(--muted)] hover:text-white transition shrink-0"
              >
                Contract
              </a>
            </div>
            {account?.address ? (
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 px-4 py-3">
                  <div className="min-w-0 font-mono text-sm">
                    <div className="text-xs uppercase tracking-wider text-[var(--muted)]">Balance</div>
                    <div className="mt-1">
                      <span className="text-[var(--muted)]">ALPHAYIN: </span>
                      <span className={alphaAyinBalance > BigInt(0) ? 'font-medium text-white' : 'text-[var(--muted)]'}>
                        {formatTokenAmount(alphaAyinBalance, DECIMALS)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[var(--muted)]">vALPHAYIN: </span>
                      <span className={valphAyinBalance > BigInt(0) ? 'font-medium text-white' : 'text-[var(--muted)]'}>
                        {formatTokenAmount(valphAyinBalance, DECIMALS)}
                      </span>
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-col gap-2">
                    <div className="text-xs uppercase tracking-wider text-[var(--muted)]">Deposit</div>
                    <div className="flex flex-nowrap items-center gap-2">
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="0.0"
                        value={depositAmount}
                        onChange={(e) => setDepositAmount(e.target.value)}
                        className="min-w-0 flex-1 rounded border border-[var(--card-border)] bg-[var(--input-bg)] px-2 py-1.5 font-mono text-sm text-white placeholder:text-[var(--muted)]"
                      />
                      <button
                        type="button"
                        onClick={() => setDepositAmount(formatTokenAmount(alphaAyinBalance, DECIMALS))}
                        className="shrink-0 rounded border border-[var(--card-border)] px-2 py-1.5 text-xs text-[var(--muted)] hover:bg-white/5 hover:text-white"
                      >
                        Max
                      </button>
                      <button
                        type="button"
                        onClick={handleDeposit}
                        disabled={!!pending}
                        className="shrink-0 rounded border border-[var(--card-border)] px-3 py-1.5 text-sm font-medium text-white hover:bg-white/5 disabled:opacity-50"
                      >
                        {pending === 'pounder' ? '…' : 'Deposit'}
                      </button>
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-col gap-2">
                    <div className="text-xs uppercase tracking-wider text-[var(--muted)]">Withdraw</div>
                    <div className="flex flex-nowrap items-center gap-2">
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="0.0"
                        value={withdrawAmount}
                        onChange={(e) => setWithdrawAmount(e.target.value)}
                        className="min-w-0 flex-1 rounded border border-[var(--card-border)] bg-[var(--input-bg)] px-2 py-1.5 font-mono text-sm text-white placeholder:text-[var(--muted)]"
                      />
                      <button
                        type="button"
                        onClick={() => setWithdrawAmount(formatTokenAmount(valphAyinBalance, DECIMALS))}
                        className="shrink-0 rounded border border-[var(--card-border)] px-2 py-1.5 text-xs text-[var(--muted)] hover:bg-white/5 hover:text-white"
                      >
                        Max
                      </button>
                      <button
                        type="button"
                        onClick={handleWithdraw}
                        disabled={!!pending}
                        className="shrink-0 rounded bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
                      >
                        {pending === 'pounder' ? '…' : 'Withdraw'}
                      </button>
                    </div>
                  </div>
                </div>
            ) : (
              <div className="px-4 py-6 text-center text-sm text-[var(--muted)]">
                Connect your wallet to deposit ALPHAYIN or withdraw from Pounder.
              </div>
            )}
          </section>

          {/* Single staking — stake ALPHAYIN, earn AYIN (lib/Staking ABI) */}
          <section className="mt-4 overflow-hidden rounded-xl border border-[var(--card-border)] bg-[var(--card)]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--card-border)] px-4 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <img src={TOKEN_LOGOS.alph} alt="" className="h-6 w-6 rounded-full shrink-0" />
                  <img src={TOKEN_LOGOS.ayin} alt="" className="-ml-2 h-6 w-6 rounded-full ring-2 ring-[var(--card)] shrink-0" />
                  <h2 className="text-sm font-semibold text-white">Single LP staking</h2>
                </div>
                <span className="text-xs text-[var(--muted)]">
                  Stake ALPHAYIN, earn AYIN
                </span>
              </div>
              <a
                href={`${EXPLORER_URL}/addresses/${SINGLE_ALPHAYIN_STAKE_ADDRESS}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[var(--muted)] hover:text-white transition shrink-0"
              >
                Contract
              </a>
            </div>
            {account?.address ? (
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 px-4 py-3">
                <div className="min-w-0 font-mono text-sm">
                  <div className="text-xs uppercase tracking-wider text-[var(--muted)]">Balance</div>
                  <div className="mt-1">
                    <span className="text-[var(--muted)]">ALPHAYIN : </span>
                    <span className={singleStakingDepositBalance > BigInt(0) ? 'font-medium text-white' : 'text-[var(--muted)]'}>
                      {formatTokenAmount(singleStakingDepositBalance, DECIMALS)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[var(--muted)]">Staked: </span>
                    <span className={singleStaked > BigInt(0) ? 'font-medium text-white' : 'text-[var(--muted)]'}>
                      {formatTokenAmount(singleStaked, DECIMALS)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[var(--muted)]">Earned (AYIN): </span>
                    <span className={singleEarned > BigInt(0) ? 'font-medium text-white' : 'text-[var(--muted)]'}>
                      {formatTokenAmount(singleEarned, DECIMALS)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleSingleClaim}
                    disabled={!!pending || singleEarned === BigInt(0)}
                    className="mt-2 rounded border border-[var(--card-border)] px-3 py-1.5 text-sm font-medium text-white hover:bg-white/5 disabled:opacity-50"
                  >
                    {pending === SINGLE_STAKING_KEY ? '…' : 'Claim'}
                  </button>
                </div>
                <div className="flex min-w-0 flex-col gap-2">
                  <div className="text-xs uppercase tracking-wider text-[var(--muted)]">Stake</div>
                  <div className="flex flex-nowrap items-center gap-2">
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="0.0"
                      value={stakeAmounts[SINGLE_STAKING_KEY] ?? ''}
                      onChange={(e) =>
                        setStakeAmounts((p) => ({ ...p, [SINGLE_STAKING_KEY]: e.target.value }))
                      }
                      className="min-w-0 flex-1 rounded border border-[var(--card-border)] bg-[var(--input-bg)] px-2 py-1.5 font-mono text-sm text-white placeholder:text-[var(--muted)]"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setStakeAmounts((p) => ({ ...p, [SINGLE_STAKING_KEY]: formatTokenAmount(singleStakingDepositBalance, DECIMALS) }))
                      }
                      disabled={singleStakingDepositBalance === BigInt(0)}
                      className="shrink-0 rounded border border-[var(--card-border)] px-2 py-1.5 text-xs text-[var(--muted)] hover:bg-white/5 hover:text-white disabled:opacity-50"
                    >
                      Max
                    </button>
                    <button
                      type="button"
                      onClick={handleSingleStake}
                      disabled={!!pending}
                      className="shrink-0 rounded border border-[var(--card-border)] px-3 py-1.5 text-sm font-medium text-white hover:bg-white/5 disabled:opacity-50"
                    >
                      {pending === SINGLE_STAKING_KEY ? '…' : 'Stake'}
                    </button>
                  </div>
                </div>
                <div className="flex min-w-0 flex-col gap-2">
                  <div className="text-xs uppercase tracking-wider text-[var(--muted)]">Unstake</div>
                  <div className="flex flex-nowrap items-center gap-2">
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="0.0"
                      value={unstakeAmounts[SINGLE_STAKING_KEY] ?? ''}
                      onChange={(e) =>
                        setUnstakeAmounts((p) => ({ ...p, [SINGLE_STAKING_KEY]: e.target.value }))
                      }
                      className="min-w-0 flex-1 rounded border border-[var(--card-border)] bg-[var(--input-bg)] px-2 py-1.5 font-mono text-sm text-white placeholder:text-[var(--muted)]"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setUnstakeAmounts((p) => ({ ...p, [SINGLE_STAKING_KEY]: formatTokenAmount(singleStaked, DECIMALS) }))
                      }
                      disabled={singleStaked === BigInt(0)}
                      className="shrink-0 rounded border border-[var(--card-border)] px-2 py-1.5 text-xs text-[var(--muted)] hover:bg-white/5 hover:text-white disabled:opacity-50"
                    >
                      Max
                    </button>
                    <button
                      type="button"
                      onClick={handleSingleUnstake}
                      disabled={!!pending}
                      className="shrink-0 rounded bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
                    >
                      {pending === SINGLE_STAKING_KEY ? '…' : 'Unstake'}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="px-4 py-6 text-center text-sm text-[var(--muted)]">
                Connect your wallet to stake ALPHAYIN and earn AYIN.
              </div>
            )}
          </section>

          {/* Pool staking — always visible; placeholders when wallet not connected */}
          <section className="mt-6 overflow-hidden rounded-xl border border-[var(--card-border)] bg-[var(--card)]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--card-border)] px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10" aria-hidden>
                  <svg className="h-3.5 w-3.5 text-[var(--muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="9" cy="12" r="3" />
                    <circle cx="15" cy="12" r="3" />
                    <path d="M9 12h6" />
                  </svg>
                </span>
                <h2 className="text-sm font-semibold text-white">
                  Pool staking
                </h2>
              </div>
              {account?.address && (
                <button
                  type="button"
                  onClick={refetchStakingPoolsAndPositions}
                  disabled={refreshingStaking}
                  className="flex items-center gap-1.5 rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-3 py-1.5 text-xs font-medium text-[var(--muted)] transition hover:bg-[var(--card-border)] hover:text-white disabled:opacity-50"
                  title="Refetch pools and staking positions"
                >
                  <svg className={`h-4 w-4 ${refreshingStaking ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                    <path d="M3 3v5h5" />
                    <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                    <path d="M16 21h5v-5" />
                  </svg>
                  {refreshingStaking ? 'Refreshing…' : 'Refresh'}
                </button>
              )}
            </div>

            {/* Desktop: 3-column grid (≥1280px) */}
            <div className="hidden xl:block">
              <div
                className="grid gap-x-4 border-b border-[var(--card-border)] px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--muted)]"
                style={{ gridTemplateColumns: '1fr 1fr 1fr' }}
              >
                <div>Balance</div>
                <div>Stake</div>
                <div>Unstake</div>
              </div>
              {sortedPoolEntries.map((entry) => {
                const poolAddr = poolAddressByStakingKey(entry.tokenA, entry.tokenB)
                const lpBalance =
                  account?.address && poolAddr && balances
                    ? getLpBalance(balances, poolAddr) ?? BigInt(0)
                    : BigInt(0)
                const staked = account?.address ? (stakedByKey[entry.key] ?? BigInt(0)) : BigInt(0)
                const isPending = pending === entry.key
                const connected = !!account?.address
                return (
                  <div
                    key={entry.key}
                    className="grid gap-x-4 border-b border-[var(--card-border)] px-4 py-3 last:border-b-0"
                    style={{ gridTemplateColumns: '1fr 1fr 1fr' }}
                  >
                    <div className="min-w-0 font-mono text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-white">{entry.label}</span>
                        <a
                          href={`${EXPLORER_URL}/addresses/${entry.stakingAddress}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-[var(--muted)] hover:text-white transition shrink-0"
                          title="Staking contract"
                        >
                          Contract
                        </a>
                      </div>
                      <div className="mt-1">
                        <span className="text-[var(--muted)]">LP: </span>
                        <span className={lpBalance > BigInt(0) ? 'font-medium text-white' : 'text-[var(--muted)]'}>
                          {connected && poolAddr ? formatLpAmount(lpBalance) : '—'}
                        </span>
                      </div>
                      <div>
                        <span className="text-[var(--muted)]">Staked: </span>
                        <span className={staked > BigInt(0) ? 'font-medium text-white' : 'text-[var(--muted)]'}>
                          {connected ? formatLpAmount(staked) : '—'}
                        </span>
                      </div>
                    </div>
                    <div className="flex min-w-0 flex-col gap-2">
                      <div className="flex flex-nowrap items-center gap-2">
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="0.0"
                          value={stakeAmounts[entry.key] ?? ''}
                          onChange={(e) =>
                            setStakeAmounts((p) => ({ ...p, [entry.key]: e.target.value }))
                          }
                          disabled={!connected}
                          className="min-w-0 flex-1 rounded border border-[var(--card-border)] bg-[var(--input-bg)] px-2 py-1.5 font-mono text-sm text-white placeholder:text-[var(--muted)] disabled:opacity-60"
                        />
                        <button
                          type="button"
                          onClick={() => handleStakeMax(entry)}
                          disabled={!connected || lpBalance === BigInt(0)}
                          className="shrink-0 rounded border border-[var(--card-border)] px-2 py-1.5 text-xs text-[var(--muted)] hover:bg-white/5 hover:text-white disabled:opacity-50"
                        >
                          Max
                        </button>
                        <button
                          type="button"
                          onClick={() => handleStake(entry)}
                          disabled={!connected || !!pending || !poolAddr}
                          className="shrink-0 rounded border border-[var(--card-border)] px-3 py-1.5 text-sm font-medium text-white hover:bg-white/5 disabled:opacity-50"
                        >
                          {isPending ? '…' : 'Stake'}
                        </button>
                      </div>
                    </div>
                    <div className="flex min-w-0 flex-col gap-2">
                      <div className="flex flex-nowrap items-center gap-2">
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="0.0"
                          value={unstakeAmounts[entry.key] ?? ''}
                          onChange={(e) =>
                            setUnstakeAmounts((p) => ({ ...p, [entry.key]: e.target.value }))
                          }
                          disabled={!connected}
                          className="min-w-0 flex-1 rounded border border-[var(--card-border)] bg-[var(--input-bg)] px-2 py-1.5 font-mono text-sm text-white placeholder:text-[var(--muted)] disabled:opacity-60"
                        />
                        <button
                          type="button"
                          onClick={() => handleUnstakeMax(entry)}
                          disabled={!connected || staked === BigInt(0)}
                          className="shrink-0 rounded border border-[var(--card-border)] px-2 py-1.5 text-xs text-[var(--muted)] hover:bg-white/5 hover:text-white disabled:opacity-50"
                        >
                          Max
                        </button>
                        <button
                          type="button"
                          onClick={() => handleUnstake(entry)}
                          disabled={!connected || !!pending}
                          className="shrink-0 rounded bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
                        >
                          {isPending ? '…' : 'Unstake'}
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Mobile/tablet: one card per pool (<1280px) */}
            <div className="xl:hidden divide-y divide-[var(--card-border)]">
              {sortedPoolEntries.map((entry) => {
                const poolAddr = poolAddressByStakingKey(entry.tokenA, entry.tokenB)
                const lpBalance =
                  account?.address && poolAddr && balances
                    ? getLpBalance(balances, poolAddr) ?? BigInt(0)
                    : BigInt(0)
                const staked = account?.address ? (stakedByKey[entry.key] ?? BigInt(0)) : BigInt(0)
                const isPending = pending === entry.key
                const connected = !!account?.address
                return (
                  <div key={entry.key} className="p-4 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-white">{entry.label}</span>
                      <a
                        href={`${EXPLORER_URL}/addresses/${entry.stakingAddress}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-[var(--muted)] hover:text-white transition shrink-0"
                        title="Staking contract"
                      >
                        Contract
                      </a>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm font-mono">
                      <div className="flex justify-between gap-2">
                        <span className="text-[var(--muted)]">LP</span>
                        <span className={lpBalance > BigInt(0) ? 'font-medium text-white' : 'text-[var(--muted)]'}>
                          {connected && poolAddr ? formatLpAmount(lpBalance) : '—'}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-[var(--muted)]">Staked</span>
                        <span className={staked > BigInt(0) ? 'font-medium text-white' : 'text-[var(--muted)]'}>
                          {connected ? formatLpAmount(staked) : '—'}
                        </span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="text-xs uppercase tracking-wider text-[var(--muted)]">Stake</div>
                      <div className="flex flex-nowrap items-center gap-2">
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="0.0"
                          value={stakeAmounts[entry.key] ?? ''}
                          onChange={(e) =>
                            setStakeAmounts((p) => ({ ...p, [entry.key]: e.target.value }))
                          }
                          disabled={!connected}
                          className="min-w-0 flex-1 rounded border border-[var(--card-border)] bg-[var(--input-bg)] px-2 py-1.5 font-mono text-sm text-white placeholder:text-[var(--muted)] disabled:opacity-60"
                        />
                        <button
                          type="button"
                          onClick={() => handleStakeMax(entry)}
                          disabled={!connected || lpBalance === BigInt(0)}
                          className="shrink-0 rounded border border-[var(--card-border)] px-2 py-1.5 text-xs text-[var(--muted)] hover:bg-white/5 hover:text-white disabled:opacity-50"
                        >
                          Max
                        </button>
                        <button
                          type="button"
                          onClick={() => handleStake(entry)}
                          disabled={!connected || !!pending || !poolAddr}
                          className="shrink-0 rounded border border-[var(--card-border)] px-3 py-1.5 text-sm font-medium text-white hover:bg-white/5 disabled:opacity-50"
                        >
                          {isPending ? '…' : 'Stake'}
                        </button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="text-xs uppercase tracking-wider text-[var(--muted)]">Unstake</div>
                      <div className="flex flex-nowrap items-center gap-2">
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="0.0"
                          value={unstakeAmounts[entry.key] ?? ''}
                          onChange={(e) =>
                            setUnstakeAmounts((p) => ({ ...p, [entry.key]: e.target.value }))
                          }
                          disabled={!connected}
                          className="min-w-0 flex-1 rounded border border-[var(--card-border)] bg-[var(--input-bg)] px-2 py-1.5 font-mono text-sm text-white placeholder:text-[var(--muted)] disabled:opacity-60"
                        />
                        <button
                          type="button"
                          onClick={() => handleUnstakeMax(entry)}
                          disabled={!connected || staked === BigInt(0)}
                          className="shrink-0 rounded border border-[var(--card-border)] px-2 py-1.5 text-xs text-[var(--muted)] hover:bg-white/5 hover:text-white disabled:opacity-50"
                        >
                          Max
                        </button>
                        <button
                          type="button"
                          onClick={() => handleUnstake(entry)}
                          disabled={!connected || !!pending}
                          className="shrink-0 rounded bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
                        >
                          {isPending ? '…' : 'Unstake'}
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        </div>
      </main>

      {successTxId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setSuccessTxId(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-[var(--card-border)] bg-[var(--card)] p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-4 text-center font-medium text-white">Transaction submitted</p>
            <a
              href={`${EXPLORER_URL}/transactions/${successTxId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mb-4 flex w-full items-center justify-center rounded-xl bg-[var(--accent)] py-3 font-medium text-white transition-colors hover:bg-[var(--accent-hover)]"
            >
              View on explorer
            </a>
            <button
              type="button"
              onClick={() => setSuccessTxId(null)}
              className="w-full rounded-xl border border-[var(--card-border)] py-2.5 text-sm font-medium text-[var(--muted)] hover:bg-white/5 hover:text-white"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
