'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWallet } from '@alephium/web3-react'
import { web3, binToHex, tokenIdFromAddress, groupOfAddress, TransactionBuilder } from '@alephium/web3'
import type { SignerProvider } from '@alephium/web3'
import { Header } from '@/components/Header'
import {
  AYIN_TOKEN_ID,
  XAYIN_TOKEN_ID,
  XAYIN_LIQUID_STAKING_ADDRESS,
  ALPHAYIN_TOKEN_ID,
  POUNDER_VAULT_ADDRESS,
  SINGLE_ALPHAYIN_STAKE_ADDRESS,
  SINGLE_ALPHAYIN_STAKE_DEPOSIT_TOKEN,
  SINGLE_ALPHAYIN_USE_STAKING_V4,
  STAKING_POOLS_DEPLOYMENT,
  BACKEND_URL,
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
  executeUnstakeLpChainedWithAyinTopUp,
  executeTopUpRewardsThenUnstake,
  executeClaimRewards,
  executeTopUpRewards,
  getEarnedReward,
  getStakedBalance,
  getStakingContractOwner,
  parseInsufficientAyinError,
  isStakingV4,
} from '@/lib/lpStaking'
import { fetchPublicKeyForAddress } from '@/lib/fetchPublicKey'
import type { PoolInfo } from '@/lib/types'

const DECIMALS = 18
/** Minimum ALPH needed for tx fees / contract attachment (0.002 ALPH for staking account). */
const MIN_ALPH_FOR_TX = BigInt('2000000000000000')

/** Set to true to show the Single LP staking section (ALPHAYIN stake, earn AYIN). */
const SHOW_SINGLE_LP_STAKING = true

/** Set to true to show the Pounder section (deposit/withdraw ALPHAYIN). */
const SHOW_POUNDER = true

const TOKEN_LOGOS = {
  ayin: 'https://raw.githubusercontent.com/alephium/token-list/master/logos/AYIN.png',
  xayin: 'https://raw.githubusercontent.com/alephium/token-list/master/logos/XAYIN.png',
  alph: 'https://raw.githubusercontent.com/alephium/token-list/master/logos/ALPH.png',
} as const

