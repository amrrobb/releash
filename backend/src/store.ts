import { DatabaseSync } from "node:sqlite";

/** Nonces we signed into rp_context (single-use) and the human bound to each owner.
 * One owner, one human: the first verified nullifier for an owner is the only one that can renew it.
 * One human, one owner: a nullifier already bound to another owner is refused. */
export function openStore(path: string) {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS nonces (nonce TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, used_at INTEGER);
    CREATE TABLE IF NOT EXISTS owner_humans (owner TEXT PRIMARY KEY COLLATE NOCASE, nullifier TEXT NOT NULL UNIQUE, credential TEXT NOT NULL, simulated INTEGER NOT NULL, first_seen INTEGER NOT NULL);
  `);
  const insertNonce = db.prepare("INSERT INTO nonces (nonce, expires_at) VALUES (?, ?)");
  const useNonce = db.prepare("UPDATE nonces SET used_at = ? WHERE nonce = ? AND used_at IS NULL AND expires_at >= ?");
  const byOwner = db.prepare("SELECT nullifier FROM owner_humans WHERE owner = ?");
  const byNullifier = db.prepare("SELECT owner FROM owner_humans WHERE nullifier = ?");
  const insertHuman = db.prepare("INSERT INTO owner_humans (owner, nullifier, credential, simulated, first_seen) VALUES (?, ?, ?, ?, ?)");
  return {
    issueNonce(nonce: string, expiresAt: number) {
      insertNonce.run(nonce, expiresAt);
    },
    consumeNonce(nonce: string, now = Math.floor(Date.now() / 1000)) {
      return useNonce.run(now, nonce, now).changes === 1;
    },
    /** null if bound (or already bound to this same human); otherwise why it is refused. */
    bindHuman(nullifier: string, owner: string, credential: string, simulated: boolean, now = Math.floor(Date.now() / 1000)): string | null {
      const o = byOwner.get(owner) as { nullifier: string } | undefined;
      if (o) return o.nullifier === nullifier ? null : "This account already has its human. A different verified person cannot renew this agent.";
      const n = byNullifier.get(nullifier) as { owner: string } | undefined;
      if (n) return "This human already backs another account. One human, one account.";
      insertHuman.run(owner, nullifier, credential, simulated ? 1 : 0, now);
      return null;
    },
    close() {
      db.close();
    },
  };
}
export type Store = ReturnType<typeof openStore>;
