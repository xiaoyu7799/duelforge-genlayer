/* DuelForge deploy + demo-duel flow on Stable Studionet ONLY (chain 61999).
 *
 * Usage: node scripts/deploy_studionet.mjs
 *   Optional env: GENLAYER_PRIVATE_KEY (creator account; if unset, an
 *   ephemeral account is generated at runtime and NEVER written to disk).
 *   A second ephemeral joiner account is always generated at runtime.
 *   No private key, seed phrase, or key material is ever written to any
 *   file by this script -- checkpoint and evidence files hold only
 *   addresses, tx hashes, receipts summaries, and read-back state.
 *
 * Steps, in order, each waited to FINALIZED with a read-back:
 *   deploy -> duel 0 (threshold $50,000, creator YES): create, join (NO),
 *   settle (expected YES wins) -> duel 1 (threshold $100,000, creator
 *   YES): create, join (NO), settle (expected NO wins).
 * Stake per duel: 100 nominal TEST units. Pool per duel: 200.
 *
 * Resume safety (no duplicate writes):
 *   - Every completed (FINALIZED) step is checkpointed immediately to
 *     scripts/.deploy-checkpoint.json (gitignored) and is NEVER re-sent.
 *   - Before sending any step, on-chain state is checked first (duel
 *     exists / STAKED / SETTLED); a step the chain already reflects is
 *     skipped, not re-sent.
 *   - A tx that was sent but not yet checkpointed as FINALIZED is
 *     recorded as pendingTx; on resume the script waits for THAT hash
 *     first instead of sending a new tx.
 *   - If a tx FINALIZES with an error, or consensus disagrees, the
 *     script STOPS and reports the tx hash and receipt -- it does not
 *     auto-redeploy, auto-retry blindly, or force a second settle
 *     (a second settle could never double-distribute: SETTLED rejects
 *     re-settlement, but a forced retry would still be wrong).
 *
 * Chain checks before any send: chain id must be 61999 and gas price
 * must be 0 (Studionet is gasless). Anything else aborts.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, createAccount, generatePrivateKey } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkpointPath = path.join(root, "scripts", ".deploy-checkpoint.json");
const evidencePath = path.join(root, "evidence", "deploy-results.json");
const codePath = path.join(root, "contracts", "duelforge.py");
const code = readFileSync(codePath, "utf-8");
const contractSha256 = createHash("sha256").update(code).digest("hex");
console.log("Contract SHA256:", contractSha256);

const STATUS_NAMES = {
  0: "UNINITIALIZED", 1: "PENDING", 2: "PROPOSING", 3: "COMMITTING",
  4: "REVEALING", 5: "ACCEPTED", 6: "UNDETERMINED", 7: "FINALIZED", 8: "CANCELED",
};
const statusName = (r) => r?.statusName ?? STATUS_NAMES[r?.status] ?? String(r?.status ?? "");

function loadCheckpoint() {
  if (existsSync(checkpointPath)) {
    try { return JSON.parse(readFileSync(checkpointPath, "utf-8")); } catch { /* fall through */ }
  }
  return { steps: {}, duels: {} };
}
function saveCheckpoint(cp) {
  const tmp = checkpointPath + ".tmp";
  writeFileSync(tmp, JSON.stringify(cp, null, 2) + "\n");
  renameSync(tmp, checkpointPath);
}
function saveEvidence(ev) {
  mkdirSync(path.dirname(evidencePath), { recursive: true });
  const tmp = evidencePath + ".tmp";
  writeFileSync(tmp, JSON.stringify(ev, null, 2) + "\n");
  renameSync(tmp, evidencePath);
}

const checkpoint = loadCheckpoint();
console.log("Checkpoint steps already FINALIZED:", Object.keys(checkpoint.steps || {}).filter((k) => checkpoint.steps[k]?.status === "FINALIZED"));

// Accounts: ephemeral at runtime only, never persisted.
const creatorKey = process.env.GENLAYER_PRIVATE_KEY || generatePrivateKey();
if (!process.env.GENLAYER_PRIVATE_KEY) console.log("No GENLAYER_PRIVATE_KEY: using an ephemeral creator account for this run only (key never written to disk).");
const creatorAccount = createAccount(creatorKey);
const joinerAccount = createAccount(generatePrivateKey());
console.log("Creator (ephemeral unless key supplied):", creatorAccount.address);
console.log("Joiner (ephemeral):", joinerAccount.address);
if (creatorAccount.address.toLowerCase() === joinerAccount.address.toLowerCase()) throw new Error("Creator and joiner accounts collided -- aborting");

