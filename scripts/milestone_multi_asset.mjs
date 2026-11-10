/* DuelForge milestone: multi-asset duels (BTC + ETH) + cancel for open duels.
 *
 * Stable Studionet ONLY (chain 61999). Deploys a NEW contract (the v1
 * contract 0x06D8b71D50FFd24035639cf0A93F620C8Fa2AA33 is untouched) and
 * runs the milestone evidence cases, each waited to FINALIZED with a
 * LATEST_FINAL read-back:
 *   (a) Duel 0: ETH end-to-end (threshold $1,500, creator YES) -- create,
 *       join (NO), settle. Live ETH ~$2,120 at design time: wide margin.
 *   (b) Duel 1: BTC regression (threshold $50,000, creator YES) -- the v1
 *       demo flow re-run on the new contract. Live BTC ~$74,700.
 *   (c) Duel 2: cancel journey -- create OPEN, cancel by creator, read-back
 *       shows CANCELLED + stake refunded, then join FAILS and settle FAILS.
 *   (d) Negative cases (lifecycle rejections, txs recorded):
 *       - create duel 99 with unknown asset "SOL" -> rejected
 *       - cancel duel 3 by a non-creator -> rejected
 *       - join own duel (duel 3) -> rejected
 *       - settle an OPEN duel (duel 3) -> rejected
 *       - settle an already-SETTLED duel (duel 0) -> rejected
 *
 * Usage: node scripts/milestone_multi_asset.mjs
 *   Optional env: GENLAYER_PRIVATE_KEY (creator account; if unset, an
 *   ephemeral account is generated and checkpointed -- see below).
 *   MILESTONE_WORKDIR overrides the checkpoint directory.
 *
 * Checkpoint rule (standing): temp account keys + progress checkpoint live
 * ONLY in ~/workspace/milestones/duelforge-evidence-work/ (workspace, never
 * /tmp, never inside any repo), keys.json mode 0600, deleted when the flow
 * completes or is abandoned. Evidence files hold only addresses, tx hashes,
 * receipt summaries, and read-back state -- no key material.
 * Resume safety: every FINALIZED step is checkpointed immediately and is
 * NEVER re-sent; on-chain state is checked before sending; a tx sent but
 * not yet checkpointed as FINALIZED is waited for on resume.
 *
 * Chain checks before any send: chain id must be 61999 and gas price 0.
 * All writes are zero-value. Nominal TEST units only -- no real funds.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, chmodSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, createAccount, generatePrivateKey } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus, TransactionHashVariant } from "genlayer-js/types";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workdir = process.env.MILESTONE_WORKDIR || path.join(process.env.HOME || "~", "workspace", "milestones", "duelforge-evidence-work");
mkdirSync(workdir, { recursive: true });
const keysPath = path.join(workdir, "keys.json");
const checkpointPath = path.join(workdir, "checkpoint.json");
const codePath = path.join(root, "contracts", "duelforge.py");
const code = readFileSync(codePath, "utf-8");
const contractSha256 = createHash("sha256").update(code).digest("hex");
console.log("Contract SHA256:", contractSha256);

const STATUS_NAMES = {
  0: "UNINITIALIZED", 1: "PENDING", 2: "PROPOSING", 3: "COMMITTING",
  4: "REVEALING", 5: "ACCEPTED", 6: "UNDETERMINED", 7: "FINALIZED", 8: "CANCELED",
};
const statusName = (r) => r?.statusName ?? STATUS_NAMES[r?.status] ?? String(r?.status ?? "");

// --- checkpoint + keys (workdir only) -------------------------------------
function loadJson(p, fallback) {
  if (existsSync(p)) {
    try { return JSON.parse(readFileSync(p, "utf-8")); } catch { /* fall through */ }
  }
  return fallback;
}
function saveJson(p, obj, mode) {
  const tmp = p + ".tmp";
  writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n");
  if (mode !== undefined) chmodSync(tmp, mode);
  renameSync(tmp, p);
}
const checkpoint = loadJson(checkpointPath, { steps: {}, cases: {} });
const saveCheckpoint = () => saveJson(checkpointPath, checkpoint);

