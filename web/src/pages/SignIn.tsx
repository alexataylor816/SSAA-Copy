import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
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

export default function SignIn() {
  const { t } = useLanguage();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { signIn, signInWithGoogle } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error: signInError } = await signIn(email, password);
    setSubmitting(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }
    navigate(peekNext() ?? "/dashboard");
  }

  async function handleGoogleCredential(credential: string) {
    setError(null);
    setSubmitting(true);
    const { error: googleError } = await signInWithGoogle(credential);
    setSubmitting(false);
    if (googleError) {
      setError(googleError.message);
      return;
    }
    navigate(peekNext() ?? "/dashboard");
  }

  return (
    <AuthLayout>
      <Card className="w-full max-w-md border-primary/20 shadow-lg">
        <CardHeader className="text-center pb-2">
          <CardTitle className="text-2xl font-bold">{t("signIn.welcomeBack")}</CardTitle>
          <p className="text-muted-foreground text-sm mt-1">{t("signIn.signInToAccessYourDashboard")}</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t("common.email")}</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">{t("signIn.password")}</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={showPassword ? t("signIn.hidePassword") : t("signIn.showPassword")}
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
              
              {t("signIn.signIn")}
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

          <div className="mt-6 text-center space-y-3">
            <Link to="/signup" className="text-sm font-medium text-primary hover:text-primary/80">
              
              {t("signIn.donTHaveAnAccountSign")}
            </Link>
            <div className="flex justify-center gap-4 text-sm">
              <Link to="/forgot-username" className="text-muted-foreground hover:text-primary transition-colors">
                
                {t("signIn.forgotUsername")}
              </Link>
              <Link to="/forgot-password" className="text-muted-foreground hover:text-primary transition-colors">
                
                {t("signIn.forgotPassword")}
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}