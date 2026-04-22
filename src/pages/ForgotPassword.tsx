import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { getPublicResetPasswordUrl } from "@/lib/authRedirects";
import { toast } from "sonner";
import { ArrowLeft, Mail, Loader2 } from "lucide-react";

const ForgotPassword = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: getPublicResetPasswordUrl(),
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      setSent(true);
      toast.success("Check your email for a reset link!");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-secondary/20 px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link to="/" className="inline-block text-3xl font-display font-bold text-primary">
            Helpr
          </Link>
          <p className="mt-2 text-sm text-muted-foreground">Reset your password</p>
        </div>

        <div className="rounded-2xl border border-border/60 bg-card shadow-[var(--card-shadow)] p-6 sm:p-7 space-y-5">
        {sent ? (
          <div className="text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
              <Mail className="w-8 h-8 text-primary" />
            </div>
            <p className="text-foreground font-medium">Check your inbox</p>
            <p className="text-sm text-muted-foreground">
              We sent a reset link to <span className="font-medium text-foreground">{email}</span>. It expires in 1 hour.
            </p>
            <p className="text-xs text-muted-foreground/80">
              Don't see it? Check your spam folder or wait a minute — emails can take a moment to arrive.
            </p>
            <Button variant="outline" className="w-full" onClick={() => setSent(false)}>
              Use a different email
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email address</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <Button type="submit" className="w-full" size="lg" disabled={loading}>
              {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending…</> : "Send reset link"}
            </Button>
          </form>
        )}

        <p className="text-center text-sm text-muted-foreground pt-1">
          <Link to="/login" className="text-primary font-semibold hover:underline inline-flex items-center gap-1">
            <ArrowLeft className="w-3 h-3" /> Back to login
          </Link>
        </p>
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