let keys = loadJson(keysPath, null);
if (!keys) {
  keys = {
    creator: process.env.GENLAYER_PRIVATE_KEY || generatePrivateKey(),
    joiner: generatePrivateKey(),
    third: generatePrivateKey(),
    note: "Ephemeral Studionet accounts for the DuelForge multi-asset milestone evidence run only. Delete this file when the flow completes or is abandoned.",
  };
  saveJson(keysPath, keys, 0o600);
  console.log("Generated ephemeral accounts; keys checkpointed to workdir keys.json (0600).");
} else {
  console.log("Resuming with checkpointed ephemeral accounts from workdir keys.json.");
}

const creatorAccount = createAccount(keys.creator);
const joinerAccount = createAccount(keys.joiner);
const thirdAccount = createAccount(keys.third);
console.log("Creator:", creatorAccount.address);
console.log("Joiner:", joinerAccount.address);
console.log("Third:", thirdAccount.address);

const clientFor = (account) => createClient({ chain: studionet, account });
const creatorClient = clientFor(creatorAccount);
const joinerClient = clientFor(joinerAccount);
const thirdClient = clientFor(thirdAccount);
const readClient = creatorClient;

// --- chain + gas checks (before any send) ---------------------------------
const chainId = await creatorClient.getChainId();
console.log("Chain ID:", chainId);
if (chainId !== 61999) throw new Error(`Wrong chain: expected 61999 (Stable Studionet), got ${chainId} -- aborting`);
const gasPrice = await creatorClient.getGasPrice();
console.log("Gas price:", String(gasPrice));
if (gasPrice !== 0n) throw new Error(`Expected gas price 0 on Studionet, got ${gasPrice} -- aborting`);
console.log("Network: Stable Studionet, chain 61999 -- checks passed");

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
  try {
    const flat = JSON.stringify(receipt ?? {});
    const agree = (flat.match(/AGREE/g) || []).length;
    const disagree = (flat.match(/DISAGREE/g) || []).length;
    if (agree || disagree) summary.voteMentions = { AGREE: agree, DISAGREE: disagree };
    for (const key of ["executionResult", "result", "consensus", "votes", "leaderVote", "error", "errorMessage"]) {
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
    const raw = await readClient.readContract({
      address, functionName: "get_duel", args: [BigInt(id)],
      transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
    });
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch { return null; }
}
async function readPlayer(address, playerAddr) {
  const raw = await readClient.readContract({
    address, functionName: "get_player", args: [playerAddr],
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
  });
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}
async function readLeaderboard(address) {
  const raw = await readClient.readContract({
    address, functionName: "get_leaderboard", args: [],
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
  });
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

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
    checkpoint.steps[key] = done; saveCheckpoint();
    return done;
  }
  if (await stateAlreadyDone()) {
    console.log(`[skip] ${label}: on-chain state already reflects this step; not re-sending (no tx hash recorded for this step)`);
    const done = { txHash: null, status: "STATE_VERIFIED_NO_HASH", note: "Step reflected on-chain before this run sent anything; hash unknown, not claimed." };
    checkpoint.steps[key] = done; saveCheckpoint();
    return done;
  }
  const hash = await sendFn();
  checkpoint.steps[key] = { txHash: hash, status: "PENDING", pendingTx: hash };
  saveCheckpoint();
  const receipt = await waitFinal(client, hash, label);
  if (statusName(receipt) !== "FINALIZED") {
    checkpoint.steps[key] = { txHash: hash, status: statusName(receipt), pendingTx: hash, receipt: summarizeReceipt(receipt) };
    saveCheckpoint();
    throw new Error(`${label}: tx ${hash} did not FINALIZE (status ${statusName(receipt)}). Receipt: ${JSON.stringify(summarizeReceipt(receipt))}. Stopping -- diagnose before any retry.`);
  }
  const done = { txHash: hash, status: "FINALIZED", receipt: summarizeReceipt(receipt) };
  checkpoint.steps[key] = done; saveCheckpoint();
  return done;
}

