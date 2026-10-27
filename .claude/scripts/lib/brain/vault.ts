/**
 * Where the brain vault is. `BRAIN_VAULT` wins (the global hooks and the
 * tests set it); otherwise the vault is two folders above `.claude/scripts/`,
 * which is where every brain script lives.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function resolveVaultRoot(scriptUrl: string, env: NodeJS.ProcessEnv = process.env): string {
	const fromEnv = env["BRAIN_VAULT"];
	if (fromEnv !== undefined && fromEnv.trim() !== "") return resolve(fromEnv);
	return resolve(dirname(fileURLToPath(scriptUrl)), "..", "..");
}
