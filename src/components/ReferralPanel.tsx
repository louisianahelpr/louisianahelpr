import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Gift } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import ReferralSection from "@/components/ReferralSection";

const ReferralPanel = () => {
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    if (open && !userId) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user) setUserId(session.user.id);
      });
    }
  }, [open, userId]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" title="Referral Program" className="hover:bg-accent/20 hover:text-accent-foreground btn-press rounded-xl h-9 w-9">
          <Gift className="w-4 h-4" />
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md p-0">
        <SheetHeader className="p-4 border-b border-border">
          <SheetTitle className="font-display">Referral Program</SheetTitle>
        </SheetHeader>
        <div className="overflow-y-auto max-h-[calc(100vh-5rem)] p-4">
          {userId ? (
            <ReferralSection userId={userId} />
          ) : (
            <p className="text-sm text-muted-foreground text-center py-12">Loading…</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default ReferralPanel;