// A step EXPECTED to fail on-chain (negative case). Records whatever the
// chain/client reports -- a returned tx hash + its receipt, or the thrown
// error -- and then verifies via LATEST_FINAL read-back that state did not
// change. A "failed" step is a PASS for the case when the state is unchanged.
async function runFailStep(key, client, sendFn, stateUnchanged, label) {
  const existing = checkpoint.steps[key];
  if (existing?.status === "REJECTED_RECORDED") {
    console.log(`[skip] ${label}: rejection already recorded in checkpoint (${existing.txHash ?? "no tx hash"})`);
    return existing;
  }
  let txHash = null;
  let outcome = null;
  try {
    txHash = await sendFn();
    console.log(`${label}: send returned tx ${txHash}; waiting for receipt`);
    try {
      const receipt = await waitFinal(client, txHash, label + " (expected-fail)");
      outcome = { sentTx: true, receiptStatus: statusName(receipt), receipt: summarizeReceipt(receipt) };
    } catch (waitErr) {
      outcome = { sentTx: true, waitError: String(waitErr?.message ?? waitErr) };
      try {
        const tx = await client.getTransaction({ hash: txHash });
        outcome.observedTxStatus = statusName(tx) ?? String(tx?.status ?? "");
      } catch { /* ignore */ }
    }
  } catch (sendErr) {
    outcome = { sentTx: false, error: String(sendErr?.message ?? sendErr) };
  }
  const unchanged = await stateUnchanged();
  if (!unchanged) throw new Error(`${label}: expected rejection but on-chain state CHANGED -- stopping for diagnosis. Outcome: ${JSON.stringify(outcome)}`);
  const done = { txHash, status: "REJECTED_RECORDED", outcome, stateUnchangedVerified: true };
  checkpoint.steps[key] = done; saveCheckpoint();
  console.log(`${label}: REJECTED as expected; state unchanged. txHash=${txHash ?? "none (client-side rejection)"}`);
  return done;
}

function writeEvidence(name, obj) {
  const p = path.join(root, "evidence", name);
  const tmp = p + ".tmp";
  writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n");
  renameSync(tmp, p);
  console.log("Wrote evidence/" + name);
}

const baseMeta = () => ({
  network: "Stable Studionet",
  chainId: 61999,
  rpcUrl: "https://studio.genlayer.com/api",
  contractAddress,
  explorer: `https://explorer-studio.genlayer.com/address/${contractAddress}`,
  studio: `https://studio.genlayer.com/?import-contract=${contractAddress}`,
  contractFile: "contracts/duelforge.py",
  contractSha256,
  note: "Nominal TEST units only -- no real funds. Creator/joiner/third addresses below are ephemeral Studionet accounts, labelled as such.",
});

// --- deploy ---
let contractAddress = checkpoint.contractAddress ?? null;
if (checkpoint.steps.deploy?.status === "FINALIZED" && contractAddress) {
  console.log("Deploy already FINALIZED in checkpoint:", contractAddress, checkpoint.steps.deploy.txHash);
} else {
  const deployRes = await runStep("deploy", creatorClient, async () => false, async () => {
    return await creatorClient.deployContract({ code, args: [], leaderOnly: false });
  }, "deploy");
  if (!contractAddress) {
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
    saveCheckpoint();
  }
}
console.log("Contract address:", contractAddress);
console.log("Explorer:", `https://explorer-studio.genlayer.com/address/${contractAddress}`);

// --- verify deployed code matches the repo file ---
let deployedCodeSha = null;
let deployedCodeVerified = false;
try {
  const deployedCode = await readClient.getContractCode(contractAddress);
  if (typeof deployedCode === "string" && deployedCode.length > 0) {
    deployedCodeSha = createHash("sha256").update(deployedCode).digest("hex");
    deployedCodeVerified = deployedCodeSha === contractSha256;
    console.log("Deployed code SHA256:", deployedCodeSha, deployedCodeVerified ? "(MATCHES repo file)" : "(MISMATCH -- stopping)");
    if (!deployedCodeVerified) throw new Error(`Deployed code SHA ${deployedCodeSha} != repo file SHA ${contractSha256} -- stopping`);
  } else {
    console.log("getContractCode returned empty/non-string; cannot verify deployed code this way -- recording as unverified, continuing with deploy tx + read-backs only.");
  }
} catch (e) {
  if (e.message.includes("MISMATCH")) throw e;
  console.log("getContractCode check failed (non-fatal):", String(e?.message ?? e));
}
checkpoint.deployedCodeSha256 = deployedCodeSha;
checkpoint.deployedCodeVerified = deployedCodeVerified;
saveCheckpoint();

