import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArrowLeft, Mail, Loader2 } from "lucide-react";

const ForgotPassword = () => {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
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
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <Link to="/" className="text-3xl font-display font-bold text-primary">Helpr</Link>
          <p className="mt-2 text-muted-foreground">Reset your password</p>
        </div>

        {sent ? (
          <div className="text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
              <Mail className="w-8 h-8 text-primary" />
            </div>
            <p className="text-foreground font-medium">Check your email</p>
            <p className="text-sm text-muted-foreground">
              We sent a password reset link to <span className="font-medium text-foreground">{email}</span>
            </p>
            <Button variant="outline" className="w-full" onClick={() => setSent(false)}>
              Try a different email
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
              />
            </div>
            <Button type="submit" className="w-full" size="lg" disabled={loading}>
              {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending…</> : "Send reset link"}
            </Button>
          </form>
        )}

        <p className="text-center text-sm text-muted-foreground">
          <Link to="/login" className="text-primary font-medium hover:underline inline-flex items-center gap-1">
            <ArrowLeft className="w-3 h-3" /> Back to login
          </Link>
        </p>
      </div>
    </div>
  );
};

export default ForgotPassword;
