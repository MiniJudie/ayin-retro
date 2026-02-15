#!/usr/bin/env node
/**
 * Check ALPH/AYIN LP staking for a list of addresses from a text file.
 * One address per line. Accepts either wallet (staker) or StakingAccount contract addresses (resolved automatically).
 * Outputs: amount staked, claimable rewards (AYIN), stored rewards, rewardToPaid.
 *
 * Usage: npx tsx scripts/check-staking-list.ts [liste.txt]
 *   or:  npm run check-staking-list -- [liste.txt]
 *
 * Default file: liste.txt (current directory).
 * Uses NEXT_PUBLIC_NODE_URL from env (optional; defaults to mainnet).
 */

import { readFile } from 'fs/promises'
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
  const listPath = process.argv[2]?.trim() || 'liste.txt'

  let content: string
  try {
    content = await readFile(listPath, 'utf-8')
  } catch (e) {
    console.error('Failed to read list file:', listPath, e)
    process.exit(1)
  }

  const addresses = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (addresses.length === 0) {
    console.error('No addresses found in', listPath)
    process.exit(1)
  }

  web3.setCurrentNodeProvider(NODE_URL)

  console.log('ALPH/AYIN LP staking – list check')
  console.log('Contract:', SINGLE_ALPHAYIN_STAKE_ADDRESS)
  console.log('List file:', listPath, `(${addresses.length} addresses)`)
  console.log('Node:', NODE_URL)
  console.log('')

  const results = await Promise.all(
    addresses.map(async (address) => {
      const stakerAddress = await resolveStakerAddress(address)
      const [staked, earned, rewards, rewardToPaid] = await Promise.all([
        getStakedBalance(SINGLE_ALPHAYIN_STAKE_ADDRESS, stakerAddress, SINGLE_ALPHAYIN_USE_STAKING_V4),
        getEarnedReward(SINGLE_ALPHAYIN_STAKE_ADDRESS, stakerAddress, SINGLE_ALPHAYIN_USE_STAKING_V4),
        getRewardsBalance(SINGLE_ALPHAYIN_STAKE_ADDRESS, stakerAddress, SINGLE_ALPHAYIN_USE_STAKING_V4),
        getRewardToPaid(SINGLE_ALPHAYIN_STAKE_ADDRESS, stakerAddress, SINGLE_ALPHAYIN_USE_STAKING_V4),
      ])
      return { address, stakerAddress, staked, earned, rewards, rewardToPaid }
    })
  )

  const maxAddrLen = Math.max(36, ...results.map((r) => r.address.length))
  const headerAddr = 'Address'.padEnd(maxAddrLen)
  const headerStaked = 'Staked (LP)'.padStart(18)
  const headerReward = 'Claimable (AYIN)'.padStart(18)
  const headerRewards = 'Stored (AYIN)'.padStart(18)
  const headerRewardToPaid = 'RewardToPaid'.padStart(22)
  console.log(`${headerAddr}  ${headerStaked}  ${headerReward}  ${headerRewards}  ${headerRewardToPaid}`)
  console.log('-'.repeat(maxAddrLen + 2 + 18 + 2 + 18 + 2 + 18 + 2 + 22))

  for (const { address, staked, earned, rewards, rewardToPaid } of results) {
    const addr = address.slice(0, maxAddrLen).padEnd(maxAddrLen)
    const stakedStr = formatAmount(staked, DECIMALS).padStart(18)
    const earnedStr = formatAmount(earned, DECIMALS).padStart(18)
    const rewardsStr = formatAmount(rewards, DECIMALS).padStart(18)
    const rewardToPaidStr = formatAmount(rewardToPaid, DECIMALS).padStart(22)
    console.log(`${addr}  ${stakedStr}  ${earnedStr}  ${rewardsStr}  ${rewardToPaidStr}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
