import { NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'
import type { PoolInfo } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * Pools are merged from ayin.pool.json (address, poolType V1/V2, reserves, token0, token1)
 * and mobula.pair.2.json (prices). See scripts/merge-pools.js and data/pool.json.
 */
export async function GET() {
  try {
    const poolPath = path.join(process.cwd(), 'data', 'pool.json')
    const raw = await readFile(poolPath, 'utf-8')
    const pools: PoolInfo[] = JSON.parse(raw)
    return NextResponse.json(pools)
  } catch (e) {
    console.error('Pools API error:', e)
    return NextResponse.json([])
  }
}
