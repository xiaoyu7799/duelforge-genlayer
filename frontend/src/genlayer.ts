import { createClient, createAccount, generatePrivateKey } from 'genlayer-js'
import { studionet } from 'genlayer-js/chains'
import { TransactionStatus } from 'genlayer-js/types'

export const CHAIN_ID = 61999
export const CHAIN_ID_HEX = '0xf22f'
export const RPC_URL = 'https://studio.genlayer.com/api'
export const EXPLORER = 'https://explorer-studio.genlayer.com'

// The contract address is NEVER hard-coded here. It is read at runtime
// from deployment.json (repo-root deployment.json, copied into the built
// site by the `prebuild` step), so a redeploy only needs a new manifest.
// Every read/write below throws until the manifest has loaded, so no
// value is ever shown or sent against a stale or guessed address.
export type DeploymentManifest = { contractAddress: string; chainId: number; network?: string }
let manifest: DeploymentManifest | null = null

export async function loadDeployment(): Promise<DeploymentManifest> {
  const res = await fetch('./deployment.json')
  if (!res.ok) throw new Error('DEPLOYMENT_MANIFEST_UNAVAILABLE')
  const data = await res.json()
  if (Number(data.chainId) !== CHAIN_ID || !/^0x[0-9a-fA-F]{40}$/.test(String(data.contractAddress || ''))) {
    throw new Error('DEPLOYMENT_MANIFEST_INVALID')
  }
  manifest = { contractAddress: data.contractAddress, chainId: Number(data.chainId), network: data.network }
  return manifest
}

export function getContractAddress(): string {
  if (!manifest) throw new Error('DEPLOYMENT_MANIFEST_UNAVAILABLE')
  return manifest.contractAddress
}

export function getManifest(): DeploymentManifest | null { return manifest }

// create_duel argument order for the multi-asset contract:
// (duel_id, asset, threshold, side, stake). Single-sourced here so the
// call site cannot drift from it.
export type Asset = 'BTC' | 'ETH'
export const ASSETS: Asset[] = ['BTC', 'ETH']
export function isAsset(v: any): v is Asset { return v === 'BTC' || v === 'ETH' }
export function duelAsset(d: any): Asset { return isAsset(d?.asset) ? d.asset : 'BTC' }
export function createDuelArgs(id: number, asset: Asset, threshold: number, side: 'YES' | 'NO', stake: number) {
  return [BigInt(id), asset, BigInt(threshold), side, BigInt(stake)]
}

export function explorerAddress(addr: string) { return `${EXPLORER}/address/${addr}` }
export function explorerTx(hash: string) { return `${EXPLORER}/tx/${hash}` }

export function readClient(): any {
  return createClient({ chain: studionet })
}

export function parseJson(raw: any) {
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch { return raw }
  }
  return raw
}

export async function readDuel(id: number) {
  const raw = await readClient().readContract({ address: getContractAddress(), functionName: 'get_duel', args: [BigInt(id)] })
  return parseJson(raw)
}

export async function readDuelCount(): Promise<number> {
  const raw = await readClient().readContract({ address: getContractAddress(), functionName: 'get_duel_count', args: [] })
  return Number(String(raw))
}

export async function readDuels(): Promise<any[]> {
  const count = await readDuelCount()
  if (count <= 0) return []
  const raw = await readClient().readContract({ address: getContractAddress(), functionName: 'list_duels', args: [0n, BigInt(Math.min(count, 20))] })
  const list = parseJson(raw)
  return Array.isArray(list) ? list : []
}

export async function readLeaderboard(): Promise<any[]> {
  const raw = await readClient().readContract({ address: getContractAddress(), functionName: 'get_leaderboard', args: [] })
  const list = parseJson(raw)
  return Array.isArray(list) ? list : []
}

export async function readPlayer(address: string) {
  const raw = await readClient().readContract({ address: getContractAddress(), functionName: 'get_player', args: [address] })
  return parseJson(raw)
}

