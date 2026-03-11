import { useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { CheckCircle } from "lucide-react";

const PaymentSuccess = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const jobId = searchParams.get("job_id");

  useEffect(() => {
    // Mark job as in_progress after successful payment
    if (jobId) {
      supabase
        .from("jobs")
        .update({ status: "in_progress" })
        .eq("id", jobId)
        .then(({ error }) => {
          if (error) console.error("Failed to update job status:", error);
        });
    }
  }, [jobId]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="text-center space-y-6 max-w-md">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
          <CheckCircle className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-3xl font-display font-bold text-foreground">Payment successful!</h1>
        <p className="text-muted-foreground">
          Your payment has been processed. The helper has been notified and the task is now in progress.
        </p>
        <Button size="lg" onClick={() => navigate("/dashboard")}>
          Back to dashboard
        </Button>
      </div>
    </div>
  );
};

export default PaymentSuccess;
