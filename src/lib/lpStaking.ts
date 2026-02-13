import { signExecuteMethod, ONE_ALPH, web3, addressFromContractId } from '@alephium/web3'
import type { SignerProvider } from '@alephium/web3'
import { Staking } from './Staking'
import { StakingV4 } from './StakingV4'
import { STAKING_V4_KEYS } from './config'
import { registerCodeHashAlias } from './contracts-registry'

// On-chain StakingV4 deployments may have a different code hash. Map them to our StakingV4 contract.
registerCodeHashAlias(
  'ac23901b2567dbd26ff1b19681d54b8310d1cb9622a24bf94482c7ac66940a20',
  StakingV4
)
registerCodeHashAlias(
  'cb665a9ca0fff0b0e237b0b21c15b5890bb8366a814ad9d2afd64c1b73fc83f3',
  StakingV4
)
// On-chain Staking (V2) deployments may have a different code hash.
registerCodeHashAlias(
  '8674144cd2f1351516913e68b9e3014d6340d5c572dcde909615d61b4fda587c',
  Staking
)

/** Normalize token id to 32-char hex (no 0x) for tx building. */
function normalizeTokenId(id: string): string {
  const s = (id ?? '').trim().toLowerCase()
  return s.startsWith('0x') ? s.slice(2) : s
}

/** Fetch the LP token id that the staking contract accepts (use this for stake tx). */
export async function getLpTokenIdFromStakingContract(
  stakingAddress: string,
  useStakingV4: boolean
): Promise<string> {
  const instance = useStakingV4
    ? StakingV4.at(stakingAddress)
    : Staking.at(stakingAddress)
  const res = await instance.view.getTokenId({})
  // When there is a single return value, the SDK sets returns = that value (not an array), so res.returns is the hex string.
  const returns = (res as { returns?: unknown }).returns
  const raw = Array.isArray(returns) ? returns[0] : returns
  const str = typeof raw === 'string' ? raw : raw != null ? String(raw) : ''
  const normalized = normalizeTokenId(str)
  if (normalized.length !== 64 || !/^[0-9a-f]+$/.test(normalized)) {
    throw new Error('Could not read LP token id from staking contract (expected 32-byte hex)')
  }
  return normalized
}

/** Fetch earned (unclaimed) reward for a staker. Returns 0n if no account or on error. */
export async function getEarnedReward(
  stakingAddress: string,
  userAddress: string,
  useStakingV4: boolean
): Promise<bigint> {
  try {
    const instance = useStakingV4
      ? StakingV4.at(stakingAddress)
      : Staking.at(stakingAddress)
    const accountRes = await instance.view.getStakingAccount({
      args: { staker: userAddress as `@${string}` },
    })
    const accountReturns = (accountRes as { returns?: unknown }).returns
    const raw = Array.isArray(accountReturns) ? accountReturns[0] : accountReturns
    if (raw == null) return 0n
    const earnedRes = await instance.view.earned({ args: { acc: raw as string } })
    const earnedReturns = (earnedRes as { returns?: unknown }).returns
    const earnedRaw = Array.isArray(earnedReturns) ? earnedReturns[0] : earnedReturns
    return typeof earnedRaw === 'bigint' ? earnedRaw : BigInt(earnedRaw ?? 0)
  } catch {
    return 0n
  }
}

// Sanity cap: no reasonable LP stake is above this (avoids showing rewardPerTokenPaid or wrong field).
const MAX_REASONABLE_STAKED = BigInt('1000000000000000000000000') // 1e24 with 18 decimals

