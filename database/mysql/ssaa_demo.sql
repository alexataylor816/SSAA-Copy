-- SSAA MySQL dump
-- Generated 2026-10-14T00:03:49.682Z from demo.db by backend/scripts/export-mysql.ts
-- Tables: backend/db/mysql/schema.sql (the schema the app runs on). Requires MySQL 8.0.13+.

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
CREATE DATABASE IF NOT EXISTS `ssaa` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE `ssaa`;

-- Start clean so the inserts below don't collide with old rows.
DROP TABLE IF EXISTS `users`;
DROP TABLE IF EXISTS `password_resets`;
DROP TABLE IF EXISTS `companies`;
DROP TABLE IF EXISTS `user_roles`;
DROP TABLE IF EXISTS `company_join_requests`;
DROP TABLE IF EXISTS `employees`;
DROP TABLE IF EXISTS `projects`;
DROP TABLE IF EXISTS `project_connections`;
DROP TABLE IF EXISTS `availability`;
DROP TABLE IF EXISTS `schedule_requests`;
DROP TABLE IF EXISTS `tasks`;
DROP TABLE IF EXISTS `project_aliases`;
DROP TABLE IF EXISTS `user_project_assignments`;
DROP TABLE IF EXISTS `employee_project_assignments`;
DROP TABLE IF EXISTS `company_deletion_requests`;
DROP TABLE IF EXISTS `contractor_connections`;
DROP TABLE IF EXISTS `contractor_connection_projects`;
DROP TABLE IF EXISTS `notification_templates`;
DROP TABLE IF EXISTS `conversations`;
DROP TABLE IF EXISTS `conversation_participants`;
DROP TABLE IF EXISTS `messages`;
DROP TABLE IF EXISTS `message_reads`;
DROP TABLE IF EXISTS `user_notifications`;

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

-- availability: 20 rows
INSERT INTO `availability` (`id`, `employee_id`, `project_id`, `date`, `start_time`, `end_time`, `all_projects`, `created_at`, `stop_number`, `stop_label`) VALUES
  ('13b3d086-f030-4088-a79f-e45ffb8ad1e1', 'c6623f23-90b9-4dcd-9e43-e78d0d4467fe', NULL, '2026-10-19', '07:00', '15:30', 1, '2026-10-14 00:03:48', NULL, NULL),
  ('6d968f5c-10f4-4887-be37-c4ae00e59448', 'd7fc0d71-5788-40c7-8dc9-bf2b19ff6ead', NULL, '2026-10-19', '07:00', '15:30', 1, '2026-10-14 00:03:48', NULL, NULL),
  ('de0a0d58-2d93-4c23-8425-24e818522a5d', '7974581e-791b-4383-a377-7a3a11b4e7a9', NULL, '2026-10-19', '07:00', '15:30', 1, '2026-10-14 00:03:48', NULL, NULL),
  ('9d4c4cc4-37be-4caa-82bb-a10b35052562', 'c6623f23-90b9-4dcd-9e43-e78d0d4467fe', NULL, '2026-10-20', '07:00', '15:30', 1, '2026-10-14 00:03:48', NULL, NULL),
  ('647e9f40-5d76-4166-a5ed-9f5d415c0939', 'd7fc0d71-5788-40c7-8dc9-bf2b19ff6ead', NULL, '2026-10-20', '07:00', '15:30', 1, '2026-10-14 00:03:48', NULL, NULL),
  ('84e96226-dbe9-4ac9-b3bc-1efc24b68b5f', '7974581e-791b-4383-a377-7a3a11b4e7a9', NULL, '2026-10-20', '07:00', '15:30', 1, '2026-10-14 00:03:48', NULL, NULL),
  ('4457962e-b37b-4094-bf91-dccdfd510bd2', 'c6623f23-90b9-4dcd-9e43-e78d0d4467fe', NULL, '2026-10-21', '07:00', '15:30', 1, '2026-10-14 00:03:48', NULL, NULL),
  ('c614d96d-0be1-4d1b-8e53-4fcad69defea', 'd7fc0d71-5788-40c7-8dc9-bf2b19ff6ead', NULL, '2026-10-21', '07:00', '15:30', 1, '2026-10-14 00:03:48', NULL, NULL),
  ('66cdeb74-ea7f-426f-a858-b36b00b36c0e', '7974581e-791b-4383-a377-7a3a11b4e7a9', NULL, '2026-10-21', '07:00', '15:30', 1, '2026-10-14 00:03:48', NULL, NULL),
  ('9979ff7a-02f4-4689-844d-9a6ce84112d7', 'c6623f23-90b9-4dcd-9e43-e78d0d4467fe', NULL, '2026-10-22', '07:00', '15:30', 1, '2026-10-14 00:03:48', NULL, NULL),
  ('3aaac3c4-3fd8-48ae-baaf-c95c1d17be38', 'd7fc0d71-5788-40c7-8dc9-bf2b19ff6ead', NULL, '2026-10-22', '07:00', '15:30', 1, '2026-10-14 00:03:48', NULL, NULL),
  ('8945736d-ca11-481b-a1ef-24e0d2f4460c', '7974581e-791b-4383-a377-7a3a11b4e7a9', NULL, '2026-10-22', '07:00', '15:30', 1, '2026-10-14 00:03:48', NULL, NULL),
  ('ae1bfa12-86fa-42ac-879f-587905199c4e', 'c6623f23-90b9-4dcd-9e43-e78d0d4467fe', NULL, '2026-10-23', '07:00', '15:30', 1, '2026-10-14 00:03:48', NULL, NULL),
  ('bea3426c-ca38-4533-bbe6-caeff75c8410', 'd7fc0d71-5788-40c7-8dc9-bf2b19ff6ead', NULL, '2026-10-23', '07:00', '15:30', 1, '2026-10-14 00:03:48', NULL, NULL),
  ('9dd44ae4-79b9-4091-b9e1-cce1095722a9', '7974581e-791b-4383-a377-7a3a11b4e7a9', NULL, '2026-10-23', '07:00', '15:30', 1, '2026-10-14 00:03:48', NULL, NULL),
  ('78f7ebb5-ae4b-4e0a-a1c9-19004c28aed8', 'c6623f23-90b9-4dcd-9e43-e78d0d4467fe', NULL, '2026-10-24', '06:00', '10:00', 1, '2026-10-14 00:03:48', 1, 'Stop #1'),
  ('d0a843e1-1bfb-484e-8b89-bdab83698471', 'c6623f23-90b9-4dcd-9e43-e78d0d4467fe', NULL, '2026-10-24', '13:00', '17:00', 1, '2026-10-14 00:03:48', 2, 'Stop #2'),
  ('e036e6dc-cf0d-40b4-9cfd-6a6e8ceba3e5', '16e663e3-cafe-4989-b32e-420ee06775de', NULL, '2026-10-19', '08:00', '16:00', 1, '2026-10-14 00:03:49', NULL, NULL),
  ('04331ed2-eeff-4053-a8cf-b1478b288b66', '16e663e3-cafe-4989-b32e-420ee06775de', NULL, '2026-10-21', '08:00', '16:00', 1, '2026-10-14 00:03:49', NULL, NULL),
  ('c1d03a2b-6c42-4381-8079-8513a114fd54', '16e663e3-cafe-4989-b32e-420ee06775de', NULL, '2026-10-23', '08:00', '16:00', 1, '2026-10-14 00:03:49', NULL, NULL);

