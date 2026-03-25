import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { CheckCircle, ShieldCheck } from "lucide-react";
import { usePageTitle } from "@/hooks/usePageTitle";

const PaymentSuccess = () => {
  usePageTitle("Payment Authorized — Helpr");
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="text-center space-y-6 max-w-md">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
          <CheckCircle className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-3xl font-display font-bold text-foreground">Payment authorized!</h1>
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">
          <ShieldCheck className="w-5 h-5 text-primary shrink-0" />
          <p>Your payment has been securely processed. The helpr will be paid once both you and the helpr confirm the job is complete.</p>
        </div>
        <p className="text-muted-foreground">
          Your task is now live and visible to nearby helprs. Once a helpr applies and you accept them, the job begins. When the work is done, both parties mark it complete to release payment. If one side confirms and the other doesn't respond within 72 hours, payment is released automatically.
        </p>
        <Button size="lg" onClick={() => navigate("/dashboard")}>
          Back to dashboard
        </Button>
      </div>
    </div>
  );
};

export default PaymentSuccess;
