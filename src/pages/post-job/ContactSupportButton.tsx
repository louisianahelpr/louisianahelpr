import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { hapticLight } from "@/lib/haptics";

/**
 * /payment-success's "Contact support" (moved out of PaymentSuccess.tsx unchanged to keep that file under the
 * component size ratchet, jobs audit 11-21; the same move as GoToDashboardButton).
 */
export function ContactSupportButton() {
  const navigate = useNavigate();
  return (
    <Button
      variant="ghost"
      onClick={() => {
        void hapticLight();
        navigate("/support");
      }}
      className="w-full rounded-full"
      style={{ color: "hsl(var(--bark))" }}
    >
      Contact support
    </Button>
  );
}