-- companies: 3 rows
INSERT INTO `companies` (`id`, `name`, `company_type`, `address`, `trade`, `created_at`, `updated_at`) VALUES
  ('016e1cb5-86bd-4ab1-83e6-4b4978785182', 'Terrapin Builders', 'gc', NULL, NULL, '2026-10-14 00:03:48', '2026-10-14 00:03:48'),
  ('e3e747d3-b810-4a27-b532-d42a0de3163b', 'Bao Plumbing', 'sub', NULL, 'Plumbing', '2026-10-14 00:03:48', '2026-10-14 00:03:48'),
  ('e98e15f4-4551-442f-8d4c-284f6f360e04', 'Capital Electric', 'sub', NULL, 'Electrical', '2026-10-14 00:03:48', '2026-10-14 00:03:48');

-- company_join_requests: 4 rows
INSERT INTO `company_join_requests` (`id`, `user_id`, `company_id`, `status`, `created_at`, `updated_at`) VALUES
  ('83e21371-0dce-4802-8de7-7e9dc8a0540d', 'bb29eb26-6b25-485a-857b-204160a16efc', '016e1cb5-86bd-4ab1-83e6-4b4978785182', 'approved', '2026-10-14 00:03:48', '2026-10-14 00:03:48'),
  ('a6eb3625-af8e-48db-a83b-9c8f8b03f2ea', '6becb70b-9dc8-4ab9-b1c4-8e547db81ca6', 'e3e747d3-b810-4a27-b532-d42a0de3163b', 'approved', '2026-10-14 00:03:48', '2026-10-14 00:03:48'),
  ('6fda859f-8d84-4ae6-be9b-06729893f0b8', 'ae2c00c9-4b97-4625-80bd-4b3437f5bbef', 'e3e747d3-b810-4a27-b532-d42a0de3163b', 'approved', '2026-10-14 00:03:48', '2026-10-14 00:03:48'),
  ('e5f99857-5319-48b5-aba2-3ef0a66f7a86', '47ec0c25-3e33-4401-9cd2-946a8ec98dc0', 'e98e15f4-4551-442f-8d4c-284f6f360e04', 'approved', '2026-10-14 00:03:48', '2026-10-14 00:03:48');