function parseStakedAmountFromRaw(raw: unknown, debugLabel?: string): bigint {
  const label = debugLabel ? `[${debugLabel}] ` : ''
  if (raw == null) {
    console.log(`${label}parseStakedAmountFromRaw: raw is null/undefined → 0n`)
    return 0n
  }
  if (Array.isArray(raw)) {
    const a = raw[0] != null ? (typeof raw[0] === 'bigint' ? raw[0] : BigInt(Number(raw[0]))) : 0n
    const b = raw[1] != null ? (typeof raw[1] === 'bigint' ? raw[1] : BigInt(Number(raw[1]))) : 0n
    const amt = a <= MAX_REASONABLE_STAKED ? a : b <= MAX_REASONABLE_STAKED ? b : 0n
    console.log(`${label}parseStakedAmountFromRaw: array [${a}, ${b}] → amt=${amt}`)
    return amt
  }
  if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    const amountVal = o['amount'] ?? o['amountStaked']
    const rewardPerTokenVal = o['rewardPerTokenPaid']
    const toBigInt = (x: unknown) => (x == null ? 0n : typeof x === 'bigint' ? x : BigInt(Number(x)))
    const v1 = toBigInt(amountVal)
    const v2 = toBigInt(rewardPerTokenVal)
    const keys = Object.keys(o)
    console.log(`${label}parseStakedAmountFromRaw: object keys=${keys.join(',')} amount=${v1} rewardPerTokenPaid=${v2} cap=${MAX_REASONABLE_STAKED}`)
    if (v1 <= MAX_REASONABLE_STAKED && v1 >= 0n) {
      console.log(`${label}parseStakedAmountFromRaw: using v1 (amount) → ${v1}`)
      return v1
    }
    if (v2 <= MAX_REASONABLE_STAKED && v2 >= 0n) {
      console.log(`${label}parseStakedAmountFromRaw: using v2 (rewardPerTokenPaid) → ${v2}`)
      return v2
    }
    console.log(`${label}parseStakedAmountFromRaw: both above cap → 0n`)
    return 0n
  }
  const str = typeof raw === 'string' ? raw : String(raw)
  const hex = str.startsWith('0x') ? str.slice(2) : str
  if (hex.length < 64) {
    console.log(`${label}parseStakedAmountFromRaw: string length ${hex.length} < 64 → 0n`)
    return 0n
  }
  const v1 = BigInt('0x' + hex.slice(0, 64).padStart(64, '0'))
  const v2 = hex.length >= 128 ? BigInt('0x' + hex.slice(64, 128)) : 0n
  const amt = v1 <= MAX_REASONABLE_STAKED ? v1 : v2 <= MAX_REASONABLE_STAKED ? v2 : 0n
  console.log(`${label}parseStakedAmountFromRaw: ByteVec len=${hex.length} v1=${v1} v2=${v2} → amt=${amt}`)
  return amt
}

/** When getStakingAccount returns a 64-char hex (staking account contract id), fetch that contract's state and read staked amount from fields. */
async function getStakedAmountFromAccountContract(accountContractIdHex: string): Promise<bigint> {
  const hex = accountContractIdHex.startsWith('0x') ? accountContractIdHex.slice(2) : accountContractIdHex
  if (hex.length !== 64 || !/^[0-9a-fA-F]+$/.test(hex)) return 0n
  try {
    const nodeProvider = web3.getCurrentNodeProvider()
    if (!nodeProvider) return 0n
    const address = addressFromContractId(hex)
    const state = await nodeProvider.contracts.getContractsAddressState(address)
    const fields = [...(state.immFields ?? []), ...(state.mutFields ?? [])]
    for (const f of fields) {
      const v = (f as { type?: string; value?: string }).value
      const t = (f as { type?: string }).type
      if (t !== 'U256' && t !== 'I256' || v === undefined) continue
      const n = BigInt(v)
      if (n >= 0n && n <= MAX_REASONABLE_STAKED) return n
    }
  } catch {
    // ignore
  }
  return 0n
}

