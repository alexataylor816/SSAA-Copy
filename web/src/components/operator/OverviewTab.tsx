import { AlertTriangle, Ban, Building2, CalendarClock, CheckCircle2, ChevronRight, HardHat, Mail, PencilLine, Users, FolderKanban, UserX } from "lucide-react";
import { when, type Overview } from "@/lib/operatorApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { dateLocale } from "@/i18n/runtime";

/** The operator's first screen: how big the platform is, what needs attention, and what just happened. */

const STATUS_BAR: Record<string, { label: string; className: string }> = {
  confirmed: { label: "Confirmed", className: "bg-emerald-500" },
  pending: { label: "Pending", className: "bg-amber-400" },
  rejected: { label: "Declined", className: "bg-red-500" },
  cancelled: { label: "Cancelled", className: "bg-slate-400" },
};

const REQUEST_STYLE: Record<string, string> = {
  pending: "border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  confirmed: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  rejected: "border-red-300 bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300",
  cancelled: "border-border bg-muted/20 text-muted-foreground",
};

const shortDay = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(dateLocale(), { weekday: "short", month: "short", day: "numeric" });
};

export default function OverviewTab({
  data,
  onOpenUser,
  onOpenCancellations,
  onOpenLog,
  onShowSuspended,
}: {
  data: Overview;
  onOpenUser: (userId: string) => void;
  onOpenCancellations: () => void;
  onOpenLog: () => void;
  onShowSuspended: () => void;
}) {
  const c = data.counts;
  const tiles = [
    { label: "GCs", value: c.gcs, icon: Building2 },
    { label: "Subs", value: c.subs, icon: HardHat },
    { label: "Users", value: c.users, icon: Users },
    { label: "Projects", value: c.projects, icon: FolderKanban },
    { label: "Crew", value: c.employees, icon: HardHat },
  ];
  const attention = [
    { label: "Pending requests", detail: "waiting for a subcontractor to confirm", value: c.pendingRequests, icon: CalendarClock, tone: "amber" },
    { label: "Edited by subs", detail: "confirmed days a GC hasn't reviewed", value: c.edited, icon: PencilLine, tone: "amber" },
    { label: "Cancellation requests", detail: "companies asking to be deleted", value: c.deletions, icon: Ban, tone: "red", onClick: onOpenCancellations },
    { label: "Failed emails", detail: "in the last 7 days", value: c.failedEmail, icon: Mail, tone: "red", onClick: onOpenLog },
    { label: "Suspended accounts", detail: "can't sign in", value: c.suspended, icon: UserX, tone: "slate", onClick: onShowSuspended },
  ];
  const statusTotal = Object.values(data.requestsByStatus).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-5">
      {data.email !== "smtp" && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            {data.email === "none"
              ? "Email isn't set up on this server: emails are recorded in the log as not sent. Bell notifications and chat messages still go out."
              : "Email uses the Resend test key, which only reaches the Resend account owner. Verify the ssaainc.com domain in Resend before launch so customers get their emails."}
          </p>
        </div>
      )}

      {/* Phone: three small tiles a row, numbers first; the icons come back with the room. */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3 lg:grid-cols-5">
        {tiles.map((t) => (
          <Card key={t.label}>
            <CardContent className="flex items-center gap-3 p-3 sm:p-4">
              <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary sm:flex">
                <t.icon className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-2xl font-semibold tabular-nums leading-tight">{t.value}</span>
                <span className="block truncate text-xs text-muted-foreground">{t.label}</span>
              </span>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Needs attention</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {attention.map((a) => {
              const quiet = a.value === 0;
              const tone = quiet
                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                : a.tone === "red"
                  ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
                  : a.tone === "amber"
                    ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                    : "bg-muted/20 text-muted-foreground";
              const Icon = quiet ? CheckCircle2 : a.icon;
              const body = (
                <>
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{a.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{a.detail}</span>
                  </span>
                  <span className="text-lg font-semibold tabular-nums">{a.value}</span>
                  {a.onClick && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                </>
              );
              return a.onClick ? (
                <button key={a.label} type="button" onClick={a.onClick} className="flex w-full items-center gap-3 rounded-md p-2 text-left hover:bg-muted/15">
                  {body}
                </button>
              ) : (
                <div key={a.label} className="flex items-center gap-3 p-2">
                  {body}
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Schedule requests, last week to next week</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex items-baseline justify-between">
                <span className="text-3xl font-semibold tabular-nums">{statusTotal}</span>
                <span className="text-xs text-muted-foreground">{c.upcoming} booked or pending in the next 7 days</span>
              </div>
              <div className="mt-2 flex h-3 overflow-hidden rounded-full bg-muted/20" role="img" aria-label="Requests by status">
                {Object.entries(STATUS_BAR).map(([key, s]) =>
                  data.requestsByStatus[key] ? (
                    <span key={key} className={s.className} style={{ width: `${(data.requestsByStatus[key] / statusTotal) * 100}%` }} />
                  ) : null,
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {Object.entries(STATUS_BAR).map(([key, s]) => (
                  <span key={key} className="flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${s.className}`} />
                    {s.label} <span className="tabular-nums text-muted-foreground">{data.requestsByStatus[key] ?? 0}</span>
                  </span>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between rounded-md border p-3 text-sm">
              <span className="text-muted-foreground">Messages sent in the last 7 days</span>
              <button type="button" onClick={onOpenLog} className="font-semibold tabular-nums text-primary hover:underline">
                {c.sentWeek}
              </button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Latest schedule requests</CardTitle>
          </CardHeader>
          <CardContent>
            {data.recentRequests.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No requests yet.</p>
            ) : (
              <ul className="divide-y">
                {data.recentRequests.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{r.project}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {shortDay(r.date)} · {r.gc} → {r.sub}
                      </span>
                    </span>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${REQUEST_STYLE[r.status] ?? ""}`}>{r.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Newest accounts</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {data.newestUsers.map((u) => (
                <li key={u.userId}>
                  <button type="button" onClick={() => onOpenUser(u.userId)} className="flex w-full items-center justify-between gap-3 py-2.5 text-left text-sm hover:bg-muted/10">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{u.fullName || u.email}</span>
                      <span className="block truncate text-xs text-muted-foreground">{u.companyName ?? "No company yet"}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{when(u.createdAt).replace(/, \d{4}.*/, "")}</span>
                  </button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
