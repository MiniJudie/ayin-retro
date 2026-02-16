import {
  signExecuteMethod,
  addressFromContractId,
  DUST_AMOUNT,
  type SignerProvider,
  type SignExecuteScriptTxParams,
  type SignChainedTxParams,
  type SignTransferTxParams,
  type SignDeployContractTxParams,
  type SignUnsignedTxParams,
  type SignMessageParams,
} from '@alephium/web3'

import { web3, waitForTxConfirmation, DappTransactionBuilder} from '@alephium/web3'

/** 1 ALPH required by StakingV4/Staking for stake (create/fund staking account). */
const ONE_ALPH = BigInt('1000000000000000000')
/** ALPH to attach for claim/unstake (staking account may require 0.002 ALPH). */
const MIN_ALPH_FOR_CLAIM_UNSTAKE = BigInt('2000000000000000') // 0.002 ALPH
import { Staking } from './Staking'
import { StakingV4 } from './StakingV4'
import { StakingAccount } from './StakingAccount'
import { AYIN_DECIMALS, SINGLE_ALPHAYIN_STAKE_ADDRESS, STAKING_V4_KEYS } from './config'
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

/** Error used to capture ExecuteScript tx params from signExecuteMethod without submitting. */
class CapturedExecuteScriptParamsError extends Error {
  constructor(public readonly params: SignExecuteScriptTxParams) {
    super('CaptureExecuteScriptParams')
    this.name = 'CapturedExecuteScriptParamsError'
  }
}

/** Signer that captures ExecuteScript params when signAndSubmitExecuteScriptTx is called and throws with them. */
function createCaptureExecuteScriptSigner(real: SignerProvider): SignerProvider {
  return {
    get nodeProvider() {
      return real.nodeProvider
    },
    get explorerProvider() {
      return real.explorerProvider
    },
    getSelectedAccount: () => real.getSelectedAccount(),
    signAndSubmitTransferTx: (p: SignTransferTxParams) => real.signAndSubmitTransferTx(p),
    signAndSubmitDeployContractTx: (p: SignDeployContractTxParams) => real.signAndSubmitDeployContractTx(p),
    async signAndSubmitExecuteScriptTx(params: SignExecuteScriptTxParams) {
      throw new CapturedExecuteScriptParamsError(params)
    },
    signAndSubmitUnsignedTx: (p: SignUnsignedTxParams) => real.signAndSubmitUnsignedTx(p),
    signAndSubmitChainedTx: (p: SignChainedTxParams[]) => real.signAndSubmitChainedTx(p),
    signUnsignedTx: (p: SignUnsignedTxParams) => real.signUnsignedTx(p),
    signMessage: (p: SignMessageParams) => real.signMessage(p),
  } as unknown as SignerProvider
}

/** If address is a StakingAccount contract, return the staker (wallet) address; otherwise return the input. Use when the user might pass a StakingAccount address instead of their wallet. */
export async function resolveStakerAddress(address: string): Promise<string> {
  try {
    const account = StakingAccount.at(address)
    const res = await account.view.getStaker()
    const ret = (res as { returns?: unknown }).returns
    const staker = Array.isArray(ret) ? ret[0] : ret
    if (staker != null && typeof staker === 'string') return staker
  } catch {
    // not a StakingAccount or call failed
  }
  return address
}

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

const REWARD_PRECISION = BigInt('1000000000000000000') // 1e18 for reward math

function parseViewReturn<T>(res: unknown): T {
  const ret = (res as { returns?: unknown }).returns
  const v = Array.isArray(ret) ? ret[0] : ret
  return v as T
}

