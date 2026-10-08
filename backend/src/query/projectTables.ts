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
import { database } from "../db.js";

export async function ensureProjectTables(): Promise<void> {
  await database.exec(`
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
  await database.exec("CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id)");
  await database.exec("CREATE INDEX IF NOT EXISTS idx_tasks_dates ON tasks(start_date, end_date)");

  await database.exec(`
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

  await database.exec(`
    CREATE TABLE IF NOT EXISTS user_project_assignments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (user_id, project_id)
    )
  `);
  await database.exec("CREATE INDEX IF NOT EXISTS idx_upa_project ON user_project_assignments(project_id)");

  await database.exec(`
    CREATE TABLE IF NOT EXISTS employee_project_assignments (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (employee_id, project_id)
    )
  `);
  await database.exec("CREATE INDEX IF NOT EXISTS idx_epa_project ON employee_project_assignments(project_id)");
  await database.exec("CREATE INDEX IF NOT EXISTS idx_epa_employee ON employee_project_assignments(employee_id)");

  // Multi-stop availability (the original's stop_number INTEGER / stop_label TEXT).
  // Databases created before this was typed have stop_number as TEXT; the
  // scheduling model writes whole numbers and reads them back as numbers either way.
  // PRAGMA is SQLite-only; MySQL gets these columns from the MySQL schema file.
  if (database.dialect === "sqlite") {
    for (const [table, column, type] of [
      ["availability", "stop_number", "INTEGER"],
      ["availability", "stop_label", "TEXT"],
    ] as const) {
      const cols = await database.all<{ name: string }>(`PRAGMA table_info(${table})`);
      if (!cols.some((c) => c.name === column)) {
        await database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      }
    }

    // The dashboard's team rail (RightPanel -> MatrixEmployeeCard) shows each
    // employee's trade, and creating an employee there sends job_title.
    const employeeCols = await database.all<{ name: string }>("PRAGMA table_info(employees)");
    if (!employeeCols.some((c) => c.name === "job_title")) {
      await database.exec("ALTER TABLE employees ADD COLUMN job_title TEXT");
    }
  }
}