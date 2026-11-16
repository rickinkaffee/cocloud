import { Link } from "@tanstack/react-router";
import { AuthAccessReadScope } from "@t3tools/contracts";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useEnvironmentScope } from "../state/session";
import { useEnvironmentQuery } from "../state/query";
import { authEnvironment } from "../state/auth";
import { CocloudConnectionCenter } from "../extensions/connection-center.js";
import { cocloudVisibleClient } from "../extensions/authorized-client-policy";

export function WorkbenchConnectionCenter() {
  const environmentId = usePrimaryEnvironmentId();
  const canView = useEnvironmentScope(environmentId, AuthAccessReadScope);
  const access = useEnvironmentQuery(canView && environmentId ? authEnvironment.accessChanges({environmentId, input: null}) : null);
  const count = access.error === null && access.data?.type === "snapshot"
    ? access.data.payload.clientSessions.filter(cocloudVisibleClient).length : null;
  return <CocloudConnectionCenter authorizationCount={count} canView={canView}
    deviceSettings={<Link to="/settings/access" className="flex min-h-9 items-center underline">管理设备与授权</Link>}/>;
}
