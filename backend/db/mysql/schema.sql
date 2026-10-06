-- MySQL version of every table the backend creates in SQLite today
-- (users.ts, passwordResets.ts, rbac/models.ts, scheduling/models.ts, query/projectTables.ts).
--
-- Goal: identical behaviour, so the existing code and tests keep working.
-- That's why some choices look unusual for MySQL:
--
--   * IDs stay strings (VARCHAR(36)) because the code generates UUIDs itself.
--   * Dates/times stay strings in the exact format SQLite produced
--     ("YYYY-MM-DD HH:MM:SS" in UTC). The code compares and returns them as
--     strings; switching to DATETIME is a later, separate change.
--   * employee_ids stays TEXT holding a JSON array string, because the code
--     calls JSON.parse on it. (A MySQL JSON column would come back already parsed.)
--   * Booleans are TINYINT 0/1, same values SQLite returned.
--
-- Safe to run repeatedly (IF NOT EXISTS). Tables are ordered so every
-- foreign key points at a table that already exists.
--
-- Load it with:   mysql -u ssaa_dev -p ssaa < db/mysql/schema.sql

CREATE TABLE IF NOT EXISTS users (
  id            VARCHAR(36)  NOT NULL PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name     VARCHAR(255) NOT NULL,
  company_id    VARCHAR(36)  NULL,
  is_admin      TINYINT      NOT NULL DEFAULT 0,
  created_at    VARCHAR(32)  NOT NULL DEFAULT (DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS password_resets (
  id         VARCHAR(36)  NOT NULL PRIMARY KEY,
  user_id    VARCHAR(36)  NOT NULL,
  code_hash  VARCHAR(255) NOT NULL,
  expires_at VARCHAR(32)  NOT NULL,
  used_at    VARCHAR(32)  NULL,
  created_at VARCHAR(32)  NOT NULL DEFAULT (DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s')),
  INDEX idx_password_resets_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS companies (
  id           VARCHAR(36)  NOT NULL PRIMARY KEY,
  name         VARCHAR(255) NOT NULL,
  company_type VARCHAR(10)  NOT NULL,
  address      TEXT         NULL,
  created_at   VARCHAR(32)  NOT NULL DEFAULT (DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s')),
  updated_at   VARCHAR(32)  NOT NULL DEFAULT (DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s')),
  CONSTRAINT chk_company_type CHECK (company_type IN ('gc', 'sub'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS user_roles (
  id                 VARCHAR(36) NOT NULL PRIMARY KEY,
  user_id            VARCHAR(36) NOT NULL,
  company_id         VARCHAR(36) NOT NULL,
  permission_level   VARCHAR(20) NOT NULL,
  is_company_creator TINYINT     NOT NULL DEFAULT 0,
  created_at         VARCHAR(32) NOT NULL DEFAULT (DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s')),
  updated_at         VARCHAR(32) NOT NULL DEFAULT (DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s')),
  UNIQUE KEY uq_user_roles_user_company (user_id, company_id),
  CONSTRAINT fk_user_roles_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT chk_permission_level CHECK (permission_level IN ('basic', 'level_1', 'partial', 'full', 'account_holder'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS company_join_requests (
  id         VARCHAR(36) NOT NULL PRIMARY KEY,
  user_id    VARCHAR(36) NOT NULL,
  company_id VARCHAR(36) NOT NULL,
  status     VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at VARCHAR(32) NOT NULL DEFAULT (DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s')),
  updated_at VARCHAR(32) NOT NULL DEFAULT (DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s')),
  CONSTRAINT fk_join_requests_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT chk_join_request_status CHECK (status IN ('pending', 'approved', 'rejected'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS employees (
  id             VARCHAR(36)  NOT NULL PRIMARY KEY,
  company_id     VARCHAR(36)  NOT NULL,
  name           VARCHAR(255) NOT NULL,
  email          VARCHAR(255) NULL,
  phone          VARCHAR(50)  NULL,
  linked_user_id VARCHAR(36)  NULL,
  created_at     VARCHAR(32)  NOT NULL DEFAULT (DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s')),
  CONSTRAINT fk_employees_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS projects (
  id              VARCHAR(36)  NOT NULL PRIMARY KEY,
  name            VARCHAR(255) NOT NULL,
  address         TEXT         NULL,
  company_id      VARCHAR(36)  NOT NULL,
  connection_code VARCHAR(16)  NOT NULL UNIQUE,
  created_at      VARCHAR(32)  NOT NULL DEFAULT (DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s')),
  updated_at      VARCHAR(32)  NOT NULL DEFAULT (DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s')),
  CONSTRAINT fk_projects_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS project_connections (
  id             VARCHAR(36) NOT NULL PRIMARY KEY,
  project_id     VARCHAR(36) NOT NULL,
  sub_company_id VARCHAR(36) NOT NULL,
  connected_at   VARCHAR(32) NOT NULL DEFAULT (DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s')),
  UNIQUE KEY uq_project_connections (project_id, sub_company_id),
  CONSTRAINT fk_connections_project FOREIGN KEY (project_id)     REFERENCES projects(id)  ON DELETE CASCADE,
  CONSTRAINT fk_connections_sub     FOREIGN KEY (sub_company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS availability (
  id           VARCHAR(36)  NOT NULL PRIMARY KEY,
  employee_id  VARCHAR(36)  NOT NULL,
  project_id   VARCHAR(36)  NULL,
  date         VARCHAR(10)  NOT NULL,       -- "YYYY-MM-DD"
  start_time   VARCHAR(40)  NOT NULL,
  end_time     VARCHAR(40)  NOT NULL,
  all_projects TINYINT      NOT NULL DEFAULT 0,
  stop_number  VARCHAR(50)  NULL,           -- added later in SQLite as TEXT; kept as text
  stop_label   VARCHAR(255) NULL,
  created_at   VARCHAR(32)  NOT NULL DEFAULT (DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s')),
  INDEX idx_availability_date (date),
  INDEX idx_availability_employee (employee_id),
  CONSTRAINT fk_availability_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  CONSTRAINT fk_availability_project  FOREIGN KEY (project_id)  REFERENCES projects(id)  ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS schedule_requests (
  id                    VARCHAR(36) NOT NULL PRIMARY KEY,
  project_id            VARCHAR(36) NOT NULL,
  requesting_company_id VARCHAR(36) NOT NULL,
  sub_company_id        VARCHAR(36) NOT NULL,
  employee_ids          TEXT        NOT NULL DEFAULT ('[]'),   -- JSON array stored as text
  date                  VARCHAR(10) NOT NULL,
  start_time            VARCHAR(40) NULL,
  end_time              VARCHAR(40) NULL,
  description           TEXT        NULL,
  status                VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at            VARCHAR(32) NOT NULL DEFAULT (DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s')),
  updated_at            VARCHAR(32) NOT NULL DEFAULT (DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s')),
  INDEX idx_schedule_requests_date (date),
  CONSTRAINT fk_requests_project    FOREIGN KEY (project_id)            REFERENCES projects(id)  ON DELETE CASCADE,
  CONSTRAINT fk_requests_requesting FOREIGN KEY (requesting_company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_requests_sub        FOREIGN KEY (sub_company_id)        REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT chk_request_status CHECK (status IN ('pending', 'confirmed', 'rejected', 'cancelled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS tasks (
  id                  VARCHAR(36)  NOT NULL PRIMARY KEY,
  project_id          VARCHAR(36)  NOT NULL,
  assigned_company_id VARCHAR(36)  NULL,
  name                VARCHAR(255) NOT NULL,
  description         TEXT         NULL,
  start_date          VARCHAR(10)  NOT NULL,
  end_date            VARCHAR(10)  NOT NULL,
  color               VARCHAR(50)  NULL,
  status              VARCHAR(20)  NOT NULL DEFAULT 'pending',
  sort_order          INT          NOT NULL DEFAULT 0,
  created_at          VARCHAR(32)  NOT NULL DEFAULT (DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s')),
  updated_at          VARCHAR(32)  NOT NULL DEFAULT (DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s')),
  INDEX idx_tasks_project (project_id),
  INDEX idx_tasks_dates (start_date, end_date),
  CONSTRAINT fk_tasks_project  FOREIGN KEY (project_id)          REFERENCES projects(id)  ON DELETE CASCADE,
  CONSTRAINT fk_tasks_assigned FOREIGN KEY (assigned_company_id) REFERENCES companies(id) ON DELETE SET NULL,
  CONSTRAINT chk_task_status CHECK (status IN ('pending', 'in_progress', 'complete'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS project_aliases (
  id         VARCHAR(36)  NOT NULL PRIMARY KEY,
  project_id VARCHAR(36)  NOT NULL,
  company_id VARCHAR(36)  NOT NULL,
  name       VARCHAR(255) NULL,
  address    TEXT         NULL,
  created_at VARCHAR(32)  NOT NULL DEFAULT (DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s')),
  updated_at VARCHAR(32)  NOT NULL DEFAULT (DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s')),
  UNIQUE KEY uq_project_aliases (project_id, company_id),
  CONSTRAINT fk_aliases_project FOREIGN KEY (project_id) REFERENCES projects(id)  ON DELETE CASCADE,
  CONSTRAINT fk_aliases_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS user_project_assignments (
  id         VARCHAR(36) NOT NULL PRIMARY KEY,
  user_id    VARCHAR(36) NOT NULL,
  project_id VARCHAR(36) NOT NULL,
  company_id VARCHAR(36) NOT NULL,
  created_at VARCHAR(32) NOT NULL DEFAULT (DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s')),
  UNIQUE KEY uq_user_project (user_id, project_id),
  INDEX idx_upa_project (project_id),
  CONSTRAINT fk_upa_project FOREIGN KEY (project_id) REFERENCES projects(id)  ON DELETE CASCADE,
  CONSTRAINT fk_upa_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS employee_project_assignments (
  id          VARCHAR(36) NOT NULL PRIMARY KEY,
  employee_id VARCHAR(36) NOT NULL,
  project_id  VARCHAR(36) NOT NULL,
  company_id  VARCHAR(36) NOT NULL,
  created_at  VARCHAR(32) NOT NULL DEFAULT (DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s')),
  UNIQUE KEY uq_employee_project (employee_id, project_id),
  INDEX idx_epa_project (project_id),
  INDEX idx_epa_employee (employee_id),
  CONSTRAINT fk_epa_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  CONSTRAINT fk_epa_project  FOREIGN KEY (project_id)  REFERENCES projects(id)  ON DELETE CASCADE,
  CONSTRAINT fk_epa_company  FOREIGN KEY (company_id)  REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
