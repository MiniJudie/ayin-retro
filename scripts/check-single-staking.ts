#!/usr/bin/env node
/**
 * Check single ALPH/AYIN LP staking position for any address.
 * Accepts either your wallet (staker) address or your StakingAccount contract address.
 * Outputs: amount staked, claimable rewards (AYIN), stored rewards, rewardToPaid.
 *
 * Usage: npx tsx scripts/check-single-staking.ts <address>
 *   or:  npm run check-single-staking -- <address>
 *
 * Uses NEXT_PUBLIC_NODE_URL from env (optional; defaults to mainnet).
 */

import { web3 } from '@alephium/web3'
import {
  getEarnedReward,
  getRewardToPaid,
  getRewardsBalance,
  getStakedBalance,
  resolveStakerAddress,
} from '../src/lib/lpStaking'
import { SINGLE_ALPHAYIN_STAKE_ADDRESS, SINGLE_ALPHAYIN_USE_STAKING_V4, NODE_URL } from '../src/lib/config'

const DECIMALS = 18

function formatAmount(amount: bigint, decimals: number): string {
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

async function main() {
  const address = process.argv[2]?.trim()
  if (!address) {
    console.error('Usage: npx tsx scripts/check-single-staking.ts <address>')
    console.error('Example: npx tsx scripts/check-single-staking.ts 1C2RAVWSuaXw8xtUxqPZuUKEjdKjR89cdP2SwCMyo6yo')
    process.exit(1)
  }

  web3.setCurrentNodeProvider(NODE_URL)

  const stakerAddress = await resolveStakerAddress(address)

  console.log('Single ALPH/AYIN LP staking')
  console.log('Contract:', SINGLE_ALPHAYIN_STAKE_ADDRESS)
  console.log('Address:', address)
  if (stakerAddress !== address) {
    console.log('Staker (resolved from StakingAccount):', stakerAddress)
  }
  console.log('Node:', NODE_URL)
  console.log('')

  const [staked, earned, rewards, rewardToPaid] = await Promise.all([
    getStakedBalance(SINGLE_ALPHAYIN_STAKE_ADDRESS, stakerAddress, SINGLE_ALPHAYIN_USE_STAKING_V4),
    getEarnedReward(SINGLE_ALPHAYIN_STAKE_ADDRESS, stakerAddress, SINGLE_ALPHAYIN_USE_STAKING_V4),
    getRewardsBalance(SINGLE_ALPHAYIN_STAKE_ADDRESS, stakerAddress, SINGLE_ALPHAYIN_USE_STAKING_V4),
    getRewardToPaid(SINGLE_ALPHAYIN_STAKE_ADDRESS, stakerAddress, SINGLE_ALPHAYIN_USE_STAKING_V4),
  ])

  console.log('Amount staked (ALPH-AYIN LP):', formatAmount(staked, DECIMALS))
  console.log('Claimable rewards (AYIN):   ', formatAmount(earned, DECIMALS))
  console.log('Stored rewards (AYIN):       ', formatAmount(rewards, DECIMALS))
  console.log('Reward to paid (stake*paid): ', formatAmount(rewardToPaid, DECIMALS))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
