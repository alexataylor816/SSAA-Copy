import { findUserById, type User } from "../models/users.js";
import { findCompanyById, findUserRole } from "../rbac/models.js";
import { hasPartialOrHigher } from "../rbac/permissions.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../rbac/errors.js";
import { database } from "../db.js";
import { findProjectById } from "../scheduling/models.js";
import {
  findContractorConnection,
  listConnectionProjects,
  listConnectionsForCompany,
  setConnectionMain,
  setConnectionProject,
  setConnectionResponse,
  setRoleChangeRequest,
  unsetConnectionProject,
  upsertConnectionRequest,
  type ContractorConnection,
} from "./models.js";

async function requireUserWithCompany(userId: string): Promise<User> {
  const user = await findUserById(userId);
  if (!user) throw new NotFoundError("User not found.");
  if (!user.companyId) throw new ConflictError("You need to be part of a company first.");
  return user;
}

async function requirePartialOrHigher(user: User): Promise<void> {
  if (user.isAdmin) return;
  const role = user.companyId ? await findUserRole(user.id, user.companyId) : undefined;
  if (!hasPartialOrHigher({ isAdmin: user.isAdmin, permissionLevel: role?.permissionLevel ?? null })) {
    throw new ForbiddenError("You need Partial-level access or higher to manage contractor connections.");
  }
}

function requireMember(user: User, conn: ContractorConnection): void {
  if (user.isAdmin) return;
  if (user.companyId !== conn.companyAId && user.companyId !== conn.companyBId) {
    throw new ForbiddenError("You are not on this connection.");
  }
}

function otherSide(conn: ContractorConnection, companyId: string): string {
  return conn.companyAId === companyId ? conn.companyBId : conn.companyAId;
}

export interface ConnectionView extends ContractorConnection {
  otherCompanyId: string;
  otherCompanyName: string | null;
  direction: "outgoing" | "incoming" | "active";
}

export async function listMyConnections(userId: string): Promise<ConnectionView[]> {
  const user = await requireUserWithCompany(userId);
  return Promise.all(
    (await listConnectionsForCompany(user.companyId!)).map(async (conn): Promise<ConnectionView> => {
      const otherId = otherSide(conn, user.companyId!);
      const other = await findCompanyById(otherId);
      const active = conn.status === "accepted";
      return {
        ...conn,
        otherCompanyId: otherId,
        otherCompanyName: other?.name ?? null,
        direction: active ? "active" : conn.initiatedByCompanyId === user.companyId ? "outgoing" : "incoming",
      };
    }),
  );
}

/** Propose (or re-propose) a standing connection to another company. */
export async function requestConnection(
  userId: string,
  otherCompanyId: string,
  proposedRole: "main" | "sub",
): Promise<ContractorConnection> {
  const user = await requireUserWithCompany(userId);
  await requirePartialOrHigher(user);
  if (typeof otherCompanyId !== "string" || !otherCompanyId) {
    throw new BadRequestError("Another company is required.");
  }
  if (otherCompanyId === user.companyId) {
    throw new BadRequestError("Cannot connect to your own company.");
  }
  const other = await findCompanyById(otherCompanyId);
  if (!other) throw new NotFoundError("Company not found.");
  if (proposedRole !== "main" && proposedRole !== "sub") {
    throw new BadRequestError("proposedRole must be 'main' or 'sub'.");
  }

  const mine = user.companyId!;
  const [a, b] = mine < otherCompanyId ? [mine, otherCompanyId] : [otherCompanyId, mine];
  return await upsertConnectionRequest({
    companyAId: a,
    companyBId: b,
    initiatedByCompanyId: mine,
    initiatedByUserId: userId,
    proposedMainCompanyId: proposedRole === "main" ? mine : otherCompanyId,
  });
}

