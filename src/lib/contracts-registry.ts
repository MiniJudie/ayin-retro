import { Contract, ContractFactory, ContractInstance } from '@alephium/web3'

let contracts: ContractFactory<ContractInstance>[] | undefined
/** Additional code hashes (e.g. upgraded/mainnet deployments) that map to a known contract. */
const codeHashAliases: Map<string, Contract> = new Map()

export function registerContract(factory: ContractFactory<ContractInstance>): void {
  if (contracts === undefined) {
    contracts = [factory]
  } else {
    contracts.push(factory)
  }
}

/** Register an on-chain code hash as an alias for a contract (e.g. different deployment with same interface). */
export function registerCodeHashAlias(codeHash: string, factory: ContractFactory<ContractInstance>): void {
  codeHashAliases.set(codeHash.toLowerCase().replace(/^0x/, ''), factory.contract)
}

export function getContractByCodeHash(codeHash: string): Contract {
  const normalized = codeHash.toLowerCase().replace(/^0x/, '')
  const alias = codeHashAliases.get(normalized)
  if (alias !== undefined) return alias
  const c = contracts?.find((f) => f.contract.hasCodeHash(codeHash))
  if (c === undefined) {
    throw new Error('Unknown code with code hash: ' + codeHash)
  }
  return c.contract
}
