import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Bell, Loader2, Mail, RefreshCw, Save, Search, Send, Undo2 } from "lucide-react";
import { api } from "@/lib/api";
import {
  STATUS_LABEL,
  STATUS_STYLE,
  eventLabel,
  when,
  type CorrespondenceEntry,
  type EmailTransport,
  type Template,
} from "@/lib/operatorApi";
import EmailEditor from "@/components/operator/EmailEditor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/components/ui/use-toast";

/**
 * Manage SSAA → Correspondence (Lovable's ManageCorrespondenceModal): the email and push wording for
 * every message the platform sends, and the log of what actually went out.
 */

type Channel = "email" | "push";
type Draft = Pick<Template, "subject" | "bodyHtml" | "pushTitle" | "pushBody">;

const fill = (text: string, samples: Record<string, string>) =>
  text.replace(/\{\{?\s*([a-z_][a-z0-9_]*)\s*\}?\}/gi, (_m, n: string) => samples[n] ?? `[${n}]`);

const EMAIL_NOTE: Record<EmailTransport, string> = {
  resend: "Email goes out through Resend. With the test key it only reaches the Resend account owner until a domain is verified.",
  smtp: "Email goes out through the configured SMTP account.",
  none: "Email isn't set up on this server, so emails are logged as not sent. Push notifications still go out.",
};

