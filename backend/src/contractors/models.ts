import crypto from "node:crypto";
import { database, db } from "../db.js";
import type { CompanyType } from "../rbac/types.js";

export type ContractorConnectionStatus = "pending" | "accepted" | "declined";

export interface ContractorConnection {
  id: string;
  companyAId: string;
  companyBId: string;
  mainCompanyId: string | null;
  status: ContractorConnectionStatus;
  initiatedByCompanyId: string;
  initiatedByUserId: string | null;
  proposedMainCompanyId: string | null;
  roleChangeRequest: {
    proposedMainCompanyId: string;
    requestedByCompanyId: string;
    requestedByUserId: string;
    requestedAt: string;
  } | null;
  acceptedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ContractorConnectionRow {
  id: string;
  company_a_id: string;
  company_b_id: string;
  main_company_id: string | null;
  status: ContractorConnectionStatus;
  initiated_by_company_id: string;
  initiated_by_user_id: string | null;
  proposed_main_company_id: string | null;
  role_change_request: string | null;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContractorConnectionProject {
  id: string;
  connectionId: string;
  projectId: string;
  mainCompanyId: string;
  subCompanyId: string;
  shared: boolean;
}

export function ensureContractorTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS contractor_connections (
      id TEXT PRIMARY KEY,
      company_a_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      company_b_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      main_company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
      initiated_by_company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      initiated_by_user_id TEXT,
      proposed_main_company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
      role_change_request TEXT,
      accepted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK (company_a_id <> company_b_id)
    )
  `);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS contractor_connections_pair_unique
    ON contractor_connections (company_a_id, company_b_id)
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS contractor_connection_projects (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL REFERENCES contractor_connections(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      main_company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      sub_company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      shared INTEGER NOT NULL DEFAULT 0,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (connection_id, project_id)
    )
  `);
}