/** Fetch earned (unclaimed) reward for a staker. Returns 0n if no account or on error. For StakingV4, uses parent earned(acc) when possible; if that returns 0, computes from StakingAccount state + parent rewardPerToken. */
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
    const raw = parseViewReturn<unknown>(accountRes)
    if (raw == null) return 0n

    const hex = typeof raw === 'string' ? (raw.startsWith('0x') ? raw.slice(2) : raw) : ''
    const isAccountRef = hex.length === 64 && /^[0-9a-fA-F]+$/.test(hex)

    if (useStakingV4 && isAccountRef) {
      const earnedRes = await instance.view.earned({ args: { acc: raw as string } })
      const earnedVal = parseViewReturn<bigint | number>(earnedRes)
      const fromParent = typeof earnedVal === 'bigint' ? earnedVal : BigInt(earnedVal ?? 0)
      if (fromParent > 0n) return fromParent

      const accountAddress = addressFromContractId(hex)
      const account = StakingAccount.at(accountAddress)
      const [rewardsRes, amountRes, paidRes, rptRes] = await Promise.all([
        account.view.getRewards(),
        account.view.getAmountStaked(),
        account.view.getRewardPerTokenPaid(),
        instance.view.calculateRewardPerToken(),
      ])
      const rewards = BigInt(parseViewReturn<bigint | number>(rewardsRes) ?? 0)
      const amountStaked = BigInt(parseViewReturn<bigint | number>(amountRes) ?? 0)
      const rewardPerTokenPaid = BigInt(parseViewReturn<bigint | number>(paidRes) ?? 0)
      const rewardPerToken = BigInt(parseViewReturn<bigint | number>(rptRes) ?? 0)
      const delta = rewardPerToken - rewardPerTokenPaid
      const accrued = (amountStaked * delta) / REWARD_PRECISION
      return rewards + accrued
    }

    const earnedRes = await instance.view.earned({ args: { acc: raw as string } })
    const earnedRaw = parseViewReturn<bigint | number>(earnedRes)
    return typeof earnedRaw === 'bigint' ? earnedRaw : BigInt(earnedRaw ?? 0)
  } catch {
    return 0n
  }
}

/** Fetch amountStaked * rewardPerTokenPaid for a staker (StakingAccount only). Returns 0n if no StakingAccount contract or on error. */
export async function getRewardToPaid(
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

    const hex = typeof raw === 'string' ? (raw.startsWith('0x') ? raw.slice(2) : raw) : ''
    if (hex.length !== 64 || !/^[0-9a-fA-F]+$/.test(hex)) return 0n

    const accountAddress = addressFromContractId(hex)
    const account = StakingAccount.at(accountAddress)
    const [amountRes, rewardPerTokenRes] = await Promise.all([
      account.view.getAmountStaked(),
      account.view.getRewardPerTokenPaid(),
    ])
    const toBigInt = (res: unknown): bigint => {
      const ret = (res as { returns?: unknown }).returns
      const v = Array.isArray(ret) ? ret[0] : ret
      return typeof v === 'bigint' ? v : BigInt(v ?? 0)
    }
    const amountStaked = toBigInt(amountRes)
    const rewardPerTokenPaid = toBigInt(rewardPerTokenRes)
    return amountStaked * rewardPerTokenPaid
  } catch {
    return 0n
  }
}
/** Fetch rewardPerTokenPaid for a staker (StakingAccount only). Returns 0n if no StakingAccount contract or on error. */
export async function getRewardPerTokenPaid(
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

    const hex = typeof raw === 'string' ? (raw.startsWith('0x') ? raw.slice(2) : raw) : ''
    if (hex.length !== 64 || !/^[0-9a-fA-F]+$/.test(hex)) return 0n

    const accountAddress = addressFromContractId(hex)
    const account = StakingAccount.at(accountAddress)
    const rewardPerTokenRes = await account.view.getRewardPerTokenPaid()
    const amountReturns = (rewardPerTokenRes as { returns?: unknown }).returns
    const val = Array.isArray(amountReturns) ? amountReturns[0] : amountReturns
    return typeof val === 'bigint' ? val : BigInt(val ?? 0)
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

    const hex = typeof raw === 'string' ? (raw.startsWith('0x') ? raw.slice(2) : raw) : ''
    if (hex.length === 64 && /^[0-9a-fA-F]+$/.test(hex)) {
      const accountAddress = addressFromContractId(hex)
      console.log(`${label}: accountAddress=${accountAddress} for staker=${userAddress}`)
      const account = StakingAccount.at(accountAddress)
      const amountRes = await account.view.getAmountStaked()
      const amountReturns = (amountRes as { returns?: unknown }).returns
      const val = Array.isArray(amountReturns) ? amountReturns[0] : amountReturns
      const result = typeof val === 'bigint' ? val : BigInt(val ?? 0)
      console.log(`${label}: StakingAccount.getAmountStaked → result=${result}`)
      return result
    }

    const result = parseStakedAmountFromRaw(raw, label)
    console.log(`${label}: → result=${result}`)
    return result
  } catch (e) {
    console.log(`${label}: catch`, e)
    return 0n
  }
}