export default function CorrespondenceDialog({
  open,
  onOpenChange,
  onBack,
  canChange,
  emailTransport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBack?: () => void;
  canChange: boolean;
  emailTransport: EmailTransport;
}) {
  const { toast } = useToast();
  const [tab, setTab] = useState<"email" | "push" | "log">("email");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [samples, setSamples] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<{ template: Template; channel: Channel } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const pushBody = useRef<HTMLTextAreaElement>(null);

  const [entries, setEntries] = useState<CorrespondenceEntry[]>([]);
  const [logChannel, setLogChannel] = useState("");
  const [logStatus, setLogStatus] = useState("");
  const [logSearch, setLogSearch] = useState("");
  const [logLoading, setLogLoading] = useState(false);

  const loadTemplates = useCallback(async () => {
    const res = await api.get<{ templates: Template[] }>("/admin/templates");
    setTemplates(res.templates);
    return res.templates;
  }, []);

  const loadLog = useCallback(async () => {
    setLogLoading(true);
    try {
      const params = new URLSearchParams();
      if (logChannel) params.set("channel", logChannel);
      if (logStatus) params.set("status", logStatus);
      if (logSearch.trim()) params.set("q", logSearch.trim());
      const res = await api.get<{ entries: CorrespondenceEntry[] }>(`/admin/correspondence?${params}`);
      setEntries(res.entries);
    } catch (err) {
      toast({ title: "Couldn't load the log", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setLogLoading(false);
    }
  }, [logChannel, logStatus, logSearch, toast]);

  useEffect(() => {
    if (!open) return;
    void loadTemplates();
    void api.get<{ samples: Record<string, string> }>("/admin/samples").then((r) => setSamples(r.samples)).catch(() => undefined);
  }, [open, loadTemplates]);

  useEffect(() => {
    if (!open || tab !== "log") return;
    const t = window.setTimeout(() => void loadLog(), logSearch ? 300 : 0);
    return () => window.clearTimeout(t);
  }, [open, tab, loadLog, logSearch]);

  const label = (t: Template) => t.displayName?.trim() || eventLabel(t.eventType);

  function startEdit(template: Template, channel: Channel) {
    setEditing({ template, channel });
    setDraft({ subject: template.subject, bodyHtml: template.bodyHtml, pushTitle: template.pushTitle, pushBody: template.pushBody });
    setRenaming(false);
    setEditingDesc(false);
  }

  async function patch(template: Template, body: Partial<Template>, message: string, undo?: Partial<Template>) {
    setBusy(true);
    try {
      const updated = await api.patch<Template>(`/admin/templates/${template.id}`, body);
      const list = await loadTemplates();
      if (editing?.template.id === template.id) setEditing((e) => (e ? { ...e, template: list.find((t) => t.id === template.id) ?? updated } : e));
      toast({
        title: message,
        description: undo ? "You can undo this for the next few seconds." : undefined,
        action: undo ? (
          <ToastAction
            altText="Undo"
            onClick={async () => {
              try {
                await api.patch(`/admin/templates/${template.id}`, undo);
                await loadTemplates();
                toast({ title: "Reverted to the previous version" });
              } catch (err) {
                toast({ title: "Undo failed", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
              }
            }}
          >
            <Undo2 className="mr-1 h-3 w-3" /> Undo
          </ToastAction>
        ) : undefined,
      });
      return true;
    } catch (err) {
      toast({ title: "Couldn't save", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveTemplate() {
    if (!editing || !draft) return;
    const t = editing.template;
    const ok =
      editing.channel === "email"
        ? await patch(t, { subject: draft.subject, bodyHtml: draft.bodyHtml }, "Template saved", { subject: t.subject, bodyHtml: t.bodyHtml })
        : await patch(t, { pushTitle: draft.pushTitle ?? "", pushBody: draft.pushBody ?? "" }, "Template saved", {
            pushTitle: t.pushTitle ?? "",
            pushBody: t.pushBody ?? "",
          });
    if (ok) setEditing(null);
  }

  async function sendTest() {
    if (!editing) return;
    setBusy(true);
    try {
      const res = await api.post<{ status: CorrespondenceEntry["status"]; to: string }>(`/admin/templates/${editing.template.id}/test`);
      toast({
        title: res.status === "sent" ? `Test sent to ${res.to}` : "Test not sent",
        description:
          res.status === "sent"
            ? "Save first if you want the test to use your latest changes."
            : res.status === "off"
              ? "This template is switched off."
              : res.status === "skipped"
                ? "Email isn't set up on this server."
                : "The email provider refused it. See the Log tab.",
        variant: res.status === "sent" ? undefined : "destructive",
      });
    } catch (err) {
      toast({ title: "Test not sent", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  function insertIntoPush(token: string) {
    const el = pushBody.current;
    const current = draft?.pushBody ?? "";
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    setDraft((d) => (d ? { ...d, pushBody: current.slice(0, start) + token + current.slice(end) } : d));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  const emailTemplates = templates;
  const pushTemplates = useMemo(() => templates.filter((t) => t.pushTitle != null), [templates]);

  const heading = editing && (
    <div className="flex flex-wrap items-center justify-between gap-2">
      {renaming ? (
        <form
          className="flex flex-1 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void patch(editing.template, { displayName: nameDraft.trim() || null }, "Template name updated").then(() => setRenaming(false));
          }}
        >
          <Input autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} className="h-9 max-w-sm" aria-label="Template name" />
          <Button size="sm" type="submit" disabled={busy}>
            Save
          </Button>
          <Button size="sm" type="button" variant="ghost" onClick={() => setRenaming(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <h3 className="text-lg font-semibold">{label(editing.template)}</h3>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {canChange && !renaming && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setNameDraft(label(editing.template));
              setRenaming(true);
            }}
          >
            Edit Name of Template
          </Button>
        )}
        {canChange && !editingDesc && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setDescDraft(editing.template.description ?? "");
              setEditingDesc(true);
            }}
          >
            Edit Description
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => setEditing(null)}>
          {canChange ? "Cancel" : "Back"}
        </Button>
      </div>
    </div>
  );

  const description =
    editing &&
    (editingDesc ? (
      <div className="space-y-2">
        <Textarea autoFocus value={descDraft} onChange={(e) => setDescDraft(e.target.value)} rows={3} placeholder="Describe when this message is sent" />
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void patch(editing.template, { description: descDraft.trim() || null }, "Template description updated").then(() => setEditingDesc(false))}
          >
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditingDesc(false)}>
            Cancel
          </Button>
        </div>
      </div>
    ) : editing.template.description ? (
      <p className="text-sm text-muted-foreground">{editing.template.description}</p>
    ) : null);

  const list = (items: Template[], channel: Channel) => (
    <div className="space-y-2">
      {items.map((t) => {
        const active = channel === "email" ? t.isActive : t.pushActive;
        return (
          <div key={t.id} className="flex items-start justify-between gap-3 rounded-lg border bg-card p-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{label(t)}</span>
                <Badge variant={active ? "default" : "secondary"}>{active ? "Active" : "Inactive"}</Badge>
              </div>
              {t.description && <p className="mt-1 text-sm text-muted-foreground">{t.description}</p>}
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {channel === "email" ? `Subject: ${t.subject}` : `${t.pushTitle}: ${t.pushBody}`}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <Switch
                checked={active}
                disabled={!canChange || busy}
                aria-label={`${label(t)} ${channel} ${active ? "on" : "off"}`}
                onCheckedChange={(on) =>
                  void patch(t, channel === "email" ? { isActive: on } : { pushActive: on }, `${label(t)}: ${channel} ${on ? "on" : "off"}`)
                }
              />
              <Button variant="outline" size="sm" onClick={() => startEdit(t, channel)}>
                {canChange ? "Edit" : "View"}
              </Button>
            </div>
          </div>
        );
      })}
      {items.length === 0 && <p className="py-8 text-center text-muted-foreground">No templates yet.</p>}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-1rem)] max-w-5xl flex-col gap-3 overflow-hidden p-4 sm:p-6">
        <DialogHeader>
          <div className="flex items-center gap-2">
            {onBack && (
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Back to Manage SSAA" onClick={onBack}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <DialogTitle>Correspondence</DialogTitle>
          </div>
          <DialogDescription className="text-left">{EMAIL_NOTE[emailTransport]}</DialogDescription>
        </DialogHeader>

        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v as typeof tab);
            setEditing(null);
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="email" className="gap-2">
              <Mail className="h-4 w-4" /> Email
            </TabsTrigger>
            <TabsTrigger value="push" className="gap-2">
              <Bell className="h-4 w-4" /> Push
            </TabsTrigger>
            <TabsTrigger value="log" className="gap-2">
              <RefreshCw className="h-4 w-4" /> Log
            </TabsTrigger>
          </TabsList>

          <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
            <TabsContent value="email" className="mt-0">
              {editing?.channel === "email" && draft ? (
                <div className="space-y-4">
                  {heading}
                  {description}
                  <div className="space-y-2">
                    <Label htmlFor="tpl-subject">Subject Line</Label>
                    <Input id="tpl-subject" value={draft.subject} disabled={!canChange} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Email Body</Label>
                    <EmailEditor value={draft.bodyHtml} onChange={(html) => setDraft((d) => (d ? { ...d, bodyHtml: html } : d))} placeholders={editing.template.placeholderVariables} />
                  </div>
                  <div className="rounded-md border">
                    <div className="border-b px-4 py-2 text-xs">
                      <div className="text-muted-foreground">Recipient preview (placeholders filled with sample values)</div>
                      <div className="mt-1 font-medium">Subject: {fill(draft.subject, samples)}</div>
                    </div>
                    <div
                      className="max-h-[320px] overflow-y-auto rounded-b-md bg-white p-5 text-sm text-neutral-900 [&_a]:text-blue-700 [&_a]:underline [&_h1]:text-xl [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:ml-5 [&_ol]:list-decimal [&_p]:mb-2 [&_ul]:list-disc"
                      // Preview only: the operator's own template HTML with fixed sample values.
                      dangerouslySetInnerHTML={{ __html: fill(draft.bodyHtml, samples) || '<p style="color:#888;font-style:italic">Empty email</p>' }}
                    />
                  </div>
                  {canChange && (
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Button onClick={() => void saveTemplate()} disabled={busy} className="flex-1">
                        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                        Save Template
                      </Button>
                      <Button variant="outline" onClick={() => void sendTest()} disabled={busy}>
                        <Send className="mr-2 h-4 w-4" />
                        Send test to me
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                list(emailTemplates, "email")
              )}
            </TabsContent>

            <TabsContent value="push" className="mt-0">
              {editing?.channel === "push" && draft ? (
                <div className="space-y-4">
                  {heading}
                  {description}
                  <div className="space-y-2">
                    <Label htmlFor="tpl-push-title">Push Notification Title</Label>
                    <Input
                      id="tpl-push-title"
                      value={draft.pushTitle ?? ""}
                      maxLength={120}
                      disabled={!canChange}
                      onChange={(e) => setDraft({ ...draft, pushTitle: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Insert Placeholder</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {editing.template.placeholderVariables.map((v) => (
                        <button
                          key={v}
                          type="button"
                          disabled={!canChange}
                          onClick={() => insertIntoPush(`{${v}}`)}
                          className="rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 font-mono text-[11px] text-primary hover:bg-primary/10"
                        >
                          {`{${v}}`}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="tpl-push-body">
                      Message Body {editing.template.eventType === "schedule_assigned" ? "(also sent as a message in the person's People chat)" : "(shown under the bell)"}
                    </Label>
                    <Textarea
                      id="tpl-push-body"
                      ref={pushBody}
                      value={draft.pushBody ?? ""}
                      onChange={(e) => setDraft({ ...draft, pushBody: e.target.value })}
                      rows={5}
                      maxLength={1600}
                      disabled={!canChange}
                    />
                    <p className="text-xs text-muted-foreground">{(draft.pushBody ?? "").length}/1600 characters</p>
                  </div>
                  <div className="rounded-md border p-4">
                    <div className="mb-2 text-xs font-medium text-muted-foreground">Live preview</div>
                    <div className="max-w-md rounded-2xl bg-primary/10 px-4 py-3 text-sm">
                      <div className="font-medium">{fill(draft.pushTitle ?? "", samples)}</div>
                      <div className="whitespace-pre-wrap">{fill(draft.pushBody ?? "", samples) || <span className="italic text-muted-foreground">Empty message</span>}</div>
                    </div>
                  </div>
                  {canChange && (
                    <Button onClick={() => void saveTemplate()} disabled={busy} className="w-full">
                      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                      Save Template
                    </Button>
                  )}
                </div>
              ) : (
                list(pushTemplates, "push")
              )}
            </TabsContent>

            <TabsContent value="log" className="mt-0 space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={logSearch} onChange={(e) => setLogSearch(e.target.value)} placeholder="Search recipient, subject or event…" className="pl-9" aria-label="Search the log" />
                </div>
                <div className="grid grid-cols-2 gap-2 sm:flex">
                  <select value={logChannel} onChange={(e) => setLogChannel(e.target.value)} className="h-10 rounded-md border border-input bg-background px-2 text-sm" aria-label="Channel">
                    <option value="">All channels</option>
                    <option value="email">Email</option>
                    <option value="push">Push</option>
                    <option value="chat">Chat</option>
                  </select>
                  <select value={logStatus} onChange={(e) => setLogStatus(e.target.value)} className="h-10 rounded-md border border-input bg-background px-2 text-sm" aria-label="Status">
                    <option value="">Any status</option>
                    <option value="sent">Sent</option>
                    <option value="failed">Failed</option>
                    <option value="skipped">Email not set up</option>
                    <option value="off">Template off</option>
                  </select>
                </div>
                <Button variant="outline" onClick={() => void loadLog()} disabled={logLoading} aria-label="Refresh the log">
                  <RefreshCw className={`h-4 w-4 ${logLoading ? "animate-spin" : ""}`} />
                </Button>
              </div>

              {entries.length === 0 ? (
                <p className="py-10 text-center text-muted-foreground">{logLoading ? "Loading…" : "Nothing sent yet."}</p>
              ) : (
                <>
                  {/* Desktop: Lovable's table. */}
                  <table className="hidden w-full text-sm md:table">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="py-2 pr-3 font-medium">Date</th>
                        <th className="py-2 pr-3 font-medium">Event</th>
                        <th className="py-2 pr-3 font-medium">Channel</th>
                        <th className="py-2 pr-3 font-medium">Recipient</th>
                        <th className="py-2 pr-3 font-medium">Subject</th>
                        <th className="py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((e) => (
                        <tr key={e.id} className="border-b align-top last:border-0">
                          <td className="whitespace-nowrap py-2 pr-3 text-xs">{when(e.createdAt)}</td>
                          <td className="py-2 pr-3 text-xs">{eventLabel(e.eventType)}</td>
                          <td className="py-2 pr-3 text-xs capitalize">{e.channel}</td>
                          <td className="max-w-[200px] py-2 pr-3 text-xs">
                            <div className="truncate">{e.recipientName ?? "—"}</div>
                            <div className="truncate text-muted-foreground">{e.recipientEmail ?? ""}</div>
                          </td>
                          <td className="max-w-[260px] py-2 pr-3 text-xs">
                            <div className="truncate" title={e.body ?? undefined}>
                              {e.subject || e.body || "—"}
                            </div>
                          </td>
                          <td className="py-2">
                            <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[e.status]}`} title={e.errorMessage ?? undefined}>
                              {STATUS_LABEL[e.status]}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {/* Phone: one card per message. */}
                  <ul className="space-y-2 md:hidden">
                    {entries.map((e) => (
                      <li key={e.id} className="rounded-lg border bg-card p-3 text-sm">
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-medium">{eventLabel(e.eventType)}</span>
                          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[e.status]}`}>{STATUS_LABEL[e.status]}</span>
                        </div>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          <span className="capitalize">{e.channel}</span> · {e.recipientName ?? e.recipientEmail ?? "—"}
                        </p>
                        {(e.subject || e.body) && <p className="mt-1 line-clamp-2 text-xs">{e.subject || e.body}</p>}
                        <p className="mt-1 text-[11px] text-muted-foreground">{when(e.createdAt)}</p>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