function formatTokenAmount(amount: bigint, decimals: number): string {
  const s = amount.toString()
  if (s.length <= decimals) {
    const padded = s.padStart(decimals, '0')
    const frac = padded.replace(/0+$/, '')
    return frac ? '0.' + frac.slice(0, 18) : '0'
  }
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
  const [singleStakingContractAyin, setSingleStakingContractAyin] = useState<bigint | null>(null)
  const [singleStakingOwner, setSingleStakingOwner] = useState<string | null>(null)
  const [singleStaked, setSingleStaked] = useState<bigint>(0n)
  const [singleEarned, setSingleEarned] = useState<bigint>(0n)
  const [topUpModalOpen, setTopUpModalOpen] = useState(false)
  const [topUpAmount, setTopUpAmount] = useState('')
  const [topUpOwnerLoading, setTopUpOwnerLoading] = useState(false)
  const [insufficientAyinPopup, setInsufficientAyinPopup] = useState<{
    expected: bigint
    got: bigint
    missing: bigint
    unstakeAmount: bigint
  } | null>(null)
  const [debugLpAddress, setDebugLpAddress] = useState('')
  const [debugLpPublicKey, setDebugLpPublicKey] = useState('')
  const [debugLpPublicKeyFetching, setDebugLpPublicKeyFetching] = useState(false)
  const [debugLpPublicKeyError, setDebugLpPublicKeyError] = useState<string | null>(null)
  const [debugLpSectionOpen, setDebugLpSectionOpen] = useState(false)
  const [unstakeWithTopUpModalOpen, setUnstakeWithTopUpModalOpen] = useState(false)
  const [unstakeWithTopUpAyinAmount, setUnstakeWithTopUpAyinAmount] = useState('1')
  const lastSingleUnstakeAmountRef = useRef<bigint>(0n)
  const SINGLE_STAKING_KEY = 'single_alphayin'
  const effectiveSingleAddress = (debugLpAddress.trim() || account?.address) ?? ''

  // When debug address is set, wrap signer so getSelectedAccount() returns the debug address (and getPublicKey returns debug key if set).
  // Build/simulation will run as that user; signing still uses connected wallet so signature will fail (intended for reproducing errors).
  const effectiveSingleSigner = useMemo((): SignerProvider | undefined => {
    if (!signer || !debugLpAddress.trim()) return signer
    const debugAddr = debugLpAddress.trim()
    const debugPubKey = debugLpPublicKey.trim() || null
    const real = signer as SignerProvider & { getPublicKey?(a: string): Promise<string>; signRaw?(a: string, h: string): Promise<string>; nodeProvider: SignerProvider['nodeProvider']; submitTransaction?(p: unknown): Promise<unknown> }
    return {
      get nodeProvider() {
        return real.nodeProvider
      },
      get explorerProvider() {
        return real.explorerProvider
      },
      async getSelectedAccount() {
        const realAccount = await real.getSelectedAccount()
        const pubKey = debugPubKey ?? realAccount.publicKey
        const group = groupOfAddress(debugAddr)
        return {
          ...realAccount,
          address: debugAddr,
          publicKey: pubKey,
          ...(typeof group === 'number' ? { group } : {}),
        }
      },
      async signAndSubmitTransferTx(p) {
        return real.signAndSubmitTransferTx(p)
      },
      async signAndSubmitDeployContractTx(p) {
        return real.signAndSubmitDeployContractTx(p)
      },
      async signAndSubmitExecuteScriptTx(params) {
        const publicKey = debugPubKey ?? (await real.getSelectedAccount()).publicKey
        const response = await TransactionBuilder.from(real.nodeProvider!).buildExecuteScriptTx(params, publicKey)
        const realAccount = await real.getSelectedAccount()
        const r = response as { txId: string; unsignedTx: string; fundingTxs?: Array<{ txId: string; unsignedTx: string; [k: string]: unknown }> }
        if (r.fundingTxs?.length) {
          const signedFundingTxs: Array<{ txId: string; unsignedTx: string; signature: string; [k: string]: unknown }> = []
          for (const ft of r.fundingTxs) {
            const sig = await real.signRaw!(realAccount.address, ft.txId)
            signedFundingTxs.push({ ...ft, signature: sig })
            await real.submitTransaction!({ unsignedTx: ft.unsignedTx, signature: sig })
          }
          const sig = await real.signRaw!(realAccount.address, r.txId)
          await real.submitTransaction!({ unsignedTx: r.unsignedTx, signature: sig })
          return { ...response, signature: sig, fundingTxs: signedFundingTxs } as unknown as Awaited<ReturnType<SignerProvider['signAndSubmitExecuteScriptTx']>>
        }
        const sig = await real.signRaw!(realAccount.address, r.txId)
        await real.submitTransaction!({ unsignedTx: r.unsignedTx, signature: sig })
        return { ...response, signature: sig } as unknown as Awaited<ReturnType<SignerProvider['signAndSubmitExecuteScriptTx']>>
      },
      async signAndSubmitUnsignedTx(p) {
        return real.signAndSubmitUnsignedTx(p)
      },
      async signAndSubmitChainedTx(p) {
        return real.signAndSubmitChainedTx(p)
      },
      async signUnsignedTx(p) {
        return real.signUnsignedTx(p)
      },
      async signMessage(p) {
        return real.signMessage(p)
      },
    } as SignerProvider
  }, [signer, debugLpAddress, debugLpPublicKey])

  useEffect(() => {
    web3.setCurrentNodeProvider(NODE_URL)
  }, [])

  const fetchContractBalances = useCallback(async () => {
    const [xayinAyin, pounderAlphayin, pounderAyin, singleStakingAyin] = await Promise.all([
      getAddressTokenBalance(XAYIN_LIQUID_STAKING_ADDRESS, AYIN_TOKEN_ID),
      getAddressTokenBalance(POUNDER_VAULT_ADDRESS, ALPHAYIN_TOKEN_ID),
      getAddressTokenBalance(POUNDER_VAULT_ADDRESS, AYIN_TOKEN_ID),
      getAddressTokenBalance(SINGLE_ALPHAYIN_STAKE_ADDRESS, AYIN_TOKEN_ID),
    ])
    setXAyinContractAyin(xayinAyin)
    setPounderContractAlphayin(pounderAlphayin)
    setPounderContractAyin(pounderAyin)
    setSingleStakingContractAyin(singleStakingAyin)
  }, [])

  useEffect(() => {
    fetchContractBalances()
  }, [fetchContractBalances])

  useEffect(() => {
    if (!account?.address) {
      setSingleStakingOwner(null)
      return
    }
    getStakingContractOwner(SINGLE_ALPHAYIN_STAKE_ADDRESS).then(setSingleStakingOwner)
  }, [account?.address])

  // Force-load contract owner when Top up modal opens so it’s always fresh
  useEffect(() => {
    if (!topUpModalOpen) return
    setTopUpOwnerLoading(true)
    getStakingContractOwner(SINGLE_ALPHAYIN_STAKE_ADDRESS)
      .then((owner) => {
        setSingleStakingOwner(owner)
      })
      .finally(() => {
        setTopUpOwnerLoading(false)
      })
  }, [topUpModalOpen])

  const refetchStakingPoolsAndPositions = useCallback(async () => {
    setRefreshingStaking(true)
    try {
      const [list] = await Promise.all([
        fetch('/api/pools').then((r) => r.json()).then((list: PoolInfo[]) => list).catch(() => []),
      ])
      setPools(list)
      if (account?.address) {
        const addr = account.address
        const singleAddr = effectiveSingleAddress || addr
        await Promise.all([
          ...STAKING_POOLS_DEPLOYMENT.flatMap((entry) => [
            getEarnedReward(entry.stakingAddress, addr, isStakingV4(entry.key)).then((earned) =>
              setRewardsByKey((prev) => (prev[entry.key] === earned ? prev : { ...prev, [entry.key]: earned }))
            ),
            getStakedBalance(entry.stakingAddress, addr, isStakingV4(entry.key)).then((staked) =>
              setStakedByKey((prev) => (prev[entry.key] === staked ? prev : { ...prev, [entry.key]: staked }))
            ),
          ]),
          singleAddr ? getEarnedReward(SINGLE_ALPHAYIN_STAKE_ADDRESS, singleAddr, SINGLE_ALPHAYIN_USE_STAKING_V4).then(setSingleEarned) : Promise.resolve(),
          singleAddr ? getStakedBalance(SINGLE_ALPHAYIN_STAKE_ADDRESS, singleAddr, SINGLE_ALPHAYIN_USE_STAKING_V4).then(setSingleStaked) : Promise.resolve(),
        ])
      }
      refreshBalances()
      fetchContractBalances()
    } finally {
      setRefreshingStaking(false)
    }
  }, [account?.address, effectiveSingleAddress, refreshBalances, fetchContractBalances])

  useEffect(() => {
    if (!account?.address && !debugLpAddress.trim()) {
      setRewardsByKey({})
      setStakedByKey({})
      setSingleEarned(0n)
      setSingleStaked(0n)
      return
    }
    const addr = account?.address ?? ''
    const singleAddr = effectiveSingleAddress || addr
    if (account?.address) {
      STAKING_POOLS_DEPLOYMENT.forEach((entry) => {
        getEarnedReward(entry.stakingAddress, addr, isStakingV4(entry.key)).then((earned) =>
          setRewardsByKey((prev) => (prev[entry.key] === earned ? prev : { ...prev, [entry.key]: earned }))
        )
        getStakedBalance(entry.stakingAddress, addr, isStakingV4(entry.key)).then((staked) =>
          setStakedByKey((prev) => (prev[entry.key] === staked ? prev : { ...prev, [entry.key]: staked }))
        )
      })
    }
    if (singleAddr) {
      getEarnedReward(SINGLE_ALPHAYIN_STAKE_ADDRESS, singleAddr, SINGLE_ALPHAYIN_USE_STAKING_V4).then(setSingleEarned)
      getStakedBalance(SINGLE_ALPHAYIN_STAKE_ADDRESS, singleAddr, SINGLE_ALPHAYIN_USE_STAKING_V4).then(setSingleStaked)
    } else {
      setSingleEarned(0n)
      setSingleStaked(0n)
    }
  }, [account?.address, debugLpAddress, effectiveSingleAddress])

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
      if (balances && balances.alph < MIN_ALPH_FOR_TX) {
        setError('Insufficient ALPH for transaction fees. You need at least 0.002 ALPH. Please add ALPH to your wallet.')
        return
      }
      setError(null)
      setPending(key)
      try {
        const { txId } = await fn()
        onSuccess?.()
        refreshBalances?.()
        setError(null)
        setSuccessTxId(txId)
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Transaction failed'
        const insufficientAyin = parseInsufficientAyinError(msg, SINGLE_ALPHAYIN_STAKE_ADDRESS, AYIN_TOKEN_ID)
        if (insufficientAyin) {
          setInsufficientAyinPopup({
            ...insufficientAyin,
            unstakeAmount: lastSingleUnstakeAmountRef.current,
          })
          setError(null)
        } else {
          const alphMsg =
            msg.includes('expected: 1000000000000000000') || (msg.includes('Not enough approved balance') && !msg.includes(SINGLE_ALPHAYIN_STAKE_ADDRESS))
              ? 'Staking requires 1 ALPH to be attached. Ensure your wallet has at least 1 ALPH and try again.'
              : msg.includes('expected 0.002 ALPH') || msg.includes('expected 0.001 ALPH') || msg.includes('got 0 ALPH')
                ? 'Your staking account contract needs at least 0.002 ALPH. Send 0.002 ALPH to the address in the error (e.g. 17Cf96... or 22VZ7K...) from your wallet, then try claim or unstake again.'
                : msg.includes('Assertion Failed')
                  ? 'Transaction rejected by the contract. For Top up rewards, only the contract owner can perform this action.'
                  : msg
          setError(alphMsg)
        }
      } finally {
        setPending(null)
      }
    },
    [signer, account?.address, refreshBalances, balances]
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
      () => executeStakeLp((effectiveSingleSigner ?? signer)!, SINGLE_ALPHAYIN_STAKE_ADDRESS, amount, SINGLE_ALPHAYIN_USE_STAKING_V4),
      () => {
        sendEvent({ category: 'stake', action: 'stake', name: 'Single ALPHAYIN', value: stakeAmounts[SINGLE_STAKING_KEY] ?? '' })
        setStakeAmounts((p) => ({ ...p, [SINGLE_STAKING_KEY]: '' }))
        fetchContractBalances()
        if (account?.address) {
          getEarnedReward(SINGLE_ALPHAYIN_STAKE_ADDRESS, account.address, SINGLE_ALPHAYIN_USE_STAKING_V4).then(setSingleEarned)
          getStakedBalance(SINGLE_ALPHAYIN_STAKE_ADDRESS, account.address, SINGLE_ALPHAYIN_USE_STAKING_V4).then(setSingleStaked)
        }
      }
    )
  }, [stakeAmounts, run, effectiveSingleSigner, signer, account?.address, fetchContractBalances])

  const handleSingleUnstake = useCallback(() => {
    const amount = parseTokenAmount(unstakeAmounts[SINGLE_STAKING_KEY] ?? '', DECIMALS)
    if (!amount || amount <= BigInt(0)) {
      setError('Enter unstake amount')
      return
    }
    lastSingleUnstakeAmountRef.current = amount
    run(
      SINGLE_STAKING_KEY,
      () =>
        executeUnstakeLp(
          (effectiveSingleSigner ?? signer)!,
          SINGLE_ALPHAYIN_STAKE_ADDRESS,
          amount,
          SINGLE_ALPHAYIN_USE_STAKING_V4
        ),
      () => {
        sendEvent({ category: 'stake', action: 'unstake', name: 'Single ALPHAYIN', value: unstakeAmounts[SINGLE_STAKING_KEY] ?? '' })
        setUnstakeAmounts((p) => ({ ...p, [SINGLE_STAKING_KEY]: '' }))
        fetchContractBalances()
        if (account?.address) {
          getEarnedReward(SINGLE_ALPHAYIN_STAKE_ADDRESS, account.address, SINGLE_ALPHAYIN_USE_STAKING_V4).then(setSingleEarned)
          getStakedBalance(SINGLE_ALPHAYIN_STAKE_ADDRESS, account.address, SINGLE_ALPHAYIN_USE_STAKING_V4).then(setSingleStaked)
        }
      }
    )
  }, [unstakeAmounts, run, effectiveSingleSigner, signer, account?.address, fetchContractBalances])

  const handleUnstakeWithTopUpSubmit = useCallback(() => {
    const unstakeAmountRaw = parseTokenAmount(unstakeAmounts[SINGLE_STAKING_KEY] ?? '', DECIMALS)
    const ayinAmountRaw = parseTokenAmount(unstakeWithTopUpAyinAmount, DECIMALS)
    if (!unstakeAmountRaw || unstakeAmountRaw <= BigInt(0)) {
      setError('Enter unstake amount')
      return
    }
    if (!ayinAmountRaw || ayinAmountRaw <= BigInt(0)) {
      setError('Enter AYIN amount to top up (e.g. 1)')
      return
    }
    const ayinHuman = ayinAmountRaw / (10n ** BigInt(DECIMALS))
    if (ayinHuman <= 0n) {
      setError('AYIN amount too small')
      return
    }
    setUnstakeWithTopUpModalOpen(false)
    run(
      SINGLE_STAKING_KEY,
      () =>
        executeTopUpRewardsThenUnstake(
          (effectiveSingleSigner ?? signer)!,
          SINGLE_ALPHAYIN_STAKE_ADDRESS,
          unstakeAmountRaw,
          ayinHuman,
          AYIN_TOKEN_ID
        ),
      () => {
        sendEvent({ category: 'stake', action: 'unstake', name: 'Single ALPHAYIN (with top-up)' })
        setUnstakeAmounts((p) => ({ ...p, [SINGLE_STAKING_KEY]: '' }))
        setUnstakeWithTopUpAyinAmount('1')
        fetchContractBalances()
        if (account?.address) {
          getEarnedReward(SINGLE_ALPHAYIN_STAKE_ADDRESS, account.address, SINGLE_ALPHAYIN_USE_STAKING_V4).then(setSingleEarned)
          getStakedBalance(SINGLE_ALPHAYIN_STAKE_ADDRESS, account.address, SINGLE_ALPHAYIN_USE_STAKING_V4).then(setSingleStaked)
        }
      }
    )
  }, [unstakeAmounts, unstakeWithTopUpAyinAmount, run, effectiveSingleSigner, signer, account?.address, fetchContractBalances])

  const handleInsufficientAyinRetry = useCallback(() => {
    if (!insufficientAyinPopup || !(effectiveSingleSigner ?? signer)) return
    const { missing, unstakeAmount } = insufficientAyinPopup
    const topUpAmount = missing + 1n
    setInsufficientAyinPopup(null)
    run(
      SINGLE_STAKING_KEY,
      () =>
        executeUnstakeLpChainedWithAyinTopUp(
          (effectiveSingleSigner ?? signer)!,
          SINGLE_ALPHAYIN_STAKE_ADDRESS,
          unstakeAmount,
          AYIN_TOKEN_ID,
          topUpAmount
        ),
      () => {
        sendEvent({ category: 'stake', action: 'unstake', name: 'Single ALPHAYIN (retry with top-up)' })
        setUnstakeAmounts((p) => ({ ...p, [SINGLE_STAKING_KEY]: '' }))
        fetchContractBalances()
        if (account?.address) {
          getEarnedReward(SINGLE_ALPHAYIN_STAKE_ADDRESS, account.address, SINGLE_ALPHAYIN_USE_STAKING_V4).then(setSingleEarned)
          getStakedBalance(SINGLE_ALPHAYIN_STAKE_ADDRESS, account.address, SINGLE_ALPHAYIN_USE_STAKING_V4).then(setSingleStaked)
        }
      }
    )
  }, [insufficientAyinPopup, run, signer, account?.address, fetchContractBalances])

  const handleSingleClaim = useCallback(() => {
    run(
      SINGLE_STAKING_KEY,
      () => executeClaimRewards((effectiveSingleSigner ?? signer)!, SINGLE_ALPHAYIN_STAKE_ADDRESS, SINGLE_ALPHAYIN_USE_STAKING_V4),
      () => {
        sendEvent({ category: 'stake', action: 'claim', name: 'Single ALPHAYIN' })
        fetchContractBalances()
        if (account?.address) {
          getEarnedReward(SINGLE_ALPHAYIN_STAKE_ADDRESS, account.address, SINGLE_ALPHAYIN_USE_STAKING_V4).then(setSingleEarned)
          getStakedBalance(SINGLE_ALPHAYIN_STAKE_ADDRESS, account.address, SINGLE_ALPHAYIN_USE_STAKING_V4).then(setSingleStaked)
        }
      }
    )
  }, [run, effectiveSingleSigner, signer, account?.address, fetchContractBalances])

  const TOP_UP_PENDING_KEY = 'single_topup'
  const handleTopUpSubmit = useCallback(() => {
    const amountRaw = parseTokenAmount(topUpAmount, DECIMALS)
    if (!amountRaw || amountRaw <= BigInt(0)) {
      setError('Enter AYIN amount')
      return
    }
    // Pass human AYIN (1n = 1 AYIN) so lib can scale to raw; avoids large bigint serialization.
    const amountHuman = amountRaw / (10n ** BigInt(DECIMALS))
    if (amountHuman <= 0n) {
      setError('Amount too small')
      return
    }
    run(
      TOP_UP_PENDING_KEY,
      () => executeTopUpRewards((effectiveSingleSigner ?? signer)!, SINGLE_ALPHAYIN_STAKE_ADDRESS, amountHuman, AYIN_TOKEN_ID),
      () => {
        setTopUpModalOpen(false)
        setTopUpAmount('')
        fetchContractBalances()
        sendEvent({ category: 'stake', action: 'topup', name: 'Single ALPHAYIN' })
      }
    )
  }, [topUpAmount, run, effectiveSingleSigner, signer, fetchContractBalances])

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

          {/* Pounder section — separate card, 3 equal columns: Balance | Deposit | Withdraw. Hidden when SHOW_POUNDER is false. */}
          {SHOW_POUNDER && (
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
          )}

          {/* Single staking — stake ALPHAYIN, earn AYIN (lib/Staking ABI). Hidden when SHOW_SINGLE_LP_STAKING is false. */}
          {SHOW_SINGLE_LP_STAKING && (
          <section className="mt-4 overflow-hidden rounded-xl border border-[var(--card-border)] bg-[var(--card)]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--card-border)] px-4 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <img src={TOKEN_LOGOS.alph} alt="" className="h-6 w-6 rounded-full shrink-0" />
                  <img src={TOKEN_LOGOS.ayin} alt="" className="-ml-2 h-6 w-6 rounded-full ring-2 ring-[var(--card)] shrink-0" />
                  <h2 className="text-sm font-semibold text-white">Single LP staking</h2>
                </div>
                
                {singleStakingContractAyin !== null && (
                  <span className="text-xs text-[var(--muted)]">
                    AYIN in contract: <span className="font-medium text-white">{formatTokenAmount(singleStakingContractAyin, DECIMALS)}</span>
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => { setError(null); setTopUpModalOpen(true) }}
                  disabled={!!pending}
                  className="rounded border border-[var(--card-border)] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-white/5 disabled:opacity-50"
                >
                  Top up
                </button>
                <a
                  href={`${EXPLORER_URL}/addresses/${SINGLE_ALPHAYIN_STAKE_ADDRESS}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-[var(--muted)] hover:text-white transition"
                >
                  Contract
                </a>
              </div>
            </div>
            {account?.address ? (
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 px-4 py-3 items-start">
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
                </div>
                <div className="flex min-w-0 flex-col gap-2">
                  <div className="text-xs uppercase tracking-wider text-[var(--muted)]">Stake</div>
                  <div className="flex flex-nowrap items-start gap-2">
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
                  <div className="flex flex-nowrap items-start gap-2">
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
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <button
                        type="button"
                        onClick={handleSingleUnstake}
                        disabled={!!pending}
                        className="w-full rounded bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
                      >
                        {pending === SINGLE_STAKING_KEY ? '…' : 'Unstake'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setUnstakeWithTopUpModalOpen(true)}
                        disabled={!!pending || singleStaked === BigInt(0)}
                        className="w-full rounded border border-[var(--card-border)] px-3 py-1.5 text-sm font-medium text-[var(--muted)] hover:bg-white/5 hover:text-white disabled:opacity-50"
                        title="Top up contract AYIN then unstake in one chained transaction"
                      >
                        Unstake with top-up
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="px-4 py-6 text-center text-sm text-[var(--muted)]">
                Connect your wallet to stake ALPHAYIN and earn AYIN.
              </div>
            )}
          </section>
          )}

          {/* Unstake with top-up modal — single LP: select AYIN amount, then chain topUp + unstake */}
          {unstakeWithTopUpModalOpen && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
              onClick={() => setUnstakeWithTopUpModalOpen(false)}
            >
              <div
                className="w-full max-w-lg rounded-2xl border border-[var(--card-border)] bg-[var(--card)] p-6 shadow-xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-white">Unstake with top-up</h3>
                  <button
                    type="button"
                    onClick={() => setUnstakeWithTopUpModalOpen(false)}
                    className="rounded p-1 text-[var(--muted)] hover:bg-white/10 hover:text-white"
                    aria-label="Close"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <p className="mb-4 text-sm text-[var(--muted)]">
                  First send AYIN to the staking contract (top-up), then unstake your LP in one chained transaction. Use this when the contract has insufficient AYIN to pay rewards.
                </p>
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs text-[var(--muted)]">Unstake amount (ALPHAYIN)</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="0.0"
                      value={unstakeAmounts[SINGLE_STAKING_KEY] ?? ''}
                      onChange={(e) => {
                        const v = e.target.value.replace(/,/g, '.')
                        if (/^[0-9.]*$/.test(v) || v === '') setUnstakeAmounts((p) => ({ ...p, [SINGLE_STAKING_KEY]: v }))
                      }}
                      className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--input-bg)] px-3 py-2 font-mono text-sm text-white placeholder:text-[var(--muted)]"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-[var(--muted)]">AYIN to top up (sent to contract)</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="1"
                      value={unstakeWithTopUpAyinAmount}
                      onChange={(e) => {
                        const v = e.target.value.replace(/,/g, '.')
                        if (/^[0-9.]*$/.test(v) || v === '') setUnstakeWithTopUpAyinAmount(v)
                      }}
                      className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--input-bg)] px-3 py-2 font-mono text-sm text-white placeholder:text-[var(--muted)]"
                    />
                  </div>
                  {error && <p className="text-sm text-red-400">{error}</p>}
                  <button
                    type="button"
                    onClick={handleUnstakeWithTopUpSubmit}
                    disabled={
                      !!pending ||
                      !parseTokenAmount(unstakeAmounts[SINGLE_STAKING_KEY] ?? '', DECIMALS) ||
                      parseTokenAmount(unstakeAmounts[SINGLE_STAKING_KEY] ?? '', DECIMALS)! <= BigInt(0) ||
                      !parseTokenAmount(unstakeWithTopUpAyinAmount, DECIMALS) ||
                      parseTokenAmount(unstakeWithTopUpAyinAmount, DECIMALS)! <= BigInt(0)
                    }
                    className="w-full rounded-xl bg-[var(--accent)] py-3 font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
                  >
                    {pending === SINGLE_STAKING_KEY ? '…' : 'Sign & run (top-up then unstake)'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Top up AYIN modal — single LP staking */}
          {topUpModalOpen && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
              onClick={() => setTopUpModalOpen(false)}
            >
              <div
                className="w-full max-w-lg rounded-2xl border border-[var(--card-border)] bg-[var(--card)] p-6 shadow-xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-white">Top up rewards (AYIN)</h3>
                  <button
                    type="button"
                    onClick={() => setTopUpModalOpen(false)}
                    className="rounded p-1 text-[var(--muted)] hover:bg-white/10 hover:text-white"
                    aria-label="Close"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <p className="mb-4 text-sm text-[var(--muted)]">
                  Anyone can top up the contract with AYIN so it can pay rewards when users claim or unstake. Enter the amount below and sign the transaction.
                </p>
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs text-[var(--muted)]">AYIN amount</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="0.0"
                      value={topUpAmount}
                      onChange={(e) => {
                        const v = e.target.value.replace(/,/g, '.')
                        if (/^[0-9.]*$/.test(v) || v === '') setTopUpAmount(v)
                      }}
                      className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--input-bg)] px-3 py-2 font-mono text-sm text-white placeholder:text-[var(--muted)]"
                    />
                  </div>
                  {error && <p className="text-sm text-red-400">{error}</p>}
                  <button
                    type="button"
                    onClick={handleTopUpSubmit}
                    disabled={!!pending || !topUpAmount || !parseTokenAmount(topUpAmount, DECIMALS) || parseTokenAmount(topUpAmount, DECIMALS)! <= BigInt(0)}
                    className="w-full rounded-xl bg-[var(--accent)] py-3 font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
                  >
                    {pending === TOP_UP_PENDING_KEY ? '…' : 'Sign & top up'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Insufficient AYIN in contract — cannot unstake until top-up */}
          {insufficientAyinPopup && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
              onClick={() => setInsufficientAyinPopup(null)}
            >
              <div
                className="w-full max-w-md rounded-2xl border border-[var(--card-border)] bg-[var(--card)] p-6 shadow-xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-white">Not enough AYIN in contract</h3>
                  <button
                    type="button"
                    onClick={() => setInsufficientAyinPopup(null)}
                    className="rounded p-1 text-[var(--muted)] hover:bg-white/10 hover:text-white"
                    aria-label="Close"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <p className="mb-4 text-sm text-[var(--muted)]">
                  We are sorry. There is not enough AYIN in the staking contract to pay your rewards. Because of that you cannot withdraw (unstake) until the contract is topped up.
                </p>
                <div className="mb-4 rounded-lg border border-[var(--card-border)] bg-[var(--input-bg)] px-3 py-2 font-mono text-sm">
                  <div className="text-xs text-[var(--muted)]">Missing AYIN (to top up)</div>
                  <div className="mt-0.5 text-white">{formatTokenAmount(insufficientAyinPopup.missing, DECIMALS)}</div>
                  <div className="mt-2 text-xs">
                    <span className="text-blue-400">Contract has: {formatTokenAmount(insufficientAyinPopup.got, DECIMALS)}</span>
                    <span className="text-[var(--muted)]"> · </span>
                    <span className="text-red-400">Needed: {formatTokenAmount(insufficientAyinPopup.expected, DECIMALS)}</span>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => setInsufficientAyinPopup(null)}
                    className="w-full rounded-xl border border-[var(--card-border)] py-2.5 text-sm text-[var(--muted)] hover:bg-white/5 hover:text-white"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}
          {      /* Debug LP — override address for single LP; optional public key to simulate as that user (signature still from connected wallet) */}        
          {SHOW_SINGLE_LP_STAKING && (

          <section className="mt-4 overflow-hidden rounded-xl border border-amber-500/30 bg-[var(--card)]">
            <button
              type="button"
              onClick={() => setDebugLpSectionOpen((o) => !o)}
              className="flex w-full items-center justify-between border-b border-amber-500/30 px-4 py-2 text-left hover:bg-white/5"
              aria-expanded={debugLpSectionOpen}
            >
              <h2 className="text-sm font-semibold text-amber-400">Debug LP</h2>
              <svg
                className={`h-4 w-4 shrink-0 text-amber-400 transition-transform ${debugLpSectionOpen ? 'rotate-180' : ''}`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {debugLpSectionOpen && (
            <div className="px-4 py-3 space-y-3">
              <p className="text-xs text-[var(--muted)] -mt-1">
                Override wallet for single LP data and actions. When address is set, staked and single-LP actions (stake, unstake, top-up) run build/simulation as this address. Add the other user&apos;s public key to reproduce their errors (e.g. &quot;Not enough approved balance&quot;). Signing still uses the connected wallet so the final signature may be invalid.
              </p>
              <div>
                <label className="mb-1 block text-xs text-[var(--muted)]">Wallet address (override)</label>
                <input
                  type="text"
                  placeholder="Leave empty to use connected wallet"
                  value={debugLpAddress}
                  onChange={(e) => setDebugLpAddress(e.target.value)}
                  className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--input-bg)] px-3 py-2 font-mono text-sm text-white placeholder:text-[var(--muted)]"
                />
              </div>
              {debugLpAddress.trim() && (
                <div>
                  <label className="mb-1 block text-xs text-[var(--muted)]">Public key (for simulation)</label>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      placeholder="Paste or fetch from chain"
                      value={debugLpPublicKey}
                      onChange={(e) => { setDebugLpPublicKey(e.target.value); setDebugLpPublicKeyError(null) }}
                      className="min-w-0 flex-1 rounded-lg border border-[var(--card-border)] bg-[var(--input-bg)] px-3 py-2 font-mono text-sm text-white placeholder:text-[var(--muted)]"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        const addr = debugLpAddress.trim()
                        if (!addr) return
                        setDebugLpPublicKeyFetching(true)
                        setDebugLpPublicKeyError(null)
                        try {
                          const key = await fetchPublicKeyForAddress(BACKEND_URL, addr)
                          if (key) {
                            setDebugLpPublicKey(key)
                          } else {
                            setDebugLpPublicKeyError('Not found. Address must have signed at least one transaction (explorer + node).')
                          }
                        } catch (e) {
                          setDebugLpPublicKeyError(e instanceof Error ? e.message : 'Fetch failed')
                        } finally {
                          setDebugLpPublicKeyFetching(false)
                        }
                      }}
                      disabled={debugLpPublicKeyFetching}
                      className="shrink-0 rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-400 hover:bg-amber-500/20 disabled:opacity-50"
                    >
                      {debugLpPublicKeyFetching ? '…' : 'Fetch from chain'}
                    </button>
                  </div>
                  {debugLpPublicKeyError && (
                    <p className="mt-1 text-xs text-amber-400">{debugLpPublicKeyError}</p>
                  )}
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    Without this, build uses the connected wallet key so simulation may not match the override address. Public key is visible in any transaction signed by this address (e.g. unlock script).
                  </p>
                </div>
              )}
              {debugLpAddress.trim() && (
                <p className="text-xs text-[var(--muted)]">
                  Viewing single LP as: <span className="font-mono text-white break-all">{debugLpAddress.trim()}</span>
                </p>
              )}
            </div>
            )}
          </section>
          )} 
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