/** Fetch unclaimed rewards for a staker. Handles 64-char StakingAccount contract id (StakingAccount.getRewards) and fallback to staking.earned(acc). Returns 0n if no account or on error. */
export async function getRewardsBalance(
  stakingAddress: string,
  userAddress: string,
  useStakingV4: boolean
): Promise<bigint> {
  const label = `getRewardsBalance ${useStakingV4 ? 'V4' : 'V2'} ${stakingAddress.slice(0, 8)}…`
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
    if (raw == null) return 0n

    const hex = typeof raw === 'string' ? (raw.startsWith('0x') ? raw.slice(2) : raw) : ''
    if (hex.length === 64 && /^[0-9a-fA-F]+$/.test(hex)) {
      const accountAddress = addressFromContractId(hex)
      const account = StakingAccount.at(accountAddress)
      const rewardsRes = await account.view.getRewards()
      const rewardsReturns = (rewardsRes as { returns?: unknown }).returns
      const val = Array.isArray(rewardsReturns) ? rewardsReturns[0] : rewardsReturns
      const result = typeof val === 'bigint' ? val : BigInt(val ?? 0)
      console.log(`${label}: StakingAccount.getRewards → result=${result}`)
      return result
    }

    const earnedRes = await instance.view.earned({ args: { acc: raw as string } })
    const earnedReturns = (earnedRes as { returns?: unknown }).returns
    const earnedRaw = Array.isArray(earnedReturns) ? earnedReturns[0] : earnedReturns
    const result = typeof earnedRaw === 'bigint' ? earnedRaw : BigInt(earnedRaw ?? 0)
    console.log(`${label}: → result=${result}`)
    return result
  } catch (e) {
    console.log(`${label}: catch`, e)
    return 0n
  }
}

