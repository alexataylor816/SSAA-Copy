import { useState, useEffect, useRef } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Mail, Bell, MessageSquare, Save, RefreshCw, ArrowLeft, Undo2 } from 'lucide-react';
import { ToastAction } from '@/components/ui/toast';
import { format } from 'date-fns';
import RichEmailEditor from './correspondence/RichEmailEditor';
import TemplatePreview from './correspondence/TemplatePreview';

interface NotificationTemplate {
  id: string;
  event_type: string;
  display_name: string | null;
  channel: string;
  subject: string;
  body_html: string;
  description: string | null;
  is_active: boolean;
  placeholder_variables: string[];
  metadata: Record<string, any> | null;
  updated_at: string;
}

interface NotificationLog {
  id: string;
  event_type: string;
  channel: string;
  recipient_email: string | null;
  subject: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
}

interface ManageCorrespondenceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBack?: () => void;
}

const ManageCorrespondenceModal = ({ open, onOpenChange, onBack }: ManageCorrespondenceModalProps) => {
  const { toast } = useToast();
  const { t } = useLanguage();
  const [templates, setTemplates] = useState<NotificationTemplate[]>([]);
  const [logs, setLogs] = useState<NotificationLog[]>([]);
  const [smsInbound, setSmsInbound] = useState<any[]>([]);
  const [editingTemplate, setEditingTemplate] = useState<NotificationTemplate | null>(null);
  const [editSubject, setEditSubject] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState('');
  const [editBody, setEditBody] = useState('');
  const [editFrequency, setEditFrequency] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const smsTextareaRef = useRef<HTMLTextAreaElement>(null);

  const insertIntoSms = (token: string) => {
    const el = smsTextareaRef.current;
    if (!el) {
      setEditBody(prev => prev + token);
      return;
    }
    const start = el.selectionStart ?? editBody.length;
    const end = el.selectionEnd ?? editBody.length;
    const next = editBody.slice(0, start) + token + editBody.slice(end);
    setEditBody(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  };

  useEffect(() => {
    if (open) {
      fetchTemplates();
      fetchLogs();
      fetchSmsInbound();
    }
  }, [open]);

  const fetchTemplates = async () => {
    const { data, error } = await supabase
      .from('notification_templates')
      .select('*')
      .order('event_type');

    if (error) {
      console.error('Error fetching templates:', error);
      return;
    }
    setTemplates((data || []) as unknown as NotificationTemplate[]);
  };

  const fetchLogs = async () => {
    const { data, error } = await supabase
      .from('notification_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('Error fetching logs:', error);
      return;
    }
    setLogs((data || []) as unknown as NotificationLog[]);
  };

  const fetchSmsInbound = async () => {
    const { data, error } = await (supabase as any)
      .from('sms_inbound_log')
      .select('*')
      .order('received_at', { ascending: false })
      .limit(100);
    if (error) {
      console.error('Error fetching SMS inbound log:', error);
      return;
    }
    setSmsInbound(data || []);
  };

  const handleEditTemplate = (template: NotificationTemplate) => {
    setEditingTemplate(template);
    setRenaming(false);
    setEditingDesc(false);
    setEditSubject(template.subject);
    setEditBody(template.body_html);
    const freq = template.metadata?.frequency_days;
    setEditFrequency(freq ? String(freq) : '');
  };

  const handleSaveTemplate = async () => {
    if (!editingTemplate) return;
    setLoading(true);

    const previousSubject = editingTemplate.subject;
    const previousBody = editingTemplate.body_html;
    const previousMetadata = editingTemplate.metadata;
    const templateId = editingTemplate.id;

    const updateData: any = { subject: editSubject, body_html: editBody };

    // Save frequency if this is a touchpoint template
    if (editingTemplate.event_type.startsWith('guest_gc_touchpoint')) {
      const metadata = { ...(editingTemplate.metadata || {}), frequency_days: editFrequency ? parseInt(editFrequency) : null };
      updateData.metadata = metadata;
    }

    const { error } = await supabase
      .from('notification_templates')
      .update(updateData)
      .eq('id', templateId);

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({
        title: 'Template saved',
        description: 'You can undo this save for the next few seconds.',
        action: (
          <ToastAction
            altText="Undo save"
            onClick={async () => {
              const { error: undoErr } = await supabase
                .from('notification_templates')
                .update({ subject: previousSubject, body_html: previousBody, metadata: previousMetadata })
                .eq('id', templateId);
              if (undoErr) {
                toast({ title: 'Undo failed', description: undoErr.message, variant: 'destructive' });
              } else {
                toast({ title: 'Reverted to previous version' });
                fetchTemplates();
              }
            }}
          >
            <Undo2 className="h-3 w-3 mr-1" /> Undo
          </ToastAction>
        ),
      });
      setEditingTemplate(null);
      fetchTemplates();
    }
    setLoading(false);
  };

  const handleToggleActive = async (template: NotificationTemplate) => {
    const { error } = await supabase
      .from('notification_templates')
      .update({ is_active: !template.is_active })
      .eq('id', template.id);

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      fetchTemplates();
    }
  };

  const templateLabel = (tpl: { display_name?: string | null; event_type: string }) =>
    (tpl.display_name && tpl.display_name.trim()) || formatEventType(tpl.event_type);

  const saveTemplateName = async () => {
    if (!editingTemplate) return;
    const next = nameDraft.trim();
    const { error } = await supabase
      .from('notification_templates')
      .update({ display_name: next || null })
      .eq('id', editingTemplate.id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return;
    }
    setEditingTemplate({ ...editingTemplate, display_name: next || null });
    setRenaming(false);
    toast({ title: 'Template name updated' });
    fetchTemplates();
  };

  const renderTemplateHeading = () => {
    if (!editingTemplate) return null;
    if (renaming) {
      return (
        <div className="flex items-center gap-2 flex-1 mr-2">
          <Input
            autoFocus
            value={nameDraft}
            onChange={e => setNameDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); void saveTemplateName(); }
              if (e.key === 'Escape') { e.preventDefault(); setRenaming(false); }
            }}
            placeholder="Template name"
            className="h-9 max-w-sm"
          />
          <Button size="sm" onClick={saveTemplateName}>Save</Button>
          <Button size="sm" variant="ghost" onClick={() => setRenaming(false)}>Cancel</Button>
        </div>
      );
    }
    return <h3 className="text-lg font-semibold">{templateLabel(editingTemplate)}</h3>;
  };

  const renderRenameButton = () =>
    renaming ? null : (
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setNameDraft(editingTemplate ? templateLabel(editingTemplate) : '');
          setRenaming(true);
        }}
      >
        Edit Name of Template
      </Button>
    );

  const saveTemplateDescription = async () => {
    if (!editingTemplate) return;
    const next = descDraft.trim();
    const { error } = await supabase
      .from('notification_templates')
      .update({ description: next || null })
      .eq('id', editingTemplate.id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return;
    }
    setEditingTemplate({ ...editingTemplate, description: next || null });
    setEditingDesc(false);
    toast({ title: 'Template description updated' });
    fetchTemplates();
  };

  const renderDescriptionButton = () =>
    editingDesc ? null : (
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setDescDraft(editingTemplate?.description ?? '');
          setEditingDesc(true);
        }}
      >
        Edit Description
      </Button>
    );

  const renderDescription = () => {
    if (!editingTemplate) return null;
    if (editingDesc) {
      return (
        <div className="space-y-2">
          <Textarea
            autoFocus
            value={descDraft}
            onChange={e => setDescDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') { e.preventDefault(); setEditingDesc(false); }
            }}
            placeholder="Describe when this message is sent"
            rows={3}
          />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={saveTemplateDescription}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditingDesc(false)}>Cancel</Button>
          </div>
        </div>
      );
    }
    if (!editingTemplate.description) return null;
    return <p className="text-sm text-muted-foreground">{editingTemplate.description}</p>;
  };


  const formatEventType = (type: string) => {
    const displayMap: Record<string, string> = {
      schedule_created: 'Schedule Requests',
      project_invite: 'Share Project Email',
      gc_invite_to_ssaa: 'Invite GC to SSAA',
      guest_gc_touchpoint_1: "Guest GC's Email Touch Point 1",
      guest_gc_touchpoint_2: "Guest GC's Email Touch Point 2",
      guest_gc_touchpoint_3: "Guest GC's Email Touch Point 3",
      employee_welcome: 'Employee Welcome Email',
      sms_welcome_confirmation: 'Welcome Confirmation (Opt-In)',
      sms_help_response: 'HELP Auto-Reply (HELP / INFO / SUPPORT)',
      sms_optout_response: 'Opt-Out Auto-Reply (STOP / UNSUBSCRIBE / END / QUIT / HALT)',
    };
    if (displayMap[type]) return displayMap[type];
    return type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            {onBack && (
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { onOpenChange(false); onBack(); }}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <DialogTitle>{t('correspondence.title')}</DialogTitle>
          </div>
        </DialogHeader>

        <Tabs defaultValue="email" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="email" className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Email
            </TabsTrigger>
            <TabsTrigger value="push" className="flex items-center gap-2">
              <Bell className="h-4 w-4" />
              Push
            </TabsTrigger>
            {/* Text messaging is retired — trigger hidden, templates/log kept in code. */}
            <TabsTrigger value="log" className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4" />
              Log
            </TabsTrigger>
          </TabsList>

          {/* Email Templates Tab */}
          <TabsContent value="email">
            <ScrollArea className="h-[60vh]">
              {editingTemplate ? (
                <div className="space-y-4 p-2">
                  <div className="flex items-center justify-between">
                    {renderTemplateHeading()}
                    <div className="flex items-center gap-2">
                      {editingTemplate.event_type.startsWith('guest_gc_touchpoint') && (
                        <select
                          value={editFrequency}
                          onChange={e => setEditFrequency(e.target.value)}
                          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                        >
                          <option value="">Frequency...</option>
                          <option value="7">1 week</option>
                          <option value="14">2 weeks</option>
                          <option value="21">3 weeks</option>
                          <option value="28">4 weeks</option>
                          <option value="30">1 month</option>
                          <option value="60">2 months</option>
                        </select>
                      )}
                      {renderRenameButton()}
                      {renderDescriptionButton()}
                      <Button variant="outline" size="sm" onClick={() => setEditingTemplate(null)}>Cancel</Button>
                    </div>
                  </div>
                  {editingTemplate.event_type.startsWith('guest_gc_touchpoint') && (
                    <p className="text-xs text-muted-foreground">Adjust the frequency above to control how often this outreach email is sent.</p>
                  )}
                  {renderDescription()}
                  <div className="space-y-2">
                    <Label>Subject Line</Label>
                    <Input value={editSubject} onChange={e => setEditSubject(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Email Body</Label>
                    <RichEmailEditor
                      value={editBody}
                      onChange={setEditBody}
                      placeholders={editingTemplate.placeholder_variables}
                    />
                  </div>
                  <TemplatePreview
                    html={editBody}
                    subject={editSubject}
                    placeholders={editingTemplate.placeholder_variables}
                    channel="email"
                  />
                  <Button onClick={handleSaveTemplate} disabled={loading} className="w-full">
                    <Save className="h-4 w-4 mr-2" />
                    Save Template
                  </Button>
                </div>
              ) : (
                <div className="space-y-2 p-2">
                  {templates.filter(t => t.channel === 'email').map(template => (
                    <div key={template.id} className="flex items-center justify-between p-3 rounded-lg border">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{templateLabel(template)}</span>
                          <Badge variant={template.is_active ? 'default' : 'secondary'}>
                            {template.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">{template.description}</p>
                        <p className="text-xs text-muted-foreground mt-1">Subject: {template.subject}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <Switch
                          checked={template.is_active}
                          onCheckedChange={() => handleToggleActive(template)}
                        />
                        <Button variant="outline" size="sm" onClick={() => handleEditTemplate(template)}>
                          Edit
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          {/* Push Notifications Tab — replaces the retired text channel. */}
          <TabsContent value="push">
            <ScrollArea className="h-[60vh]">
              {editingTemplate && editingTemplate.channel === 'push' ? (
                <div className="space-y-4 p-2">
                  <div className="flex items-center justify-between">
                    {renderTemplateHeading()}
                    <div className="flex items-center gap-2">
                      {renderRenameButton()}
                      {renderDescriptionButton()}
                      <Button variant="outline" size="sm" onClick={() => setEditingTemplate(null)}>Cancel</Button>
                    </div>
                  </div>
                  {renderDescription()}
                  <div className="space-y-2">
                    <Label>Push Notification Title</Label>
                    <Input value={editSubject} onChange={e => setEditSubject(e.target.value)} maxLength={120} />
                  </div>
                  <div className="space-y-2">
                    <Label>Insert Placeholder</Label>
                    <div className="flex flex-wrap gap-1">
                      {editingTemplate.placeholder_variables.map(v => (
                        <Badge
                          key={v}
                          variant="secondary"
                          className="text-xs cursor-pointer hover:bg-secondary/80"
                          onClick={() => insertIntoSms(`{${v}}`)}
                        >{`{${v}}`}</Badge>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Message Body (sent as a message in the recipient's People chat)</Label>
                    <Textarea
                      ref={smsTextareaRef}
                      value={editBody}
                      onChange={e => setEditBody(e.target.value)}
                      rows={6}
                      className="text-sm"
                      maxLength={1600}
                    />
                    <p className="text-xs text-muted-foreground">{editBody.length}/1600 characters</p>
                  </div>
                  <TemplatePreview
                    html={editBody}
                    subject={editSubject}
                    placeholders={editingTemplate.placeholder_variables}
                    channel="sms"
                  />
                  <Button onClick={handleSaveTemplate} disabled={loading} className="w-full">
                    <Save className="h-4 w-4 mr-2" />
                    Save Template
                  </Button>
                </div>
              ) : (
                <div className="space-y-2 p-2">
                  {templates.filter(t => t.channel === 'push').map(template => (
                    <div key={template.id} className="flex items-center justify-between p-3 rounded-lg border">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{templateLabel(template)}</span>
                          <Badge variant={template.is_active ? 'default' : 'secondary'}>
                            {template.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">{template.description}</p>
                        <p className="text-xs text-muted-foreground mt-1 truncate max-w-md">{template.body_html}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <Switch
                          checked={template.is_active}
                          onCheckedChange={() => handleToggleActive(template)}
                        />
                        <Button variant="outline" size="sm" onClick={() => handleEditTemplate(template)}>
                          Edit
                        </Button>
                      </div>
                    </div>
                  ))}
                  {templates.filter(t => t.channel === 'push').length === 0 && (
                    <div className="text-center text-muted-foreground py-8">
                      No push notification templates configured
                    </div>
                  )}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          {/* Text Messages (SMS) Tab */}
          <TabsContent value="text">
            <ScrollArea className="h-[60vh]">
              {editingTemplate && editingTemplate.channel === 'sms' ? (
                <div className="space-y-4 p-2">
                  <div className="flex items-center justify-between">
                    {renderTemplateHeading()}
                    <div className="flex items-center gap-2">
                      {renderRenameButton()}
                      {renderDescriptionButton()}
                      <Button variant="outline" size="sm" onClick={() => setEditingTemplate(null)}>Cancel</Button>
                    </div>
                  </div>
                  {renderDescription()}
                  <div className="space-y-2">
                    <Label>Insert Placeholder</Label>
                    <div className="flex flex-wrap gap-1">
                      {editingTemplate.placeholder_variables.map(v => (
                        <Badge
                          key={v}
                          variant="secondary"
                          className="text-xs cursor-pointer hover:bg-secondary/80"
                          onClick={() => insertIntoSms(`{${v}}`)}
                        >{`{${v}}`}</Badge>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>SMS Message Body</Label>
                    <Textarea
                      ref={smsTextareaRef}
                      value={editBody}
                      onChange={e => setEditBody(e.target.value)}
                      rows={6}
                      className="text-sm"
                      maxLength={1600}
                    />
                    <p className="text-xs text-muted-foreground">{editBody.length}/1600 characters</p>
                  </div>
                  <TemplatePreview
                    html={editBody}
                    placeholders={editingTemplate.placeholder_variables}
                    channel="sms"
                  />
                  <Button onClick={handleSaveTemplate} disabled={loading} className="w-full">
                    <Save className="h-4 w-4 mr-2" />
                    Save Template
                  </Button>
                </div>
              ) : (
                <div className="space-y-2 p-2">
                  {templates.filter(t => t.channel === 'sms').map(template => (
                    <div key={template.id} className="flex items-center justify-between p-3 rounded-lg border">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{templateLabel(template)}</span>
                          <Badge variant={template.is_active ? 'default' : 'secondary'}>
                            {template.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">{template.description}</p>
                        <p className="text-xs text-muted-foreground mt-1 truncate max-w-md">{template.body_html}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <Switch
                          checked={template.is_active}
                          onCheckedChange={() => handleToggleActive(template)}
                        />
                        <Button variant="outline" size="sm" onClick={() => handleEditTemplate(template)}>
                          Edit
                        </Button>
                      </div>
                    </div>
                  ))}
                  {templates.filter(t => t.channel === 'sms').length === 0 && (
                    <div className="text-center text-muted-foreground py-8">
                      No SMS templates configured
                    </div>
                  )}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          {/* Notification Log Tab */}
          <TabsContent value="log">
            <ScrollArea className="h-[60vh]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Recipient</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                        No notifications sent yet
                      </TableCell>
                    </TableRow>
                  ) : (
                    logs.map(log => (
                      <TableRow key={log.id}>
                        <TableCell className="text-xs">
                          {format(new Date(log.created_at), 'MMM d, yyyy h:mm a')}
                        </TableCell>
                        <TableCell className="text-xs">{formatEventType(log.event_type)}</TableCell>
                        <TableCell className="text-xs">{log.recipient_email || '—'}</TableCell>
                        <TableCell className="text-xs max-w-[200px] truncate">{log.subject || '—'}</TableCell>
                        <TableCell>
                          <Badge variant={log.status === 'sent' ? 'default' : 'destructive'} className="text-xs">
                            {log.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </TabsContent>

          {/* Text Response Log Tab */}
          <TabsContent value="text_log">
            <ScrollArea className="h-[60vh]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Received</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>Message</TableHead>
                    <TableHead>Matched Keyword</TableHead>
                    <TableHead>Auto-Reply</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {smsInbound.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        No inbound text messages yet
                      </TableCell>
                    </TableRow>
                  ) : (
                    smsInbound.map((row: any) => (
                      <TableRow key={row.id}>
                        <TableCell className="text-xs">
                          {format(new Date(row.received_at), 'MMM d, yyyy h:mm a')}
                        </TableCell>
                        <TableCell className="text-xs">{row.from_phone}</TableCell>
                        <TableCell className="text-xs max-w-[280px] truncate">{row.body || '—'}</TableCell>
                        <TableCell className="text-xs">
                          {row.matched_keyword
                            ? <Badge variant="secondary" className="text-xs">{row.matched_keyword}</Badge>
                            : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-xs">
                          {row.response_event_type ? formatEventType(row.response_event_type) : '—'}
                        </TableCell>
                        <TableCell>
                          {row.response_status
                            ? <Badge variant={row.response_status === 'sent' ? 'default' : 'destructive'} className="text-xs">{row.response_status}</Badge>
                            : <span className="text-xs text-muted-foreground">—</span>}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

export default ManageCorrespondenceModal;
