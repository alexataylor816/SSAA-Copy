import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { format, formatDistanceToNow } from "date-fns";
import { ArrowLeft, ChevronDown, Plus, Search, Send, UserPlus } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Port of Lovable's Messages page (MessagesView + ConversationThread). Project
 * chats are one private channel per GC/sub pair, grouped under the project for
 * the GC; People holds 1:1 DMs; Group Chats are titled chats anyone can add
 * their contacts to. The contacts book and attachments are not ported yet.
 */

type Tab = "projects" | "people" | "groups";

const TAB_LABEL: Record<Tab, string> = { projects: "Projects", people: "People", groups: "Group Chats" };

const UnreadBadge = ({ count }: { count: number }) =>
  count > 0 ? (
    <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
      {count}
    </span>
  ) : null;

function ConversationRow({
  conv,
  label,
  active,
  indent,
  onOpen,
}: {
  conv: ConversationSummary;
  label: string;
  active: boolean;
  indent?: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      className={`w-full text-left transition-colors hover:bg-accent ${indent ? "border-t py-2 pl-9 pr-3" : "p-3"} ${
        active ? "bg-accent" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className={`truncate text-sm ${indent ? "" : "font-medium"}`}>{label}</div>
          <div className="truncate text-xs text-muted-foreground">{conv.lastMessage?.body ?? ""}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          {conv.lastMessage && (
            <span className="whitespace-nowrap text-[10px] text-muted-foreground">
              {formatDistanceToNow(new Date(conv.lastMessage.createdAt))}
            </span>
          )}
          <UnreadBadge count={conv.unreadCount} />
        </div>
      </div>
    </button>
  );
}

function Thread({
  conv,
  messages,
  onSend,
  onAddPeople,
}: {
  conv: ConversationSummary;
  messages: ChatMessage[];
  onSend: (body: string) => Promise<void>;
  onAddPeople?: () => void;
}) {
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
      setError(err instanceof Error ? err.message : "Message not sent.");
    } finally {
      setSending(false);
    }
  }

  const label = conv.type === "project" && conv.subtitle ? `${conv.title} — ${conv.subtitle}` : conv.title;

  return (
    <>
      <div className="flex items-center justify-between border-b bg-card px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate font-semibold">{label}</h2>
          {conv.type !== "project" && conv.subtitle && <p className="truncate text-xs text-muted-foreground">{conv.subtitle}</p>}
        </div>
        {conv.type === "group" && onAddPeople && (
          <Button size="sm" variant="ghost" onClick={onAddPeople}>
            <UserPlus className="mr-1 h-4 w-4" /> Add
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-3 p-4">
          {messages.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">No messages yet. Say hello.</p>
          )}
          {messages.map((m) => {
            if (m.kind === "system") {
              return (
                <p key={m.id} className="text-center text-xs text-muted-foreground">
                  {m.body} · {format(new Date(m.createdAt), "MMM d h:mm a")}
                </p>
              );
            }
            const mine = m.senderUserId === user?.id;
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[75%] rounded-lg px-3 py-2 ${mine ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                  {!mine && (
                    <div className="mb-1 text-xs font-semibold opacity-80">
                      {m.senderName ?? "User"}
                      {conv.type === "project" && m.senderCompanyName && (
                        <span className="font-normal opacity-70"> · {m.senderCompanyName}</span>
                      )}
                    </div>
                  )}
                  <div className="whitespace-pre-wrap break-words text-sm">{m.body}</div>
                  <div className="mt-1 text-[10px] opacity-60">{format(new Date(m.createdAt), "MMM d h:mm a")}</div>
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
          <div className="flex items-center gap-2">
            <Input
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Type a message..."
              aria-label="Message"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <Button onClick={() => void send()} disabled={sending || !body.trim()} aria-label="Send">
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="border-t bg-card p-3 text-center text-xs text-muted-foreground">
          You have view-only access to this project chat.
        </div>
      )}
    </>
  );
}

type PickerMode = "dm" | "group" | "add";

/** NewMessageModal (DM or new group) and GroupAddParticipantModal in one picker. */
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

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await onCreateGroup(title.trim(), picked);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the group.");
    } finally {
      setBusy(false);
    }
  }

  const heading = mode === "group" ? "New group chat" : mode === "add" ? "Add people" : "New message";

  return (
    <Dialog open={mode !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{heading}</DialogTitle>
          <DialogDescription>People in your company and on projects you share.</DialogDescription>
        </DialogHeader>
        {mode === "group" && (
          <Input placeholder="Group name, e.g. Level 2 crew" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Group name" />
        )}
        <Input placeholder="Search people..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="max-h-72 divide-y overflow-y-auto rounded-md border">
          {shown.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">
              {mode === "add" ? "Everyone you work with is already in this group." : "No one to message yet."}
            </p>
          ) : (
            shown.map((c) => {
              const details = (
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{c.fullName || c.email}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {c.email}
                    {c.companyName ? ` · ${c.companyName}` : ""}
                  </div>
                </div>
              );
              return mode === "group" ? (
                <label key={c.userId} className="flex cursor-pointer items-center gap-3 p-3 hover:bg-accent">
                  <Checkbox
                    checked={picked.includes(c.userId)}
                    onCheckedChange={(value) =>
                      setPicked((prev) => (value ? [...prev, c.userId] : prev.filter((id) => id !== c.userId)))
                    }
                  />
                  {details}
                </label>
              ) : (
                <button key={c.userId} onClick={() => onPick(c.userId)} className="w-full p-3 text-left hover:bg-accent">
                  {details}
                </button>
              );
            })
          )}
        </div>
        {mode === "group" && (
          <>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button disabled={busy || !title.trim() || picked.length === 0} onClick={() => void create()}>
              Create group{picked.length > 0 ? ` (${picked.length + 1} people)` : ""}
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Messages() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("projects");
  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [picker, setPicker] = useState<PickerMode | null>(null);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeId;

  // A message for the open thread is appended in place and marked read.
  const onMessage = useCallback((message: ChatMessage) => {
    if (message.conversationId !== activeRef.current) return;
    setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
    void messagingApi.markRead(message.conversationId);
  }, []);

  const { conversations, loading, refresh } = useConversations(onMessage);

  const openConversation = useCallback(
    async (id: string) => {
      setActiveId(id);
      setMessages([]);
      try {
        const res = await messagingApi.messages(id);
        if (activeRef.current === id) setMessages(res.messages);
        await messagingApi.markRead(id);
      } catch {
        setMessages([]);
      }
    },
    [],
  );

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
    const linked = conversations.find((c) => c.id === linkedId);
    setTab(linked?.type === "project" ? "projects" : linked?.type === "group" ? "groups" : "people");
    void openConversation(linkedId);
    setSearchParams({}, { replace: true });
  }, [linkedId, loading, conversations, openConversation, setSearchParams]);

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
      setTab("people");
      await openConversation(conversationId);
    },
    [refresh, openConversation],
  );

  const createGroup = useCallback(
    async (title: string, userIds: string[]) => {
      const { conversationId } = await messagingApi.createGroup(title, userIds);
      setPicker(null);
      await refresh();
      setTab("groups");
      await openConversation(conversationId);
    },
    [refresh, openConversation],
  );

  const openAddPeople = useCallback(async () => {
    if (!activeId) return;
    const res = await messagingApi.participants(activeId);
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

  const q = search.trim().toLowerCase();
  const matches = (c: ConversationSummary) =>
    !q || [c.title, c.subtitle ?? "", c.lastMessage?.body ?? ""].some((v) => v.toLowerCase().includes(q));

  const projectConvs = conversations.filter((c) => c.type === "project");
  const peopleConvs = conversations.filter((c) => c.type === "dm");
  const groupConvs = conversations.filter((c) => c.type === "group");
  const tabUnread: Record<Tab, number> = {
    projects: projectConvs.reduce((s, c) => s + c.unreadCount, 0),
    people: peopleConvs.reduce((s, c) => s + c.unreadCount, 0),
    groups: groupConvs.reduce((s, c) => s + c.unreadCount, 0),
  };
  const listConvs = tab === "groups" ? groupConvs : peopleConvs;

  // The GC sees each project as a group with a channel per sub; a sub sees one row per project.
  const projectGroups = (() => {
    const groups = new Map<string, { projectId: string; name: string; owned: boolean; convs: ConversationSummary[] }>();
    for (const c of projectConvs.filter(matches)) {
      const key = c.projectId ?? c.id;
      const owned = c.subCompanyId !== user?.companyId;
      const group = groups.get(key) ?? { projectId: key, name: c.title, owned, convs: [] };
      group.convs.push(c);
      groups.set(key, group);
    }
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  })();

  const showRail = !activeId;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <DashboardHeader />
      <div className="flex min-h-0 flex-1">
        <aside className={`${showRail ? "flex" : "hidden"} w-full flex-col border-r bg-card md:flex md:w-80`}>
          <div className="flex items-center gap-2 border-b p-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")} className="h-8 w-8" aria-label="Back to dashboard">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="flex-1 justify-between">
                  {TAB_LABEL[tab]}
                  <ChevronDown className="ml-2 h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                {(Object.keys(TAB_LABEL) as Tab[]).map((key) => (
                  <DropdownMenuItem key={key} onClick={() => setTab(key)}>
                    <span className="flex-1">{TAB_LABEL[key]}</span>
                    <UnreadBadge count={tabUnread[key]} />
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {tab !== "projects" && (
            <div className="border-b p-3">
              <Button size="sm" className="w-full justify-start" onClick={() => setPicker(tab === "groups" ? "group" : "dm")}>
                <Plus className="mr-2 h-4 w-4" />
                {tab === "groups" ? "New group chat" : "New message"}
              </Button>
            </div>
          )}

          <div className="border-b p-3">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={`Search ${tab}...`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 pl-8"
              />
            </div>
          </div>

          <ScrollArea className="flex-1">
            {loading ? (
              <div className="p-6 text-center text-sm text-muted-foreground">Loading...</div>
            ) : tab === "projects" ? (
              projectGroups.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  No project chats yet. They appear once a subcontractor connects to a project.
                </div>
              ) : (
                <div className="divide-y">
                  {projectGroups.map((group) => {
                    if (!group.owned) {
                      const conv = group.convs[0];
                      return (
                        <ConversationRow
                          key={group.projectId}
                          conv={conv}
                          label={conv.title}
                          active={activeId === conv.id}
                          onOpen={() => void openConversation(conv.id)}
                        />
                      );
                    }
                    const open = expanded[group.projectId] ?? true;
                    const unread = group.convs.reduce((s, c) => s + c.unreadCount, 0);
                    return (
                      <div key={group.projectId}>
                        <button
                          onClick={() => setExpanded((prev) => ({ ...prev, [group.projectId]: !open }))}
                          className="flex w-full items-center gap-2 p-3 text-left transition-colors hover:bg-accent"
                        >
                          <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "" : "-rotate-90"}`} />
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">{group.name}</span>
                          <UnreadBadge count={unread} />
                        </button>
                        {open &&
                          group.convs.map((conv) => (
                            <ConversationRow
                              key={conv.id}
                              conv={conv}
                              label={conv.subtitle ?? "Subcontractor"}
                              active={activeId === conv.id}
                              indent
                              onOpen={() => void openConversation(conv.id)}
                            />
                          ))}
                      </div>
                    );
                  })}
                </div>
              )
            ) : listConvs.filter(matches).length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                {tab === "groups" ? "No group chats yet." : "No conversations yet."}
              </div>
            ) : (
              <div className="divide-y">
                {listConvs.filter(matches).map((conv) => (
                  <ConversationRow
                    key={conv.id}
                    conv={conv}
                    label={conv.title}
                    active={activeId === conv.id}
                    onOpen={() => void openConversation(conv.id)}
                  />
                ))}
              </div>
            )}
          </ScrollArea>
        </aside>

        <main className={`${showRail ? "hidden" : "flex"} min-w-0 flex-1 flex-col md:flex`}>
          {active ? (
            <>
              <div className="flex items-center gap-2 border-b bg-card px-2 py-2 md:hidden">
                <Button variant="ghost" size="icon" onClick={() => setActiveId(null)} className="h-8 w-8">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <span className="truncate text-sm font-medium">Back to conversations</span>
              </div>
              <Thread conv={active} messages={messages} onSend={handleSend} onAddPeople={() => void openAddPeople()} />
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              Select a conversation to start messaging
            </div>
          )}
        </main>
      </div>

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
