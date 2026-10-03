import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** True when this module is the script tsx was asked to run (so e2e can import the others). */
export function isMain(metaUrl: string) {
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}
