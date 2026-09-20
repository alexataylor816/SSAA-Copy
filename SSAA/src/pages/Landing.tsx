import { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import heroImage from '@/assets/hero-construction.jpg';
import { Calendar, Users, Building2, Eye, EyeOff } from 'lucide-react';
import { lovable } from '@/integrations/lovable/index';
import { Separator } from '@/components/ui/separator';
import type { Language } from '@/i18n/translations';

const Landing = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [signUpLanguage, setSignUpLanguage] = useState<Language>('en');
  const { signIn, signUp, profile, loading, user } = useAuth();
  const { t, setLanguage } = useLanguage();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();

  const inviteToken = searchParams.get('invite');

  useEffect(() => {
    if (profile && !loading) {
      // Load language preference from profile
      if (profile.language) {
        setLanguage(profile.language as Language);
      }
      // One-shot flag set by Onboarding bail-out: never auto-bounce the user
      // back into the free-trial / onboarding flow on this visit.
      let skipOnboardingRedirect = false;
      try {
        if (sessionStorage.getItem('ssaa_skip_onboarding_redirect') === '1') {
          skipOnboardingRedirect = true;
          sessionStorage.removeItem('ssaa_skip_onboarding_redirect');
          sessionStorage.removeItem('ssaa_pending_signup');
        }
      } catch {}
      // Operators (moa role) always go straight to dashboard — never onboarding
      if (profile.company_id || profile.role === 'moa') {
        navigate('/dashboard');
      } else if (skipOnboardingRedirect) {
        // Account was created but the readiness poll timed out — send them to
        // dashboard (it tolerates a hydrating profile via realtime) instead of
        // looping back to the free-trial onboarding screen.
        navigate('/dashboard');
      } else {
        navigate(inviteToken ? `/onboarding?invite=${inviteToken}` : '/onboarding');
      }
    }
  }, [profile, loading, navigate, inviteToken]);

  useEffect(() => {
    if (inviteToken) {
      setIsSignUp(true);
    }
  }, [inviteToken]);

  // When user changes language during signup, update the context too
  useEffect(() => {
    if (isSignUp) {
      setLanguage(signUpLanguage);
    }
  }, [signUpLanguage, isSignUp]);

  const checkAndLinkEmployee = async (userId: string, userEmail: string) => {
    try {
      const normalizedEmail = userEmail.trim().toLowerCase();
      const { data: userProfile } = await supabase
        .from('profiles')
        .select('company_id')
        .eq('user_id', userId)
        .single();

      if (!userProfile?.company_id) return null;

      const { data: matchingEmployee } = await supabase
        .from('employees')
        .select('*')
        .ilike('email', normalizedEmail)
        .eq('company_id', userProfile.company_id)
        .is('linked_user_id', null)
        .single();

      if (matchingEmployee) {
        await supabase
          .from('employees')
          .update({ linked_user_id: userId })
          .eq('id', matchingEmployee.id);

        return matchingEmployee;
      }

      return null;
    } catch (error) {
      console.error('Error checking for matching employee:', error);
      return null;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      if (isSignUp) {
        if (!fullName.trim()) {
          toast({ title: t('common.error'), description: 'Full name is required.', variant: 'destructive' });
          setIsLoading(false);
          return;
        }
        // Defer user creation: persist credentials to sessionStorage so the
        // onboarding flow can rehydrate even if router state is lost during
        // navigation/re-renders (which caused the bounce-back to landing).
        const normalizedEmail = email.trim().toLowerCase();
        const payload = {
          signupEmail: normalizedEmail,
          signupPassword: password,
          signupFullName: fullName.trim(),
          signupLanguage: signUpLanguage,
        };
        try {
          sessionStorage.setItem('ssaa_pending_signup', JSON.stringify(payload));
        } catch {}
        navigate(inviteToken ? `/onboarding?invite=${inviteToken}` : '/onboarding', {
          state: payload,
        });
        setIsLoading(false);
        return;
      } else {
        const { error } = await signIn(email.trim().toLowerCase(), password);
        if (error) throw error;
        try {
          sessionStorage.removeItem('ssaa_pending_signup');
          sessionStorage.removeItem('ssaa_skip_onboarding_redirect');
        } catch {}
      }
    } catch (error: any) {
      toast({
        title: t('common.error'),
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Left Panel - Hero */}
      <div className="lg:w-1/2 bg-primary relative flex items-center justify-center p-8 lg:p-16">
        <div 
          className="absolute inset-0 bg-cover bg-center opacity-20"
          style={{ backgroundImage: `url(${heroImage})` }}
        />
        <div className="relative z-10 text-center lg:text-left max-w-xl">
          <h1 className="text-4xl lg:text-6xl font-bold text-primary-foreground mb-4">
            SSAA
          </h1>
          <p className="text-2xl lg:text-3xl font-medium text-primary-foreground/90 mb-6 whitespace-pre-line">
            {t('landing.tagline')}
          </p>
          <p className="text-lg text-primary-foreground/80 mb-8">
            {t('landing.description')}
          </p>
          
          {inviteToken && (
            <div className="bg-primary-foreground/20 border border-primary-foreground/30 rounded-lg p-4 mb-6">
              <p className="text-primary-foreground font-medium text-sm">
                {t('landing.invite')}
              </p>
            </div>
          )}
          
          <div className="flex flex-wrap gap-4 justify-center lg:justify-start">
            <div className="flex items-center gap-2 bg-primary-foreground/10 px-4 py-2 rounded-lg">
              <Calendar className="h-5 w-5 text-primary-foreground" />
              <span className="text-primary-foreground text-sm">{t('landing.smartScheduling')}</span>
            </div>
            <div className="flex items-center gap-2 bg-primary-foreground/10 px-4 py-2 rounded-lg">
              <Users className="h-5 w-5 text-primary-foreground" />
              <span className="text-primary-foreground text-sm">{t('landing.teamManagement')}</span>
            </div>
            <div className="flex items-center gap-2 bg-primary-foreground/10 px-4 py-2 rounded-lg">
              <Building2 className="h-5 w-5 text-primary-foreground" />
              <span className="text-primary-foreground text-sm">{t('landing.projectTracking')}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel - Login */}
      <div className="lg:w-1/2 flex items-center justify-center p-8 bg-background">
        <Card className="w-full max-w-md border-primary/20 shadow-lg">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-2xl font-bold text-foreground">
              {isSignUp ? t('landing.createAccount') : t('landing.welcomeBack')}
            </CardTitle>
            <p className="text-muted-foreground text-sm mt-1">
              {isSignUp ? t('landing.signUpDesc') : t('landing.signInDesc')}
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {isSignUp && (
                <div className="space-y-2">
                  <Label htmlFor="fullName">{t('landing.fullName')}</Label>
                  <Input
                    id="fullName"
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="John Smith"
                    className="border-input"
                  />
                </div>
              )}
              
              <div className="space-y-2">
                <Label htmlFor="email">{t('landing.email')}</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  required
                  className="border-input"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="password">{t('landing.password')}</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    className="border-input pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {isSignUp && (
                <div className="space-y-2">
                  <Label htmlFor="language">{t('landing.languagePreference')}</Label>
                  <Select value={signUpLanguage} onValueChange={(v) => setSignUpLanguage(v as Language)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">{t('language.english')}</SelectItem>
                      <SelectItem value="es">{t('language.spanish')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              <Button 
                type="submit" 
                className="w-full"
                disabled={isLoading}
              >
                {isLoading ? t('landing.pleaseWait') : (isSignUp ? t('landing.createAccount') : t('landing.signIn'))}
              </Button>

              <div className="relative my-2">
                <Separator />
                <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-3 text-xs text-muted-foreground">
                  {t('landing.or')}
                </span>
              </div>

              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={isLoading}
                onClick={async () => {
                  setIsLoading(true);
                  try {
                    const { error } = await lovable.auth.signInWithOAuth("google", {
                      redirect_uri: window.location.origin,
                    });
                    if (error) throw error;
                  } catch (error: any) {
                    toast({
                      title: t('common.error'),
                      description: error.message,
                      variant: "destructive",
                    });
                    setIsLoading(false);
                  }
                }}
              >
                <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                {t('landing.continueWithGoogle')}
              </Button>
            </form>

            <div className="mt-6 text-center space-y-3">
              <button
                type="button"
                onClick={() => setIsSignUp(!isSignUp)}
                className="text-primary hover:text-primary/80 text-sm font-medium transition-colors"
              >
                {isSignUp ? t('landing.alreadyHaveAccount') : t('landing.dontHaveAccount')}
              </button>
              
              {!isSignUp && (
                <div className="flex justify-center gap-4 text-sm">
                  <Link to="/forgot-username" className="text-muted-foreground hover:text-primary transition-colors">
                    {t('landing.forgotUsername')}
                  </Link>
                  <Link to="/forgot-password" className="text-muted-foreground hover:text-primary transition-colors">
                    {t('landing.forgotPassword')}
                  </Link>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Landing;
