import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { CheckCircle, ShieldCheck } from "lucide-react";

const PaymentSuccess = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const jobId = searchParams.get("job_id");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (jobId) {
      setSaving(true);
      // Retrieve the checkout session's payment intent and store it, then mark in_progress
      (async () => {
        try {
          const { data: job } = await supabase
            .from("jobs")
            .select("stripe_session_id")
            .eq("id", jobId)
            .single();

          // Update job status to in_progress (escrow is already set by create-payment)
          await supabase
            .from("jobs")
            .update({ status: "in_progress" })
            .eq("id", jobId);
        } catch (e) {
          console.error("Post-payment update error:", e);
        } finally {
          setSaving(false);
        }
      })();
    }
  }, [jobId]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="text-center space-y-6 max-w-md">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
          <CheckCircle className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-3xl font-display font-bold text-foreground">Payment authorized!</h1>
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">
          <ShieldCheck className="w-5 h-5 text-primary shrink-0" />
          <p>Your payment is held in escrow. Funds will only be captured when both you and the helper confirm the job is complete.</p>
        </div>
        <p className="text-muted-foreground">
          The helper has been notified and the task is now in progress. If neither party confirms within 72 hours of the first confirmation, payment is auto-released.
        </p>
        <Button size="lg" onClick={() => navigate("/dashboard")}>
          Back to dashboard
        </Button>
      </div>
    </div>
  );
};

export default PaymentSuccess;