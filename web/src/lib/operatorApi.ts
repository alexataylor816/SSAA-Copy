import { dateLocale } from "@/i18n/runtime";
/** Shapes returned by the operator API (backend/src/admin/routes.ts). */

export type OperatorLevel = "owner" | "main_operator" | "view_only";
export type EmailTransport = "smtp" | "resend" | "none";

export interface OperatorMe {
  userId: string;
  level: OperatorLevel;
  canChange: boolean;
  canManageOperators: boolean;
  email: EmailTransport;
}

export interface AdminCompany {
  id: string;
  name: string;
  companyType: string;
  members: number;
  projects: number;
  primaryHolder: { userId: string; fullName: string | null; email: string } | null;
}

export interface AdminUser {
  userId: string;
  email: string;
  fullName: string | null;
  isOperator: boolean;
  operatorLevel: OperatorLevel | null;
  suspended: boolean;
  companyId: string | null;
  companyName: string | null;
  companyType: string | null;
  permissionLevel: string | null;
}

export interface Overview {
  counts: {
    gcs: number;
    subs: number;
    users: number;
    projects: number;
    employees: number;
    pendingRequests: number;
    upcoming: number;
    edited: number;
    suspended: number;
    deletions: number;
    failedEmail: number;
    sentWeek: number;
  };
  requestsByStatus: Record<string, number>;
  recentRequests: { id: string; date: string; status: string; createdAt: string; project: string; gc: string; sub: string }[];
  newestUsers: { userId: string; fullName: string; email: string; createdAt: string; companyName: string | null }[];
  email: EmailTransport;
}

export interface CorrespondenceEntry {
  id: string;
  eventType: string;
  channel: "email" | "push" | "chat";
  recipientUserId: string | null;
  recipientEmail: string | null;
  recipientName: string | null;
  subject: string | null;
  body: string | null;
  status: "sent" | "failed" | "skipped" | "off";
  errorMessage: string | null;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  operatorId: string;
  operatorName: string | null;
  operatorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  summary: string;
  createdAt: string;
}

export interface Template {
  id: string;
  eventType: string;
  displayName: string | null;
  subject: string;
  bodyHtml: string;
  description: string | null;
  isActive: boolean;
  pushTitle: string | null;
  pushBody: string | null;
  pushActive: boolean;
  placeholderVariables: string[];
  updatedAt: string;
}

export interface Operator {
  userId: string;
  email: string;
  fullName: string;
  level: OperatorLevel;
}

export interface DeletionRequest {
  id: string;
  companyId: string;
  companyName: string | null;
  reason: string | null;
  createdAt: string;
}

export interface UserDetail {
  user: {
    userId: string;
    email: string;
    fullName: string;
    phone: string | null;
    createdAt: string;
    isOperator: boolean;
    operatorLevel: OperatorLevel | null;
    suspended: boolean;
    suspendedAt: string | null;
    signInMethod: "google" | "password";
  };
  company: { id: string; name: string; companyType: string } | null;
  permissionLevel: string | null;
  isCreator: boolean;
  levels: string[];
  correspondence: CorrespondenceEntry[];
  audit: AuditEntry[];
}

export interface CompanyDetail {
  company: { id: string; name: string; companyType: string; address: string | null };
  levels: string[];
  members: { userId: string; fullName: string; email: string; permissionLevel: string; isCreator: boolean; suspended: boolean }[];
  projects: { id: string; name: string; address: string | null; ownerName: string | null }[];
  employees: number;
  requests: { id: string; date: string; status: string; project: string; other: string }[];
  correspondence: CorrespondenceEntry[];
  audit: AuditEntry[];
}

export const LEVEL_LABEL: Record<string, string> = {
  account_holder: "Account Holder",
  full: "Full",
  partial: "Partial",
  level_1: "Level 1",
  basic: "Basic",
};
export const levelLabel = (level: string | null) => (level ? (LEVEL_LABEL[level] ?? level.replace("_", " ")) : "No role");

export const OPERATOR_LEVEL_LABEL: Record<OperatorLevel, string> = {
  owner: "Owner",
  main_operator: "Main Operator (Full Access)",
  view_only: "Operator (View Only)",
};

/** Lovable's names for each event in the Correspondence screen and log. */
export const EVENT_LABEL: Record<string, string> = {
  schedule_created: "Schedule Requests",
  schedule_confirmed: "Schedule Confirmed",
  schedule_rejected: "Schedule Declined",
  schedule_cancelled: "Schedule Cancelled",
  schedule_edited: "Schedule Edited by Subcontractor",
  schedule_batch_sent: "Weekly Requests from GC",
  schedule_assigned: "Personnel: You're on the Schedule",
  join_request: "Join Request Submitted",
  join_approved: "Join Request Approved",
  join_rejected: "Join Request Declined",
  password_reset: "Password Reset Code",
  username_reminder: "Username Reminder",
};
export const eventLabel = (type: string) => EVENT_LABEL[type] ?? type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export const STATUS_STYLE: Record<CorrespondenceEntry["status"], string> = {
  sent: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  failed: "border-red-300 bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300",
  skipped: "border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  off: "border-border bg-muted/20 text-muted-foreground",
};

export const STATUS_LABEL: Record<CorrespondenceEntry["status"], string> = {
  sent: "Sent",
  failed: "Failed",
  skipped: "Not sent: email not set up",
  off: "Not sent: template off",
};

export const when = (iso: string) => {
  const d = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(dateLocale(), { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
};
