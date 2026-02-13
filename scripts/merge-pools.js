#!/usr/bin/env node
/**
 * Merges data/sources/ayin.pool.json and data/sources/mobula.pair.2.json into data/pool.json.
 * - ayin.pool.json is source of truth: address, poolType (V1/V2), reserves, token0, token1, tokenPairId.
 * - mobula.pair.2.json adds: mobulaPrice, pair (price), ticker, name (by matching ayinPair === pool.address).
 * Output shape matches PoolInfo + optional mobula fields.
 * Run from repo root: node scripts/merge-pools.js
 */

const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const ayinPath = path.join(root, 'data', 'sources', 'ayin.pool.json')
const mobulaPath = path.join(root, 'data', 'sources', 'mobula.pair.2.json')
const outPath = path.join(root, 'data', 'pool.json')

const ayin = JSON.parse(fs.readFileSync(ayinPath, 'utf-8'))
const mobula = JSON.parse(fs.readFileSync(mobulaPath, 'utf-8'))

const mobulaByAyinPair = new Map()
for (const m of mobula) {
  if (m.ayinPair) mobulaByAyinPair.set(m.ayinPair, m)
}

const merged = ayin.map((p) => {
  const m = mobulaByAyinPair.get(p.address)
  return {
    address: p.address,
    tokenPairId: p.tokenPairId ?? p.address,
    token0: p.token0,
    token1: p.token1,
    reserve0: p.reserve0 ?? '0',
    reserve1: p.reserve1 ?? '0',
    poolType: p.poolType ?? 'V1',
    TVL: p.TVL,
    liquidity: p.liquidity,
    ...(m && {
      mobulaPrice: m.mobulaPrice,
      pair: m.pair,
      ticker: m.ticker,
      name: m.name,
    }),
  }
})

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, JSON.stringify(merged, null, 2), 'utf-8')
console.log('Wrote', outPath, 'with', merged.length, 'pools')