const clientFor = (account) => createClient({ chain: studionet, account });
const creatorClient = clientFor(creatorAccount);
const joinerClient = clientFor(joinerAccount);
const readClient = creatorClient;

// --- chain + gas checks (before any send) ---
const chainId = await creatorClient.getChainId();
console.log("Chain ID:", chainId);
if (chainId !== 61999) throw new Error(`Wrong chain: expected 61999 (Stable Studionet), got ${chainId} -- aborting`);
const gasPrice = await creatorClient.getGasPrice();
console.log("Gas price:", String(gasPrice));
if (gasPrice !== 0n) throw new Error(`Expected gas price 0 on Studionet, got ${gasPrice} -- aborting`);
console.log("Network: Stable Studionet, chain 61999, https://studio.genlayer.com/api -- checks passed");

async function waitFinal(client, hash, label) {
  console.log(`${label} tx:`, hash);
  const receipt = await client.waitForTransactionReceipt({
    hash, status: TransactionStatus.FINALIZED, retries: 240, interval: 5000,
  });
  console.log(`${label} receipt status:`, statusName(receipt));
  return receipt;
}

function summarizeReceipt(receipt) {
  const summary = { status: statusName(receipt), rawStatus: receipt?.status ?? null };
  // Best-effort vote/consensus extraction: receipt shapes vary; never fail on this.
  try {
    const flat = JSON.stringify(receipt ?? {});
    const agree = (flat.match(/AGREE/g) || []).length;
    const disagree = (flat.match(/DISAGREE/g) || []).length;
    if (agree || disagree) summary.voteMentions = { AGREE: agree, DISAGREE: disagree };
    for (const key of ["executionResult", "result", "consensus", "votes", "leaderVote", "leader_receipt"]) {
      if (receipt?.[key] !== undefined) summary[key] = receipt[key];
      if (receipt?.data?.[key] !== undefined) summary[`data.${key}`] = receipt.data[key];
    }
    if (receipt?.data?.contract_address) summary.contractAddressInReceipt = receipt.data.contract_address;
    if (receipt?.txDataDecoded?.contractAddress) summary.contractAddressInReceipt = receipt.txDataDecoded.contractAddress;
  } catch { /* ignore */ }
  return summary;
}

