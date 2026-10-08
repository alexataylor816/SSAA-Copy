import crypto from "node:crypto";
import { database } from "../db.js";
import { findCompanyById, findEmployeeById } from "../rbac/models.js";
import type { Availability, Project, ProjectConnection, ScheduleRequest, ScheduleRequestStatus } from "./types.js";

interface ProjectRow {
  id: string;
  name: string;
  address: string | null;
  company_id: string;
  connection_code: string;
  created_at: string;
  updated_at: string;
}

interface ProjectConnectionRow {
  id: string;
  project_id: string;
  sub_company_id: string;
  connected_at: string;
}

interface AvailabilityRow {
  id: string;
  employee_id: string;
  project_id: string | null;
  date: string;
  start_time: string;
  end_time: string;
  all_projects: 0 | 1;
  stop_number: number | string | null;
  stop_label: string | null;
  created_at: string;
}

interface ScheduleRequestRow {
  id: string;
  project_id: string;
  requesting_company_id: string;
  sub_company_id: string;
  employee_ids: string; // JSON array
  date: string;
  start_time: string | null;
  end_time: string | null;
  description: string | null;
  image_urls: string; // JSON array of /uploads/* paths attached to the request
  status: ScheduleRequestStatus;
  status_reason: string | null;
  created_at: string;
  updated_at: string;
}

export async function ensureSchedulingTables(): Promise<void> {
  await database.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      connection_code TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await database.exec(`
    CREATE TABLE IF NOT EXISTS project_connections (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      sub_company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      connected_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (project_id, sub_company_id)
    )
  `);

  await database.exec(`
    CREATE TABLE IF NOT EXISTS availability (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      all_projects INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await database.exec("CREATE INDEX IF NOT EXISTS idx_availability_date ON availability(date)");
  await database.exec("CREATE INDEX IF NOT EXISTS idx_availability_employee ON availability(employee_id)");

  await database.exec(`
    CREATE TABLE IF NOT EXISTS schedule_requests (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      requesting_company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      sub_company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      employee_ids TEXT NOT NULL DEFAULT '[]',
      date TEXT NOT NULL,
      start_time TEXT,
      end_time TEXT,
      description TEXT,
      image_urls TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending',
'confirmed', 'rejected', 'cancelled')),
      status_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await database.exec("CREATE INDEX IF NOT EXISTS idx_schedule_requests_date ON schedule_requests(date)");

  // Additive columns for SQLite databases created before photo attachments
  // existed. PRAGMA is SQLite-only; MySQL gets them from the MySQL schema file.
  if (database.dialect === "sqlite") {
    const columns = new Set(
      (await database.all<{ name: string }>("PRAGMA table_info(schedule_requests)")).map((c) => c.name),
    );
    if (!columns.has("image_urls")) {
      await database.exec("ALTER TABLE schedule_requests ADD COLUMN image_urls TEXT NOT NULL DEFAULT '[]'");
    }
    if (!columns.has("status_reason")) {
      await database.exec("ALTER TABLE schedule_requests ADD COLUMN status_reason TEXT");
    }
  }
}
function randomConnectionCode(): string {
  return crypto.randomBytes(6).toString("hex").slice(0, 8);
}

/** A UNIQUE-constraint violation, in either database's wording. */
function isUniqueViolation(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.message.includes("UNIQUE") || (err as { code?: string }).code === "ER_DUP_ENTRY";
}

export async function createProjectRow(params: { name: string; address?: string | null; companyId: string }): Promise<Project> {
  const id = crypto.randomUUID();
  // Connection codes are short and drawn from a small alphabet — collisions
  // are rare but not impossible, so retry a few times against the UNIQUE constraint.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const code = randomConnectionCode();
      await database.run(
        "INSERT INTO projects (id, name, address, company_id, connection_code) VALUES (?, ?, ?, ?, ?)",
        [id, params.name, params.address ?? null, params.companyId, code],
      );
      return (await findProjectById(id))!;
    } catch (err) {
      if (attempt === 4 || !isUniqueViolation(err)) throw err;
    }
  }
  throw new Error("Failed to generate a unique connection code.");
}

export async function findProjectById(id: string): Promise<Project | undefined> {
  const row = await database.get<ProjectRow>("SELECT * FROM projects WHERE id = ?", [id]);
  return row ? mapProjectRow(row) : undefined;
}