-- conversation_participants: 20 rows
INSERT INTO `conversation_participants` (`conversation_id`, `user_id`, `company_id`, `joined_at`) VALUES
  ('af30d415-95c0-4610-b8cf-e29888152649', 'a549da8a-aafa-472b-bbd6-9f61af77b570', '016e1cb5-86bd-4ab1-83e6-4b4978785182', '2026-10-14T00:03:49.167Z'),
  ('af30d415-95c0-4610-b8cf-e29888152649', 'bb29eb26-6b25-485a-857b-204160a16efc', '016e1cb5-86bd-4ab1-83e6-4b4978785182', '2026-10-14T00:03:49.167Z'),
  ('af30d415-95c0-4610-b8cf-e29888152649', '23b7fb84-ed76-4732-bfd2-58662c09064b', 'e3e747d3-b810-4a27-b532-d42a0de3163b', '2026-10-14T00:03:49.167Z'),
  ('af30d415-95c0-4610-b8cf-e29888152649', '6becb70b-9dc8-4ab9-b1c4-8e547db81ca6', 'e3e747d3-b810-4a27-b532-d42a0de3163b', '2026-10-14T00:03:49.167Z'),
  ('af30d415-95c0-4610-b8cf-e29888152649', 'ae2c00c9-4b97-4625-80bd-4b3437f5bbef', 'e3e747d3-b810-4a27-b532-d42a0de3163b', '2026-10-14T00:03:49.167Z'),
  ('a3925e27-b0db-4a93-87cf-a3ec4b06e675', 'a549da8a-aafa-472b-bbd6-9f61af77b570', '016e1cb5-86bd-4ab1-83e6-4b4978785182', '2026-10-14T00:03:49.176Z'),
  ('a3925e27-b0db-4a93-87cf-a3ec4b06e675', 'bb29eb26-6b25-485a-857b-204160a16efc', '016e1cb5-86bd-4ab1-83e6-4b4978785182', '2026-10-14T00:03:49.176Z'),
  ('a3925e27-b0db-4a93-87cf-a3ec4b06e675', '23b7fb84-ed76-4732-bfd2-58662c09064b', 'e3e747d3-b810-4a27-b532-d42a0de3163b', '2026-10-14T00:03:49.176Z'),
  ('a3925e27-b0db-4a93-87cf-a3ec4b06e675', '6becb70b-9dc8-4ab9-b1c4-8e547db81ca6', 'e3e747d3-b810-4a27-b532-d42a0de3163b', '2026-10-14T00:03:49.176Z'),
  ('a3925e27-b0db-4a93-87cf-a3ec4b06e675', 'ae2c00c9-4b97-4625-80bd-4b3437f5bbef', 'e3e747d3-b810-4a27-b532-d42a0de3163b', '2026-10-14T00:03:49.176Z'),
  ('9b1523bf-7c66-4549-8f75-b9aacdb14b1e', 'a549da8a-aafa-472b-bbd6-9f61af77b570', '016e1cb5-86bd-4ab1-83e6-4b4978785182', '2026-10-14T00:03:49.183Z'),
  ('9b1523bf-7c66-4549-8f75-b9aacdb14b1e', 'bb29eb26-6b25-485a-857b-204160a16efc', '016e1cb5-86bd-4ab1-83e6-4b4978785182', '2026-10-14T00:03:49.183Z'),
  ('9b1523bf-7c66-4549-8f75-b9aacdb14b1e', 'a4cf0d53-0dd9-47ad-8fb2-9d773e41b71f', 'e98e15f4-4551-442f-8d4c-284f6f360e04', '2026-10-14T00:03:49.183Z'),
  ('9b1523bf-7c66-4549-8f75-b9aacdb14b1e', '47ec0c25-3e33-4401-9cd2-946a8ec98dc0', 'e98e15f4-4551-442f-8d4c-284f6f360e04', '2026-10-14T00:03:49.183Z'),
  ('748770b1-fdbe-4aa4-9723-ebfff8236bfc', 'bb29eb26-6b25-485a-857b-204160a16efc', '016e1cb5-86bd-4ab1-83e6-4b4978785182', '2026-10-14T00:03:49.211Z'),
  ('748770b1-fdbe-4aa4-9723-ebfff8236bfc', '6becb70b-9dc8-4ab9-b1c4-8e547db81ca6', 'e3e747d3-b810-4a27-b532-d42a0de3163b', '2026-10-14T00:03:49.211Z'),
  ('80ccf2a2-f79e-410d-81bf-830a5f9ccdc0', 'a549da8a-aafa-472b-bbd6-9f61af77b570', '016e1cb5-86bd-4ab1-83e6-4b4978785182', '2026-10-14T00:03:49.229Z'),
  ('80ccf2a2-f79e-410d-81bf-830a5f9ccdc0', 'bb29eb26-6b25-485a-857b-204160a16efc', '016e1cb5-86bd-4ab1-83e6-4b4978785182', '2026-10-14T00:03:49.229Z'),
  ('80ccf2a2-f79e-410d-81bf-830a5f9ccdc0', '23b7fb84-ed76-4732-bfd2-58662c09064b', 'e3e747d3-b810-4a27-b532-d42a0de3163b', '2026-10-14T00:03:49.229Z'),
  ('80ccf2a2-f79e-410d-81bf-830a5f9ccdc0', 'a4cf0d53-0dd9-47ad-8fb2-9d773e41b71f', 'e98e15f4-4551-442f-8d4c-284f6f360e04', '2026-10-14T00:03:49.229Z');

-- conversations: 5 rows
INSERT INTO `conversations` (`id`, `type`, `project_id`, `sub_company_id`, `title`, `created_by`, `created_at`, `last_message_at`) VALUES
  ('af30d415-95c0-4610-b8cf-e29888152649', 'project', '9004a91e-a7e1-416e-b8f2-828c9ec1b548', 'e3e747d3-b810-4a27-b532-d42a0de3163b', 'Main St Retail Fit-Out', 'a549da8a-aafa-472b-bbd6-9f61af77b570', '2026-10-14T00:03:49.161Z', '2026-10-14T00:03:49.161Z'),
  ('a3925e27-b0db-4a93-87cf-a3ec4b06e675', 'project', '90722302-c9b5-45f1-a2bf-a7ef6b05f97e', 'e3e747d3-b810-4a27-b532-d42a0de3163b', 'Riverside Office Build', 'a549da8a-aafa-472b-bbd6-9f61af77b570', '2026-10-14T00:03:49.171Z', '2026-10-14T00:03:49.201Z'),
  ('9b1523bf-7c66-4549-8f75-b9aacdb14b1e', 'project', '90722302-c9b5-45f1-a2bf-a7ef6b05f97e', 'e98e15f4-4551-442f-8d4c-284f6f360e04', 'Riverside Office Build', 'a549da8a-aafa-472b-bbd6-9f61af77b570', '2026-10-14T00:03:49.179Z', '2026-10-14T00:03:49.179Z'),
  ('748770b1-fdbe-4aa4-9723-ebfff8236bfc', 'dm', NULL, NULL, NULL, 'bb29eb26-6b25-485a-857b-204160a16efc', '2026-10-14T00:03:49.211Z', '2026-10-14T00:03:49.220Z'),
  ('80ccf2a2-f79e-410d-81bf-830a5f9ccdc0', 'group', NULL, NULL, 'Riverside coordination', 'a549da8a-aafa-472b-bbd6-9f61af77b570', '2026-10-14T00:03:49.229Z', '2026-10-14T00:03:49.234Z');

