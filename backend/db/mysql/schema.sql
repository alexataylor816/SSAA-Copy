-- MySQL version of every table the backend creates in SQLite today
-- (users.ts, passwordResets.ts, rbac/models.ts, rbac/companyDeletion.ts, contractors/models.ts,
-- notifications/templates.ts, notifications/service.ts, messaging/service.ts,
-- scheduling/models.ts, query/projectTables.ts).
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

-- ---------------------------------------------------------------------------
-- Tables added after the first version of this file
-- (rbac/companyDeletion.ts, contractors/models.ts, notifications/templates.ts,
-- messaging/service.ts, notifications/service.ts). Every parent table is
-- defined above.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS company_deletion_requests (
  id           VARCHAR(36) NOT NULL PRIMARY KEY,
  company_id   VARCHAR(36) NOT NULL,
  requested_by VARCHAR(36) NOT NULL,
  reason       TEXT        NULL,
  status       VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at   VARCHAR(32) NOT NULL DEFAULT (DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s')),
  updated_at   VARCHAR(32) NOT NULL DEFAULT (DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s')),
  CONSTRAINT fk_deletion_requests_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT chk_deletion_request_status CHECK (status IN ('pending', 'approved', 'rejected'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS contractor_connections (
  id                       VARCHAR(36) NOT NULL PRIMARY KEY,
  company_a_id             VARCHAR(36) NOT NULL,
  company_b_id             VARCHAR(36) NOT NULL,
  main_company_id          VARCHAR(36) NULL,
  status                   VARCHAR(20) NOT NULL DEFAULT 'pending',
  initiated_by_company_id  VARCHAR(36) NOT NULL,
  initiated_by_user_id     VARCHAR(36) NULL,
  proposed_main_company_id VARCHAR(36) NULL,
  role_change_request      TEXT        NULL,   -- JSON object stored as text
  accepted_at              VARCHAR(32) NULL,
  created_at               VARCHAR(32) NOT NULL DEFAULT (DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s')),
  updated_at               VARCHAR(32) NOT NULL DEFAULT (DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s')),
  UNIQUE KEY contractor_connections_pair_unique (company_a_id, company_b_id),
  CONSTRAINT fk_cc_company_a     FOREIGN KEY (company_a_id)             REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_cc_company_b     FOREIGN KEY (company_b_id)             REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_cc_main          FOREIGN KEY (main_company_id)          REFERENCES companies(id) ON DELETE SET NULL,
  CONSTRAINT fk_cc_initiated_by  FOREIGN KEY (initiated_by_company_id)  REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_cc_proposed_main FOREIGN KEY (proposed_main_company_id) REFERENCES companies(id) ON DELETE SET NULL,
  CONSTRAINT chk_cc_status CHECK (status IN ('pending', 'accepted', 'declined')),
  CONSTRAINT chk_cc_distinct_companies CHECK (company_a_id <> company_b_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS contractor_connection_projects (
  id              VARCHAR(36) NOT NULL PRIMARY KEY,
  connection_id   VARCHAR(36) NOT NULL,
  project_id      VARCHAR(36) NOT NULL,
  main_company_id VARCHAR(36) NOT NULL,
  sub_company_id  VARCHAR(36) NOT NULL,
  shared          TINYINT     NOT NULL DEFAULT 0,
  created_by      VARCHAR(36) NULL,
  created_at      VARCHAR(32) NOT NULL DEFAULT (DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s')),
  updated_at      VARCHAR(32) NOT NULL DEFAULT (DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s')),
  UNIQUE KEY uq_ccp_connection_project (connection_id, project_id),
  CONSTRAINT fk_ccp_connection FOREIGN KEY (connection_id)   REFERENCES contractor_connections(id) ON DELETE CASCADE,
  CONSTRAINT fk_ccp_project    FOREIGN KEY (project_id)      REFERENCES projects(id)               ON DELETE CASCADE,
  CONSTRAINT fk_ccp_main       FOREIGN KEY (main_company_id) REFERENCES companies(id)              ON DELETE CASCADE,
  CONSTRAINT fk_ccp_sub        FOREIGN KEY (sub_company_id)  REFERENCES companies(id)              ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS notification_templates (
  id                    VARCHAR(36)  NOT NULL PRIMARY KEY,
  event_type            VARCHAR(100) NOT NULL UNIQUE,
  channel               VARCHAR(20)  NOT NULL DEFAULT 'email',
  subject               TEXT         NOT NULL DEFAULT (''),
  body_html             TEXT         NOT NULL DEFAULT (''),
  description           TEXT         NULL,
  is_active             TINYINT      NOT NULL DEFAULT 1,
  placeholder_variables TEXT         NOT NULL DEFAULT ('[]'),   -- JSON array stored as text
  created_at            VARCHAR(32)  NOT NULL DEFAULT (DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s')),
  updated_at            VARCHAR(32)  NOT NULL DEFAULT (DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Messaging writes ISO timestamps with milliseconds ("2026-10-07T12:34:56.789Z")
-- itself and SQLite gives these columns no default, so neither does MySQL.
CREATE TABLE IF NOT EXISTS conversations (
  id              VARCHAR(36)  NOT NULL PRIMARY KEY,
  type            VARCHAR(20)  NOT NULL,
  project_id      VARCHAR(36)  NULL,
  sub_company_id  VARCHAR(36)  NULL,
  title           VARCHAR(255) NULL,
  created_by      VARCHAR(36)  NULL,
  created_at      VARCHAR(32)  NOT NULL,
  last_message_at VARCHAR(32)  NOT NULL,
  UNIQUE KEY uq_conversations_project_sub (project_id, sub_company_id),
  CONSTRAINT fk_conversations_project FOREIGN KEY (project_id)     REFERENCES projects(id)  ON DELETE CASCADE,
  CONSTRAINT fk_conversations_sub     FOREIGN KEY (sub_company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT chk_conversation_type CHECK (type IN ('project', 'dm', 'group'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS conversation_participants (
  conversation_id VARCHAR(36) NOT NULL,
  user_id         VARCHAR(36) NOT NULL,
  company_id      VARCHAR(36) NULL,
  joined_at       VARCHAR(32) NOT NULL,
  PRIMARY KEY (conversation_id, user_id),
  INDEX idx_conv_participants_user (user_id),
  CONSTRAINT fk_participants_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- seq is MySQL's stand-in for SQLite's implicit rowid: it orders messages
-- created in the same millisecond. Never returned by the API.
CREATE TABLE IF NOT EXISTS messages (
  id                VARCHAR(36) NOT NULL PRIMARY KEY,
  seq               BIGINT      NOT NULL AUTO_INCREMENT UNIQUE,
  conversation_id   VARCHAR(36) NOT NULL,
  sender_user_id    VARCHAR(36) NULL,
  sender_company_id VARCHAR(36) NULL,
  body              TEXT        NOT NULL,
  kind              VARCHAR(20) NOT NULL DEFAULT 'user',
  created_at        VARCHAR(32) NOT NULL,
  INDEX idx_messages_conv_created (conversation_id, created_at),
  CONSTRAINT fk_messages_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS message_reads (
  conversation_id VARCHAR(36) NOT NULL,
  user_id         VARCHAR(36) NOT NULL,
  last_read_at    VARCHAR(32) NOT NULL,
  PRIMARY KEY (conversation_id, user_id),
  CONSTRAINT fk_message_reads_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS user_notifications (
  id         VARCHAR(36)  NOT NULL PRIMARY KEY,
  user_id    VARCHAR(36)  NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  title      TEXT         NOT NULL,
  body       TEXT         NULL,
  project_id VARCHAR(36)  NULL,
  link       TEXT         NULL,
  read_at    VARCHAR(32)  NULL,
  created_at VARCHAR(32)  NOT NULL,
  INDEX idx_user_notifications_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- Columns added after the first version of this file
-- (SQLite adds them with ALTER TABLE ... ADD COLUMN). MySQL 8 has no
-- ADD COLUMN IF NOT EXISTS, so each one checks information_schema first;
-- this keeps the file safe to run repeatedly and also upgrades a database
-- loaded from the earlier version of this file.
-- ---------------------------------------------------------------------------

SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'phone') = 0,
  'ALTER TABLE users ADD COLUMN phone VARCHAR(50) NULL', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'language') = 0,
  'ALTER TABLE users ADD COLUMN language VARCHAR(10) NOT NULL DEFAULT ''en''', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'profile_picture_url') = 0,
  'ALTER TABLE users ADD COLUMN profile_picture_url TEXT NULL', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'google_sub') = 0,
  'ALTER TABLE users ADD COLUMN google_sub VARCHAR(255) NULL', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Like SQLite, a MySQL UNIQUE index allows any number of NULLs.
SET @sql = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND INDEX_NAME = 'users_google_sub') = 0,
  'CREATE UNIQUE INDEX users_google_sub ON users (google_sub)', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'companies' AND COLUMN_NAME = 'trade') = 0,
  'ALTER TABLE companies ADD COLUMN trade VARCHAR(255) NULL', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND COLUMN_NAME = 'employee_number') = 0,
  'ALTER TABLE employees ADD COLUMN employee_number VARCHAR(50) NULL', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND COLUMN_NAME = 'job_title') = 0,
  'ALTER TABLE employees ADD COLUMN job_title VARCHAR(255) NULL', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schedule_requests' AND COLUMN_NAME = 'image_urls') = 0,
  'ALTER TABLE schedule_requests ADD COLUMN image_urls TEXT NOT NULL DEFAULT (''[]'')', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schedule_requests' AND COLUMN_NAME = 'status_reason') = 0,
  'ALTER TABLE schedule_requests ADD COLUMN status_reason TEXT NULL', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Existing rows are numbered in primary-key order; new ones in insert order.
SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'messages' AND COLUMN_NAME = 'seq') = 0,
  'ALTER TABLE messages ADD COLUMN seq BIGINT NOT NULL AUTO_INCREMENT UNIQUE', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
