import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Plus, Pencil, Trash2, Loader2, UserCog, ArrowLeft } from 'lucide-react';


interface Operator {
  id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  operator_level: string;
  created_at: string;
}

interface ManageOperatorsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  readOnly?: boolean;
  onBack?: () => void;
}

const ManageOperatorsModal = ({ open, onOpenChange, readOnly = false, onBack }: ManageOperatorsModalProps) => {
  const { toast } = useToast();
  const [operators, setOperators] = useState<Operator[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingOperator, setEditingOperator] = useState<Operator | null>(null);
  
  // Form state
  const [formEmail, setFormEmail] = useState('');
  const [formFullName, setFormFullName] = useState('');
  const [formLevel, setFormLevel] = useState<string>('operator');
  const [formPassword, setFormPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchOperators = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('operators')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching operators:', error);
    } else {
      setOperators((data as any[]) || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (open) {
      fetchOperators();
    }
  }, [open]);

  const resetForm = () => {
    setFormEmail('');
    setFormFullName('');
    setFormLevel('operator');
    setFormPassword('');
    setShowAddForm(false);
    setEditingOperator(null);
  };

  const handleCreate = async () => {
    if (!formEmail.trim() || !formPassword.trim()) {
      toast({ title: 'Error', description: 'Email and password are required', variant: 'destructive' });
      return;
    }
    if (formPassword.length < 6) {
      toast({ title: 'Error', description: 'Password must be at least 6 characters', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-operator', {
        body: {
          action: 'create',
          email: formEmail.trim(),
          full_name: formFullName.trim() || null,
          operator_level: formLevel,
          password: formPassword,
        },
      });

      if (error) throw error;
      if (data && !data.success) throw new Error(data.error || 'Failed to create operator');

      if (data?.emailSent) {
        toast({ title: 'Operator created', description: `Welcome email sent to ${formEmail}` });
      } else {
        toast({ 
          title: 'Operator created', 
          description: data?.emailError 
            ? `Account created but welcome email failed: ${data.emailError}` 
            : `Account created. Please share login credentials manually with ${formEmail}.`,
          variant: 'default'
        });
      }
      resetForm();
      fetchOperators();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdate = async () => {
    if (!editingOperator) return;

    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-operator', {
        body: {
          action: 'update',
          operator_id: editingOperator.id,
          operator_level: formLevel,
          full_name: formFullName.trim() || null,
        },
      });

      if (error) throw error;
      if (data && !data.success) throw new Error(data.error || 'Failed to update operator');

      toast({ title: 'Operator updated' });
      resetForm();
      fetchOperators();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (operatorId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('create-operator', {
        body: {
          action: 'delete',
          operator_id: operatorId,
        },
      });

      if (error) throw error;
      if (data && !data.success) throw new Error(data.error || 'Failed to delete operator');

      toast({ title: 'Operator deleted' });
      fetchOperators();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const startEdit = (op: Operator) => {
    setEditingOperator(op);
    setFormFullName(op.full_name || '');
    setFormLevel(op.operator_level);
    setShowAddForm(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) resetForm(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {onBack && (
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { onOpenChange(false); onBack(); }}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <UserCog className="h-5 w-5" />
            Manage Operators
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-hidden flex flex-col gap-4">
          {/* Add New Operator button */}
          {!readOnly && !showAddForm && !editingOperator && (
            <Button onClick={() => setShowAddForm(true)} className="w-full">
              <Plus className="h-4 w-4 mr-2" />
              Add New Operator
            </Button>
          )}

          {/* Add Form */}
          {!readOnly && showAddForm && (
            <div className="space-y-3 border rounded-lg p-4 bg-muted/30">
              <h3 className="font-semibold text-sm">New Operator</h3>
              <div className="space-y-2">
                <Label>Operator Level</Label>
                <Select value={formLevel} onValueChange={setFormLevel}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="main_operator">Main Operator (Full Access)</SelectItem>
                    <SelectItem value="operator">Operator (View Only)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  placeholder="operator@example.com"
                />
              </div>
              <div className="space-y-2">
                <Label>Full Name</Label>
                <Input
                  value={formFullName}
                  onChange={(e) => setFormFullName(e.target.value)}
                  placeholder="John Doe"
                />
              </div>
              <div className="space-y-2">
                <Label>Initial Password</Label>
                <Input
                  type="text"
                  value={formPassword}
                  onChange={(e) => setFormPassword(e.target.value)}
                  placeholder="Temporary password"
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={handleCreate} disabled={submitting} className="flex-1">
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Create Operator
                </Button>
                <Button variant="outline" onClick={resetForm}>Cancel</Button>
              </div>
            </div>
          )}

          {/* Edit Form */}
          {!readOnly && editingOperator && (
            <div className="space-y-3 border rounded-lg p-4 bg-muted/30">
              <h3 className="font-semibold text-sm">Edit Operator — {editingOperator.email}</h3>
              <div className="space-y-2">
                <Label>Operator Level</Label>
                <Select value={formLevel} onValueChange={setFormLevel}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="main_operator">Main Operator (Full Access)</SelectItem>
                    <SelectItem value="operator">Operator (View Only)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Full Name</Label>
                <Input
                  value={formFullName}
                  onChange={(e) => setFormFullName(e.target.value)}
                  placeholder="John Doe"
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={handleUpdate} disabled={submitting} className="flex-1">
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Save Changes
                </Button>
                <Button variant="outline" onClick={resetForm}>Cancel</Button>
              </div>
            </div>
          )}

          {/* Operators List */}
          <div className="flex-1 min-h-0 overflow-y-auto pr-2">
            <div className="space-y-2">
              {loading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : operators.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No operators added yet.</p>
              ) : (
                operators.map((op) => (
                  <div key={op.id} className="flex items-center justify-between border rounded-lg p-3 bg-background">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{op.full_name || op.email}</p>
                      <p className="text-xs text-muted-foreground truncate">{op.email}</p>
                      <span className={`inline-block text-xs mt-1 px-2 py-0.5 rounded-full ${
                        op.operator_level === 'main_operator'
                          ? 'bg-primary/10 text-primary'
                          : 'bg-muted text-muted-foreground'
                      }`}>
                        {op.operator_level === 'main_operator' ? 'Main Operator' : 'Operator (View Only)'}
                      </span>
                    </div>
                    {!readOnly && (
                      <div className="flex items-center gap-1 ml-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => startEdit(op)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Operator</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently delete {op.full_name || op.email}'s operator account and remove their access to the dashboard. This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDelete(op.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ManageOperatorsModal;