/** Claim pending rewards from a pool's staking contract. Attaches 0.001 ALPH for StakingV4 (sent to parent contract). If you see "expected 0.001 ALPH, got 0 ALPH" for an address, that is your staking account contract — send 0.001 ALPH to that address once from your wallet, then try claiming again. */
export async function executeClaimRewards(
  signer: SignerProvider,
  stakingAddress: string,
  useStakingV4: boolean
): Promise<{ txId: string }> {
  const attoAlphAmount = MIN_ALPH_FOR_CLAIM_UNSTAKE
  if (useStakingV4) {
    const instance = StakingV4.at(stakingAddress)
    const result = await signExecuteMethod(StakingV4, instance, 'claimRewards', {
      signer,
      args: {},
      attoAlphAmount,
    })
    return { txId: result.txId }
  } else {
    const instance = Staking.at(stakingAddress)
    const result = await signExecuteMethod(Staking, instance, 'claimRewards', {
      signer,
      args: {},
      attoAlphAmount,
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

/** Unstake LP tokens from a pool's staking contract. Attaches 0.002 ALPH so the StakingAccount (StakingV4) or script has the required balance. */
export async function executeUnstakeLp(
  signer: SignerProvider,
  stakingAddress: string,
  amount: bigint,
  useStakingV4: boolean
): Promise<{ txId: string }> {
  const attoAlphAmount = MIN_ALPH_FOR_CLAIM_UNSTAKE
  if (useStakingV4) {
    const instance = StakingV4.at(stakingAddress)
    const result = await signExecuteMethod(StakingV4, instance, 'unstake', {
      signer,
      args: { amount },
      attoAlphAmount,
    })
    return { txId: result.txId }
  } else {
    const instance = Staking.at(stakingAddress)
    const result = await signExecuteMethod(Staking, instance, 'unstake', {
      signer,
      args: { amount },
      attoAlphAmount,
    })
    return { txId: result.txId }
  }
}

/**
 * Unstake LP from a StakingV4 pool in one signature: first sends 0.002 ALPH to the user's StakingAccount, then calls unstake.
 * Use this when the StakingAccount has no ALPH (avoids "expected 0.002 ALPH" and a second tx). Only supports StakingV4.
 */
export async function executeUnstakeLpChained(
  signer: SignerProvider,
  stakingAddress: string,
  amount: bigint
): Promise<{ txId: string }> {
  const instance = StakingV4.at(stakingAddress)
  const account = await signer.getSelectedAccount()

  const accountRes = await instance.view.getStakingAccount({
    args: { staker: account.address as `@${string}` },
  })
  const raw = (accountRes as { returns?: unknown }).returns
  const rawVal = Array.isArray(raw) ? raw[0] : raw
  const hex =
    typeof rawVal === 'string'
      ? rawVal.startsWith('0x')
        ? rawVal.slice(2)
        : rawVal
      : ''
  if (hex.length !== 64 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error('No staking account found for this address. Stake first before unstaking.')
  }
  const stakingAccountAddress = addressFromContractId(hex)

  const captureSigner = createCaptureExecuteScriptSigner(signer)
  let scriptParams: SignExecuteScriptTxParams | undefined
  try {
    await signExecuteMethod(StakingV4, instance, 'unstake', {
      signer: captureSigner,
      args: { amount },
      attoAlphAmount: 0n,
    })
  } catch (e) {
    if (e instanceof CapturedExecuteScriptParamsError) {
      scriptParams = e.params
    } else {
      throw e
    }
  }
  if (!scriptParams) {
    throw new Error('Failed to build unstake script params')
  }

  const transferParams: SignChainedTxParams = {
    type: 'Transfer',
    signerAddress: account.address,
    signerKeyType: account.keyType,
    destinations: [
      {
        address: stakingAccountAddress,
        attoAlphAmount: MIN_ALPH_FOR_CLAIM_UNSTAKE,
      },
    ],
  }
  const executeScriptParams: SignChainedTxParams = {
    type: 'ExecuteScript',
    ...scriptParams,
  }

  const results = await signer.signAndSubmitChainedTx([transferParams, executeScriptParams])
  const unstakeResult = results[1]
  if (!unstakeResult || unstakeResult.type !== 'ExecuteScript') {
    throw new Error('Chained tx failed: missing unstake result')
  }
  return { txId: unstakeResult.txId }
}

/** 1 AYIN in smallest units (18 decimals). */
const ONE_AYIN_RAW = 10n ** 18n

/** Normalize token id to 32-char hex for contract calls. */
function normalizeTokenIdForTopUp(id: string): string {
  const s = (id ?? '').trim().toLowerCase().replace(/^0x/, '')
  if (s.length !== 64 || !/^[0-9a-f]+$/.test(s)) throw new Error('Invalid AYIN token id')
  return s
}

/**
 * Parse "Not enough approved balance" error for a given contract and AYIN token.
 * Returns { expected, got, missing } when the error matches (expected = amount needed, got = current balance; missing = expected - got).
 */
export function parseInsufficientAyinError(
  message: string,
  contractAddress: string,
  ayinTokenId: string
): { expected: bigint; got: bigint; missing: bigint } | null {
  if (!message.includes('Not enough approved balance')) return null
  const normContract = (contractAddress ?? '').trim()
  const normToken = (ayinTokenId ?? '').trim().toLowerCase().replace(/^0x/, '')
  if (normContract && !message.includes(normContract)) return null
  if (normToken.length === 64 && !message.toLowerCase().includes(normToken)) return null
  const match = message.match(/expected\s*:?\s*(\d+)\s*,\s*got\s*:?\s*(\d+)/i)
  if (!match) return null
  const expected = BigInt(match[1])
  const got = BigInt(match[2])
  const missing = expected > got ? expected - got : 0n
  return { expected, got, missing }
}

/** Get the owner address of a StakingV4 staking contract. Returns null if fetch fails. */
export async function getStakingContractOwner(stakingAddress: string): Promise<string | null> {
  try {
    const instance = StakingV4.at(stakingAddress)
    const state = await instance.fetchState()
    const owner = (state.fields as { owner_?: string }).owner_
    return owner ?? null
  } catch {
    return null
  }
}

const TOP_UP_CONTRACT_ADDRESS = 'tuuAwnJNwxew6chSHV74CW9Er18EE925Ss2fQMmZbWtF'
const AYIN_TOKEN_ID_FOR_TOP_UP = '1a281053ba8601a658368594da034c2e99a0fb951b86498d05e76aedfe666800'

/** Build tx params for topUpRewards (execute script). amount = human AYIN (1n = 1 AYIN). */
function buildTopUpRewardsTxParams(signerAddress: string, amountHuman: bigint): SignExecuteScriptTxParams {
  const rawAmount = amountHuman * (10n ** BigInt(AYIN_DECIMALS))
  const builder = new DappTransactionBuilder(signerAddress)
  return builder.callContract({
    contractAddress: TOP_UP_CONTRACT_ADDRESS,
    methodIndex: 20,
    args: [rawAmount],
    attoAlphAmount: DUST_AMOUNT,
    tokens: [{ id: AYIN_TOKEN_ID_FOR_TOP_UP, amount: rawAmount }],
  }).getResult()
}

/**
 * Top up the staking contract's AYIN rewards balance. Only the contract owner can call this; others will get an assertion error.
 */
export async function executeTopUpRewards(
  signer: SignerProvider,
  stakingAddress: string,
  amount: bigint,
  ayinTokenId: string
): Promise<{ txId: string }> {
  const account = await signer.getSelectedAccount()
  if (!account) throw new Error('No account selected')
  const topUpParams = buildTopUpRewardsTxParams(account.address, amount)
  const txResult = await signer.signAndSubmitExecuteScriptTx(topUpParams)

  return { txId: txResult.txId }
}

/**
 * Chained tx: first top up the staking contract's AYIN rewards, then unstake LP.
 * Use when the contract has insufficient AYIN to pay rewards on unstake. Only StakingV4.
 */
export async function executeTopUpRewardsThenUnstake(
  signer: SignerProvider,
  stakingAddress: string,
  unstakeAmount: bigint,
  ayinTopUpAmountHuman: bigint,
  ayinTokenId: string
): Promise<{ txId: string }> {
  if (ayinTopUpAmountHuman <= 0n) throw new Error('AYIN top-up amount must be positive')
  const account = await signer.getSelectedAccount()
  if (!account) throw new Error('No account selected')

  const topUpParams = buildTopUpRewardsTxParams(account.address, ayinTopUpAmountHuman)

  const instance = StakingV4.at(stakingAddress)
  const captureSigner = createCaptureExecuteScriptSigner(signer)
  let unstakeParams: SignExecuteScriptTxParams | undefined
  try {
    await signExecuteMethod(StakingV4, instance, 'unstake', {
      signer: captureSigner,
      args: { amount: unstakeAmount },
      attoAlphAmount: MIN_ALPH_FOR_CLAIM_UNSTAKE,
    })
  } catch (e) {
    if (e instanceof CapturedExecuteScriptParamsError) {
      unstakeParams = e.params
    } else {
      throw e
    }
  }
  if (!unstakeParams) throw new Error('Failed to build unstake tx params')

  const results = await signer.signAndSubmitChainedTx([
    { type: 'ExecuteScript', ...topUpParams },
    { type: 'ExecuteScript', ...unstakeParams },
  ])
  const last = results[results.length - 1]
  const txId = last && 'txId' in last ? (last as { txId: string }).txId : ''
  return { txId }
}

/**
 * Unstake LP from a StakingV4 pool in one transaction. Optionally attach AYIN to the unstake call so the contract can pay rewards
 * (e.g. from parseInsufficientAyinError: missing + 1n). Default is 1 AYIN when not specified.
 */
export async function executeUnstakeLpChainedWithAyinTopUp(
  signer: SignerProvider,
  stakingAddress: string,
  amount: bigint,
  ayinTokenId: string,
  ayinTopUpAmount?: bigint
): Promise<{ txId: string }> {
  const instance = StakingV4.at(stakingAddress)
  const normalizedAyinId = (ayinTokenId ?? '').trim().toLowerCase().replace(/^0x/, '')
  if (normalizedAyinId.length !== 64 || !/^[0-9a-f]+$/.test(normalizedAyinId)) {
    throw new Error('Invalid AYIN token id')
  }
  const ayinToAttach = ayinTopUpAmount ?? ONE_AYIN_RAW
  if (ayinToAttach <= 0n) throw new Error('AYIN amount to attach must be positive')


    const account = await signer.getSelectedAccount()

    const builder = new DappTransactionBuilder(account?.address)
    
    const result = builder.callContract({
      contractAddress: 'tuuAwnJNwxew6chSHV74CW9Er18EE925Ss2fQMmZbWtF',
      methodIndex: 20,
      args: [ayinToAttach],
      attoAlphAmount: DUST_AMOUNT,
      tokens: [{ id: '1a281053ba8601a658368594da034c2e99a0fb951b86498d05e76aedfe666800', amount: ayinToAttach }],
    }).getResult()

    const txResult = await signer.signAndSubmitExecuteScriptTx(result)
    return { txId: txResult.txId }
  
  
}

export function isStakingV4(poolKey: string): boolean {
  return STAKING_V4_KEYS.has(poolKey)
}