/** Fetch staked LP amount for a staker. Handles ByteVec (Staking), StakingAccount struct (StakingV4), and 64-char account contract id. Returns 0n if no account or on error. */
export async function getStakedBalance(
  stakingAddress: string,
  userAddress: string,
  useStakingV4: boolean
): Promise<bigint> {
  const label = `getStakedBalance ${useStakingV4 ? 'V4' : 'V2'} ${stakingAddress.slice(0, 8)}…`
  try {
    const instance = useStakingV4
      ? StakingV4.at(stakingAddress)
      : Staking.at(stakingAddress)
    const accountRes = await instance.view.getStakingAccount({
      args: { staker: userAddress as `@${string}` },
    })
    const returns = (accountRes as { returns?: unknown }).returns
    const isArray = Array.isArray(returns)
    const raw = isArray ? returns[0] : returns
    console.log(`${label}: getStakingAccount returns isArray=${isArray} raw type=${typeof raw}`, raw != null && typeof raw === 'object' ? { keys: Object.keys(raw as object) } : raw)
    let result = parseStakedAmountFromRaw(raw, label)
    // When the return is a 64-char hex (staking account contract id), parsing yields 0n; fetch amount from that contract.
    if (result === 0n && typeof raw === 'string') {
      const hex = raw.startsWith('0x') ? raw.slice(2) : raw
      if (hex.length === 64 && /^[0-9a-fA-F]+$/.test(hex)) {
        result = await getStakedAmountFromAccountContract(raw)
        console.log(`${label}: account contract fallback → result=${result}`)
      }
    }
    console.log(`${label}: → result=${result}`)
    return result
  } catch (e) {
    console.log(`${label}: catch`, e)
    return 0n
  }
}

/** Claim pending rewards from a pool's staking contract. */
export async function executeClaimRewards(
  signer: SignerProvider,
  stakingAddress: string,
  useStakingV4: boolean
): Promise<{ txId: string }> {
  if (useStakingV4) {
    const instance = StakingV4.at(stakingAddress)
    const result = await signExecuteMethod(StakingV4, instance, 'claimRewards', {
      signer,
      args: {},
    })
    return { txId: result.txId }
  } else {
    const instance = Staking.at(stakingAddress)
    const result = await signExecuteMethod(Staking, instance, 'claimRewards', {
      signer,
      args: {},
    })
    return { txId: result.txId }
  }
}

/** Stake LP tokens in a pool's staking contract. Uses the LP token id from the staking contract so the correct token is attached. */
export async function executeStakeLp(
  signer: SignerProvider,
  stakingAddress: string,
  amount: bigint,
  useStakingV4: boolean
): Promise<{ txId: string }> {
  const lpTokenId = await getLpTokenIdFromStakingContract(stakingAddress, useStakingV4)
  // Contract requires exactly 1 ALPH to be attached (validated on-chain).
  const attoAlphAmount = ONE_ALPH
  if (useStakingV4) {
    const instance = StakingV4.at(stakingAddress)
    const result = await signExecuteMethod(StakingV4, instance, 'stake', {
      signer,
      args: { amount },
      attoAlphAmount,
      tokens: [{ id: lpTokenId, amount }],
    })
    return { txId: result.txId }
  } else {
    const instance = Staking.at(stakingAddress)
    const result = await signExecuteMethod(Staking, instance, 'stake', {
      signer,
      args: { amount },
      attoAlphAmount,
      tokens: [{ id: lpTokenId, amount }],
    })
    return { txId: result.txId }
  }
}

/** Unstake LP tokens from a pool's staking contract. */
export async function executeUnstakeLp(
  signer: SignerProvider,
  stakingAddress: string,
  amount: bigint,
  useStakingV4: boolean
): Promise<{ txId: string }> {
  if (useStakingV4) {
    const instance = StakingV4.at(stakingAddress)
    const result = await signExecuteMethod(StakingV4, instance, 'unstake', {
      signer,
      args: { amount },
    })
    return { txId: result.txId }
  } else {
    const instance = Staking.at(stakingAddress)
    const result = await signExecuteMethod(Staking, instance, 'unstake', {
      signer,
      args: { amount },
    })
    return { txId: result.txId }
  }
}

export function isStakingV4(poolKey: string): boolean {
  return STAKING_V4_KEYS.has(poolKey)
}
