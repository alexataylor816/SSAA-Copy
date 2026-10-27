import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import AuthLayout from "@/components/AuthLayout";
import { peekNext } from "@/lib/share";
import GoogleSignInButton, { googleSignInEnabled } from "@/components/GoogleSignInButton";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { tr } from "@/i18n/runtime";

export default function SignUp() {
  const { t } = useLanguage();
  const [params] = useSearchParams();
  // A link like /signup?invite=<companyId> skips onboarding and sends a join
  // request to that company instead, pending the account holder's approval.
  // Everyone else lands on /onboarding after the account exists.
  const inviteCompanyId = params.get("invite");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { signUp, signInWithGoogle } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!fullName.trim()) return setError(tr("signUp.fullNameRequired"));
    if (password.length < 6) return setError(tr("common.passwordMin6"));

    setSubmitting(true);
    try {
      const { error: signUpError } = await signUp(email, password, fullName.trim());
      if (signUpError) throw signUpError;

      if (inviteCompanyId) {
        await api.post(`/companies/${inviteCompanyId}/join-requests`);
        navigate("/dashboard", { state: { pendingJoinRequest: true } });
      } else {
        navigate(peekNext() ?? "/onboarding");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("auth.couldNotCreateAccount"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogleCredential(credential: string) {
    setError(null);
    setSubmitting(true);
    try {
      const { error: googleError } = await signInWithGoogle(credential);
      if (googleError) throw googleError;

      // Google accounts go through onboarding too: the invite link still sends
      // a join request, and everyone else sets up their company there.
      if (inviteCompanyId) {
        await api.post(`/companies/${inviteCompanyId}/join-requests`);
        navigate("/dashboard", { state: { pendingJoinRequest: true } });
      } else {
        navigate(peekNext() ?? "/onboarding");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("signUp.couldNotContinueGoogle"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout inviteNote={inviteCompanyId ? t("signUp.youVeBeenInvitedToJoin") : undefined}>
      <Card className="w-full max-w-md border-primary/20 shadow-lg">
        <CardHeader className="text-center pb-2">
          <CardTitle className="text-2xl font-bold">{t("signUp.createYourAccount")}</CardTitle>
          <p className="text-muted-foreground text-sm mt-1">
            {inviteCompanyId ? t("signUp.youReJoiningAnExistingCompany") : t("signUp.startBySettingUpYourCompany")}
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="fullName">{t("signUp.fullName")}</Label>
              <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder={t("signUp.johnSmith")} required />
            </div>

            {!inviteCompanyId && (
              <p className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
                
                {t("signUp.afterCreatingYourAccountYouLl")}
              </p>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">{t("common.email")}</Label>
              <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">{t("signUp.password")}</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={showPassword ? t("signUp.hidePassword") : t("signUp.showPassword")}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              
              {t("signUp.createAccount")}
            </Button>

            {googleSignInEnabled && (
              <>
                <div className="relative my-2">
                  <Separator />
                  <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-3 text-xs text-muted-foreground">
                    or
                  </span>
                </div>

                <GoogleSignInButton
                  onCredential={(credential) => void handleGoogleCredential(credential)}
                  onError={(message) => setError(message)}
                  disabled={submitting}
                />
              </>
            )}
          </form>

          <div className="mt-6 text-center">
            <Link to="/signin" className="text-sm font-medium text-primary hover:text-primary/80">
              
              {t("signUp.alreadyHaveAnAccountSignIn")}
            </Link>
          </div>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
