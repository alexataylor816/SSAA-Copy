/**
 * Extra tables the Lovable original had that our REST routes never covered.
 *
 * The reference app reads all of these through `supabase.from(...)`, so the
 * migration needs them before any of the dashboard UI can work. Column names
 * match the Postgres originals exactly — that is what lets the Lovable
 * components port across unchanged.
 *
 *   tasks                       — schedule milestones in LeftPanel/CalendarPanel
 *   project_aliases             — per-company project display override
 *   user_project_assignments    — which login can see/act on which project
 *   employee_project_assignments— which employee works which project
 */
import { db } from "../db.js";

export function ensureProjectTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      assigned_company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      description TEXT,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      color TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'complete')),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_dates ON tasks(start_date, end_date)");

  db.exec(`
    CREATE TABLE IF NOT EXISTS project_aliases (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      name TEXT,
      address TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (project_id, company_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_project_assignments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (user_id, project_id)
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_upa_project ON user_project_assignments(project_id)");

  db.exec(`
    CREATE TABLE IF NOT EXISTS employee_project_assignments (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (employee_id, project_id)
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_epa_project ON employee_project_assignments(project_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_epa_employee ON employee_project_assignments(employee_id)");

  // Multi-stop availability was deferred in scheduling/types.ts but the
  // reference's ResourceMatrix renders stop numbers, so the columns exist now.
  for (const [table, column] of [
    ["availability", "stop_number"],
    ["availability", "stop_label"],
  ] as const) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
    }
  }

  // The dashboard's team rail (RightPanel -> MatrixEmployeeCard) shows each
  // employee's trade, and creating an employee there sends job_title.
  const employeeCols = db.prepare("PRAGMA table_info(employees)").all() as { name: string }[];
  if (!employeeCols.some((c) => c.name === "job_title")) {
    db.exec("ALTER TABLE employees ADD COLUMN job_title TEXT");
  }
}