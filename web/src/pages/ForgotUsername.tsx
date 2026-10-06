import { useState } from "react";
import { Link } from "react-router-dom";
import { authApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import AuthLayout from "@/components/AuthLayout";
import { Loader2 } from "lucide-react";

export default function ForgotUsername() {
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<{ delivered: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      setResult(await authApi.requestUsernameReminder(email.trim().toLowerCase()));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout>
      <Card className="w-full max-w-md border-primary/20 shadow-lg">
        <CardHeader className="text-center pb-2">
          <CardTitle className="text-2xl font-bold">Forgot your username?</CardTitle>
          <p className="text-muted-foreground text-sm mt-1">We&apos;ll email it if the address is registered.</p>
        </CardHeader>
        <CardContent>
          {result ? (
            <div className="space-y-4 text-center">
              <p className="text-sm text-muted-foreground">
                {result.delivered
                  ? "Check your inbox for your username."
                  : "If that address is registered, we've requested a reminder. Contact your company admin if it doesn't arrive."}
              </p>
              <Button variant="outline" className="w-full" onClick={() => setResult(null)}>
                Try another email
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
                Send reminder
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