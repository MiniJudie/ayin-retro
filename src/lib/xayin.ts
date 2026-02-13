import { signExecuteMethod } from '@alephium/web3'
import type { SignerProvider } from '@alephium/web3'
import { LiquidStaking } from './LiquidStaking'
import { XAYIN_LIQUID_STAKING_ADDRESS, AYIN_TOKEN_ID, XAYIN_TOKEN_ID } from './config'

/** Mint xAyin: send AYIN to LiquidStaking, receive xAyin. */
export async function executeMintXAyin(
  signer: SignerProvider,
  amount: bigint
): Promise<{ txId: string }> {
  const instance = LiquidStaking.at(XAYIN_LIQUID_STAKING_ADDRESS)
  const result = await signExecuteMethod(LiquidStaking, instance, 'mint', {
    signer,
    args: { amount },
    tokens: [{ id: AYIN_TOKEN_ID, amount }],
  })
  return { txId: result.txId }
}

/** Burn xAyin: send xAyin to LiquidStaking, receive AYIN. */
export async function executeBurnXAyin(
  signer: SignerProvider,
  xTokenAmount: bigint
): Promise<{ txId: string }> {
  const instance = LiquidStaking.at(XAYIN_LIQUID_STAKING_ADDRESS)
  const result = await signExecuteMethod(LiquidStaking, instance, 'burn', {
    signer,
    args: { xTokenAmount },
    tokens: [{ id: XAYIN_TOKEN_ID, amount: xTokenAmount }],
  })
  return { txId: result.txId }
}
