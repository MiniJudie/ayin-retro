import { NextResponse } from 'next/server'
import { TOKEN_LIST_URL } from '@/lib/config'
import type { TokenListResponse } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const res = await fetch(TOKEN_LIST_URL, { next: { revalidate: 300 } })
    if (!res.ok) throw new Error('Token list fetch failed')
    const data: TokenListResponse = await res.json()
    return NextResponse.json(data.tokens ?? [])
  } catch (e) {
    console.error('Tokens API error:', e)
    return NextResponse.json([])
  }
}
