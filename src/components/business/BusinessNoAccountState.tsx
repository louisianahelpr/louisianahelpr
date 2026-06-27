import { Building2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import BusinessLayout from "@/components/business/BusinessLayout";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";

/**
 * Shown across every /business/* page when the signed-in user isn't part of
 * a business. Keeps the suite's side-nav shell + a single "Learn more" CTA so
 * the whole section behaves the same, instead of some pages rendering this
 * state while others silently bounce the user out to /dashboard.
 */
export default function BusinessNoAccountState({ title }: { title: string }) {
  const navigate = useNavigate();
  return (
    <BusinessLayout eyebrow="Helpr Business" title={title}>
      <EmptyState
        variant="inline"
        icon={Building2}
        eyebrow="No business account"
        title="You're not part of a business"
        body="Sign up as a business to add teammates and manage jobs together under one account."
        action={<Button onClick={() => navigate("/for-business")}>Learn more</Button>}
      />
    </BusinessLayout>
  );
}