-- employees: 8 rows
INSERT INTO `employees` (`id`, `company_id`, `name`, `email`, `phone`, `linked_user_id`, `created_at`, `employee_number`, `job_title`) VALUES
  ('d9181382-ea59-4104-ba35-75be24ecb75c', '016e1cb5-86bd-4ab1-83e6-4b4978785182', 'Gina Torres', 'gina.torres@example.com', NULL, 'a549da8a-aafa-472b-bbd6-9f61af77b570', '2026-10-14 00:03:48', NULL, 'Owner'),
  ('f32a8691-645f-43e9-a1a8-46d85d42a9c2', '016e1cb5-86bd-4ab1-83e6-4b4978785182', 'Paul Kim', 'paul.kim@example.com', NULL, 'bb29eb26-6b25-485a-857b-204160a16efc', '2026-10-14 00:03:48', NULL, 'Project Manager'),
  ('1eafd0d9-93fa-41ad-83bb-18b3836171a3', 'e3e747d3-b810-4a27-b532-d42a0de3163b', 'Bao Nguyen', 'bao.plumbing@example.com', NULL, '23b7fb84-ed76-4732-bfd2-58662c09064b', '2026-10-14 00:03:48', NULL, 'Owner'),
  ('c6623f23-90b9-4dcd-9e43-e78d0d4467fe', 'e3e747d3-b810-4a27-b532-d42a0de3163b', 'Mike Rivera', 'mike.rivera@example.com', NULL, '6becb70b-9dc8-4ab9-b1c4-8e547db81ca6', '2026-10-14 00:03:48', 'BP-102', 'Foreman'),
  ('d7fc0d71-5788-40c7-8dc9-bf2b19ff6ead', 'e3e747d3-b810-4a27-b532-d42a0de3163b', 'Pete Alvarez', 'pete.alvarez@example.com', NULL, 'ae2c00c9-4b97-4625-80bd-4b3437f5bbef', '2026-10-14 00:03:48', 'BP-117', 'Journeyman Plumber'),
  ('7974581e-791b-4383-a377-7a3a11b4e7a9', 'e3e747d3-b810-4a27-b532-d42a0de3163b', 'Luis Ortega', NULL, NULL, NULL, '2026-10-14 00:03:48', NULL, 'Apprentice Plumber'),
  ('cc6f45a8-9e00-4d8d-9d18-c666ef32c9fa', 'e98e15f4-4551-442f-8d4c-284f6f360e04', 'Erin Walsh', 'erin.walsh@example.com', NULL, 'a4cf0d53-0dd9-47ad-8fb2-9d773e41b71f', '2026-10-14 00:03:48', NULL, 'Owner'),
  ('16e663e3-cafe-4989-b32e-420ee06775de', 'e98e15f4-4551-442f-8d4c-284f6f360e04', 'Dev Patel', 'dev.patel@example.com', NULL, '47ec0c25-3e33-4401-9cd2-946a8ec98dc0', '2026-10-14 00:03:48', NULL, 'Electrician');

-- message_reads: 3 rows
INSERT INTO `message_reads` (`conversation_id`, `user_id`, `last_read_at`) VALUES
  ('a3925e27-b0db-4a93-87cf-a3ec4b06e675', 'a549da8a-aafa-472b-bbd6-9f61af77b570', '2026-10-14T00:03:49.192Z'),
  ('a3925e27-b0db-4a93-87cf-a3ec4b06e675', '23b7fb84-ed76-4732-bfd2-58662c09064b', '2026-10-14T00:03:49.201Z'),
  ('748770b1-fdbe-4aa4-9723-ebfff8236bfc', 'bb29eb26-6b25-485a-857b-204160a16efc', '2026-10-14T00:03:49.220Z');

-- messages: 4 rows
INSERT INTO `messages` (`id`, `conversation_id`, `sender_user_id`, `sender_company_id`, `body`, `kind`, `created_at`) VALUES
  ('e07de504-460d-49ff-a5d0-2074d2b940f3', 'a3925e27-b0db-4a93-87cf-a3ec4b06e675', 'a549da8a-aafa-472b-bbd6-9f61af77b570', '016e1cb5-86bd-4ab1-83e6-4b4978785182', 'Inspector is coming Wednesday at 10. Can your crew have the level 2 rough-in ready?', 'user', '2026-10-14T00:03:49.192Z'),
  ('3a7f9819-8ae1-4d5f-89ec-3abefc5fef3e', 'a3925e27-b0db-4a93-87cf-a3ec4b06e675', '23b7fb84-ed76-4732-bfd2-58662c09064b', 'e3e747d3-b810-4a27-b532-d42a0de3163b', 'Yes, Mike and Pete are on it Monday and Tuesday.', 'user', '2026-10-14T00:03:49.201Z'),
  ('b5d7c5fc-5685-43de-b124-a7ae02173979', '748770b1-fdbe-4aa4-9723-ebfff8236bfc', 'bb29eb26-6b25-485a-857b-204160a16efc', '016e1cb5-86bd-4ab1-83e6-4b4978785182', 'Mike, can you send photos of the mechanical room when you''re done?', 'user', '2026-10-14T00:03:49.220Z'),
  ('f85cc5ec-7f38-40ad-9fef-09c8f4cb5be9', '80ccf2a2-f79e-410d-81bf-830a5f9ccdc0', 'a549da8a-aafa-472b-bbd6-9f61af77b570', '016e1cb5-86bd-4ab1-83e6-4b4978785182', 'Gina Torres created the group "Riverside coordination"', 'system', '2026-10-14T00:03:49.234Z');

