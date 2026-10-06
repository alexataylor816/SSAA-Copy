/**
 * Projects + Availability + Schedule Requests, ported from the Lovable app's
 * `projects`, `project_connections`, `availability`, and `schedule_requests`
 * tables.
 *
 * Deliberately deferred still: multi-stop scheduling
 * (availability.stop_number/stop_label, schedule_requests.employee_stops),
 * guest-GC companies + project_aliases, contractor_connections (sub-of-sub /
 * intermediary routing), and the drag-and-drop weekly resource matrix.
 * Those are separate, larger efforts — see SSAA/.lovable/plan/ for the
 * originals.
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
  createdAt: string;
  updatedAt: string;
}
