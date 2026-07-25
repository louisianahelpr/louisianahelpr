import { useState } from "react";
import { Building2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import BusinessLayout from "@/components/business/BusinessLayout";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  Dialog,
  DialogContent,
  DialogHero,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuthReady } from "@/hooks/useAuthReady";
import { queryKeys } from "@/lib/queryKeys";
import { report } from "@/lib/errorLogger";

/**
 * Shown across every /business/* page when the signed-in user isn't part of
 * a business. Since the visitor is ALREADY authenticated, the old "Learn
 * more → /for-business → /signup?type=business" funnel dead-ends (Signup
 * bounces authed users to /dashboard). So the primary action creates the
 * business inline: a single `businesses` insert (the trg_add_owner_as_member
 * trigger auto-creates the owner's active membership), which useMyBusiness
 * then resolves on the next refetch.
 */
export default function BusinessNoAccountState({ title }: { title: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuthReady();
  const [open, setOpen] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const createBusiness = async () => {
    const name = companyName.trim();
    if (!name || !user?.id) return;
    setSubmitting(true);
    try {
      const { error } = await supabase
        .from("businesses")
        .insert({ owner_id: user.id, name });
      if (error) throw error;
      // Refetch the myBusiness lookup (prefix-invalidate all users' keys) so
      // the surrounding page swaps out of this empty state into the suite.
      await queryClient.invalidateQueries({ queryKey: queryKeys.business.allMine });
      toast.success("Business account created.");
      setOpen(false);
      navigate("/business");
    } catch (err) {
      report(err, { tags: { source: "BusinessNoAccountState.createBusiness" } });
      toast.error("Couldn't create the business account. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <BusinessLayout eyebrow="Helpr Business" title={title}>
      <EmptyState
        variant="inline"
        icon={Building2}
        title="You're not part of a business"
        body="Create a business account to add teammates and manage jobs together under one account."
        action={
          <div className="flex flex-col items-center gap-2">
            <Button onClick={() => setOpen(true)}>Create business account</Button>
            <Button variant="ghost" size="sm" onClick={() => navigate("/for-business")}>
              Learn more
            </Button>
          </div>
        }
      />

      <Dialog open={open} onOpenChange={(v) => !submitting && setOpen(v)}>
        <DialogContent>
          <DialogHero
            eyebrow="Helpr Business"
            title="Create your business account"
            subtitle="You'll be the owner. You can invite teammates and manage seats once it's set up."
          />
          <div className="space-y-2">
            <Label htmlFor="business-name">Company name</Label>
            <Input
              id="business-name"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="e.g. Bayou Logistics LLC"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && companyName.trim() && !submitting) {
                  e.preventDefault();
                  void createBusiness();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={createBusiness} disabled={!companyName.trim() || submitting}>
              {submitting ? "Creating…" : "Create business"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BusinessLayout>
  );
}