const deployTxHash = checkpoint.steps.deploy?.txHash ?? null;

// --- case (a): ETH duel end-to-end ---
const ETH = { id: 0, asset: "ETH", threshold: 1500, creatorSide: "YES", joinerSide: "NO", stake: 100, expectedWinnerSide: "YES" };
{
  const create = await runStep("eth_create", creatorClient,
    async () => (await readDuel(contractAddress, ETH.id)) !== null,
    async () => await creatorClient.writeContract({
      address: contractAddress, functionName: "create_duel",
      args: [BigInt(ETH.id), ETH.asset, BigInt(ETH.threshold), ETH.creatorSide, BigInt(ETH.stake)],
      value: 0n, leaderOnly: false,
    }), "create ETH duel 0");
  const afterCreate = await readDuel(contractAddress, ETH.id);
  console.log("ETH duel 0 after create:", JSON.stringify(afterCreate));
  if (!afterCreate || afterCreate.status !== "OPEN" || afterCreate.asset !== "ETH") throw new Error("ETH duel 0 is not OPEN/ETH after create -- stopping");

  const join = await runStep("eth_join", joinerClient,
    async () => { const d = await readDuel(contractAddress, ETH.id); return d !== null && d.status !== "OPEN"; },
    async () => await joinerClient.writeContract({
      address: contractAddress, functionName: "join_duel",
      args: [BigInt(ETH.id), ETH.joinerSide], value: 0n, leaderOnly: false,
    }), "join ETH duel 0");
  const afterJoin = await readDuel(contractAddress, ETH.id);
  if (!afterJoin || afterJoin.status !== "STAKED") throw new Error("ETH duel 0 is not STAKED after join -- stopping");

  const settle = await runStep("eth_settle", creatorClient,
    async () => { const d = await readDuel(contractAddress, ETH.id); return d !== null && d.status === "SETTLED"; },
    async () => await creatorClient.writeContract({
      address: contractAddress, functionName: "settle_duel",
      args: [BigInt(ETH.id)], value: 0n, leaderOnly: false,
    }), "settle ETH duel 0");
  const afterSettle = await readDuel(contractAddress, ETH.id);
  console.log("ETH duel 0 after settle:", JSON.stringify(afterSettle));
  if (!afterSettle || afterSettle.status !== "SETTLED") throw new Error("ETH duel 0 is not SETTLED after settle -- stopping");
  if (afterSettle.winner_side !== ETH.expectedWinnerSide) {
    console.log(`WARNING: ETH duel 0 settled ${afterSettle.winner_side}, expected ${ETH.expectedWinnerSide} -- recorded honestly, not forced to re-settle`);
  }
  const creatorPlayer = await readPlayer(contractAddress, afterSettle.creator);
  const joinerPlayer = await readPlayer(contractAddress, afterSettle.joiner);
  const caseA = {
    ...baseMeta(),
    case: "(a) ETH duel end-to-end",
    duelId: ETH.id, asset: ETH.asset, threshold: ETH.threshold,
    proposition: `ETH price in USD is above $${ETH.threshold.toLocaleString("en-US")} at settlement`,
    livePriceContext: "Live ETH ~$2,120 at design time (2026-11-10); threshold $1,500 is a wide margin below it, so the expected outcome is YES wins.",
    creatorSide: ETH.creatorSide, joinerSide: ETH.joinerSide, stake: ETH.stake, pool: afterSettle.pool,
    creator: afterSettle.creator, creatorNote: "Ephemeral Studionet account, labelled as such.",
    joiner: afterSettle.joiner, joinerNote: "Ephemeral Studionet account, labelled as such.",
    createTxHash: create.txHash, createReceiptStatus: create.status,
    joinTxHash: join.txHash, joinReceiptStatus: join.status,
    settleTxHash: settle.txHash, settleReceiptStatus: settle.status, settleReceipt: settle.receipt ?? null,
    expectedWinnerSide: ETH.expectedWinnerSide,
    readBack: afterSettle, creatorPlayer, joinerPlayer,
    checkedAt: new Date().toISOString(),
  };
  checkpoint.cases.eth = caseA; saveCheckpoint();
  writeEvidence("multi-asset-eth-duel.json", caseA);
  console.log(`ETH duel complete: winner_side=${afterSettle.winner_side}, winner=${afterSettle.winner}, pool=${afterSettle.pool}`);
}