-- notification_templates: 7 rows
INSERT INTO `notification_templates` (`id`, `event_type`, `channel`, `subject`, `body_html`, `description`, `is_active`, `placeholder_variables`, `created_at`, `updated_at`) VALUES
  ('07a6a28f-c1d1-4989-a98b-7f8751e2213f', 'schedule_created', 'email', 'New schedule request for {{date}}', '<p>{{gc_name}} requested {{crew}} for {{day}} on {{project_name}}.</p>', 'Sent when a GC requests crew from a sub.', 1, '["gc_name","crew","day","project_name","date"]', '2026-10-14 00:03:47', '2026-10-14 00:03:47'),
  ('d6388af5-6e23-4767-baea-92bccd9f7b0a', 'schedule_confirmed', 'email', 'Request confirmed for {{date}}', '<p>{{sub_name}} confirmed {{day}} on {{project_name}}.</p>', 'Sent when a sub confirms a request.', 1, '["sub_name","day","project_name","date"]', '2026-10-14 00:03:47', '2026-10-14 00:03:47'),
  ('ad0c58f7-98d0-4d9d-ae3f-39b76519e85a', 'schedule_rejected', 'email', 'Request declined for {{date}}', '<p>{{sub_name}} declined {{day}} on {{project_name}}.</p>', 'Sent when a sub declines a request.', 1, '["sub_name","day","project_name","date"]', '2026-10-14 00:03:47', '2026-10-14 00:03:47'),
  ('c3a79367-49fa-4805-8af7-161146227afc', 'schedule_cancelled', 'email', 'Request cancelled for {{date}}', '<p>A request for {{day}} on {{project_name}} was cancelled.</p>', 'Sent when either side cancels.', 1, '["day","project_name","date"]', '2026-10-14 00:03:47', '2026-10-14 00:03:47'),
  ('3cb86317-28b0-452b-842d-a6a17d6b41b3', 'join_request', 'email', 'New join request', '<p>{{user_name}} asked to join {{company_name}}.</p>', 'Sent to approvers on a new join request.', 1, '["user_name","company_name"]', '2026-10-14 00:03:47', '2026-10-14 00:03:47'),
  ('171f71ea-db05-4c26-8219-1a84e2a02c6b', 'join_approved', 'email', 'You''re in', '<p>{{company_name}} approved your request. You can start scheduling now.</p>', 'Sent to the requester on approval.', 1, '["company_name"]', '2026-10-14 00:03:47', '2026-10-14 00:03:47'),
  ('c040945f-2be1-4c80-8dce-6b58c5fe00f8', 'join_rejected', 'email', 'Join request declined', '<p>{{company_name}} declined your request to join.</p>', 'Sent to the requester on rejection.', 1, '["company_name"]', '2026-10-14 00:03:47', '2026-10-14 00:03:47');

-- project_connections: 3 rows
INSERT INTO `project_connections` (`id`, `project_id`, `sub_company_id`, `connected_at`) VALUES
  ('b0a8c01e-891a-4a6e-8cce-e20dd43127c3', '90722302-c9b5-45f1-a2bf-a7ef6b05f97e', 'e3e747d3-b810-4a27-b532-d42a0de3163b', '2026-10-14 00:03:48'),
  ('0b0102d4-9c42-4064-9ebb-d99a25c77680', '9004a91e-a7e1-416e-b8f2-828c9ec1b548', 'e3e747d3-b810-4a27-b532-d42a0de3163b', '2026-10-14 00:03:48'),
  ('40076bfe-2f5f-4d43-bcc1-fc2b8c2ab336', '90722302-c9b5-45f1-a2bf-a7ef6b05f97e', 'e98e15f4-4551-442f-8d4c-284f6f360e04', '2026-10-14 00:03:48');

-- projects: 2 rows
INSERT INTO `projects` (`id`, `name`, `address`, `company_id`, `connection_code`, `created_at`, `updated_at`) VALUES
  ('90722302-c9b5-45f1-a2bf-a7ef6b05f97e', 'Riverside Office Build', '4100 River Rd, College Park, MD', '016e1cb5-86bd-4ab1-83e6-4b4978785182', 'b8f9369b', '2026-10-14 00:03:48', '2026-10-14 00:03:48'),
  ('9004a91e-a7e1-416e-b8f2-828c9ec1b548', 'Main St Retail Fit-Out', '120 Main St, Hyattsville, MD', '016e1cb5-86bd-4ab1-83e6-4b4978785182', '7785fbef', '2026-10-14 00:03:48', '2026-10-14 00:03:48');