function mapConnectionRow(row: ContractorConnectionRow): ContractorConnection {
  return {
    id: row.id,
    companyAId: row.company_a_id,
    companyBId: row.company_b_id,
    mainCompanyId: row.main_company_id,
    status: row.status,
    initiatedByCompanyId: row.initiated_by_company_id,
    initiatedByUserId: row.initiated_by_user_id,
    proposedMainCompanyId: row.proposed_main_company_id,
    roleChangeRequest: row.role_change_request ? JSON.parse(row.role_change_request) : null,
    acceptedAt: row.accepted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function findContractorConnection(id: string): Promise<ContractorConnection | undefined> {
  const row = await database.get<ContractorConnectionRow>("SELECT * FROM contractor_connections WHERE id = ?", [id]);
  return row ? mapConnectionRow(row) : undefined;
}

export async function findConnectionBetween(a: string, b: string): Promise<ContractorConnection | undefined> {
  const [low, high] = a < b ? [a, b] : [b, a];
  const row = await database.get<ContractorConnectionRow>(
    "SELECT * FROM contractor_connections WHERE company_a_id = ? AND company_b_id = ?",
    [low, high],
  );
  return row ? mapConnectionRow(row) : undefined;
}

export async function listConnectionsForCompany(companyId: string): Promise<ContractorConnection[]> {
  const rows = await database.all<ContractorConnectionRow>(
    "SELECT * FROM contractor_connections WHERE company_a_id = ? OR company_b_id = ? ORDER BY updated_at DESC",
    [companyId, companyId],
  );
  return rows.map(mapConnectionRow);
}

export async function upsertConnectionRequest(params: {
  companyAId: string;
  companyBId: string;
  initiatedByCompanyId: string;
  initiatedByUserId: string;
  proposedMainCompanyId: string;
}): Promise<ContractorConnection> {
  const existing = await findConnectionBetween(params.companyAId, params.companyBId);
  const ts = new Date().toISOString();
  if (existing) {
    await database.run(
      `UPDATE contractor_connections SET status = 'pending', initiated_by_company_id = ?, initiated_by_user_id = ?,
       proposed_main_company_id = ?, role_change_request = NULL, accepted_at = NULL, updated_at = ? WHERE id = ?`,
      [params.initiatedByCompanyId, params.initiatedByUserId, params.proposedMainCompanyId, ts, existing.id],
    );
    return (await findContractorConnection(existing.id))!;
  }
  const id = crypto.randomUUID();
  await database.run(
    `INSERT INTO contractor_connections
     (id, company_a_id, company_b_id, status, initiated_by_company_id, initiated_by_user_id, proposed_main_company_id, created_at, updated_at)
     VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
    [id, params.companyAId, params.companyBId, params.initiatedByCompanyId, params.initiatedByUserId, params.proposedMainCompanyId, ts, ts],
  );
  return (await findContractorConnection(id))!;
}

export async function setConnectionResponse(
  id: string,
  accept: boolean,
  mainCompanyId: string | null,
  roleChangeRequest: ContractorConnection["roleChangeRequest"],
) {
  const ts = new Date().toISOString();
  if (!accept) {
    await database.run("UPDATE contractor_connections SET status = 'declined', updated_at = ? WHERE id = ?", [ts, id]);
    return;
  }
  await database.run(
    `UPDATE contractor_connections SET status = 'accepted', main_company_id = ?, accepted_at = ?,
     proposed_main_company_id = NULL, role_change_request = ?, updated_at = ? WHERE id = ?`,
    [mainCompanyId, ts, roleChangeRequest ? JSON.stringify(roleChangeRequest) : null, ts, id],
  );
}

export async function setConnectionMain(id: string, mainCompanyId: string) {
  const ts = new Date().toISOString();
  await database.run(
    "UPDATE contractor_connections SET main_company_id = ?, role_change_request = NULL, updated_at = ? WHERE id = ?",
    [mainCompanyId, ts, id],
  );
}

export async function setRoleChangeRequest(id: string, req: NonNullable<ContractorConnection["roleChangeRequest"]>) {
  const ts = new Date().toISOString();
  await database.run("UPDATE contractor_connections SET role_change_request = ?, updated_at = ? WHERE id = ?", [
    JSON.stringify(req),
    ts,
    id,
  ]);
}

export async function listConnectionProjects(connectionId: string): Promise<ContractorConnectionProject[]> {
  const rows = await database.all<{
    id: string;
    connection_id: string;
    project_id: string;
    main_company_id: string;
    sub_company_id: string;
    shared: number;
  }>("SELECT * FROM contractor_connection_projects WHERE connection_id = ?", [connectionId]);
  return rows.map((r) => ({
    id: r.id,
    connectionId: r.connection_id,
    projectId: r.project_id,
    mainCompanyId: r.main_company_id,
    subCompanyId: r.sub_company_id,
    shared: r.shared === 1,
  }));
}

export async function setConnectionProject(params: {
  connectionId: string;
  projectId: string;
  mainCompanyId: string;
  subCompanyId: string;
  shared: boolean;
  createdBy: string;
}) {
  const id = crypto.randomUUID();
  const ts = new Date().toISOString();
  // Upsert on (connection_id, project_id): same columns updated either way,
  // only the conflict syntax differs between the two databases.
  const upsert =
    database.dialect === "mysql"
      ? `AS new ON DUPLICATE KEY UPDATE
       main_company_id = new.main_company_id, sub_company_id = new.sub_company_id,
       shared = new.shared, updated_at = new.updated_at`
      : `ON CONFLICT (connection_id, project_id) DO UPDATE SET
       main_company_id = excluded.main_company_id, sub_company_id = excluded.sub_company_id,
       shared = excluded.shared, updated_at = excluded.updated_at`;
  await database.run(
    `INSERT INTO contractor_connection_projects
     (id, connection_id, project_id, main_company_id, sub_company_id, shared, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ${upsert}`,
    [
      id,
      params.connectionId,
      params.projectId,
      params.mainCompanyId,
      params.subCompanyId,
      params.shared ? 1 : 0,
      params.createdBy,
      ts,
      ts,
    ],
  );
}

export async function unsetConnectionProject(connectionId: string, projectId: string) {
  await database.run("DELETE FROM contractor_connection_projects WHERE connection_id = ? AND project_id = ?", [
    connectionId,
    projectId,
  ]);
}

export async function deleteContractorConnectionsForProject(projectId: string) {
  await database.run("DELETE FROM contractor_connection_projects WHERE project_id = ?", [projectId]);
}
