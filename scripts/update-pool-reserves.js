#!/usr/bin/env node
/**
 * Fetches reserve0 and reserve1 on-chain for each pool in data/pool.json and updates the file.
 * Uses the same layout as TokenPair: mutFields[0]=reserve0, mutFields[1]=reserve1.
 * Requires NEXT_PUBLIC_NODE_URL (optional; defaults to https://node.mainnet.alephium.org).
 * Run from repo root: node scripts/update-pool-reserves.js
 */

const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const poolPath = path.join(root, 'data', 'pool.json')

const NODE_URL = process.env.NEXT_PUBLIC_NODE_URL || 'https://node.mainnet.alephium.org'

const MUT_IDX_RESERVE0 = 0
const MUT_IDX_RESERVE1 = 1

function parseMutFieldAsU256(mutFields, index) {
  const field = mutFields[index]
  if (field == null) return undefined
  const v = field.value
  if (typeof v === 'string') return v
  return undefined
}

async function getPoolState(provider, poolAddress) {
  try {
    const rawState = await provider.contracts.getContractsAddressState(poolAddress)
    const mutFields = Array.isArray(rawState.mutFields) ? rawState.mutFields : []
    const reserve0 = parseMutFieldAsU256(mutFields, MUT_IDX_RESERVE0)
    const reserve1 = parseMutFieldAsU256(mutFields, MUT_IDX_RESERVE1)
    if (reserve0 === undefined || reserve1 === undefined) return null
    return { reserve0, reserve1 }
  } catch (err) {
    console.warn(`  Failed to fetch state for ${poolAddress}:`, err.message)
    return null
  }
}

async function main() {
  try {
    require('dotenv').config({ path: path.join(root, '.env') })
  } catch {
    // dotenv optional
  }

  const { NodeProvider } = require('@alephium/web3')
  const provider = new NodeProvider(process.env.NEXT_PUBLIC_NODE_URL || NODE_URL)

  const raw = fs.readFileSync(poolPath, 'utf-8')
  const pools = JSON.parse(raw)

  if (!Array.isArray(pools) || pools.length === 0) {
    console.error('pool.json is empty or not an array')
    process.exit(1)
  }

  console.log(`Fetching reserves for ${pools.length} pools from ${process.env.NEXT_PUBLIC_NODE_URL || NODE_URL}...`)

  let updated = 0
  let failed = 0

  for (let i = 0; i < pools.length; i++) {
    const pool = pools[i]
    const address = pool.address
    if (!address) {
      failed++
      continue
    }
    const state = await getPoolState(provider, address)
    if (state) {
      pool.reserve0 = state.reserve0
      pool.reserve1 = state.reserve1
      updated++
      if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${pools.length}...`)
    } else {
      failed++
    }
  }

  fs.writeFileSync(poolPath, JSON.stringify(pools, null, 2) + '\n', 'utf-8')
  console.log(`Done. Updated ${updated} pools, ${failed} failed. Wrote ${poolPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