-- schedule_requests: 3 rows
INSERT INTO `schedule_requests` (`id`, `project_id`, `requesting_company_id`, `sub_company_id`, `employee_ids`, `date`, `start_time`, `end_time`, `description`, `image_urls`, `status`, `status_reason`, `created_at`, `updated_at`) VALUES
  ('24d0c04b-1470-416f-85b4-e6ff3d9351b2', '90722302-c9b5-45f1-a2bf-a7ef6b05f97e', '016e1cb5-86bd-4ab1-83e6-4b4978785182', 'e3e747d3-b810-4a27-b532-d42a0de3163b', '["c6623f23-90b9-4dcd-9e43-e78d0d4467fe","d7fc0d71-5788-40c7-8dc9-bf2b19ff6ead"]', '2026-10-19', '07:00', '15:30', 'Rough-in plumbing, level 2 restrooms', '[]', 'confirmed', NULL, '2026-10-14 00:03:49', '2026-10-14 00:03:49'),
  ('5ea457db-c2b5-4948-a037-346f304c728e', '90722302-c9b5-45f1-a2bf-a7ef6b05f97e', '016e1cb5-86bd-4ab1-83e6-4b4978785182', 'e3e747d3-b810-4a27-b532-d42a0de3163b', '["7974581e-791b-4383-a377-7a3a11b4e7a9"]', '2026-10-21', '07:00', '12:00', 'Pipe insulation, mechanical room', '[]', 'pending', NULL, '2026-10-14 00:03:49', '2026-10-14 00:03:49'),
  ('76c74745-fbd1-4716-8893-e4d2cb0053f9', '90722302-c9b5-45f1-a2bf-a7ef6b05f97e', '016e1cb5-86bd-4ab1-83e6-4b4978785182', 'e98e15f4-4551-442f-8d4c-284f6f360e04', '["16e663e3-cafe-4989-b32e-420ee06775de"]', '2026-10-23', '08:00', '16:00', 'Panel install, east wing', '[]', 'rejected', 'Crew is on another job that day', '2026-10-14 00:03:49', '2026-10-14 00:03:49');

-- tasks: 4 rows
INSERT INTO `tasks` (`id`, `project_id`, `assigned_company_id`, `name`, `description`, `start_date`, `end_date`, `color`, `status`, `sort_order`, `created_at`, `updated_at`) VALUES
  ('ceb7aac4-d343-4a29-9a2a-fb5e1cd72230', '90722302-c9b5-45f1-a2bf-a7ef6b05f97e', NULL, 'Site prep & layout', NULL, '2026-10-12', '2026-10-16', '#64748b', 'complete', 0, '2026-10-14 00:03:49', '2026-10-14 00:03:49'),
  ('fa2e8d5f-3227-48cb-9859-ddbdf6242813', '90722302-c9b5-45f1-a2bf-a7ef6b05f97e', NULL, 'Plumbing rough-in', NULL, '2026-10-19', '2026-10-23', '#0ea5e9', 'in_progress', 1, '2026-10-14 00:03:49', '2026-10-14 00:03:49'),
  ('51cbe445-7d02-4d12-8bf5-ba84e29bb2e4', '90722302-c9b5-45f1-a2bf-a7ef6b05f97e', NULL, 'Electrical rough-in', NULL, '2026-10-21', '2026-10-28', '#f59e0b', 'pending', 2, '2026-10-14 00:03:49', '2026-10-14 00:03:49'),
  ('8b6185c9-8c7d-4143-9ad2-9290294c549f', '90722302-c9b5-45f1-a2bf-a7ef6b05f97e', NULL, 'Drywall', NULL, '2026-10-29', '2026-11-05', '#22c55e', 'pending', 3, '2026-10-14 00:03:49', '2026-10-14 00:03:49');