async function readDuel(address, id) {
  try {
    const raw = await readClient.readContract({ address, functionName: "get_duel", args: [BigInt(id)] });
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch { return null; }
}
async function readPlayer(address, playerAddr) {
  const raw = await readClient.readContract({ address, functionName: "get_player", args: [playerAddr] });
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}
async function readLeaderboard(address) {
  const raw = await readClient.readContract({ address, functionName: "get_leaderboard", args: [] });
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

// Generic step runner with checkpoint + on-chain state check. Never re-sends
// a FINALIZED step; never sends a step the chain already reflects.
async function runStep(key, client, stateAlreadyDone, sendFn, label) {
  const existing = checkpoint.steps[key];
  if (existing?.status === "FINALIZED") {
    console.log(`[skip] ${label}: already FINALIZED in checkpoint (${existing.txHash})`);
    return existing;
  }
  if (existing?.pendingTx) {
    console.log(`[resume] ${label}: waiting for previously sent tx ${existing.pendingTx} instead of re-sending`);
    const receipt = await waitFinal(client, existing.pendingTx, label + " (pending)");
    if (statusName(receipt) !== "FINALIZED") throw new Error(`${label}: pending tx ${existing.pendingTx} did not FINALIZE (status ${statusName(receipt)}) -- stopping, not retrying blindly`);
    if (!(await stateAlreadyDone())) throw new Error(`${label}: tx ${existing.pendingTx} FINALIZED but on-chain state does not reflect it -- stopping for diagnosis, not re-sending`);
    const done = { txHash: existing.pendingTx, status: "FINALIZED", receipt: summarizeReceipt(receipt) };
    checkpoint.steps[key] = done; saveCheckpoint(checkpoint);
    return done;
  }
  if (await stateAlreadyDone()) {
    console.log(`[skip] ${label}: on-chain state already reflects this step; not re-sending (no tx hash recorded for this step)`);
    const done = { txHash: null, status: "STATE_VERIFIED_NO_HASH", note: "Step reflected on-chain before this run sent anything; hash unknown, not claimed." };
    checkpoint.steps[key] = done; saveCheckpoint(checkpoint);
    return done;
  }
  const hash = await sendFn();
  checkpoint.steps[key] = { txHash: hash, status: "PENDING", pendingTx: hash };
  saveCheckpoint(checkpoint);
  const receipt = await waitFinal(client, hash, label);
  if (statusName(receipt) !== "FINALIZED") {
    checkpoint.steps[key] = { txHash: hash, status: statusName(receipt), pendingTx: hash, receipt: summarizeReceipt(receipt) };
    saveCheckpoint(checkpoint);
    throw new Error(`${label}: tx ${hash} did not FINALIZE (status ${statusName(receipt)}). Receipt: ${JSON.stringify(summarizeReceipt(receipt))}. Stopping -- diagnose before any retry.`);
  }
  const done = { txHash: hash, status: "FINALIZED", receipt: summarizeReceipt(receipt) };
  checkpoint.steps[key] = done; saveCheckpoint(checkpoint);
  return done;
}

// --- deploy ---
let contractAddress = checkpoint.contractAddress ?? null;
if (checkpoint.steps.deploy?.status === "FINALIZED" && contractAddress) {
  console.log("Deploy already FINALIZED in checkpoint:", contractAddress, checkpoint.steps.deploy.txHash);
} else {
  const deployRes = await runStep("deploy", creatorClient, async () => false, async () => {
    return await creatorClient.deployContract({ code, args: [], leaderOnly: false });
  }, "deploy");
  if (!contractAddress) {
    // Re-wait for the deploy receipt to extract the address if needed.
    const receipt = await creatorClient.waitForTransactionReceipt({
      hash: deployRes.txHash, status: TransactionStatus.FINALIZED, retries: 60, interval: 5000,
    });
    contractAddress = receipt?.data?.contract_address ?? receipt?.txDataDecoded?.contractAddress ?? receipt?.contractAddress ?? null;
    if (!contractAddress) {
      console.log("Deploy receipt keys:", Object.keys(receipt ?? {}));
      console.log("Deploy receipt (truncated):", JSON.stringify(receipt, null, 2).slice(0, 4000));
      throw new Error("Could not find contract address in deploy receipt -- stopping");
    }
    checkpoint.contractAddress = contractAddress;
    checkpoint.steps.deploy.receipt = summarizeReceipt(receipt);
    saveCheckpoint(checkpoint);
  }
}
console.log("Contract address:", contractAddress);
console.log("Explorer:", `https://explorer-studio.genlayer.com/address/${contractAddress}`);

const DUELS = [
  { id: 0, threshold: 50000, creatorSide: "YES", joinerSide: "NO", stake: 100, expectedWinnerSide: "YES" },
  { id: 1, threshold: 100000, creatorSide: "YES", joinerSide: "NO", stake: 100, expectedWinnerSide: "NO" },
];

const evidence = {
  network: "Stable Studionet",
  chainId: 61999,
  rpcUrl: "https://studio.genlayer.com/api",
  contractAddress,
  explorer: `https://explorer-studio.genlayer.com/address/${contractAddress}`,
  studio: `https://studio.genlayer.com/?import-contract=${contractAddress}`,
  contractFile: "contracts/duelforge.py",
  contractSha256,
  deployTxHash: checkpoint.steps.deploy?.txHash ?? null,
  deployReceiptStatus: checkpoint.steps.deploy?.status ?? null,
  deployer: creatorAccount.address,
  deployerNote: "Ephemeral Studionet account generated at runtime (or GENLAYER_PRIVATE_KEY if supplied); key never written to disk.",
  creator: null,
  joiner: null,
  note: "Nominal TEST units only -- no real funds. Creator/joiner addresses below are ephemeral Studionet accounts, labelled as such.",
  duels: [],
  localTests: "See tests/test_duelforge.py -- mocked simulation only, NOT chain results.",
  browserWalletPath: "NOT VERIFIED -- no browser-wallet write was tested in this run.",
};
saveEvidence(evidence);

for (const spec of DUELS) {
  const prefix = `duel${spec.id}`;
  const create = await runStep(`${prefix}_create`, creatorClient,
    async () => (await readDuel(contractAddress, spec.id)) !== null,
    async () => await creatorClient.writeContract({
      address: contractAddress, functionName: "create_duel",
      args: [BigInt(spec.id), BigInt(spec.threshold), spec.creatorSide, BigInt(spec.stake)],
      value: 0n, leaderOnly: false,
    }), `create duel ${spec.id}`);
  const afterCreate = await readDuel(contractAddress, spec.id);
  console.log(`Duel ${spec.id} after create:`, JSON.stringify(afterCreate));
  if (!afterCreate || afterCreate.status !== "OPEN") throw new Error(`Duel ${spec.id} is not OPEN after create -- stopping`);

  const join = await runStep(`${prefix}_join`, joinerClient,
    async () => { const d = await readDuel(contractAddress, spec.id); return d !== null && d.status !== "OPEN"; },
    async () => {
      // Joiner must differ from the on-chain creator, not just from our creator account.
      if (joinerAccount.address.toLowerCase() === String(afterCreate.creator).toLowerCase()) throw new Error("Joiner equals on-chain creator -- aborting join");
      return await joinerClient.writeContract({
        address: contractAddress, functionName: "join_duel",
        args: [BigInt(spec.id), spec.joinerSide], value: 0n, leaderOnly: false,
      });
    }, `join duel ${spec.id}`);
  const afterJoin = await readDuel(contractAddress, spec.id);
  console.log(`Duel ${spec.id} after join:`, JSON.stringify(afterJoin));
  if (!afterJoin || afterJoin.status !== "STAKED") throw new Error(`Duel ${spec.id} is not STAKED after join -- stopping`);

  const settle = await runStep(`${prefix}_settle`, creatorClient,
    async () => { const d = await readDuel(contractAddress, spec.id); return d !== null && d.status === "SETTLED"; },
    async () => await creatorClient.writeContract({
      address: contractAddress, functionName: "settle_duel",
      args: [BigInt(spec.id)], value: 0n, leaderOnly: false,
    }), `settle duel ${spec.id}`);
  const afterSettle = await readDuel(contractAddress, spec.id);
  console.log(`Duel ${spec.id} after settle:`, JSON.stringify(afterSettle));
  if (!afterSettle || afterSettle.status !== "SETTLED") throw new Error(`Duel ${spec.id} is not SETTLED after settle -- stopping`);
  if (afterSettle.winner_side !== spec.expectedWinnerSide) {
    console.log(`WARNING: duel ${spec.id} settled ${afterSettle.winner_side}, expected ${spec.expectedWinnerSide} -- recorded honestly, not forced to re-settle`);
  }

  const creatorPlayer = await readPlayer(contractAddress, afterSettle.creator);
  const joinerPlayer = await readPlayer(contractAddress, afterSettle.joiner);
  const duelEvidence = {
    duelId: spec.id,
    threshold: spec.threshold,
    proposition: `BTC price in USD is above $${spec.threshold.toLocaleString("en-US")} at settlement`,
    creatorSide: spec.creatorSide,
    joinerSide: spec.joinerSide,
    stake: spec.stake,
    pool: afterSettle.pool,
    creator: afterSettle.creator,
    creatorNote: "Ephemeral Studionet account, labelled as such.",
    joiner: afterSettle.joiner,
    joinerNote: "Ephemeral Studionet account, labelled as such.",
    createTxHash: create.txHash,
    createReceiptStatus: create.status,
    joinTxHash: join.txHash,
    joinReceiptStatus: join.status,
    settleTxHash: settle.txHash,
    settleReceiptStatus: settle.status,
    settleReceipt: settle.receipt ?? null,
    expectedWinnerSide: spec.expectedWinnerSide,
    readBack: afterSettle,
    creatorPlayer,
    joinerPlayer,
  };
  checkpoint.duels[spec.id] = duelEvidence;
  saveCheckpoint(checkpoint);
  evidence.duels.push(duelEvidence);
  evidence.creator = afterSettle.creator;
  evidence.joiner = afterSettle.joiner;
  saveEvidence(evidence);
  console.log(`Duel ${spec.id} complete: winner_side=${afterSettle.winner_side}, winner=${afterSettle.winner}, pool=${afterSettle.pool}`);
}

evidence.leaderboard = await readLeaderboard(contractAddress);
evidence.checkedAt = new Date().toISOString();
saveEvidence(evidence);

const deployment = {
  network: "Stable Studionet", chainId: 61999, rpcUrl: "https://studio.genlayer.com/api",
  explorer: `https://explorer-studio.genlayer.com/address/${contractAddress}`,
  studio: `https://studio.genlayer.com/?import-contract=${contractAddress}`,
  contractAddress, deployTxHash: evidence.deployTxHash, deployer: creatorAccount.address,
  contractFile: "contracts/duelforge.py", contractSha256, deployedAt: evidence.checkedAt,
  receiptStatus: evidence.deployReceiptStatus,
};
writeFileSync(path.join(root, "deployment.json"), JSON.stringify(deployment, null, 2) + "\n");
console.log("Wrote evidence/deploy-results.json and deployment.json");
console.log("Leaderboard:", JSON.stringify(evidence.leaderboard));
