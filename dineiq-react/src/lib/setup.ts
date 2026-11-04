import { authRequest } from "./auth";
import { parseSetupStatus } from "./setup-state";

export async function readSetupStatus(signal?: AbortSignal) {
  return parseSetupStatus(await authRequest("/setup/status", { signal }));
}

export function refreshInstallation() {
  window.dispatchEvent(new Event("dineiq:setup-changed"));
}
