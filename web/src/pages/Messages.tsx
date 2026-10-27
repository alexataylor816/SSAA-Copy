import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { format, isSameDay, isToday, isYesterday, differenceInCalendarDays } from "date-fns";
import { ArrowLeft, Building2, ChevronDown, Search, Send, SquarePen, UserPlus, Users } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  messagingApi,
  setOpenConversation,
  useConversations,
  type ChatMessage,
  type Contact,
  type ConversationSummary,
} from "@/hooks/useMessaging";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import MobileTabBar from "@/components/dashboard/MobileTabBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatDate, formatTime, tr } from "@/i18n/runtime";
import { useLanguage } from "@/contexts/LanguageContext";

/**
 * Messages: a Projects / People / Group Chats picker at the top of the list
 * (as in the original app), project chats grouped like Teams channels under
 * their project, and a thread with avatars, date separators and grouped
 * consecutive messages.
 * Project chats are one private channel per GC/sub pair; group chats are
 * titled chats members can add their contacts to.
 */

type Filter = "projects" | "people" | "groups";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "projects", get label() { return tr("common.projects"); } },
  { key: "people", get label() { return tr("messages.people"); } },
  { key: "groups", get label() { return tr("messages.groupChats"); } },
];

// ---------- small presentational pieces ----------

const AVATAR_TONES = [
  "bg-sky-100 text-sky-800",
  "bg-emerald-100 text-emerald-800",
  "bg-amber-100 text-amber-800",
  "bg-violet-100 text-violet-800",
  "bg-rose-100 text-rose-800",
  "bg-teal-100 text-teal-800",
];

