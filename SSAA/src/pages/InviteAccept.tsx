import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface Prefill {
  invitee_full_name: string;
  invitee_email: string;
  invitee_phone: string | null;
  invitee_job_title: string | null;
  gc_company_name: string;
  project_name: string;
  project_address: string | null;
  accepted_at: string | null;
}

const InviteAccept = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Editable form fields
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [projectName, setProjectName] = useState('');
  const [projectAddress, setProjectAddress] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    const load = async () => {
      if (!token) {
        setError('Missing invite token in link.');
        setLoading(false);
        return;
      }
      const { data, error } = await supabase
        .from('gc_invite_prefills')
        .select('invitee_full_name, invitee_email, invitee_phone, invitee_job_title, gc_company_name, project_name, project_address, accepted_at')
        .eq('invite_token', token)
        .maybeSingle();

      if (error || !data) {
        setError('This invite link is invalid or has expired.');
        setLoading(false);
        return;
      }
      if (data.accepted_at) {
        setError('This invite link has already been used. Please sign in normally.');
        setLoading(false);
        return;
      }

      setPrefill(data as Prefill);
      setFullName(data.invitee_full_name);
      setEmail(data.invitee_email);
      setPhone(data.invitee_phone || '');
      setJobTitle(data.invitee_job_title || '');
      setCompanyName(data.gc_company_name);
      setProjectName(data.project_name);
      setProjectAddress(data.project_address || '');
      setLoading(false);
    };
    load();
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast({ title: 'Password must be at least 8 characters', variant: 'destructive' });
      return;
    }
    if (password !== confirmPassword) {
      toast({ title: 'Passwords do not match', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-guest-gc-from-invite', {
        body: {
          token,
          password,
          full_name: fullName,
          email,
          phone,
          job_title: jobTitle,
          gc_company_name: companyName,
          project_name: projectName,
          project_address: projectAddress,
        },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to create account');

      // Sign in
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: data.email,
        password,
      });
      if (signInErr) throw signInErr;

      toast({ title: 'Welcome!', description: 'Your account is set up.' });
      navigate('/dashboard?firstrun=1');
    } catch (e: any) {
      console.error(e);
      toast({ title: 'Setup failed', description: e.message, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>Invite Unavailable</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={() => navigate('/')}>Go to Sign In</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <Card className="max-w-2xl w-full">
        <CardHeader>
          <CardTitle>Welcome to SSAA</CardTitle>
          <CardDescription>
            Confirm your details below and choose a password. Your project and connection to the
            subcontractor will be created automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Project</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Project Name</Label>
                  <Input value={projectName} onChange={(e) => setProjectName(e.target.value)} required />
                </div>
                <div className="space-y-1">
                  <Label>Project Address</Label>
                  <Input value={projectAddress} onChange={(e) => setProjectAddress(e.target.value)} />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">You</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Full Name</Label>
                  <Input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
                </div>
                <div className="space-y-1">
                  <Label>Company</Label>
                  <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} required />
                </div>
                <div className="space-y-1">
                  <Label>Email</Label>
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </div>
                <div className="space-y-1">
                  <Label>Phone</Label>
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <Label>Job Title</Label>
                  <Input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Password</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Choose Password</Label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={8}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label>Confirm Password</Label>
                  <Input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    minLength={8}
                    required
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Minimum 8 characters.</p>
            </div>

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Setting up your account...
                </>
              ) : (
                'Confirm & Continue to Dashboard'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default InviteAccept;