// --- case (b): BTC regression (v1 demo flow on the new contract) ---
const BTC = { id: 1, asset: "BTC", threshold: 50000, creatorSide: "YES", joinerSide: "NO", stake: 100, expectedWinnerSide: "YES" };
{
  const create = await runStep("btc_create", creatorClient,
    async () => (await readDuel(contractAddress, BTC.id)) !== null,
    async () => await creatorClient.writeContract({
      address: contractAddress, functionName: "create_duel",
      args: [BigInt(BTC.id), BTC.asset, BigInt(BTC.threshold), BTC.creatorSide, BigInt(BTC.stake)],
      value: 0n, leaderOnly: false,
    }), "create BTC duel 1");
  const afterCreate = await readDuel(contractAddress, BTC.id);
  if (!afterCreate || afterCreate.status !== "OPEN" || afterCreate.asset !== "BTC") throw new Error("BTC duel 1 is not OPEN/BTC after create -- stopping");

  const join = await runStep("btc_join", joinerClient,
    async () => { const d = await readDuel(contractAddress, BTC.id); return d !== null && d.status !== "OPEN"; },
    async () => await joinerClient.writeContract({
      address: contractAddress, functionName: "join_duel",
      args: [BigInt(BTC.id), BTC.joinerSide], value: 0n, leaderOnly: false,
    }), "join BTC duel 1");
  const afterJoin = await readDuel(contractAddress, BTC.id);
  if (!afterJoin || afterJoin.status !== "STAKED") throw new Error("BTC duel 1 is not STAKED after join -- stopping");

  const settle = await runStep("btc_settle", creatorClient,
    async () => { const d = await readDuel(contractAddress, BTC.id); return d !== null && d.status === "SETTLED"; },
    async () => await creatorClient.writeContract({
      address: contractAddress, functionName: "settle_duel",
      args: [BigInt(BTC.id)], value: 0n, leaderOnly: false,
    }), "settle BTC duel 1");
  const afterSettle = await readDuel(contractAddress, BTC.id);
  console.log("BTC duel 1 after settle:", JSON.stringify(afterSettle));
  if (!afterSettle || afterSettle.status !== "SETTLED") throw new Error("BTC duel 1 is not SETTLED after settle -- stopping");
  if (afterSettle.winner_side !== BTC.expectedWinnerSide) {
    console.log(`WARNING: BTC duel 1 settled ${afterSettle.winner_side}, expected ${BTC.expectedWinnerSide} -- recorded honestly, not forced to re-settle`);
  }
  const creatorPlayer = await readPlayer(contractAddress, afterSettle.creator);
  const joinerPlayer = await readPlayer(contractAddress, afterSettle.joiner);
  const caseB = {
    ...baseMeta(),
    case: "(b) BTC regression -- v1 demo flow re-run on the new contract",
    duelId: BTC.id, asset: BTC.asset, threshold: BTC.threshold,
    proposition: `BTC price in USD is above $${BTC.threshold.toLocaleString("en-US")} at settlement`,
    livePriceContext: "Live BTC ~$74,700 at design time (2026-11-10); threshold $50,000 is the v1 duel-0 threshold, wide margin, expected YES wins.",
    creatorSide: BTC.creatorSide, joinerSide: BTC.joinerSide, stake: BTC.stake, pool: afterSettle.pool,
    creator: afterSettle.creator, creatorNote: "Ephemeral Studionet account, labelled as such.",
    joiner: afterSettle.joiner, joinerNote: "Ephemeral Studionet account, labelled as such.",
    createTxHash: create.txHash, createReceiptStatus: create.status,
    joinTxHash: join.txHash, joinReceiptStatus: join.status,
    settleTxHash: settle.txHash, settleReceiptStatus: settle.status, settleReceipt: settle.receipt ?? null,
    expectedWinnerSide: BTC.expectedWinnerSide,
    readBack: afterSettle, creatorPlayer, joinerPlayer,
    checkedAt: new Date().toISOString(),
  };
  checkpoint.cases.btc = caseB; saveCheckpoint();
  writeEvidence("multi-asset-btc-regression.json", caseB);
  console.log(`BTC duel complete: winner_side=${afterSettle.winner_side}, winner=${afterSettle.winner}, pool=${afterSettle.pool}`);
}

