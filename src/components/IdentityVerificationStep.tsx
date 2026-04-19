import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ShieldCheck, Loader2, CheckCircle2, AlertCircle, Camera } from "lucide-react";
import { loadStripe, Stripe } from "@stripe/stripe-js";

interface Props {
  /** Called after IDV finishes (verified, processing, or failed). */
  onComplete: (status: "verified" | "processing" | "manual_review" | "failed") => void;
  /** Called if hybrid IDV is disabled or unavailable — caller falls back to manual upload. */
  onFallbackToManual: () => void;
}

let stripePromise: Promise<Stripe | null> | null = null;
const getStripe = async () => {
  if (!stripePromise) {
    const { data, error } = await supabase.functions.invoke("get-stripe-public-key");
    if (error || !data?.publishable_key) throw new Error("Stripe is not configured");
    stripePromise = loadStripe(data.publishable_key);
  }
  return stripePromise;
};

export const IdentityVerificationStep = ({ onComplete, onFallbackToManual }: Props) => {
  const [hybridEnabled, setHybridEnabled] = useState<boolean | null>(null);
  const [launching, setLaunching] = useState(false);
  const [polling, setPolling] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("get_public_platform_settings");
      const row = Array.isArray(data) ? data[0] : null;
      setHybridEnabled(!!row?.hybrid_idv_enabled);
    })();
  }, []);

  const launchVerification = async () => {
    setLaunching(true);
    try {
      const stripe = await getStripe();
      if (!stripe) throw new Error("Stripe failed to load");

      const { data, error } = await supabase.functions.invoke("create-idv-session");
      if (error || !data?.client_secret) {
        throw new Error(data?.error || "Could not start verification");
      }

      const result = await stripe.verifyIdentity(data.client_secret);
      if (result.error) {
        toast.error(result.error.message || "Verification was cancelled");
        setLaunching(false);
        return;
      }

      // Stripe modal closed successfully — webhook will update status.
      setLaunching(false);
      setPolling(true);
      pollStatus();
    } catch (err: any) {
      toast.error(err.message || "Verification failed to start");
      setLaunching(false);
    }
  };

  const pollStatus = async () => {
    let attempts = 0;
    const maxAttempts = 20; // 60 seconds total
    const interval = setInterval(async () => {
      attempts++;
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { clearInterval(interval); return; }

      const { data: profile } = await supabase
        .from("profiles")
        .select("idv_status")
        .eq("user_id", session.user.id)
        .maybeSingle();

      const s = profile?.idv_status;
      setStatus(s || null);

      if (s === "verified") {
        clearInterval(interval);
        setPolling(false);
        toast.success("Identity verified!");
        onComplete("verified");
      } else if (s === "manual_review" || s === "failed") {
        clearInterval(interval);
        setPolling(false);
        onComplete(s as any);
      } else if (attempts >= maxAttempts) {
        clearInterval(interval);
        setPolling(false);
        // Still processing — that's OK
        onComplete("processing");
      }
    }, 3000);
  };

  if (hybridEnabled === null) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!hybridEnabled) {
    // Kill-switch is off — fall back to manual upload
    onFallbackToManual();
    return null;
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="text-center space-y-2">
        <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
          <ShieldCheck className="w-7 h-7 text-primary" />
        </div>
        <h3 className="font-semibold text-foreground">Verify your identity</h3>
        <p className="text-sm text-muted-foreground">
          We use Stripe Identity to instantly verify your government-issued ID and selfie. This usually takes under 2 minutes and helps build trust in the Helpr community.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
        <div className="rounded-lg bg-secondary/30 p-2.5 text-center">
          <Camera className="w-4 h-4 mx-auto text-primary mb-1" />
          <p className="font-medium text-foreground">Live capture</p>
          <p className="text-muted-foreground">No uploaded photos</p>
        </div>
        <div className="rounded-lg bg-secondary/30 p-2.5 text-center">
          <CheckCircle2 className="w-4 h-4 mx-auto text-primary mb-1" />
          <p className="font-medium text-foreground">Instant approval</p>
          <p className="text-muted-foreground">For most users</p>
        </div>
        <div className="rounded-lg bg-secondary/30 p-2.5 text-center">
          <ShieldCheck className="w-4 h-4 mx-auto text-primary mb-1" />
          <p className="font-medium text-foreground">Bank-grade</p>
          <p className="text-muted-foreground">Stripe-powered</p>
        </div>
      </div>

      {polling && (
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 flex items-start gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-amber-600 mt-0.5 shrink-0" />
          <div className="text-xs">
            <p className="font-medium text-foreground">Processing your verification…</p>
            <p className="text-muted-foreground">Current status: {status || "pending"}</p>
          </div>
        </div>
      )}

      <Button
        onClick={launchVerification}
        disabled={launching || polling}
        className="w-full"
        size="lg"
      >
        {launching ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Opening secure verification…</> :
         polling ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Waiting for result…</> :
         <><ShieldCheck className="w-4 h-4 mr-2" /> Start verification</>}
      </Button>

      <p className="text-xs text-muted-foreground text-center">
        ⚠️ You only get <strong>one verification attempt</strong>. If it fails, an admin will review manually.
      </p>
    </div>
  );
};

export default IdentityVerificationStep;
