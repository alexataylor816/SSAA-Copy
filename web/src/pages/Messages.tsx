import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format, formatDistanceToNow } from "date-fns";
import { ArrowLeft, ChevronDown, Plus, Search, Send } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { messagingApi, useConversations, type ChatMessage, type Contact, type ConversationSummary } from "@/hooks/useMessaging";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
 * the GC; People holds 1:1 DMs. Group chats, contacts and attachments are not
 * ported yet.
 */

type Tab = "projects" | "people";

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

function Thread({ conv, messages, onSend }: { conv: ConversationSummary; messages: ChatMessage[]; onSend: (body: string) => Promise<void> }) {
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
          {conv.type === "dm" && conv.subtitle && <p className="truncate text-xs text-muted-foreground">{conv.subtitle}</p>}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-3 p-4">
          {messages.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">No messages yet. Say hello.</p>
          )}
          {messages.map((m) => {
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

function NewMessageDialog({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (userId: string) => void;
}) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) return;
    setSearch("");
    messagingApi
      .contacts()
      .then((res) => setContacts(res.contacts))
      .catch(() => setContacts([]));
  }, [open]);

  const q = search.trim().toLowerCase();
  const shown = contacts.filter(
    (c) => !q || [c.fullName, c.email, c.companyName ?? ""].some((v) => v.toLowerCase().includes(q)),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New message</DialogTitle>
          <DialogDescription>People in your company and on projects you share.</DialogDescription>
        </DialogHeader>
        <Input placeholder="Search people..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="max-h-72 divide-y overflow-y-auto rounded-md border">
          {shown.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">No one to message yet.</p>
          ) : (
            shown.map((c) => (
              <button key={c.userId} onClick={() => onPick(c.userId)} className="w-full p-3 text-left hover:bg-accent">
                <div className="text-sm font-medium">{c.fullName || c.email}</div>
                <div className="text-xs text-muted-foreground">
                  {c.email}
                  {c.companyName ? ` · ${c.companyName}` : ""}
                </div>
              </button>
            ))
          )}
        </div>
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
  const [newOpen, setNewOpen] = useState(false);
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
      setNewOpen(false);
      const { conversationId } = await messagingApi.openDm(userId);
      await refresh();
      setTab("people");
      await openConversation(conversationId);
    },
    [refresh, openConversation],
  );

  const q = search.trim().toLowerCase();
  const matches = (c: ConversationSummary) =>
    !q || [c.title, c.subtitle ?? "", c.lastMessage?.body ?? ""].some((v) => v.toLowerCase().includes(q));

  const projectConvs = conversations.filter((c) => c.type === "project");
  const peopleConvs = conversations.filter((c) => c.type !== "project");
  const tabUnread = {
    projects: projectConvs.reduce((s, c) => s + c.unreadCount, 0),
    people: peopleConvs.reduce((s, c) => s + c.unreadCount, 0),
  };

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
                  {tab === "projects" ? "Projects" : "People"}
                  <ChevronDown className="ml-2 h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuItem onClick={() => setTab("projects")}>
                  <span className="flex-1">Projects</span>
                  <UnreadBadge count={tabUnread.projects} />
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTab("people")}>
                  <span className="flex-1">People</span>
                  <UnreadBadge count={tabUnread.people} />
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {tab === "people" && (
            <div className="border-b p-3">
              <Button size="sm" className="w-full justify-start" onClick={() => setNewOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                New message
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
            ) : peopleConvs.filter(matches).length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">No conversations yet.</div>
            ) : (
              <div className="divide-y">
                {peopleConvs.filter(matches).map((conv) => (
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
              <Thread conv={active} messages={messages} onSend={handleSend} />
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              Select a conversation to start messaging
            </div>
          )}
        </main>
      </div>

      <NewMessageDialog open={newOpen} onOpenChange={setNewOpen} onPick={(id) => void startDm(id)} />
    </div>
  );
}
