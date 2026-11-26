// Temporary automated checks still obtain and revoke real authorization.
// Keep those sessions out of the personal device list; never hide the current client.
function cocloudVisibleClient(session) {
  if (session.current) return true;
  if (session.revokedAt || (session.expiresAt && Date.parse(session.expiresAt) <= Date.now())) return false;
  const label = session.client?.label ?? '';
  return !/(?:^|[-\s])(?:regression|verification|verify|check|screenshot)(?:$|[-\s])/i.test(label);
}