-- user_notifications: 16 rows
INSERT INTO `user_notifications` (`id`, `user_id`, `event_type`, `title`, `body`, `project_id`, `link`, `read_at`, `created_at`) VALUES
  ('231dfca3-2759-471b-ade0-9c054149d611', 'a549da8a-aafa-472b-bbd6-9f61af77b570', 'join_request', 'New join request', 'Paul Kim asked to join Terrapin Builders.', NULL, '/dashboard', NULL, '2026-10-14T00:03:48.206Z'),
  ('0f83e8ab-02c0-44a4-831a-c65391c9737a', 'bb29eb26-6b25-485a-857b-204160a16efc', 'join_approved', 'You''re in', 'Terrapin Builders approved your request. You can start scheduling now.', NULL, '/dashboard', NULL, '2026-10-14T00:03:48.225Z'),
  ('078f0f36-bcd0-45dd-865e-4152d20d3884', '23b7fb84-ed76-4732-bfd2-58662c09064b', 'join_request', 'New join request', 'Mike Rivera asked to join Bao Plumbing.', NULL, '/dashboard', NULL, '2026-10-14T00:03:48.499Z'),
  ('1c3ba109-999a-4607-b8a0-accd243cdab7', '6becb70b-9dc8-4ab9-b1c4-8e547db81ca6', 'join_approved', 'You''re in', 'Bao Plumbing approved your request. You can start scheduling now.', NULL, '/dashboard', NULL, '2026-10-14T00:03:48.530Z'),
  ('7b98f9d6-a2d5-4814-8c8d-55a009340177', '23b7fb84-ed76-4732-bfd2-58662c09064b', 'join_request', 'New join request', 'Pete Alvarez asked to join Bao Plumbing.', NULL, '/dashboard', NULL, '2026-10-14T00:03:48.543Z'),
  ('c962865d-522b-4ab5-b0ea-c2a511e4022e', 'ae2c00c9-4b97-4625-80bd-4b3437f5bbef', 'join_approved', 'You''re in', 'Bao Plumbing approved your request. You can start scheduling now.', NULL, '/dashboard', NULL, '2026-10-14T00:03:48.560Z'),
  ('aee3ef1f-1488-4773-9b9f-0758e74b261d', 'a4cf0d53-0dd9-47ad-8fb2-9d773e41b71f', 'join_request', 'New join request', 'Dev Patel asked to join Capital Electric.', NULL, '/dashboard', NULL, '2026-10-14T00:03:48.780Z'),
  ('f4e9e4f1-a82d-4910-9df4-7bd946961a0f', '47ec0c25-3e33-4401-9cd2-946a8ec98dc0', 'join_approved', 'You''re in', 'Capital Electric approved your request. You can start scheduling now.', NULL, '/dashboard', NULL, '2026-10-14T00:03:48.795Z'),
  ('967b73df-65bf-4ae4-835b-8ef00cd1036d', '23b7fb84-ed76-4732-bfd2-58662c09064b', 'schedule_created', 'New schedule request', 'Terrapin Builders requested 2 people for Mon, Oct 19 on Riverside Office Build.', '90722302-c9b5-45f1-a2bf-a7ef6b05f97e', '/dashboard?day=2026-10-19', NULL, '2026-10-14T00:03:49.049Z'),
  ('1ff237dd-b076-4795-bbf4-30257dba7b46', 'a549da8a-aafa-472b-bbd6-9f61af77b570', 'schedule_confirmed', 'Request confirmed', 'Bao Plumbing confirmed Mon, Oct 19 on Riverside Office Build.', '90722302-c9b5-45f1-a2bf-a7ef6b05f97e', '/dashboard?day=2026-10-19', NULL, '2026-10-14T00:03:49.062Z'),
  ('aca94f20-2853-484b-a82f-48fe7d21cad4', 'bb29eb26-6b25-485a-857b-204160a16efc', 'schedule_confirmed', 'Request confirmed', 'Bao Plumbing confirmed Mon, Oct 19 on Riverside Office Build.', '90722302-c9b5-45f1-a2bf-a7ef6b05f97e', '/dashboard?day=2026-10-19', NULL, '2026-10-14T00:03:49.066Z'),
  ('7fe8ce67-b0b3-48ed-aad5-205b40bc104a', '23b7fb84-ed76-4732-bfd2-58662c09064b', 'schedule_created', 'New schedule request', 'Terrapin Builders requested 1 person for Wed, Oct 21 on Riverside Office Build.', '90722302-c9b5-45f1-a2bf-a7ef6b05f97e', '/dashboard?day=2026-10-21', NULL, '2026-10-14T00:03:49.080Z'),
  ('cf241d5b-fe8a-424e-bcf1-b3de25a1a780', 'a4cf0d53-0dd9-47ad-8fb2-9d773e41b71f', 'schedule_created', 'New schedule request', 'Terrapin Builders requested 1 person for Fri, Oct 23 on Riverside Office Build.', '90722302-c9b5-45f1-a2bf-a7ef6b05f97e', '/dashboard?day=2026-10-23', NULL, '2026-10-14T00:03:49.095Z'),
  ('c8459895-93df-4ffd-8cd9-170aa576ddcf', '47ec0c25-3e33-4401-9cd2-946a8ec98dc0', 'schedule_created', 'New schedule request', 'Terrapin Builders requested 1 person for Fri, Oct 23 on Riverside Office Build.', '90722302-c9b5-45f1-a2bf-a7ef6b05f97e', '/dashboard?day=2026-10-23', NULL, '2026-10-14T00:03:49.099Z'),
  ('6ff46e2d-78f5-466c-9807-7e2bd64047bb', 'a549da8a-aafa-472b-bbd6-9f61af77b570', 'schedule_rejected', 'Request declined', 'Capital Electric declined Fri, Oct 23 on Riverside Office Build. Reason: Crew is on another job that day', '90722302-c9b5-45f1-a2bf-a7ef6b05f97e', '/dashboard?day=2026-10-23', NULL, '2026-10-14T00:03:49.113Z'),
  ('89788a00-7f96-44ac-8400-49f6545eae78', 'bb29eb26-6b25-485a-857b-204160a16efc', 'schedule_rejected', 'Request declined', 'Capital Electric declined Fri, Oct 23 on Riverside Office Build. Reason: Crew is on another job that day', '90722302-c9b5-45f1-a2bf-a7ef6b05f97e', '/dashboard?day=2026-10-23', NULL, '2026-10-14T00:03:49.116Z');