/**
 * Removes a project and every row that references it. Foreign keys are
 * declared but not enforced in SQLite (foreign_keys is never turned on), so each child table is
 * cleared explicitly. Messaging rows live in the messaging module's tables;
 * they are deleted here by SQL because that module has no per-project
 * delete helper and importing it would couple the two domains.
 */
export async function deleteProjectAndChildren(projectId: string): Promise<void> {
  await database.transaction(async () => {
    const convs = await database.all<{ id: string }>("SELECT id FROM conversations WHERE project_id = ?", [projectId]);
    for (const conv of convs) {
      await database.run("DELETE FROM messages WHERE conversation_id = ?", [conv.id]);
      await database.run("DELETE FROM message_reads WHERE conversation_id = ?", [conv.id]);
      await database.run("DELETE FROM conversation_participants WHERE conversation_id = ?", [conv.id]);
    }
    await database.run("DELETE FROM conversations WHERE project_id = ?", [projectId]);
    await database.run("DELETE FROM schedule_requests WHERE project_id = ?", [projectId]);
    await database.run("DELETE FROM availability WHERE project_id = ?", [projectId]);
    await database.run("DELETE FROM tasks WHERE project_id = ?", [projectId]);
    await database.run("DELETE FROM project_aliases WHERE project_id = ?", [projectId]);
    await database.run("DELETE FROM user_project_assignments WHERE project_id = ?", [projectId]);
    await database.run("DELETE FROM employee_project_assignments WHERE project_id = ?", [projectId]);
    await database.run("DELETE FROM project_connections WHERE project_id = ?", [projectId]);
    await database.run("DELETE FROM contractor_connection_projects WHERE project_id = ?", [projectId]);
    await database.run("DELETE FROM projects WHERE id = ?", [projectId]);
  });
}

export async function findProjectByConnectionCode(code: string): Promise<Project | undefined> {
  const row = await database.get<ProjectRow>("SELECT * FROM projects WHERE connection_code = ?", [code]);
  return row ? mapProjectRow(row) : undefined;
}

export async function listOwnedProjects(companyId: string): Promise<Project[]> {
  const rows = await database.all<ProjectRow>("SELECT * FROM projects WHERE company_id = ? ORDER BY name", [companyId]);
  return rows.map(mapProjectRow);
}

export async function listConnectedProjects(companyId: string): Promise<Project[]> {
  const rows = await database.all<ProjectRow>(
    `SELECT p.* FROM projects p
     JOIN project_connections pc ON pc.project_id = p.id
     WHERE pc.sub_company_id = ?
     ORDER BY p.name`,
    [companyId],
  );
  return rows.map(mapProjectRow);
}

