import { Link } from "react-router-dom";
import { MailCheck, Clock, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

const SignupPending = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md text-center space-y-8">
        <Link to="/" className="text-3xl font-display font-bold text-primary inline-block">
          Helpr
        </Link>

        <div className="rounded-2xl border border-border bg-card p-8 space-y-6">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
            <MailCheck className="w-8 h-8 text-primary" />
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-foreground">Check your email</h1>
            <p className="text-muted-foreground">
              We've sent a verification link to your email address. Please click the link to verify your account.
            </p>
          </div>

          <div className="border-t border-border pt-6 space-y-4">
            <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">What happens next?</h2>
            
            <div className="flex items-start gap-3 text-left">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <MailCheck className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Verify your email</p>
                <p className="text-xs text-muted-foreground">Click the link in your inbox to confirm your email address.</p>
              </div>
            </div>

            <div className="flex items-start gap-3 text-left">
              <div className="w-8 h-8 rounded-full bg-accent/50 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Clock className="w-4 h-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Profile under review</p>
                <p className="text-xs text-muted-foreground">Our team will review your profile and ID. This usually takes 24–48 hours.</p>
              </div>
            </div>

            <div className="flex items-start gap-3 text-left">
              <div className="w-8 h-8 rounded-full bg-accent/50 flex items-center justify-center flex-shrink-0 mt-0.5">
                <ShieldCheck className="w-4 h-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Get approved</p>
                <p className="text-xs text-muted-foreground">Once approved, you'll have full access to post and accept jobs.</p>
              </div>
            </div>
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          Already verified?{" "}
          <Link to="/login" className="text-primary font-medium hover:underline">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
};

export default SignupPending;
