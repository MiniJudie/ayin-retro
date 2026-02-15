import { addressFromPublicKey } from '@alephium/web3'

const P2PKH_UNLOCK_TYPE = 0x00
const P2PKH_PUBLIC_KEY_BYTES = 33
const P2PKH_PUBLIC_KEY_HEX_LEN = P2PKH_PUBLIC_KEY_BYTES * 2

/**
 * Fetches the public key for a P2PKH address from the chain.
 * Uses the explorer backend API (backend.mainnet.alephium.org):
 * 1) Tries GET /addresses/{address}/public-key.
 * 2) If that fails, fetches a recent transaction (GET /addresses/{address}/transactions?limit=1),
 *    then GET /transactions/{hash}, and extracts the public key from the P2PKH unlock script
 *    (type 0x00 + 33-byte public key) from an input that matches the address.
 */
export async function fetchPublicKeyForAddress(
  backendBaseUrl: string,
  address: string
): Promise<string | null> {
  const normalized = address.trim()
  if (!normalized) return null

  const base = backendBaseUrl.replace(/\/$/, '')

  // 1) Try backend public-key endpoint
  try {
    const res = await fetch(`${base}/addresses/${encodeURIComponent(normalized)}/public-key`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
    if (res.ok) {
      const text = await res.text()
      const key = text.startsWith('"') ? JSON.parse(text) : text.trim()
      if (typeof key === 'string' && key.length >= 64) {
        if (addressFromPublicKey(key) === normalized) return key
        return key
      }
    }
  } catch {
    // fall back to tx-based extraction
  }

  // 2) Get a transaction where this address is a signer, then extract public key from unlock script
  try {
    const listRes = await fetch(
      `${base}/addresses/${encodeURIComponent(normalized)}/transactions?limit=1`,
      { method: 'GET', headers: { Accept: 'application/json' } }
    )
    if (!listRes.ok) return null
    const list = (await listRes.json()) as { hash?: string }[] | { data?: { hash?: string }[] }
    const txs = Array.isArray(list) ? list : (list as { data?: { hash?: string }[] }).data
    const firstTx = Array.isArray(txs) ? txs[0] : undefined
    const txHash = firstTx && typeof firstTx === 'object' && 'hash' in firstTx ? (firstTx as { hash: string }).hash : undefined
    if (!txHash) return null

    const txRes = await fetch(`${base}/transactions/${encodeURIComponent(txHash)}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
    if (!txRes.ok) return null
    const tx = (await txRes.json()) as {
      unsigned?: { inputs?: Array<{ address?: string; unlockScript?: string }> }
      inputs?: Array<{ address?: string; unlockScript?: string }>
    }
    const inputs = tx?.unsigned?.inputs ?? tx?.inputs ?? []
    for (const input of inputs) {
      if (input.address !== normalized || !input.unlockScript) continue
      const pubKey = publicKeyFromP2PKHUnlockScript(input.unlockScript)
      if (pubKey && addressFromPublicKey(pubKey) === normalized) return pubKey
    }
  } catch {
    // ignore
  }

  return null
}

/**
 * P2PKH unlock script format: 1 byte type (0x00) + 33 bytes public key (compressed).
 * Returns the public key in hex, or null if not valid P2PKH.
 */
function publicKeyFromP2PKHUnlockScript(unlockScript: string): string | null {
  const hex = unlockScript.startsWith('0x') ? unlockScript.slice(2) : unlockScript
  if (!/^[0-9a-fA-F]+$/.test(hex)) return null
  if (hex.length < 2 + P2PKH_PUBLIC_KEY_HEX_LEN) return null
  const type = parseInt(hex.slice(0, 2), 16)
  if (type !== P2PKH_UNLOCK_TYPE) return null
  return hex.slice(2, 2 + P2PKH_PUBLIC_KEY_HEX_LEN)
}
