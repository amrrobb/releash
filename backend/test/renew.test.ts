/** Exercises the REAL vault on the local anvil: the backend's signature must be accepted by renew(). */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BaseError, ContractFunctionRevertedError, createPublicClient, createWalletClient, decodeEventLog, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { loadConfig } from "../src/config.js";
import { startServer } from "../src/server.js";
import { openStore } from "../src/store.js";

const env = { ...process.env, WORLD_SIMULATE: "1", PORT: "0", DB_PATH: join(mkdtempSync(join(tmpdir(), "releash-")), "t.db") };
const config = loadConfig(env);
if (config.chainId !== 31337) throw new Error("this test runs on the local anvil only");
const vault = config.deployments.vault;
const abi = config.vaultAbi;
const pub = createPublicClient({ chain: foundry, transport: http(config.rpcUrl), pollingInterval: 200 });
const w = (pk: Hex) => createWalletClient({ account: privateKeyToAccount(pk), chain: foundry, transport: http(config.rpcUrl) });
// anvil #6 and #7 (not used by the demo), #2 is the agent
const ownerA = w("0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e");
const ownerB = w("0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356");
const agent = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a").address;
const human = `0x${Date.now().toString(16)}aa`; // fresh nullifier per run

let srv: Awaited<ReturnType<typeof startServer>>;
before(async () => {
  srv = await startServer(config);
  for (const o of [ownerA, ownerB]) {
    const hash = await o.writeContract({ address: vault, abi, functionName: "setMandate", args: [agent, 1000_000000n] });
    await pub.waitForTransactionReceipt({ hash });
  }
});
after(() => srv.close());

const renewCall = (owner: Address, nullifier: string) =>
  fetch(`${srv.url}/api/renew`, { method: "POST", body: JSON.stringify({ owner, agent, idkitResult: { responses: [{ identifier: "proof_of_human", nullifier }] } }) });

const revertName = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return "no revert";
  } catch (e) {
    const r = (e as BaseError).walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    return r?.data?.errorName ?? "unknown";
  }
};

test("backend signature is accepted by the deployed vault; tampering and replay are refused", async () => {
  const res = await renewCall(ownerA.account.address, human);
  assert.equal(res.status, 200, await res.clone().text());
  const { renewal, signature } = await res.json();
  const r = { owner: renewal.owner, agent: renewal.agent, issuedAt: BigInt(renewal.issuedAt), deadline: BigInt(renewal.deadline) };
  assert.equal(r.deadline - r.issuedAt, 600n);

  // Tampered deadline: the vault's own digest no longer matches the signature.
  assert.equal(await revertName(() => pub.simulateContract({ account: ownerB.account, address: vault, abi, functionName: "renew", args: [{ ...r, deadline: r.deadline + 1n }, signature] })), "BadSignature");

  // Anyone may submit: ownerB relays ownerA's renewal.
  const hash = await ownerB.writeContract({ address: vault, abi, functionName: "renew", args: [r, signature] });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success");
  const ev = receipt.logs.map((l) => { try { return decodeEventLog({ abi, data: l.data, topics: l.topics }) as any; } catch { return null; } }).find((e) => e?.eventName === "Renewed");
  assert.ok(ev, "Renewed event emitted");
  assert.equal(ev.args.owner.toLowerCase(), ownerA.account.address.toLowerCase());
  assert.equal(ev.args.issuedAt, r.issuedAt);
  const m = (await pub.readContract({ address: vault, abi, functionName: "mandates", args: [ownerA.account.address] })) as any[];
  assert.equal(m[2], r.issuedAt, "mandates().lastRenewed == issuedAt");
  assert.ok(((await pub.readContract({ address: vault, abi, functionName: "authorityNow", args: [ownerA.account.address] })) as bigint) > 0n);

  // Single use.
  assert.equal(await revertName(() => pub.simulateContract({ account: ownerB.account, address: vault, abi, functionName: "renew", args: [r, signature] })), "RenewalNotNewer");
});

test("simulate mode: the simulator's shared nullifier does not lock out a second owner", async () => {
  const res = await renewCall(ownerB.account.address, human); // same nullifier ownerA sent
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal((await res.json()).simulated, true);
});

test("real proofs: one owner one human, one human one owner (store binding)", () => {
  const store = openStore(":memory:");
  assert.equal(store.bindHuman("0xn1", "0xA", "proof_of_human", false), null);
  assert.equal(store.bindHuman("0xn1", "0xA", "proof_of_human", false), null, "same human renews again");
  assert.match(String(store.bindHuman("0xn2", "0xA", "proof_of_human", false)), /already has its human/);
  assert.match(String(store.bindHuman("0xn1", "0xB", "proof_of_human", false)), /another account/);
  store.close();
});

test("renew for an agent the mandate does not name is refused before signing", async () => {
  const res = await fetch(`${srv.url}/api/renew`, { method: "POST", body: JSON.stringify({ owner: ownerA.account.address, agent: ownerB.account.address, idkitResult: {} }) });
  assert.equal(res.status, 400);
});

test("revoke then immediate renew succeeds once chain time reaches issuedAt", async () => {
  // ownerA was renewed above; revoke raises renewalFloor to this second.
  const rv = await ownerA.writeContract({ address: vault, abi, functionName: "revoke", args: [] });
  await pub.waitForTransactionReceipt({ hash: rv });
  const floor = (await pub.readContract({ address: vault, abi, functionName: "renewalFloor", args: [ownerA.account.address] })) as bigint;
  const res = await renewCall(ownerA.account.address, human);
  assert.equal(res.status, 200, await res.clone().text());
  const { renewal, signature } = await res.json();
  const r = { owner: renewal.owner, agent: renewal.agent, issuedAt: BigInt(renewal.issuedAt), deadline: BigInt(renewal.deadline) };
  assert.ok(r.issuedAt > floor, `issuedAt ${r.issuedAt} must be above renewalFloor ${floor}`);
  while ((await pub.getBlock({ blockTag: "latest" })).timestamp < r.issuedAt) await new Promise((ok) => setTimeout(ok, 200));
  const hash = await ownerB.writeContract({ address: vault, abi, functionName: "renew", args: [r, signature] });
  assert.equal((await pub.waitForTransactionReceipt({ hash })).status, "success");
  const m = (await pub.readContract({ address: vault, abi, functionName: "mandates", args: [ownerA.account.address] })) as any[];
  assert.equal(m[2], r.issuedAt);
  assert.equal(m[3], false, "renew clears revoked");
});