// --- case (c): cancel journey ---
{
  const C = { id: 2, asset: "BTC", threshold: 50000, creatorSide: "YES", stake: 100 };
  const create = await runStep("cancel_create", creatorClient,
    async () => (await readDuel(contractAddress, C.id)) !== null,
    async () => await creatorClient.writeContract({
      address: contractAddress, functionName: "create_duel",
      args: [BigInt(C.id), C.asset, BigInt(C.threshold), C.creatorSide, BigInt(C.stake)],
      value: 0n, leaderOnly: false,
    }), "create duel 2 (to cancel)");
  const afterCreate = await readDuel(contractAddress, C.id);
  if (!afterCreate || afterCreate.status !== "OPEN") throw new Error("Duel 2 is not OPEN after create -- stopping");
  const creatorBefore = await readPlayer(contractAddress, afterCreate.creator);
  console.log("Creator balance before cancel:", JSON.stringify(creatorBefore));

  const cancel = await runStep("cancel_cancel", creatorClient,
    async () => { const d = await readDuel(contractAddress, C.id); return d !== null && d.status === "CANCELLED"; },
    async () => await creatorClient.writeContract({
      address: contractAddress, functionName: "cancel_duel",
      args: [BigInt(C.id)], value: 0n, leaderOnly: false,
    }), "cancel duel 2");
  const afterCancel = await readDuel(contractAddress, C.id);
  const creatorAfter = await readPlayer(contractAddress, afterCancel.creator);
  console.log("Duel 2 after cancel:", JSON.stringify(afterCancel));
  console.log("Creator balance after cancel:", JSON.stringify(creatorAfter));
  if (!afterCancel || afterCancel.status !== "CANCELLED") throw new Error("Duel 2 is not CANCELLED after cancel -- stopping");
  if (Number(creatorAfter.balance) !== Number(creatorBefore.balance) + C.stake) throw new Error(`Cancel refund mismatch: before ${creatorBefore.balance}, after ${creatorAfter.balance}, stake ${C.stake} -- stopping`);

  const joinFail = await runFailStep("cancel_join_fail", joinerClient,
    async () => await joinerClient.writeContract({
      address: contractAddress, functionName: "join_duel",
      args: [BigInt(C.id), "NO"], value: 0n, leaderOnly: false,
    }),
    async () => { const d = await readDuel(contractAddress, C.id); return d !== null && d.status === "CANCELLED"; },
    "join CANCELLED duel 2 (expected fail)");
  const settleFail = await runFailStep("cancel_settle_fail", creatorClient,
    async () => await creatorClient.writeContract({
      address: contractAddress, functionName: "settle_duel",
      args: [BigInt(C.id)], value: 0n, leaderOnly: false,
    }),
    async () => { const d = await readDuel(contractAddress, C.id); return d !== null && d.status === "CANCELLED"; },
    "settle CANCELLED duel 2 (expected fail)");
  const caseC = {
    ...baseMeta(),
    case: "(c) Cancel journey -- open duel cancelled, refund, then join/settle fail",
    duelId: C.id, asset: C.asset, threshold: C.threshold,
    creatorSide: C.creatorSide, stake: C.stake,
    creator: afterCancel.creator, creatorNote: "Ephemeral Studionet account, labelled as such.",
    createTxHash: create.txHash, createReceiptStatus: create.status,
    cancelTxHash: cancel.txHash, cancelReceiptStatus: cancel.status, cancelReceipt: cancel.receipt ?? null,
    creatorBalanceBeforeCancel: creatorBefore.balance,
    creatorBalanceAfterCancel: creatorAfter.balance,
    refundedStake: C.stake,
    joinAttempt: { ...joinFail, expectedError: "duel_not_open" },
    settleAttempt: { ...settleFail, expectedError: "duel_not_staked" },
    readBack: afterCancel, creatorPlayerAfterCancel: creatorAfter,
    checkedAt: new Date().toISOString(),
  };
  checkpoint.cases.cancel = caseC; saveCheckpoint();
  writeEvidence("multi-asset-cancel.json", caseC);
  console.log("Cancel journey complete: CANCELLED, refund verified, join+settle rejected.");
}

