import { useState } from "react";
import { Link } from "react-router-dom";
import { authApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import AuthLayout from "@/components/AuthLayout";
import { Loader2 } from "lucide-react";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      // Always the same answer whether or not the email is registered.
      const res = await authApi.requestPasswordReset(email.trim().toLowerCase());
      setDevCode(res.devCode ?? null);
      setSent(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout>
      <Card className="w-full max-w-md border-primary/20 shadow-lg">
        <CardHeader className="text-center pb-2">
          <CardTitle className="text-2xl font-bold">Reset your password</CardTitle>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="space-y-4 text-center">
              <p className="text-sm text-muted-foreground">
                If that email is registered, we&apos;ve sent a reset code. Check your inbox.
              </p>
              {devCode && (
                <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                  No mail provider is configured, so here is the code: <span className="font-mono">{devCode}</span>
                </p>
              )}
              <Button asChild variant="outline" className="w-full">
                <Link to="/reset-password">Enter the code</Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Send reset code
              </Button>
            </form>
          )}

          <div className="mt-6 text-center">
            <Link to="/signin" className="text-sm text-muted-foreground hover:text-primary transition-colors">
              Back to sign in
            </Link>
          </div>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}