export async function waitFinal(hash: string, onStage?: (s: string) => void) {
  onStage && onStage('waiting')
  const receipt = await readClient().waitForTransactionReceipt({
    hash,
    status: TransactionStatus.FINALIZED,
    retries: 180,
    interval: 5000,
  })
  onStage && onStage('finalized')
  return receipt
}

// ---- Wallet: OKX first, any injected EVM wallet accepted -----------------
export function injectedProvider(): any {
  const w: any = window as any
  return w.okxwallet || w.ethereum || null
}

export async function connectWalletAddress(): Promise<string> {
  const eth = injectedProvider()
  if (!eth) throw new Error('NO_WALLET')
  const accounts = await eth.request({ method: 'eth_requestAccounts' })
  const address = accounts && accounts[0]
  if (!address) throw new Error('NO_ACCOUNT')
  await ensureStudionet(eth)
  return address
}

export async function ensureStudionet(eth: any) {
  const provider = eth || injectedProvider()
  if (!provider) throw new Error('NO_WALLET')
  const current = await provider.request({ method: 'eth_chainId' })
  if (String(current).toLowerCase() !== CHAIN_ID_HEX) {
    try {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_ID_HEX }] })
    } catch (err: any) {
      if (err && err.code === 4902) {
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [{ chainId: CHAIN_ID_HEX, chainName: 'GenLayer Stable Studionet', rpcUrls: [RPC_URL], nativeCurrency: { name: 'GEN', symbol: 'GEN', decimals: 18 }, blockExplorerUrls: [EXPLORER] }],
        })
      } else throw err
    }
  }
}

// Snap-capable write client (desktop MetaMask with the GenLayer Snap).
export async function snapClient(walletAddress: string): Promise<any> {
  const client = createClient({ chain: studionet, account: walletAddress as any })
  await (client as any).connect('studionet')
  return client
}

// Ephemeral in-browser test account. The key lives ONLY in this tab's
// memory (a module variable, never localStorage, never sent anywhere
// except as a transaction signature) and vanishes when the tab closes.
// Transactions are REAL on-chain transactions, but the on-chain
// requester is this test account — never the reviewer's wallet address.
// The UI must always say so.
let ephemeral: { address: string; client: any } | null = null
export function ephemeralClient() {
  if (!ephemeral) {
    const account = createAccount(generatePrivateKey())
    ephemeral = { address: account.address, client: createClient({ chain: studionet, account }) }
  }
  return ephemeral
}
export function ephemeralAddress() { return ephemeral ? ephemeral.address : null }

export function short(addr: string) {
  if (!addr || addr.length < 10) return addr || ''
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

// Map raw/contract error text to a short, stable code the UI translates.
// Never surface raw stacks or RPC internals to the user.
export function errorCode(e: any): string {
  const msg = String((e && e.message) || e || '')
  // Contract codes can contain capitals (asset_must_be_BTC_or_ETH):
  // capture the full token, then normalise to lowercase for lookup.
  const m = msg.match(/EXPECTED:\s*([A-Za-z0-9_]+)/) || msg.match(/([a-z_]+_not_[a-z_]+|[a-z_]+_must_[a-z_]+|only_[a-z_]+|invalid_asset|asset_[a-z_]+|insufficient_balance|duel_id_already_exists|player_not_found|invalid_settlement_outcome|limit_must_be_1_to_20)/)
  if (m) {
    const code = m[1].toLowerCase()
    if (code === 'asset_must_be_btc_or_eth') return 'invalid_asset'
    return code
  }
  if (/NO_WALLET/.test(msg)) return 'no_wallet'
  if (/NO_ACCOUNT/.test(msg)) return 'no_account'
  if (/DEPLOYMENT_MANIFEST/.test(msg)) return 'manifest'
  if (/user rejected|User denied|rejected/i.test(msg)) return 'user_rejected'
  if (/price_sources_unavailable|EXTERNAL/.test(msg)) return 'price_sources_unavailable'
  if (/wallet_getSnaps|wallet_requestSnaps|32601|method not found/i.test(msg)) return 'snap_missing'
  return 'generic'
}