// --- case (d): negative cases ---
{
  // Duel 3 stays OPEN: used for cancel-by-non-creator, join-own, settle-OPEN.
  const D = { id: 3, asset: "BTC", threshold: 60000, creatorSide: "YES", stake: 100 };
  const create = await runStep("neg_create_open", creatorClient,
    async () => (await readDuel(contractAddress, D.id)) !== null,
    async () => await creatorClient.writeContract({
      address: contractAddress, functionName: "create_duel",
      args: [BigInt(D.id), D.asset, BigInt(D.threshold), D.creatorSide, BigInt(D.stake)],
      value: 0n, leaderOnly: false,
    }), "create duel 3 (OPEN, for negative cases)");
  const afterCreate = await readDuel(contractAddress, D.id);
  if (!afterCreate || afterCreate.status !== "OPEN") throw new Error("Duel 3 is not OPEN after create -- stopping");

  const badAsset = await runFailStep("neg_bad_asset", creatorClient,
    async () => await creatorClient.writeContract({
      address: contractAddress, functionName: "create_duel",
      args: [BigInt(99), "SOL", BigInt(50000), "YES", BigInt(100)],
      value: 0n, leaderOnly: false,
    }),
    async () => (await readDuel(contractAddress, 99)) === null,
    "create duel 99 with unknown asset SOL (expected fail)");
  const cancelNonCreator = await runFailStep("neg_cancel_non_creator", thirdClient,
    async () => await thirdClient.writeContract({
      address: contractAddress, functionName: "cancel_duel",
      args: [BigInt(D.id)], value: 0n, leaderOnly: false,
    }),
    async () => { const d = await readDuel(contractAddress, D.id); return d !== null && d.status === "OPEN"; },
    "cancel duel 3 by non-creator (expected fail)");
  const joinOwn = await runFailStep("neg_join_own", creatorClient,
    async () => await creatorClient.writeContract({
      address: contractAddress, functionName: "join_duel",
      args: [BigInt(D.id), "NO"], value: 0n, leaderOnly: false,
    }),
    async () => { const d = await readDuel(contractAddress, D.id); return d !== null && d.status === "OPEN"; },
    "join own duel 3 (expected fail)");
  const settleOpen = await runFailStep("neg_settle_open", creatorClient,
    async () => await creatorClient.writeContract({
      address: contractAddress, functionName: "settle_duel",
      args: [BigInt(D.id)], value: 0n, leaderOnly: false,
    }),
    async () => { const d = await readDuel(contractAddress, D.id); return d !== null && d.status === "OPEN"; },
    "settle OPEN duel 3 (expected fail)");
  const settleSettled = await runFailStep("neg_settle_settled", creatorClient,
    async () => await creatorClient.writeContract({
      address: contractAddress, functionName: "settle_duel",
      args: [BigInt(0)], value: 0n, leaderOnly: false,
    }),
    async () => { const d = await readDuel(contractAddress, 0); return d !== null && d.status === "SETTLED"; },
    "settle already-SETTLED duel 0 (expected fail)");
  const duel3After = await readDuel(contractAddress, D.id);
  const caseD = {
    ...baseMeta(),
    case: "(d) Negative cases -- lifecycle rejections recorded on-chain",
    openDuelId: D.id,
    openDuelCreateTxHash: create.txHash, openDuelCreateReceiptStatus: create.status,
    openDuelReadBack: duel3After,
    cases: [
      { name: "create with unknown asset", duelId: 99, asset: "SOL", expectedError: "asset_must_be_BTC_or_ETH", result: badAsset },
      { name: "cancel by non-creator", duelId: D.id, expectedError: "only_creator_can_cancel", result: cancelNonCreator },
      { name: "join own duel", duelId: D.id, expectedError: "cannot_join_own_duel", result: joinOwn },
      { name: "settle an OPEN (unstaked) duel", duelId: D.id, expectedError: "duel_not_staked", result: settleOpen },
      { name: "settle an already-SETTLED duel", duelId: 0, expectedError: "duel_not_staked", result: settleSettled },
    ],
    checkedAt: new Date().toISOString(),
  };
  checkpoint.cases.negative = caseD; saveCheckpoint();
  writeEvidence("multi-asset-negative-cases.json", caseD);
  console.log("Negative cases complete: all 5 rejections recorded, state unchanged.");
}