/** Accept (optionally confirming which side is main) or decline a proposal. */
export async function respondConnection(
  userId: string,
  connectionId: string,
  accept: boolean,
  confirmMainCompanyId?: string,
): Promise<ContractorConnection> {
  const user = await requireUserWithCompany(userId);
  await requirePartialOrHigher(user);
  const conn = await findContractorConnection(connectionId);
  if (!conn) throw new NotFoundError("Connection not found.");
  requireMember(user, conn);
  if (conn.status !== "pending") {
    throw new ConflictError("This connection request has already been handled.");
  }
  if (conn.initiatedByCompanyId === user.companyId) {
    throw new ForbiddenError("The initiating company cannot accept its own request.");
  }
  if (!accept) {
    await setConnectionResponse(connectionId, false, null, null);
    return (await findContractorConnection(connectionId))!;
  }
  const main = confirmMainCompanyId ?? conn.proposedMainCompanyId;
  if (main !== conn.companyAId && main !== conn.companyBId) {
    throw new BadRequestError("Main company must be one of the two connected companies.");
  }
  await setConnectionResponse(connectionId, true, main, null);
  return (await findContractorConnection(connectionId))!;
}

/**
 * Two-step role swap: first call from one side records the request, a
 * matching call from the other side confirms it. Returns what happened.
 */
export async function swapConnectionRole(
  userId: string,
  connectionId: string,
  proposedMainCompanyId: string,
): Promise<{ result: "requested" | "confirmed"; connection: ContractorConnection }> {
  const user = await requireUserWithCompany(userId);
  await requirePartialOrHigher(user);
  const conn = await findContractorConnection(connectionId);
  if (!conn) throw new NotFoundError("Connection not found.");
  requireMember(user, conn);
  if (conn.status !== "accepted") {
    throw new ConflictError("Connection is not active.");
  }
  if (proposedMainCompanyId !== conn.companyAId && proposedMainCompanyId !== conn.companyBId) {
    throw new BadRequestError("Main company must be one of the two connected companies.");
  }

  const pending = conn.roleChangeRequest;
  if (
    pending &&
    pending.requestedByCompanyId !== user.companyId &&
    pending.proposedMainCompanyId === proposedMainCompanyId
  ) {
    await setConnectionMain(connectionId, proposedMainCompanyId);
    return { result: "confirmed", connection: (await findContractorConnection(connectionId))! };
  }
  const ts = new Date().toISOString();
  await setRoleChangeRequest(connectionId, {
    proposedMainCompanyId,
    requestedByCompanyId: user.companyId!,
    requestedByUserId: userId,
    requestedAt: ts,
  });
  return { result: "requested", connection: (await findContractorConnection(connectionId))! };
}

/** Share (or unshare) one of the main side's projects over the connection. */
export async function linkConnectionProject(
  userId: string,
  connectionId: string,
  projectId: string,
  shared: boolean,
): Promise<void> {
  const user = await requireUserWithCompany(userId);
  await requirePartialOrHigher(user);
  const conn = await findContractorConnection(connectionId);
  if (!conn) throw new NotFoundError("Connection not found.");
  requireMember(user, conn);
  if (conn.status !== "accepted" || !conn.mainCompanyId) {
    throw new ConflictError("Connection is not active.");
  }
  if (user.companyId !== conn.mainCompanyId && !user.isAdmin) {
    throw new ForbiddenError("Only the main side manages shared projects.");
  }
  const project = await findProjectById(projectId);
  if (!project || project.companyId !== conn.mainCompanyId) {
    throw new NotFoundError("Project not found on the main side.");
  }
  const subCompanyId = conn.mainCompanyId === conn.companyAId ? conn.companyBId : conn.companyAId;
  if (shared) {
    await setConnectionProject({
      connectionId,
      projectId,
      mainCompanyId: conn.mainCompanyId,
      subCompanyId,
      shared: true,
      createdBy: userId,
    });
  } else {
    await unsetConnectionProject(connectionId, projectId);
  }
}

export async function listConnectionProjectsFor(userId: string, connectionId: string) {
  const user = await requireUserWithCompany(userId);
  const conn = await findContractorConnection(connectionId);
  if (!conn) throw new NotFoundError("Connection not found.");
  requireMember(user, conn);
  return await listConnectionProjects(connectionId);
}

export async function deleteConnection(userId: string, connectionId: string): Promise<ContractorConnection> {
  const user = await requireUserWithCompany(userId);
  await requirePartialOrHigher(user);
  const conn = await findContractorConnection(connectionId);
  if (!conn) throw new NotFoundError("Connection not found.");
  requireMember(user, conn);
  await database.run("DELETE FROM contractor_connection_projects WHERE connection_id = ?", [connectionId]);
  await database.run("DELETE FROM contractor_connections WHERE id = ?", [connectionId]);
  return conn;
}
