import type { AuthClientSession } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { cocloudVisibleClient as visible } from "./authorized-clients.js";
export function cocloudVisibleClient(session: AuthClientSession): boolean {
  return visible({...session, expiresAt: DateTime.formatIso(session.expiresAt)});
}
