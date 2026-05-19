import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { LogOut, Shield, Menu } from "lucide-react";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import NotificationPanel from "@/components/NotificationPanel";
import { supabase } from "@/integrations/supabase/client";
import { channelNonce } from "@/lib/realtimeChannel";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import HelprMark from "@/components/HelprMark";

interface DashboardHeaderProps {
  title?: string;
  onMenuClick?: () => void;
}

const DashboardHeader = ({ title, onMenuClick }: DashboardHeaderProps) => {
  const navigate = useNavigate();
  const { isAdmin, user } = useCurrentUser();
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [, setUnreadMessages] = useState(0);

  useEffect(() => {
    if (!user) return;
    const loadUnread = () => {
      supabase.from("messages").select("*", { count: "exact", head: true }).eq("receiver_id", user.id).eq("read", false)
        .then(({ count }) => setUnreadMessages(count || 0));
    };
    loadUnread();
    const channel = supabase.channel(`header-unread-${user.id}-${channelNonce()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `receiver_id=eq.${user.id}` }, () => loadUnread())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id]);

  const handleLogout = async () => {
    setLoggingOut(true);
    await supabase.auth.signOut();
    navigate("/");
  };

  return (
    <>
      {/* Pinned top nav — sticky so iOS rubber-band scrolling can never
          detach it from the viewport edge (a fixed bar would briefly drift
          on overscroll). High z-index so all page content + cards scroll
          underneath. Frosted-glass surface matches PageHeader exactly. */}
      <header className="glass-header sticky top-0 z-50">
        <div className="w-full flex h-14 items-center justify-between gap-2 px-5 lg:px-8 xl:px-12">
          <div className="flex items-center gap-2 min-w-0">
            {title ? (
              <span className="font-display font-bold text-foreground text-ds-15 truncate">{title}</span>
            ) : (
              <HelprMark to="/dashboard" size="md" />
            )}
          </div>
          <div className="flex items-center gap-1 -mr-1">
            {isAdmin && (
              <Button variant="ghost" size="icon" onClick={() => navigate("/admin")} className="btn-press rounded-ds-md h-9 w-9" aria-label="Admin panel" style={{ color: "hsl(var(--olivewood))" }}>
                <Shield className="w-4 h-4" />
              </Button>
            )}
            <NotificationPanel />
            {onMenuClick && (
              <Button variant="ghost" size="icon" onClick={onMenuClick} className="lg:hidden hover:bg-muted btn-press rounded-ds-md h-9 w-9" aria-label="Open menu">
                <Menu className="w-4 h-4" />
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={() => setShowLogoutDialog(true)} className="hover:bg-destructive/10 hover:text-destructive btn-press rounded-ds-md h-9 w-9" aria-label="Log out">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <BrandConfirmDialog
        open={showLogoutDialog}
        onOpenChange={setShowLogoutDialog}
        title="See you soon?"
        description="You'll need to sign back in next time. Your posts and messages stay safe."
        primaryLabel={loggingOut ? "Logging out…" : "Log out"}
        primaryTone="bark"
        primaryHaptic="medium"
        primaryDisabled={loggingOut}
        onPrimary={handleLogout}
        secondaryLabel="Stay logged in"
      />
    </>
  );
};

export default DashboardHeader;
