/** World ID v4: rp_context signing and server-side proof verification (ported from Leash backend/src/world.js + flow.js). */
import { signRequest } from "@worldcoin/idkit-core/signing";
import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { keccak256, toHex } from "viem";
import { requireWorld, type World } from "./config.js";
import type { Store } from "./store.js";

const fail = (status: number, message: string) => Object.assign(new Error(message), { status });

/** Credentials that prove a human. "device" (phone only) is deliberately absent. */
const HUMAN = new Set(["proof_of_human", "orb", "passport", "mnc", "document", "secure_document", "selfie", "face"]);

export function issueRpContext(world: World, store: Store, environment?: string) {
  requireWorld(world);
  const env = environment ?? world.environment;
  if (env !== "staging" && env !== "production") throw fail(400, "environment must be staging or production");
  if (env === "staging" && !world.stagingToken) throw fail(400, "no staging window is open on this server");
  const simulator = env === "staging" && environment !== undefined;
  const sig = signRequest({ action: world.action, signingKeyHex: world.signingKey! });
  store.issueNonce(sig.nonce, sig.expiresAt);
  return {
    app_id: world.appId,
    action: world.action,
    environment: env,
    credentials: simulator ? ["proof_of_human"] : world.credentials,
    allow_legacy_proofs: simulator ? false : world.allowLegacy,
    simulator_available: Boolean(world.stagingToken),
    rp_context: { rp_id: world.rpId, nonce: sig.nonce, created_at: sig.createdAt, expires_at: sig.expiresAt, signature: sig.sig },
  };
}

/** Forwards the IDKit completion result untouched to the Developer Portal. Throws on rejection. */
async function verifyWithPortal(result: any, world: World) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (world.stagingToken && (result?.environment ?? world.environment) === "staging") headers["x-staging-verification-token"] = world.stagingToken;
  const res = await fetch(`${world.verifyUrl}/${world.rpId}`, { method: "POST", headers, body: JSON.stringify(result) });
  let body: any = {};
  try {
    body = await res.json();
  } catch {}
  if (!res.ok || body.success !== true) throw Object.assign(fail(400, `World rejected the proof: ${body.detail ?? body.code ?? res.status}`), { portal: body });
  return body;
}

/** Verifies the proof was made by a human, for this action, with signal = owner; returns the nullifier.
 * WORLD_SIMULATE=1 skips the portal and every proof check (local dev only). */
export async function verifyHuman(world: World, store: Store, owner: string, result: any): Promise<{ nullifier: string; credential: string; simulated: boolean }> {
  const signal = owner.toLowerCase();
  if (world.simulate) {
    const nullifier = String(result?.responses?.[0]?.nullifier ?? keccak256(toHex(`releash-simulated-human:${signal}`)));
    console.warn(`[WORLD_SIMULATE] portal verification SKIPPED for ${owner}; nullifier ${nullifier.slice(0, 12)}…`);
    return { nullifier, credential: "simulated", simulated: true };
  }
  requireWorld(world);
  const legacy = result?.protocol_version === "3.0";
  if (result?.protocol_version !== "4.0" && !(legacy && world.allowLegacy)) throw fail(400, "expected a World ID 4.0 proof");
  if (result.action !== world.action) throw fail(400, `proof is for action "${result.action}", expected "${world.action}"`);
  const responses: any[] = result.responses ?? [];
  const human = responses.find((r) => HUMAN.has(r.identifier));
  if (!human) throw fail(400, "no human credential in the proof");
  const expected = hashSignal(signal).toLowerCase();
  if (String(human.signal_hash ?? "").toLowerCase() !== expected) throw fail(400, "proof signal is not this account (request it with signal = owner address, lowercase)");
  if (!store.consumeNonce(result.nonce)) throw fail(409, "rp_context nonce is unknown, expired or already used");
  await verifyWithPortal(result, world);
  return { nullifier: String(human.nullifier), credential: String(human.identifier), simulated: false };
}