-- user_roles: 7 rows
INSERT INTO `user_roles` (`id`, `user_id`, `company_id`, `permission_level`, `is_company_creator`, `created_at`, `updated_at`) VALUES
  ('1cbb2617-e356-40be-a440-dd1ffe6eca07', 'a549da8a-aafa-472b-bbd6-9f61af77b570', '016e1cb5-86bd-4ab1-83e6-4b4978785182', 'account_holder', 1, '2026-10-14 00:03:48', '2026-10-14 00:03:48'),
  ('8030de24-b8b4-42aa-85f4-3497f787f3ce', 'bb29eb26-6b25-485a-857b-204160a16efc', '016e1cb5-86bd-4ab1-83e6-4b4978785182', 'partial', 0, '2026-10-14 00:03:48', '2026-10-14 00:03:48'),
  ('c93e0e06-72fb-4e13-87a0-d46ef4a4f46f', '23b7fb84-ed76-4732-bfd2-58662c09064b', 'e3e747d3-b810-4a27-b532-d42a0de3163b', 'account_holder', 1, '2026-10-14 00:03:48', '2026-10-14 00:03:48'),
  ('11e94560-d314-4bcb-a4db-9cf43c034b48', '6becb70b-9dc8-4ab9-b1c4-8e547db81ca6', 'e3e747d3-b810-4a27-b532-d42a0de3163b', 'level_1', 0, '2026-10-14 00:03:48', '2026-10-14 00:03:48'),
  ('9879c776-5c18-48bb-8b59-de46334b038e', 'ae2c00c9-4b97-4625-80bd-4b3437f5bbef', 'e3e747d3-b810-4a27-b532-d42a0de3163b', 'basic', 0, '2026-10-14 00:03:48', '2026-10-14 00:03:48'),
  ('b9a480d9-48ca-4a1f-8b49-2074de582abe', 'a4cf0d53-0dd9-47ad-8fb2-9d773e41b71f', 'e98e15f4-4551-442f-8d4c-284f6f360e04', 'account_holder', 1, '2026-10-14 00:03:48', '2026-10-14 00:03:48'),
  ('05375c8f-f113-43da-b666-33a9edfbd9a5', '47ec0c25-3e33-4401-9cd2-946a8ec98dc0', 'e98e15f4-4551-442f-8d4c-284f6f360e04', 'partial', 0, '2026-10-14 00:03:48', '2026-10-14 00:03:48');

-- users: 7 rows
INSERT INTO `users` (`id`, `email`, `password_hash`, `full_name`, `phone`, `language`, `profile_picture_url`, `company_id`, `is_admin`, `created_at`, `google_sub`) VALUES
  ('a549da8a-aafa-472b-bbd6-9f61af77b570', 'gina.torres@example.com', '34918741df901480f0d41c01be7d31b9:6cde5fa73da885c237ca0b02e27b70bd9ab46111ae5a4163cb586127a9f58f7a0fdc7ac55ea9ee2bc77fb1cc8b5b2a44f1078c719d485fe521ba05a7388c820c', 'Gina Torres', NULL, 'en', NULL, '016e1cb5-86bd-4ab1-83e6-4b4978785182', 0, '2026-10-14 00:03:48', NULL),
  ('bb29eb26-6b25-485a-857b-204160a16efc', 'paul.kim@example.com', '6eb412324e52c60d68408bbdb616498d:22f437b20c7746f48a215e46af221294a8f2d98218fa0da0496a118bd119735951c1b03285fce85cfdb5d50a396d64e82ffcf3f9d4202b8708ca3688e48ea320', 'Paul Kim', NULL, 'en', NULL, '016e1cb5-86bd-4ab1-83e6-4b4978785182', 0, '2026-10-14 00:03:48', NULL),
  ('23b7fb84-ed76-4732-bfd2-58662c09064b', 'bao.plumbing@example.com', '66a0723192ef5c223a518c122aae126b:8b99447d03976a2ca03d7683f3eb3f4277eaf73f612be79808bf1fdda005c3e47c6ac3257077d895b90ac736b41c5f7b60b7d441960210777cdd80ec8f90e5c9', 'Bao Nguyen', NULL, 'en', NULL, 'e3e747d3-b810-4a27-b532-d42a0de3163b', 0, '2026-10-14 00:03:48', NULL),
  ('6becb70b-9dc8-4ab9-b1c4-8e547db81ca6', 'mike.rivera@example.com', '62e94844e4753d7bedc3f9683f0bc5d4:30aa5ffb3e5004519b210fb4bf65877f9be2cbbda20d5bc7544ccb7b0d0009862f885390a1cac5a798c06229275683726304cf407dcb0ede1f5665cb9464d0dd', 'Mike Rivera', '301-555-0142', 'en', NULL, 'e3e747d3-b810-4a27-b532-d42a0de3163b', 0, '2026-10-14 00:03:48', NULL),
  ('ae2c00c9-4b97-4625-80bd-4b3437f5bbef', 'pete.alvarez@example.com', 'ff09666276822761ff009febaf4246f5:43db0e0cb3c1fca4070e915486f74925e2bf336f7cbc1eb4743826fb1db51280e1d8751531b8514f942efb124a4a55372331aed109e5a338739de3cb0efaaf63', 'Pete Alvarez', NULL, 'en', NULL, 'e3e747d3-b810-4a27-b532-d42a0de3163b', 0, '2026-10-14 00:03:48', NULL),
  ('a4cf0d53-0dd9-47ad-8fb2-9d773e41b71f', 'erin.walsh@example.com', 'd6f89e6825e2ec46a33c7ba5b9eef1e8:5f69d732c391a5417317bfa441436f529e43debd482b7a75d011b22321f41627c21dc90cbb5d535f49b7b90046a19720e0e156d60a281fa737e4928791e38947', 'Erin Walsh', NULL, 'en', NULL, 'e98e15f4-4551-442f-8d4c-284f6f360e04', 0, '2026-10-14 00:03:48', NULL),
  ('47ec0c25-3e33-4401-9cd2-946a8ec98dc0', 'dev.patel@example.com', 'e11ed4e8bd9756697ed9f0aa9ceb8768:f445a4f415e2f43b63fdd4a5a9069dd72aeb7fefdbf8961fcda9a8222fd787bc98cb288ff64cba0ec77c2ed2d73d0a15adf5c0850fd66fa4b352e9b3fcd2f206', 'Dev Patel', NULL, 'en', NULL, 'e98e15f4-4551-442f-8d4c-284f6f360e04', 0, '2026-10-14 00:03:48', NULL);

SET FOREIGN_KEY_CHECKS = 1;
