/**
 * /rentals/invite/:token — a tenant opens their landlord's invite link
 * (Q37). Joining is one tap; the server checks the link (unused, unexpired,
 * not the landlord's own) and the member gates (18+, not restricted).
 */
import { useNavigate, useParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import AppPage from "@/components/AppPage";
import { Button } from "@/components/ui/button";
import { acceptInvite } from "@/lib/rentals/api";
import { rentalsErrorMessage } from "@/lib/rentals/copy";
import { useAgeGate } from "@/hooks/useAgeGate";
import { RentalsCard } from "./rentalsUi";

export default function RentalsInviteView() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const { underAge } = useAgeGate();
  const m = useMutation({
    mutationFn: () => acceptInvite(token),
    onSuccess: () => {
      toast.success("You're connected. You can send repair requests now.");
      navigate("/rentals", { replace: true });
    },
    onError: (e) => toast.error(rentalsErrorMessage(e)),
  });
  return (
    <AppPage title="Join your rental" backTo="/rentals">
      <RentalsCard title="Your landlord invited you">
        <p className="text-sm">
          Join to send repair requests to your landlord in the app. Your landlord approves each request and pays for the
          Helpr who fixes it.
        </p>
        <Button type="button" size="sm" disabled={m.isPending || underAge} onClick={() => m.mutate()}>
          {m.isPending ? "Joining…" : "Join"}
        </Button>
        {underAge && <p className="text-sm">You must be 18 or older to join as a tenant.</p>}
      </RentalsCard>
    </AppPage>
  );
}
