import crypto from "node:crypto";
import { db } from "../db.js";
import { findCompanyById } from "../rbac/models.js";
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

export function ensureSchedulingTables() {
  db.exec(`
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

  db.exec(`
    CREATE TABLE IF NOT EXISTS project_connections (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      sub_company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      connected_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (project_id, sub_company_id)
    )
  `);

  db.exec(`
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
  db.exec("CREATE INDEX IF NOT EXISTS idx_availability_date ON availability(date)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_availability_employee ON availability(employee_id)");

  db.exec(`
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
  db.exec("CREATE INDEX IF NOT EXISTS idx_schedule_requests_date ON schedule_requests(date)");

  // Additive column for databases created before photo attachments existed.
  const columns = new Set(
    (db.prepare("PRAGMA table_info(schedule_requests)").all() as { name: string }[]).map((c) => c.name),
  );
  if (!columns.has("image_urls")) {
    db.exec("ALTER TABLE schedule_requests ADD COLUMN image_urls TEXT NOT NULL DEFAULT '[]'");
  }
  if (!columns.has("status_reason")) {
    db.exec("ALTER TABLE schedule_requests ADD COLUMN status_reason TEXT");
  }
}
function randomConnectionCode(): string {
  return crypto.randomBytes(6).toString("hex").slice(0, 8);
}

export function createProjectRow(params: { name: string; address?: string | null; companyId: string }): Project {
  const id = crypto.randomUUID();
  // Connection codes are short and drawn from a small alphabet — collisions
  // are rare but not impossible, so retry a few times against the UNIQUE constraint.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const code = randomConnectionCode();
      db.prepare(
        "INSERT INTO projects (id, name, address, company_id, connection_code) VALUES (?, ?, ?, ?, ?)",
      ).run(id, params.name, params.address ?? null, params.companyId, code);
      return findProjectById(id)!;
    } catch (err) {
      if (attempt === 4 || !(err instanceof Error) || !err.message.includes("UNIQUE")) throw err;
    }
  }
  throw new Error("Failed to generate a unique connection code.");
}

export function findProjectById(id: string): Project | undefined {
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
  return row ? mapProjectRow(row) : undefined;
}

/**
 * Removes a project and every row that references it. Foreign keys are
 * declared but not enforced (no PRAGMA in db.ts), so each child table is
 * cleared explicitly. Messaging rows live in the messaging module's tables;
 * they are deleted here by SQL because that module has no per-project
 * delete helper and importing it would couple the two domains.
 */
export function deleteProjectAndChildren(projectId: string): void {
  db.transaction(() => {
    const convs = db.prepare("SELECT id FROM conversations WHERE project_id = ?").all(projectId) as {
      id: string;
    }[];
    const delMessages = db.prepare("DELETE FROM messages WHERE conversation_id = ?");
    const delReads = db.prepare("DELETE FROM message_reads WHERE conversation_id = ?");
    const delParts = db.prepare("DELETE FROM conversation_participants WHERE conversation_id = ?");
    for (const conv of convs) {
      delMessages.run(conv.id);
      delReads.run(conv.id);
      delParts.run(conv.id);
    }
    db.prepare("DELETE FROM conversations WHERE project_id = ?").run(projectId);
    db.prepare("DELETE FROM schedule_requests WHERE project_id = ?").run(projectId);
    db.prepare("DELETE FROM availability WHERE project_id = ?").run(projectId);
    db.prepare("DELETE FROM tasks WHERE project_id = ?").run(projectId);
    db.prepare("DELETE FROM project_aliases WHERE project_id = ?").run(projectId);
    db.prepare("DELETE FROM user_project_assignments WHERE project_id = ?").run(projectId);
    db.prepare("DELETE FROM employee_project_assignments WHERE project_id = ?").run(projectId);
    db.prepare("DELETE FROM project_connections WHERE project_id = ?").run(projectId);
    db.prepare("DELETE FROM contractor_connection_projects WHERE project_id = ?").run(projectId);
    db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  })();
}

export function findProjectByConnectionCode(code: string): Project | undefined {
  const row = db.prepare("SELECT * FROM projects WHERE connection_code = ?").get(code) as ProjectRow | undefined;
  return row ? mapProjectRow(row) : undefined;
}

export function listOwnedProjects(companyId: string): Project[] {
  const rows = db.prepare("SELECT * FROM projects WHERE company_id = ? ORDER BY name").all(companyId) as ProjectRow[];
  return rows.map(mapProjectRow);
}

export function listConnectedProjects(companyId: string): Project[] {
  const rows = db
    .prepare(
      `SELECT p.* FROM projects p
       JOIN project_connections pc ON pc.project_id = p.id
       WHERE pc.sub_company_id = ?
       ORDER BY p.name`,
    )
    .all(companyId) as ProjectRow[];
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

export function findProjectConnection(projectId: string, subCompanyId: string): ProjectConnection | undefined {
  const row = db
    .prepare("SELECT * FROM project_connections WHERE project_id = ? AND sub_company_id = ?")
    .get(projectId, subCompanyId) as ProjectConnectionRow | undefined;
  return row ? mapConnectionRow(row) : undefined;
}

export function listProjectConnections(projectId: string): ProjectConnection[] {
  const rows = db
    .prepare("SELECT * FROM project_connections WHERE project_id = ? ORDER BY connected_at")
    .all(projectId) as ProjectConnectionRow[];
  return rows.map(mapConnectionRow);
}

export function createProjectConnection(projectId: string, subCompanyId: string): ProjectConnection {
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO project_connections (id, project_id, sub_company_id) VALUES (?, ?, ?)").run(
    id,
    projectId,
    subCompanyId,
  );
  return findProjectConnection(projectId, subCompanyId)!;
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

export function createAvailabilityRow(params: {
  employeeId: string;
  projectId: string | null;
  date: string;
  startTime: string;
  endTime: string;
  allProjects: boolean;
}): Availability {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO availability (id, employee_id, project_id, date, start_time, end_time, all_projects)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    params.employeeId,
    params.allProjects ? null : params.projectId,
    params.date,
    params.startTime,
    params.endTime,
    params.allProjects ? 1 : 0,
  );
  return findAvailabilityById(id)!;
}

export function findAvailabilityById(id: string): Availability | undefined {
  const row = db.prepare("SELECT * FROM availability WHERE id = ?").get(id) as AvailabilityRow | undefined;
  return row ? mapAvailabilityRow(row) : undefined;
}

export function listAvailabilityForCompany(companyId: string, startDate: string, endDate: string): Availability[] {
  const rows = db
    .prepare(
      `SELECT a.* FROM availability a
       JOIN employees e ON e.id = a.employee_id
       WHERE e.company_id = ? AND a.date BETWEEN ? AND ?
       ORDER BY a.date, a.start_time`,
    )
    .all(companyId, startDate, endDate) as AvailabilityRow[];
  return rows.map(mapAvailabilityRow);
}

export function deleteAvailabilityRow(id: string) {
  db.prepare("DELETE FROM availability WHERE id = ?").run(id);
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
    createdAt: row.created_at,
  };
}

// --- schedule_requests ---

export function createScheduleRequestRow(params: {
  projectId: string;
  requestingCompanyId: string;
  subCompanyId: string;
  employeeIds: string[];
  date: string;
  startTime: string | null;
  endTime: string | null;
  description: string | null;
  imageUrls: string[];
}): ScheduleRequest {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO schedule_requests
       (id, project_id, requesting_company_id, sub_company_id, employee_ids, date, start_time, end_time, description, image_urls)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
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
  );
  return findScheduleRequestById(id)!;
}

export function findScheduleRequestById(id: string): ScheduleRequest | undefined {
  const row = db.prepare("SELECT * FROM schedule_requests WHERE id = ?").get(id) as ScheduleRequestRow | undefined;
  return row ? mapScheduleRequestRow(row) : undefined;
}

export function listScheduleRequestsForCompany(
  companyId: string,
  startDate: string,
  endDate: string,
): ScheduleRequest[] {
  const rows = db
    .prepare(
      `SELECT * FROM schedule_requests
       WHERE (requesting_company_id = ? OR sub_company_id = ?) AND date BETWEEN ? AND ?
       ORDER BY date, start_time`,
    )
    .all(companyId, companyId, startDate, endDate) as ScheduleRequestRow[];
  return rows.map(mapScheduleRequestRow);
}

export function updateScheduleRequestStatusRow(id: string, status: ScheduleRequestStatus, reason: string | null) {
  db.prepare("UPDATE schedule_requests SET status = ?, status_reason = ?, updated_at = datetime('now') WHERE id = ?").run(
    status,
    reason,
    id,
  );
}

function mapScheduleRequestRow(row: ScheduleRequestRow): ScheduleRequest {
  return {
    id: row.id,
    projectId: row.project_id,
    requestingCompanyId: row.requesting_company_id,
    subCompanyId: row.sub_company_id,
    employeeIds: JSON.parse(row.employee_ids),
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    description: row.description,
    imageUrls: row.image_urls ? (JSON.parse(row.image_urls) as string[]) : [],
    status: row.status,
    statusReason: row.status_reason,
    requestingCompanyName: findCompanyById(row.requesting_company_id)?.name ?? null,
    subCompanyName: findCompanyById(row.sub_company_id)?.name ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
