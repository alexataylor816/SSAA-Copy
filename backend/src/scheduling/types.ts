/**
 * Projects + Availability + Schedule Requests, ported from the Lovable app's
 * `projects`, `project_connections`, `availability`, and `schedule_requests`
 * tables.
 *
 * Availability supports multiple stops per day (stop_number/stop_label).
 * Deliberately deferred still: per-stop booking on schedule requests
 * (schedule_requests.employee_stops) and guest-GC companies + project_aliases.
 * See SSAA/.lovable/plan/ for the originals.
 */

export interface Project {
  id: string;
  name: string;
  address: string | null;
  companyId: string;
  connectionCode: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectConnection {
  id: string;
  projectId: string;
  subCompanyId: string;
  connectedAt: string;
}

export interface Availability {
  id: string;
  employeeId: string;
  projectId: string | null;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  allProjects: boolean;
  /** Multiple stops in one day (the original's stop_number/stop_label); null for a single block. */
  stopNumber: number | null;
  stopLabel: string | null;
  createdAt: string;
}

export type ScheduleRequestStatus = "pending" | "confirmed" | "rejected" | "cancelled";

export interface ScheduleRequest {
  id: string;
  projectId: string;
  requestingCompanyId: string;
  subCompanyId: string;
  employeeIds: string[];
  employeeNames: string[];
  date: string; // YYYY-MM-DD
  startTime: string | null; // HH:MM
  endTime: string | null; // HH:MM
  description: string | null;
  imageUrls: string[];
  status: ScheduleRequestStatus;
  statusReason: string | null;
  requestingCompanyName: string | null;
  subCompanyName: string | null;
  /** Changed by the other side since it was last acknowledged (the GC's "Edited" tag). */
  edited: boolean;
  lastEditedByCompanyId: string | null;
  /** The sub booked its own crew here (created already confirmed). */
  subAssigned: boolean;
  /** Published without notifying anyone; it only shows up in the app. */
  silentAssignment: boolean;
  /** Every request written by one Weekly-view publish shares this id. */
  groupId: string | null;
  editReason: string | null;
  createdAt: string;
  updatedAt: string;
}