function initialsOf(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function toneOf(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

function Avatar({
  name,
  kind = "person",
  size = "md",
}: {
  name: string;
  kind?: "person" | "group" | "project";
  size?: "sm" | "md";
}) {
  const box = size === "sm" ? "h-8 w-8 text-[11px]" : "h-10 w-10 text-sm";
  if (kind === "group") {
    return (
      <span className={`${box} flex shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary`}>
        <Users className="h-4 w-4" />
      </span>
    );
  }
  if (kind === "project") {
    return (
      <span className={`${box} flex shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground`}>
        <Building2 className="h-4 w-4" />
      </span>
    );
  }
  return (
    <span className={`${box} flex shrink-0 items-center justify-center rounded-full font-semibold ${toneOf(name)}`}>
      {initialsOf(name)}
    </span>
  );
}

/** Teams-style list time: 2:15 PM today, "Yesterday", weekday this week, else Oct 12. */
function listTime(iso: string): string {
  const d = new Date(iso);
  if (isToday(d)) return formatTime(d);
  if (isYesterday(d)) return tr("messages.yesterday");
  if (differenceInCalendarDays(new Date(), d) < 7) return formatDate(d, { weekday: "short" });
  return formatDate(d, { month: "short", day: "numeric" });
}

function dayLabel(d: Date): string {
  if (isToday(d)) return tr("messages.today");
  if (isYesterday(d)) return tr("messages.yesterday");
  return formatDate(d, { weekday: "long", month: "long", day: "numeric" });
}

const UnreadPill = ({ count }: { count: number }) =>
  count > 0 ? (
    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground">
      {count > 99 ? "99+" : count}
    </span>
  ) : null;

function ConversationRow({
  conv,
  label,
  kind,
  active,
  indent,
  onOpen,
}: {
  conv: ConversationSummary;
  label: string;
  kind: "person" | "group" | "project";
  active: boolean;
  indent?: boolean;
  onOpen: () => void;
}) {
  const unread = conv.unreadCount > 0;
  const preview = conv.lastMessage
    ? conv.type !== "dm" && conv.lastMessage.senderName
      ? `${conv.lastMessage.senderName.split(" ")[0]}: ${conv.lastMessage.body}`
      : conv.lastMessage.body
    : tr("messages.noMessagesYet");
  return (
    <button
      onClick={onOpen}
      className={`relative flex w-full items-center gap-3 rounded-md py-2 pr-2 text-left transition-colors ${
        indent ? "pl-9" : "pl-2"
      } ${active ? "bg-primary/10" : "hover:bg-accent"}`}
    >
      {active && <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r bg-primary" aria-hidden />}
      <Avatar name={label} kind={kind} size={indent ? "sm" : "md"} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className={`truncate text-sm ${unread ? "font-semibold" : "font-medium"}`}>{label}</span>
          {conv.lastMessage && (
            <span className={`shrink-0 text-[11px] ${unread ? "font-semibold text-primary" : "text-muted-foreground"}`}>
              {listTime(conv.lastMessage.createdAt)}
            </span>
          )}
        </span>
        <span className="flex items-center justify-between gap-2">
          <span className={`truncate text-xs ${unread ? "text-foreground" : "text-muted-foreground"}`}>{preview}</span>
          <UnreadPill count={conv.unreadCount} />
        </span>
      </span>
    </button>
  );
}

function SectionHeader({ title, open, onToggle, unread }: { title: string; open: boolean; onToggle: () => void; unread?: number }) {
  return (
    <button
      onClick={onToggle}
      className="flex w-full items-center gap-1.5 px-2 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
    >
      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "" : "-rotate-90"}`} />
      <span className="flex-1 text-left">{title}</span>
      {!!unread && <UnreadPill count={unread} />}
    </button>
  );
}

// ---------- members ----------

const LEVEL_LABEL: Record<string, string> = {
  get account_holder() { return tr("messages.levelLabel.accountHolder"); },
  get full() { return tr("messages.levelLabel.full"); },
  get partial() { return tr("messages.levelLabel.partial"); },
  get level_1() { return tr("messages.levelLabel.level1"); },
  get basic() { return tr("messages.levelLabel.basic"); },
};

/** Who is in a group or project chat, grouped by company. Managers only (server-enforced). */
function MembersDialog({ conversationId, onClose }: { conversationId: string | null; onClose: () => void }) {
  const { t } = useLanguage();
  const [members, setMembers] = useState<Contact[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    setMembers(null);
    setError(null);
    messagingApi
      .participants(conversationId)
      .then((res) => !cancelled && setMembers(res.participants))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : tr("messages.couldNotLoadMembers")));
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  const byCompany = new Map<string, Contact[]>();
  for (const m of members ?? []) {
    const key = m.companyName ?? tr("messages.noCompany");
    byCompany.set(key, [...(byCompany.get(key) ?? []), m]);
  }

  return (
    <Dialog open={conversationId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("messages.peopleInThisChat")}{members ? ` (${members.length})` : ""}</DialogTitle>
          <DialogDescription>{t("messages.onlyManagersCanSeeThisList")}</DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !members ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : (
          <div className="max-h-[60vh] space-y-4 overflow-y-auto">
            {[...byCompany.entries()].map(([companyName, people]) => (
              <div key={companyName} className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{companyName}</p>
                <ul className="space-y-1">
                  {people.map((p) => (
                    <li key={p.userId} className="flex items-center gap-3 rounded-md px-1 py-1.5">
                      <Avatar name={p.fullName || p.email} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{p.fullName || p.email}</p>
                        <p className="truncate text-xs text-muted-foreground">{p.email}</p>
                      </div>
                      {p.permissionLevel && (
                        <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                          {LEVEL_LABEL[p.permissionLevel] ?? p.permissionLevel}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------- thread ----------

function Thread({
  conv,
  messages,
  onSend,
  onBack,
  onAddPeople,
  onShowMembers,
}: {
  conv: ConversationSummary;
  messages: ChatMessage[];
  onSend: (body: string) => Promise<void>;
  onBack: () => void;
  onAddPeople?: () => void;
  /** Set only for managers; group and project chats only. */
  onShowMembers?: () => void;
}) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, conv.id]);

  async function send() {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      await onSend(text);
      setBody("");
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("messages.messageNotSent"));
    } finally {
      setSending(false);
    }
  }

  const kind = conv.type === "group" ? "group" : conv.type === "project" ? "project" : "person";
  const subtitle =
    conv.type === "project"
      ? t("messages.projectChatWith", { company: conv.subtitle ?? t("messages.theOtherCompany") })
      : conv.type === "group"
        ? t("messages.groupChat")
        : (conv.subtitle ?? "");

  return (
    <>
      <div className="flex items-center gap-3 border-b bg-card px-3 py-2.5 md:px-4">
        <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8 md:hidden" aria-label={t("messages.backToChats")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Avatar name={conv.title} kind={kind} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold leading-tight">{conv.title}</h2>
          {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {conv.type !== "dm" && onShowMembers && (
            <Button size="sm" variant="ghost" onClick={onShowMembers} aria-label={t("messages.peopleInThisChat")}>
              <Users className="h-4 w-4 sm:mr-1.5" />
              <span className="hidden sm:inline">{t("messages.people")}</span>
            </Button>
          )}
          {conv.type === "group" && onAddPeople && (
            <Button size="sm" variant="ghost" onClick={onAddPeople} aria-label={t("messages.addPeople")}>
              <UserPlus className="h-4 w-4 sm:mr-1.5" />
              <span className="hidden sm:inline">{t("common.add")}</span>
            </Button>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1 bg-muted/20">
        <div className="mx-auto max-w-3xl space-y-0.5 px-3 py-4 md:px-6">
          {messages.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <Avatar name={conv.title} kind={kind} />
              <p className="text-sm font-medium">{conv.title}</p>
              <p className="text-sm text-muted-foreground">{t("messages.noMessagesYetSayHello")}</p>
            </div>
          )}
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const at = new Date(m.createdAt);
            const newDay = !prev || !isSameDay(new Date(prev.createdAt), at);
            const separator = newDay ? (
              <div key={`${m.id}-day`} className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                {dayLabel(at)}
                <span className="h-px flex-1 bg-border" />
              </div>
            ) : null;

            if (m.kind === "system") {
              return (
                <div key={m.id}>
                  {separator}
                  <p className="py-1 text-center text-xs text-muted-foreground">{m.body}</p>
                </div>
              );
            }

            const mine = m.senderUserId === user?.id;
            // Like Teams: a run of messages from one person within 5 minutes shares one header.
            const continued =
              !newDay &&
              prev &&
              prev.kind !== "system" &&
              prev.senderUserId === m.senderUserId &&
              at.getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000;

            if (mine) {
              return (
                <div key={m.id}>
                  {separator}
                  <div className={`flex justify-end ${continued ? "mt-0.5" : "mt-3"}`}>
                    <div className="max-w-[80%] rounded-lg bg-primary/10 px-3 py-2 md:max-w-[70%]">
                      {!continued && <div className="mb-0.5 text-right text-[11px] text-muted-foreground">{formatTime(at)}</div>}
                      <div className="whitespace-pre-wrap break-words text-sm">{m.body}</div>
                    </div>
                  </div>
                </div>
              );
            }
            return (
              <div key={m.id}>
                {separator}
                <div className={`flex items-start gap-2 ${continued ? "mt-0.5" : "mt-3"}`}>
                  <span className="w-8 shrink-0">{!continued && <Avatar name={m.senderName ?? t("messages.user")} size="sm" />}</span>
                  <div className="max-w-[80%] rounded-lg border bg-card px-3 py-2 shadow-sm md:max-w-[70%]">
                    {!continued && (
                      <div className="mb-0.5 flex flex-wrap items-baseline gap-x-2 text-[11px]">
                        <span className="font-semibold text-foreground">{m.senderName ?? t("messages.user")}</span>
                        {conv.type !== "dm" && m.senderCompanyName && (
                          <span className="text-muted-foreground">{m.senderCompanyName}</span>
                        )}
                        <span className="text-muted-foreground">{formatTime(at)}</span>
                      </div>
                    )}
                    <div className="whitespace-pre-wrap break-words text-sm">{m.body}</div>
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>
      </ScrollArea>

      {conv.canPost ? (
        <div className="border-t bg-card p-3">
          {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
          <div className="mx-auto flex max-w-3xl items-center gap-2 rounded-lg border bg-background px-2 py-1 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary">
            <Input
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t("messages.typeAMessage")}
              aria-label={t("messages.message")}
              className="border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <Button
              size="icon"
              variant="ghost"
              onClick={() => void send()}
              disabled={sending || !body.trim()}
              aria-label={t("common.send")}
              className="h-8 w-8 shrink-0 text-primary"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="border-t bg-card p-3 text-center text-xs text-muted-foreground">
          
          {t("messages.youCanReadThisProjectChat")}
        </div>
      )}
    </>
  );
}

// ---------- new chat / add people ----------

type PickerMode = "new" | "add";

/**
 * Teams' "New chat": pick one person for a direct chat, or several for a
 * group (with a name). Also used to add people to an existing group.
 */
function PeoplePicker({
  mode,
  onClose,
  exclude = [],
  onPick,
  onCreateGroup,
}: {
  mode: PickerMode | null;
  onClose: () => void;
  exclude?: string[];
  onPick: (userId: string) => void;
  onCreateGroup: (title: string, userIds: string[]) => Promise<void>;
}) {
  const { t } = useLanguage();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState("");
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mode) return;
    setSearch("");
    setTitle("");
    setPicked([]);
    setError(null);
    messagingApi
      .contacts()
      .then((res) => setContacts(res.contacts))
      .catch(() => setContacts([]));
  }, [mode]);

  const q = search.trim().toLowerCase();
  const shown = contacts.filter(
    (c) => !exclude.includes(c.userId) && (!q || [c.fullName, c.email, c.companyName ?? ""].some((v) => v.toLowerCase().includes(q))),
  );
  const nameOf = (id: string) => {
    const c = contacts.find((x) => x.userId === id);
    return (c?.fullName || c?.email || "").split(" ")[0];
  };
  const defaultTitle = picked.slice(0, 3).map(nameOf).join(", ") + (picked.length > 3 ? ` +${picked.length - 3}` : "");

  async function start() {
    if (picked.length === 1) return onPick(picked[0]);
    setBusy(true);
    setError(null);
    try {
      await onCreateGroup(title.trim() || defaultTitle, picked);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("messages.couldNotCreateGroup"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={mode !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "add" ? t("messages.addPeople") : t("messages.newChat")}</DialogTitle>
          <DialogDescription>
            {mode === "add"
              ? t("messages.peopleInYourCompanyAndOn")
              : t("messages.pickOnePersonForADirect")}
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder={t("messages.searchPeople")} value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
        {mode === "new" && picked.length > 1 && (
          <Input
            placeholder={t("messages.groupNameOptional", { defaultTitle: defaultTitle })}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label={t("messages.groupName")}
          />
        )}
        <div className="max-h-72 space-y-0.5 overflow-y-auto">
          {shown.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">
              {mode === "add" ? t("messages.everyoneYouWorkWithIsAlready") : t("messages.noOneToMessageYet")}
            </p>
          ) : (
            shown.map((c) => {
              const details = (
                <>
                  <Avatar name={c.fullName || c.email} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{c.fullName || c.email}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {c.companyName ?? c.email}
                    </span>
                  </span>
                </>
              );
              return mode === "new" ? (
                <label key={c.userId} className="flex cursor-pointer items-center gap-3 rounded-md p-2 hover:bg-accent">
                  <Checkbox
                    checked={picked.includes(c.userId)}
                    onCheckedChange={(value) =>
                      setPicked((prev) => (value ? [...prev, c.userId] : prev.filter((id) => id !== c.userId)))
                    }
                  />
                  {details}
                </label>
              ) : (
                <button
                  key={c.userId}
                  onClick={() => onPick(c.userId)}
                  className="flex w-full items-center gap-3 rounded-md p-2 text-left hover:bg-accent"
                >
                  {details}
                </button>
              );
            })
          )}
        </div>
        {mode === "new" && (
          <>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button disabled={busy || picked.length === 0} onClick={() => void start()}>
              {picked.length <= 1 ? t("messages.startChat") : t("messages.startGroupChatPeople", { count: picked.length + 1 })}
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------- page ----------

export default function Messages() {
  const { t } = useLanguage();
  const { user, hasPartialOrHigher, isMOA } = useAuth();
  // Managers see who is in a chat; the server enforces the same rule.
  const canSeeMembers = hasPartialOrHigher || isMOA;
  const [filter, setFilter] = useState<Filter>("projects");
  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [membersOf, setMembersOf] = useState<string | null>(null);
  const [picker, setPicker] = useState<PickerMode | null>(null);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeId;

  // A message for the open thread is appended in place and marked read.
  const onMessage = useCallback((message: ChatMessage) => {
    if (message.conversationId !== activeRef.current) return;
    setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
    void messagingApi.markRead(message.conversationId);
  }, []);

  const { conversations, loading, refresh } = useConversations(onMessage);

  const openConversation = useCallback(async (id: string) => {
    setActiveId(id);
    setMessages([]);
    try {
      const res = await messagingApi.messages(id);
      if (activeRef.current === id) setMessages(res.messages);
      await messagingApi.markRead(id);
    } catch {
      setMessages([]);
    }
  }, []);

  // New-message alerts (MessageAlerts) stay quiet for whatever is open here.
  useEffect(() => {
    setOpenConversation(activeId);
    return () => setOpenConversation(null);
  }, [activeId]);

  // An alert's "Open" button links to /messages?c=<conversation id>.
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedId = searchParams.get("c");
  useEffect(() => {
    if (!linkedId || loading) return;
    void openConversation(linkedId);
    setSearchParams({}, { replace: true });
  }, [linkedId, loading, openConversation, setSearchParams]);

  const active = conversations.find((c) => c.id === activeId) ?? null;

  const handleSend = useCallback(
    async (body: string) => {
      if (!activeId) return;
      const res = await messagingApi.send(activeId, body);
      setMessages((prev) => (prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]));
    },
    [activeId],
  );

  const startDm = useCallback(
    async (userId: string) => {
      setPicker(null);
      const { conversationId } = await messagingApi.openDm(userId);
      await refresh();
      await openConversation(conversationId);
    },
    [refresh, openConversation],
  );

  const createGroup = useCallback(
    async (title: string, userIds: string[]) => {
      const { conversationId } = await messagingApi.createGroup(title, userIds);
      setPicker(null);
      await refresh();
      await openConversation(conversationId);
    },
    [refresh, openConversation],
  );

  const openAddPeople = useCallback(async () => {
    if (!activeId) return;
    // Crew can't read the member list; the server still refuses duplicates.
    const res = await messagingApi.participants(activeId).catch(() => ({ participants: [] as Contact[] }));
    setMemberIds(res.participants.map((p) => p.userId));
    setPicker("add");
  }, [activeId]);

  const addPerson = useCallback(
    async (userId: string) => {
      if (!activeId) return;
      setPicker(null);
      const res = await messagingApi.addParticipant(activeId, userId);
      setMessages((prev) => (prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]));
      await refresh();
    },
    [activeId, refresh],
  );

  // ---------- list ----------
  const q = search.trim().toLowerCase();
  const visible = (c: ConversationSummary) =>
    !q || [c.title, c.subtitle ?? "", c.lastMessage?.body ?? ""].some((v) => v.toLowerCase().includes(q));
  const unreadOf = (list: ConversationSummary[]) => list.reduce((s, c) => s + c.unreadCount, 0);

  const projectConvs = conversations.filter((c) => c.type === "project");
  const chatConvs = conversations
    .filter((c) => c.type !== "project")
    .sort((a, b) => (b.lastMessage?.createdAt ?? b.lastMessageAt).localeCompare(a.lastMessage?.createdAt ?? a.lastMessageAt));

  const chipUnread: Record<Filter, number> = {
    projects: unreadOf(projectConvs),
    people: unreadOf(chatConvs.filter((c) => c.type === "dm")),
    groups: unreadOf(chatConvs.filter((c) => c.type === "group")),
  };

  const showProjects = filter === "projects";
  const showChats = filter !== "projects";
  const chats = chatConvs.filter((c) => visible(c) && (filter === "people" ? c.type === "dm" : c.type === "group"));

  // Like Teams channels: the GC sees each project with a channel per sub; a sub sees one row per project.
  const projectGroups = (() => {
    const groups = new Map<string, { projectId: string; name: string; owned: boolean; convs: ConversationSummary[] }>();
    for (const c of projectConvs.filter(visible)) {
      const key = c.projectId ?? c.id;
      const owned = c.subCompanyId !== user?.companyId;
      const group = groups.get(key) ?? { projectId: key, name: c.title, owned, convs: [] };
      group.convs.push(c);
      groups.set(key, group);
    }
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  })();

  const toggle = (key: string) => setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  const nothing = !loading && (!showProjects || projectGroups.length === 0) && (!showChats || chats.length === 0);
  const showRail = !activeId;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <DashboardHeader />
      <div className="flex min-h-0 flex-1">
        <aside className={`${showRail ? "flex" : "hidden"} w-full flex-col border-r bg-card md:flex md:w-[340px]`}>
          <div className="space-y-3 border-b p-3">
            <div className="flex items-center justify-between">
              <h1 className="text-lg font-semibold">Chat</h1>
              <Button size="icon" variant="ghost" onClick={() => setPicker("new")} aria-label={t("messages.newChat")} title={t("messages.newChat")}>
                <SquarePen className="h-5 w-5" />
              </Button>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder={t("messages.searchChats")} value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 pl-8" />
            </div>
            {/* The original app's picker: one list at a time, with each list's unread count. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full justify-between" aria-label={t("messages.chooseChatList")}>
                  <span className="flex items-center gap-2">
                    {FILTERS.find((f) => f.key === filter)?.label}
                    {chipUnread[filter] > 0 && <UnreadPill count={chipUnread[filter]} />}
                  </span>
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[--radix-dropdown-menu-trigger-width]">
                {FILTERS.map(({ key, label }) => (
                  <DropdownMenuItem key={key} onClick={() => setFilter(key)}>
                    <span className="flex-1">{label}</span>
                    {chipUnread[key] > 0 && <UnreadPill count={chipUnread[key]} />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <ScrollArea className="flex-1">
            <div className="px-2 pb-3">
              {loading ? (
                <div className="p-6 text-center text-sm text-muted-foreground">{t("common.loading")}</div>
              ) : nothing ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  {q
                      ? t("messages.noChatsMatchThatSearch")
                      : filter === "projects"
                        ? t("messages.noProjectChatsYetTheyAppear")
                        : t("messages.noChatsYetStartOneWith")}
                </div>
              ) : (
                <>
                  {showProjects && projectGroups.length > 0 && (
                    <>
                      <SectionHeader
                        title={t("common.projects")}
                        open={!collapsed.__projects}
                        onToggle={() => toggle("__projects")}
                        unread={unreadOf(projectGroups.flatMap((g) => g.convs))}
                      />
                      {!collapsed.__projects &&
                        projectGroups.map((group) => {
                          if (!group.owned) {
                            const conv = group.convs[0];
                            return (
                              <ConversationRow
                                key={group.projectId}
                                conv={conv}
                                label={conv.title}
                                kind="project"
                                active={activeId === conv.id}
                                onOpen={() => void openConversation(conv.id)}
                              />
                            );
                          }
                          const open = !collapsed[group.projectId];
                          return (
                            <div key={group.projectId}>
                              <button
                                onClick={() => toggle(group.projectId)}
                                className="flex w-full items-center gap-3 rounded-md py-2 pl-2 pr-2 text-left hover:bg-accent"
                              >
                                <Avatar name={group.name} kind="project" />
                                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{group.name}</span>
                                <UnreadPill count={unreadOf(group.convs)} />
                                <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`} />
                              </button>
                              {open &&
                                group.convs.map((conv) => (
                                  <ConversationRow
                                    key={conv.id}
                                    conv={conv}
                                    label={conv.subtitle ?? t("common.subcontractor")}
                                    kind="person"
                                    indent
                                    active={activeId === conv.id}
                                    onOpen={() => void openConversation(conv.id)}
                                  />
                                ))}
                            </div>
                          );
                        })}
                    </>
                  )}

                  {showChats && chats.length > 0 && (
                    <>
                      <SectionHeader
                        title={filter === "people" ? t("messages.people") : t("messages.groupChats")}
                        open={!collapsed.__chats}
                        onToggle={() => toggle("__chats")}
                        unread={unreadOf(chats)}
                      />
                      {!collapsed.__chats &&
                        chats.map((conv) => (
                          <ConversationRow
                            key={conv.id}
                            conv={conv}
                            label={conv.title}
                            kind={conv.type === "group" ? "group" : "person"}
                            active={activeId === conv.id}
                            onOpen={() => void openConversation(conv.id)}
                          />
                        ))}
                    </>
                  )}
                </>
              )}
            </div>
          </ScrollArea>
        </aside>

        <main className={`${showRail ? "hidden" : "flex"} min-w-0 flex-1 flex-col md:flex`}>
          {active ? (
            <Thread
              conv={active}
              messages={messages}
              onSend={handleSend}
              onBack={() => setActiveId(null)}
              onAddPeople={() => void openAddPeople()}
              onShowMembers={canSeeMembers ? () => setMembersOf(active.id) : undefined}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-muted/20 p-6 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                <SquarePen className="h-6 w-6" />
              </span>
              <p className="font-medium">{t("messages.pickAChatOrStartA")}</p>
              <Button variant="outline" onClick={() => setPicker("new")}>
                
                {t("messages.newChat")}
              </Button>
            </div>
          )}
        </main>
      </div>
      {/* Hidden while a chat is open on a phone, like other messengers, so the reply box sits at the bottom. */}
      {showRail && <MobileTabBar />}

      <MembersDialog conversationId={membersOf} onClose={() => setMembersOf(null)} />

      <PeoplePicker
        mode={picker}
        onClose={() => setPicker(null)}
        exclude={picker === "add" ? memberIds : []}
        onPick={(id) => void (picker === "add" ? addPerson(id) : startDm(id))}
        onCreateGroup={createGroup}
      />
    </div>
  );
}
