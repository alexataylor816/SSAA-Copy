import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { KeyRound, Loader2 } from 'lucide-react';

/**
 * Welcome-email hand-off page.
 *
 * It ONLY signs the person in with the temporary password from the link and
 * sends them to the dashboard. Choosing a display name and a real password
 * happens exactly once, in the dashboard's forced setup dialog — the same
 * dialog people see when they log in manually with the temporary password.
 * Having a second form here caused the setup box to appear twice.
 */
const OnboardingReset = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const emailParam = searchParams.get('email') || '';
  const tempParam = searchParams.get('temp') || '';

  const [stage, setStage] = useState<'signing-in' | 'error'>('signing-in');
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    const signIn = async () => {
      if (!emailParam || !tempParam) {
        setErrorMsg('Invalid invitation link. Missing email or temporary password.');
        setStage('error');
        return;
      }
      const normalizedEmail = emailParam.trim().toLowerCase();
      const { error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password: tempParam,
      });
      if (error) {
        setErrorMsg(
          'We could not sign you in with this link. The temporary password may have already been used. Please log in manually with the credentials in your invitation email.'
        );
        setStage('error');
        return;
      }
      navigate('/dashboard', { replace: true });
    };
    signIn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            Set Up Your Account
          </CardTitle>
          <CardDescription>
            {stage === 'signing-in'
              ? 'Signing you in — you will choose your name and password on the next screen.'
              : 'We could not open your invitation.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {stage === 'signing-in' && (
            <div className="flex items-center justify-center gap-3 py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Signing you in...</span>
            </div>
          )}

          {stage === 'error' && (
            <div className="space-y-4">
              <p className="text-sm text-destructive">{errorMsg}</p>
              <Button className="w-full" onClick={() => navigate('/', { replace: true })}>
                Go to Login
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default OnboardingReset;