// --- summary + deployment pointer ---
const leaderboard = await readLeaderboard(contractAddress);
const summary = {
  ...baseMeta(),
  title: "DuelForge milestone evidence -- multi-asset duels (BTC + ETH) + cancel for open duels",
  milestone: "Market expansion: new playable markets (ETH alongside BTC) + a lifecycle exit (cancel for open duels). Settlement consensus (strict_eq on YES/NO only) reused unchanged; no new gate or verdict dimension.",
  v1Contract: "0x06D8b71D50FFd24035639cf0A93F620C8Fa2AA33 (untouched; v1 evidence in evidence/evidence.json and evidence/deploy-results.json)",
  deployTxHash,
  deployReceiptStatus: checkpoint.steps.deploy?.status ?? null,
  deployer: creatorAccount.address,
  deployerNote: "Ephemeral Studionet account generated at runtime (or GENLAYER_PRIVATE_KEY if supplied); key never written to any repo file.",
  deployedCodeSha256: deployedCodeSha,
  deployedCodeVerified: deployedCodeVerified,
  cases: {
    ethDuel: "evidence/multi-asset-eth-duel.json",
    btcRegression: "evidence/multi-asset-btc-regression.json",
    cancelJourney: "evidence/multi-asset-cancel.json",
    negativeCases: "evidence/multi-asset-negative-cases.json",
  },
  leaderboard,
  localTests: "See tests/test_duelforge.py -- mocked simulation only, NOT chain results.",
  browserWalletPath: "NOT VERIFIED -- no browser-wallet write was tested in this run.",
  checkedAt: new Date().toISOString(),
};
writeEvidence("multi-asset-evidence.json", summary);

const deployment = {
  network: "Stable Studionet", chainId: 61999, rpcUrl: "https://studio.genlayer.com/api",
  explorer: `https://explorer-studio.genlayer.com/address/${contractAddress}`,
  studio: `https://studio.genlayer.com/?import-contract=${contractAddress}`,
  contractAddress, deployTxHash, deployer: creatorAccount.address,
  contractFile: "contracts/duelforge.py", contractSha256, deployedAt: summary.checkedAt,
  receiptStatus: summary.deployReceiptStatus,
  deployedCodeSha256: deployedCodeSha,
  deployedCodeVerified,
  previousContractAddress: "0x06D8b71D50FFd24035639cf0A93F620C8Fa2AA33",
  previousContractNote: "v1 contract, untouched by this milestone; its evidence stays in evidence/evidence.json and evidence/deploy-results.json.",
};
writeFileSync(path.join(root, "deployment.json"), JSON.stringify(deployment, null, 2) + "\n");
console.log("Wrote evidence/multi-asset-*.json and deployment.json");
console.log("Contract:", contractAddress);
console.log("Leaderboard:", JSON.stringify(leaderboard));
console.log("DONE. Workdir checkpoint (keys.json + checkpoint.json) still exists in the evidence workdir -- delete it when the flow is confirmed complete.");