function mapProjectRow(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    companyId: row.company_id,
    connectionCode: row.connection_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// --- project_connections ---

export async function findProjectConnection(projectId: string, subCompanyId: string): Promise<ProjectConnection | undefined> {
  const row = await database.get<ProjectConnectionRow>(
    "SELECT * FROM project_connections WHERE project_id = ? AND sub_company_id = ?",
    [projectId, subCompanyId],
  );
  return row ? mapConnectionRow(row) : undefined;
}

export async function listProjectConnections(projectId: string): Promise<ProjectConnection[]> {
  const rows = await database.all<ProjectConnectionRow>(
    "SELECT * FROM project_connections WHERE project_id = ? ORDER BY connected_at",
    [projectId],
  );
  return rows.map(mapConnectionRow);
}

export async function createProjectConnection(projectId: string, subCompanyId: string): Promise<ProjectConnection> {
  const id = crypto.randomUUID();
  await database.run("INSERT INTO project_connections (id, project_id, sub_company_id) VALUES (?, ?, ?)", [
    id,
    projectId,
    subCompanyId,
  ]);
  return (await findProjectConnection(projectId, subCompanyId))!;
}

function mapConnectionRow(row: ProjectConnectionRow): ProjectConnection {
  return {
    id: row.id,
    projectId: row.project_id,
    subCompanyId: row.sub_company_id,
    connectedAt: row.connected_at,
  };
}

// --- availability ---

export async function createAvailabilityRow(params: {
  employeeId: string;
  projectId: string | null;
  date: string;
  startTime: string;
  endTime: string;
  allProjects: boolean;
  stopNumber?: number | null;
  stopLabel?: string | null;
}): Promise<Availability> {
  const id = crypto.randomUUID();
  await database.run(
    `INSERT INTO availability (id, employee_id, project_id, date, start_time, end_time, all_projects, stop_number, stop_label)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      params.employeeId,
      params.allProjects ? null : params.projectId,
      params.date,
      params.startTime,
      params.endTime,
      params.allProjects ? 1 : 0,
      // BigInt binds as an INTEGER, so a legacy TEXT column stores "1" rather than "1.0".
      params.stopNumber == null ? null : BigInt(Math.trunc(params.stopNumber)),
      params.stopLabel ?? null,
    ],
  );
  return (await findAvailabilityById(id))!;
}

export async function findAvailabilityById(id: string): Promise<Availability | undefined> {
  const row = await database.get<AvailabilityRow>("SELECT * FROM availability WHERE id = ?", [id]);
  return row ? mapAvailabilityRow(row) : undefined;
}

export async function listAvailabilityForCompany(companyId: string, startDate: string, endDate: string): Promise<Availability[]> {
  const rows = await database.all<AvailabilityRow>(
    `SELECT a.* FROM availability a
     JOIN employees e ON e.id = a.employee_id
     WHERE e.company_id = ? AND a.date BETWEEN ? AND ?
     ORDER BY a.date, a.start_time`,
    [companyId, startDate, endDate],
  );
  return rows.map(mapAvailabilityRow);
}

export async function deleteAvailabilityRow(id: string) {
  await database.run("DELETE FROM availability WHERE id = ?", [id]);
}

function mapAvailabilityRow(row: AvailabilityRow): Availability {
  return {
    id: row.id,
    employeeId: row.employee_id,
    projectId: row.project_id,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    allProjects: row.all_projects === 1,
    stopNumber: row.stop_number == null ? null : Number(row.stop_number),
    stopLabel: row.stop_label ?? null,
    createdAt: row.created_at,
  };
}

// --- schedule_requests ---

export async function createScheduleRequestRow(params: {
  projectId: string;
  requestingCompanyId: string;
  subCompanyId: string;
  employeeIds: string[];
  date: string;
  startTime: string | null;
  endTime: string | null;
  description: string | null;
  imageUrls: string[];
}): Promise<ScheduleRequest> {
  const id = crypto.randomUUID();
  await database.run(
    `INSERT INTO schedule_requests
       (id, project_id, requesting_company_id, sub_company_id, employee_ids, date, start_time, end_time, description, image_urls)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      params.projectId,
      params.requestingCompanyId,
      params.subCompanyId,
      JSON.stringify(params.employeeIds),
      params.date,
      params.startTime,
      params.endTime,
      params.description,
      JSON.stringify(params.imageUrls),
    ],
  );
  return (await findScheduleRequestById(id))!;
}

export async function findScheduleRequestById(id: string): Promise<ScheduleRequest | undefined> {
  const row = await database.get<ScheduleRequestRow>("SELECT * FROM schedule_requests WHERE id = ?", [id]);
  return row ? mapScheduleRequestRow(row) : undefined;
}

export async function listScheduleRequestsForCompany(
  companyId: string,
  startDate: string,
  endDate: string,
): Promise<ScheduleRequest[]> {
  const rows = await database.all<ScheduleRequestRow>(
    `SELECT * FROM schedule_requests
     WHERE (requesting_company_id = ? OR sub_company_id = ?) AND date BETWEEN ? AND ?
     ORDER BY date, start_time`,
    [companyId, companyId, startDate, endDate],
  );
  return Promise.all(rows.map(mapScheduleRequestRow));
}

export async function updateScheduleRequestStatusRow(id: string, status: ScheduleRequestStatus, reason: string | null) {
  await database.run("UPDATE schedule_requests SET status = ?, status_reason = ?, updated_at = ? WHERE id = ?", [
    status,
    reason,
    database.now(),
    id,
  ]);
}

async function mapScheduleRequestRow(row: ScheduleRequestRow): Promise<ScheduleRequest> {
  const employeeIds = JSON.parse(row.employee_ids) as string[];
  return {
    id: row.id,
    projectId: row.project_id,
    requestingCompanyId: row.requesting_company_id,
    subCompanyId: row.sub_company_id,
    employeeIds,
    employeeNames: await Promise.all(employeeIds.map(async (id) => (await findEmployeeById(id))?.name ?? "Unknown")),
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    description: row.description,
    imageUrls: row.image_urls ? (JSON.parse(row.image_urls) as string[]) : [],
    status: row.status,
    statusReason: row.status_reason,
    requestingCompanyName: (await findCompanyById(row.requesting_company_id))?.name ?? null,
    subCompanyName: (await findCompanyById(row.sub_company_id))?.name ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
