import { useState, useMemo, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChevronDown, Search, Plus, Users, ArrowLeft, BookUser } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useConversations, markRead, type Conversation } from '@/hooks/useMessaging';
import ConversationThread from './ConversationThread';
import ContactsModal from './ContactsModal';
import NewMessageModal from './NewMessageModal';
import { formatDistanceToNow } from 'date-fns';

interface Project { id: string; name: string; company_id?: string | null }

interface Props {
  onBack: () => void;
  projects: Project[];
  effectiveUserId?: string | null;
  effectiveCompanyId?: string | null;
  impersonating?: boolean;
  impersonatedPermissionLevel?: string | null;
  effectiveCompanyType?: 'gc' | 'sub' | null;
  identityResolved?: boolean;
  identityError?: string | null;
}

type Tab = 'projects' | 'people' | 'groups';

export default function MessagesView({
  onBack,
  projects,
  effectiveUserId,
  effectiveCompanyId,
  impersonating = false,
  impersonatedPermissionLevel = null,
  effectiveCompanyType = null,
  identityResolved = false,
  identityError = null,
}: Props) {
  const { user: authUser, profile, permissionLevel, isMOA } = useAuth();
  const isMobile = useIsMobile();
  const viewerId = effectiveUserId ?? authUser?.id ?? null;
  const user = viewerId ? ({ id: viewerId } as { id: string }) : null;
  const { conversations, lastMessages, unreadByConv, refresh } = useConversations(viewerId);
  const [activeTab, setActiveTab] = useState<Tab>('projects');
  const [activeConv, setActiveConv] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [contactsOpen, setContactsOpen] = useState(false);
  const [newMsgOpen, setNewMsgOpen] = useState(false);
  const [participantNames, setParticipantNames] = useState<Record<string, string>>({});

  // Deep link from a push notification: /messages?conversation=<id> opens that thread.
  useEffect(() => {
    const convId = new URLSearchParams(window.location.search).get('conversation');
    if (!convId) return;
    const match = conversations.find((c) => c.id === convId);
    if (!match) return;
    setActiveConv(convId);
    setActiveTab(match.type === 'project' ? 'projects' : match.type === 'group' ? 'groups' : 'people');
  }, [conversations]);




  // Company identity is resolved by the page before project ownership is classified.
  const viewerCompanyId = effectiveCompanyId ?? profile?.company_id ?? null;
  const companyType = effectiveCompanyType;

  // All permission levels can VIEW project chats. Subs at 'basic' are read-only.
  const canPostInProject = useMemo(() => {
    const level = impersonating ? impersonatedPermissionLevel : permissionLevel;
    if (!impersonating && isMOA) return true;
    if (companyType === 'sub' && (level === 'basic' || level === 'standard')) return false;
    return true;
  }, [companyType, permissionLevel, isMOA, impersonating, impersonatedPermissionLevel]);

  // For DM/group: resolve "other participant" names for labels
  useEffect(() => {
    const dmGroupConvs = conversations.filter((c) => c.type !== 'project');
    if (dmGroupConvs.length === 0 || !user) return;
    const ids = dmGroupConvs.map((c) => c.id);
    supabase
      .from('conversation_participants')
      .select('conversation_id, user_id')
      .in('conversation_id', ids)
      .then(async ({ data }) => {
        if (!data) return;
        const otherUserIds = Array.from(new Set(data.filter((p) => p.user_id !== user.id).map((p) => p.user_id)));
        if (otherUserIds.length === 0) return;
        const { data: profs } = await supabase
          .from('profiles')
          .select('user_id, full_name, email')
          .in('user_id', otherUserIds);
        const nameByUser: Record<string, string> = {};
        (profs || []).forEach((p) => {
          nameByUser[p.user_id] = p.full_name || p.email;
        });
        const labelByConv: Record<string, string> = {};
        dmGroupConvs.forEach((c) => {
          const others = data.filter((p) => p.conversation_id === c.id && p.user_id !== user.id);
          if (c.type === 'group') {
            labelByConv[c.id] = c.title || others.map((o) => nameByUser[o.user_id] || '').filter(Boolean).join(', ');
          } else {
            labelByConv[c.id] = others.map((o) => nameByUser[o.user_id] || 'Unknown').join(', ');
          }
        });
        setParticipantNames(labelByConv);
      });
  }, [conversations, user]);

  // Project conversations keyed by `${project_id}:${sub_company_id}`
  const convByProjectSub = useMemo(() => {
    const m: Record<string, Conversation> = {};
    conversations.forEach((c) => {
      if (c.type === 'project' && c.project_id) {
        m[`${c.project_id}:${(c as any).sub_company_id || ''}`] = c;
      }
    });
    return m;
  }, [conversations]);

  const myCompanyId = viewerCompanyId;

  // Only GC / Guest GC companies get the per-subcontractor drill-down.
  const isOwnerViewer = companyType === 'gc';

  // Connected companies per owned project (for the GC/Guest drill-down)
  const [connByProject, setConnByProject] = useState<Record<string, { companyId: string; name: string }[]>>({});
  useEffect(() => {
    const ownedIds = projects.filter((p) => p.company_id && p.company_id === myCompanyId).map((p) => p.id);
    if (ownedIds.length === 0 || !myCompanyId) { setConnByProject({}); return; }
    let cancelled = false;
    (async () => {
      const [{ data: pcs }, { data: guestLinks }] = await Promise.all([
        supabase
          .from('project_connections')
          .select('project_id, sub_company_id')
          .in('project_id', ownedIds),
        supabase
          .from('guest_project_connections')
          .select('guest_company_id, sub_company_id')
          .or(`guest_company_id.eq.${myCompanyId},sub_company_id.eq.${myCompanyId}`),
      ]);
      const rows = (pcs as any[]) || [];
      // Guest GC links are company-to-company: apply the partner to every owned project.
      ((guestLinks as any[]) || []).forEach((g) => {
        const partner = g.guest_company_id === myCompanyId ? g.sub_company_id : g.guest_company_id;
        if (!partner || partner === myCompanyId) return;
        ownedIds.forEach((pid) => rows.push({ project_id: pid, sub_company_id: partner }));
      });
      // Include companies that already have a chat for the project (e.g. guest links)
      conversations.forEach((c: any) => {
        if (c.type === 'project' && c.project_id && c.sub_company_id && ownedIds.includes(c.project_id)) {
          rows.push({ project_id: c.project_id, sub_company_id: c.sub_company_id });
        }
      });
      const companyIds = Array.from(new Set(rows.map((r) => r.sub_company_id).filter(Boolean)));
      const nameById: Record<string, string> = {};
      if (companyIds.length > 0) {
        const { data: comps } = await supabase.from('companies').select('id, name').in('id', companyIds);
        (comps || []).forEach((c: any) => { nameById[c.id] = c.name; });
      }
      const map: Record<string, { companyId: string; name: string }[]> = {};
      rows.forEach((r) => {
        if (!r.sub_company_id || r.sub_company_id === myCompanyId) return;
        const list = (map[r.project_id] = map[r.project_id] || []);
        if (!list.some((x) => x.companyId === r.sub_company_id)) {
          list.push({ companyId: r.sub_company_id, name: nameById[r.sub_company_id] || 'Company' });
        }
      });
      Object.values(map).forEach((l) => l.sort((a, b) => a.name.localeCompare(b.name)));
      if (!cancelled) setConnByProject(map);
    })();
    return () => { cancelled = true; };
  }, [projects, myCompanyId, conversations]);

  type SubNode = { companyId: string; name: string; conv: Conversation | null };
  type ProjectNode = {
    projectId: string;
    name: string;
    owned: boolean;
    conv: Conversation | null; // self chat when not the project owner
    subs: SubNode[];
  };

  const projectNodes: ProjectNode[] = useMemo(() => {
    return projects.map((p) => {
      // Subs / sub-of-subs never get the drill-down, even for projects they created.
      const owned = isOwnerViewer && !!(p.company_id && p.company_id === myCompanyId);
      if (owned) {
        const subs = (connByProject[p.id] || []).map((c) => ({
          companyId: c.companyId,
          name: c.name,
          conv: convByProjectSub[`${p.id}:${c.companyId}`] || null,
        }));
        return { projectId: p.id, name: p.name, owned, conv: null, subs };
      }
      return {
        projectId: p.id,
        name: p.name,
        owned,
        conv: myCompanyId ? convByProjectSub[`${p.id}:${myCompanyId}`] || null : null,
        subs: [],
      };
    });
  }, [projects, myCompanyId, connByProject, convByProjectSub, isOwnerViewer]);

  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});

  const filteredProjectNodes = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return projectNodes;
    return projectNodes
      .map((n) => {
        if (n.name.toLowerCase().includes(q)) return n;
        const subs = n.subs.filter((s) => s.name.toLowerCase().includes(q));
        return subs.length > 0 ? { ...n, subs } : null;
      })
      .filter(Boolean) as ProjectNode[];
  }, [projectNodes, search]);

  const filtered = useMemo(() => {
    if (activeTab === 'projects') return []; // projects tab uses projectRows
    const byType = conversations.filter((c) => (activeTab === 'people' ? c.type === 'dm' : c.type === 'group'));
    const q = search.trim().toLowerCase();
    if (!q) return byType;
    return byType.filter((c) => {
      const label = participantNames[c.id] || c.title || '';
      return label.toLowerCase().includes(q);
    });
  }, [conversations, activeTab, search, participantNames]);

  const tabUnread = useMemo(() => {
    const byTab: Record<Tab, number> = { projects: 0, people: 0, groups: 0 };
    conversations.forEach((c) => {
      const count = unreadByConv[c.id] || 0;
      if (c.type === 'project') byTab.projects += count;
      else if (c.type === 'dm') byTab.people += count;
      else byTab.groups += count;
    });
    return byTab;
  }, [conversations, unreadByConv]);

  const handleOpenConv = async (convId: string) => {
    setActiveConv(convId);
    if (user && !impersonating) await markRead(convId, user.id);
  };

  const openProjectSubChat = async (projectId: string, subCompanyId: string | null, existing: Conversation | null) => {
    if (existing) {
      await handleOpenConv(existing.id);
      return;
    }
    if (!subCompanyId) return;
    const { data, error } = await supabase.rpc(
      'get_or_create_project_sub_conversation' as any,
      { p_project_id: projectId, p_sub_company_id: subCompanyId },
    );
    if (error || !data) return;
    await refresh();
    setActiveConv(data as any);
    if (user && !impersonating) await markRead(data as any, user.id);
  };

  const getLabel = (c: Conversation) => {
    if (c.type === 'project') {
      const projName = projects.find((p) => p.id === c.project_id)?.name;
      const subName = (c as any).sub_company_id
        ? Object.values(connByProject).flat().find((x) => x.companyId === (c as any).sub_company_id)?.name
        : null;
      if (projName && subName) return `${projName} — ${subName}`;
      return projName || c.title || 'Project';
    }
    return participantNames[c.id] || c.title || (c.type === 'group' ? 'Group' : 'Direct message');
  };




  // On mobile, show either the rail or the thread (not both).
  const showRail = !isMobile || !activeConv;
  const showThread = !isMobile || !!activeConv;

  return (
    <div className="flex h-[calc(100vh-64px)] bg-background">
      {/* Left rail */}
      <aside className={`${showRail ? 'flex' : 'hidden'} w-full md:w-80 md:flex border-r flex-col bg-card`}>
        <div className="p-3 border-b flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="flex-1 justify-between">
                {activeTab === 'projects' ? 'Projects' : activeTab === 'people' ? 'People' : 'Group Chats'}
                <ChevronDown className="h-4 w-4 ml-2" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuItem onClick={() => setActiveTab('projects')}>
                <span className="flex-1">Projects</span>
                {tabUnread.projects > 0 && (
                  <span className="ml-2 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold">
                    {tabUnread.projects}
                  </span>
                )}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setActiveTab('people')}>
                <span className="flex-1">People</span>
                {tabUnread.people > 0 && (
                  <span className="ml-2 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold">
                    {tabUnread.people}
                  </span>
                )}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setActiveTab('groups')}>
                <span className="flex-1">Group Chats</span>
                {tabUnread.groups > 0 && (
                  <span className="ml-2 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold">
                    {tabUnread.groups}
                  </span>
                )}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {activeTab !== 'projects' && (
          <div className="p-3 border-b space-y-2">
            <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => setContactsOpen(true)}>
              <BookUser className="h-4 w-4 mr-2" /> Contacts
            </Button>
            <Button variant="default" size="sm" className="w-full justify-start" onClick={() => setNewMsgOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              {activeTab === 'groups' ? 'New group chat' : 'New message'}
            </Button>
          </div>
        )}

        <div className="p-3 border-b">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={`Search ${activeTab}...`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-9"
            />
          </div>
        </div>

        <ScrollArea className="flex-1">
          {activeTab === 'projects' ? (
            !identityResolved ? (
              <div className="p-6 text-center text-sm text-muted-foreground">Loading projects...</div>
            ) : identityError ? (
              <div className="p-6 text-center text-sm text-destructive">{identityError}</div>
            ) : filteredProjectNodes.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No projects yet.
              </div>
            ) : (
              <div className="divide-y">
                {filteredProjectNodes.map((node) => {
                  const renderMeta = (conv: Conversation | null) => {
                    const unread = conv ? unreadByConv[conv.id] || 0 : 0;
                    const last = conv ? lastMessages[conv.id] : undefined;
                    const preview = last
                      ? last.kind === 'user'
                        ? last.body || ''
                        : '📋 Schedule update'
                      : '';
                    return { unread, last, preview };
                  };

                  if (!node.owned) {
                    const { unread, last, preview } = renderMeta(node.conv);
                    const isActive = node.conv && activeConv === node.conv.id;
                    return (
                      <button
                        key={`project:${node.projectId}`}
                        onClick={() => openProjectSubChat(node.projectId, myCompanyId, node.conv)}
                        className={`w-full text-left p-3 hover:bg-accent transition-colors ${isActive ? 'bg-accent' : ''}`}
                      >
                        <div className="flex justify-between items-start gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm truncate">{node.name}</div>
                            <div className="text-xs text-muted-foreground truncate">{preview}</div>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            {last && (
                              <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                                {formatDistanceToNow(new Date(last.created_at), { addSuffix: false })}
                              </span>
                            )}
                            {unread > 0 && (
                              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold">
                                {unread}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  }

                  const open = expandedProjects[node.projectId] ?? true;
                  const projectUnread = node.subs.reduce(
                    (sum, s) => sum + (s.conv ? unreadByConv[s.conv.id] || 0 : 0),
                    0,
                  );
                  return (
                    <div key={`project:${node.projectId}`}>
                      <button
                        onClick={() =>
                          setExpandedProjects((prev) => ({ ...prev, [node.projectId]: !open }))
                        }
                        className="w-full text-left p-3 hover:bg-accent transition-colors flex items-center gap-2"
                      >
                        <ChevronDown
                          className={`h-4 w-4 shrink-0 transition-transform ${open ? '' : '-rotate-90'}`}
                        />
                        <span className="flex-1 min-w-0 font-medium text-sm truncate">{node.name}</span>
                        {projectUnread > 0 && (
                          <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold">
                            {projectUnread}
                          </span>
                        )}
                      </button>
                      {open && (
                        node.subs.length === 0 ? (
                          <div className="pl-9 pr-3 pb-3 text-xs text-muted-foreground">
                            No subcontractors connected yet.
                          </div>
                        ) : (
                          node.subs.map((s) => {
                            const { unread, last, preview } = renderMeta(s.conv);
                            const isActive = s.conv && activeConv === s.conv.id;
                            return (
                              <button
                                key={`${node.projectId}:${s.companyId}`}
                                onClick={() => openProjectSubChat(node.projectId, s.companyId, s.conv)}
                                className={`w-full text-left py-2 pl-9 pr-3 hover:bg-accent transition-colors border-t ${isActive ? 'bg-accent' : ''}`}
                              >
                                <div className="flex justify-between items-start gap-2">
                                  <div className="flex-1 min-w-0">
                                    <div className="text-sm truncate">{s.name}</div>
                                    <div className="text-xs text-muted-foreground truncate">{preview}</div>
                                  </div>
                                  <div className="flex flex-col items-end gap-1">
                                    {last && (
                                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                                        {formatDistanceToNow(new Date(last.created_at), { addSuffix: false })}
                                      </span>
                                    )}
                                    {unread > 0 && (
                                      <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold">
                                        {unread}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </button>
                            );
                          })
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            )
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No conversations yet.
            </div>
          ) : (
            <div className="divide-y">
              {filtered.map((c) => {
                const unread = unreadByConv[c.id] || 0;
                const last = lastMessages[c.id];
                const label = getLabel(c);
                const preview = last
                  ? last.kind === 'user'
                    ? last.body || ''
                    : '📋 Schedule update'
                  : '';
                return (
                  <button
                    key={c.id}
                    onClick={() => handleOpenConv(c.id)}
                    className={`w-full text-left p-3 hover:bg-accent transition-colors relative ${
                      activeConv === c.id ? 'bg-accent' : ''
                    }`}
                  >
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{label}</div>
                        <div className="text-xs text-muted-foreground truncate">{preview}</div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        {last && (
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                            {formatDistanceToNow(new Date(last.created_at), { addSuffix: false })}
                          </span>
                        )}
                        {unread > 0 && (
                          <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold">
                            {unread}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>

      </aside>

      <main className={`${showThread ? 'flex' : 'hidden'} md:flex flex-1 flex-col`}>
        {activeConv ? (
          <>
            {isMobile && (
              <div className="border-b px-2 py-2 flex items-center gap-2 bg-card">
                <Button variant="ghost" size="icon" onClick={() => setActiveConv(null)} className="h-8 w-8">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm font-medium truncate">Back to conversations</span>
              </div>
            )}
            <ConversationThread
              conversationId={activeConv}
              label={(() => {
                const c = conversations.find((x) => x.id === activeConv);
                return c ? getLabel(c) : '';
              })()}
              isGroup={conversations.find((c) => c.id === activeConv)?.type === 'group'}
              conversationType={(conversations.find((c) => c.id === activeConv)?.type as 'project' | 'dm' | 'group') || 'dm'}
              readOnly={
                conversations.find((c) => c.id === activeConv)?.type === 'project' && !canPostInProject
              }
              onParticipantAdded={refresh}
              readOnlyReason={impersonating ? 'operator-view' : undefined}
              suppressReads={impersonating}
            />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            Select a conversation to start messaging
          </div>
        )}
      </main>

      <ContactsModal
        open={contactsOpen}
        onOpenChange={setContactsOpen}
        ownerUserId={viewerId}

        onStartChat={async (otherUserId) => {
          setContactsOpen(false);
          const { data } = await supabase.rpc('get_or_create_dm_conversation' as any, { p_other_user_id: otherUserId });
          if (data) {
            await refresh();
            setActiveTab('people');
            setActiveConv(data as any);
          }
        }}
      />

      <NewMessageModal
        open={newMsgOpen}
        onOpenChange={setNewMsgOpen}
        mode={activeTab === 'groups' ? 'group' : 'dm'}
        onCreated={async (convId) => {
          setNewMsgOpen(false);
          await refresh();
          setActiveConv(convId);
        }}
      />
    </div>
  );
}
