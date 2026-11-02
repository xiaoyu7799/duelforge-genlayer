import { createClient, createAccount, generatePrivateKey } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
const addr = "0x06D8b71D50FFd24035639cf0A93F620C8Fa2AA33";
const client = createClient({ chain: studionet, account: createAccount(generatePrivateKey()) });
const read = async (fn, args=[]) => { const r = await client.readContract({ address: addr, functionName: fn, args }); return typeof r==="string"?JSON.parse(r):r; };
console.log("duel0:", JSON.stringify(await read("get_duel",[0n])));
console.log("duel1:", JSON.stringify(await read("get_duel",[1n])));
console.log("count:", String(await client.readContract({ address: addr, functionName: "get_duel_count", args: [] })));
console.log("creator player:", JSON.stringify(await read("get_player",["0xEa592eCF859B01E0588446DFFA0ed530f231C95b"])));
console.log("joiner player:", JSON.stringify(await read("get_player",["0xB1d3809853FeC25b264eefB4A7DDE1A61aD0806d"])));
console.log("leaderboard:", JSON.stringify(await read("get_leaderboard")));
for (const [label, hash] of [["settle0","0x196d1e9fd22d26a9019c234d56e8b53c7f71cf17ca6df2f6084b3a2fb88948c5"],["settle1","0x497c1b1d283149fe4950fe506af172353a50ca9d6df7413543fc3d591f6b5ac3"]]) {
  const rc = await client.waitForTransactionReceipt({ hash, status: TransactionStatus.FINALIZED, retries: 30, interval: 5000 });
  console.log(label, "receipt top-level keys:", Object.keys(rc));
  console.log(label, "status:", rc.statusName ?? rc.status, "data keys:", rc.data ? Object.keys(rc.data) : null);
  const s = JSON.stringify(rc);
  console.log(label, "AGREE mentions:", (s.match(/AGREE/g)||[]).length, "DISAGREE mentions:", (s.match(/DISAGREE/g)||[]).length);
  if (rc.data) console.log(label, "data:", JSON.stringify(rc.data).slice(0,1500));
}
