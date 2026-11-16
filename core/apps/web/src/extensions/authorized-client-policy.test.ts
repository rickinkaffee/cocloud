import {expect, it} from "vite-plus/test";
import * as DateTime from "effect/DateTime";
import type {AuthClientSession} from "@t3tools/contracts";
import {cocloudVisibleClient} from "./authorized-client-policy";
it("uses typed session expiry and keeps current and personal clients visible", () => {
  const session = {current: false, expiresAt: DateTime.makeUnsafe(Date.now() + 60_000), client: {label: "Laptop"}} as AuthClientSession;
  expect(cocloudVisibleClient(session)).toBe(true);
  expect(cocloudVisibleClient({...session, expiresAt: DateTime.makeUnsafe(0)})).toBe(false);
  expect(cocloudVisibleClient({...session, client: {...session.client, label: "release-verification"}})).toBe(false);
  expect(cocloudVisibleClient({...session, current: true, client: {...session.client, label: "release-verification"}})).toBe(true);
});
