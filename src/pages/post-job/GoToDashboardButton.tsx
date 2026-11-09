import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { safeStorage } from "@/lib/safeStorage";

/**
 * /payment-success's last button: back to the Dashboard, dropping the "last posted job" pointer on the way (moved out
 * of PaymentSuccess.tsx unchanged to keep that file under the component size ratchet, l142).
 */
export function GoToDashboardButton() {
  const navigate = useNavigate();
  return (
    <Button
      variant="ghost"
      onClick={() => {
        try {
          safeStorage.removeItem("helpr_last_posted_job_id");
        } catch {
          // Silent by design — the same convenience pointer PaymentSuccess clears; a
          // stale value is handled by every reader.
        }
        navigate("/home");
      }}
      className="w-full rounded-full"
      style={{ color: "hsl(var(--bark))" }}
    >
      Go to Dashboard
    </Button>
  );
}
