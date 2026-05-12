import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { LogOut, Shield, Menu } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import NotificationPanel from "@/components/NotificationPanel";

import ThemeToggle from "@/components/ThemeToggle";
import { supabase } from "@/integrations/supabase/client";
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
    const channel = supabase.channel(`header-unread-${user.id}`)
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
      <header
        className="sticky top-0 z-50 border-b border-white/20 bg-white/60 dark:bg-white/5 backdrop-blur-[12px] backdrop-saturate-150 shadow-[0_4px_20px_-8px_hsl(0_0%_0%/0.08)]"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)", WebkitBackdropFilter: "blur(12px) saturate(1.5)" }}
      >
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
              <Button variant="ghost" size="icon" onClick={() => navigate("/admin")} className="hover:bg-destructive/10 btn-press rounded-ds-md h-9 w-9" aria-label="Admin panel">
                <Shield className="w-4 h-4 text-destructive" />
              </Button>
            )}
            <ThemeToggle />
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

      <AlertDialog open={showLogoutDialog} onOpenChange={setShowLogoutDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle
              className="font-display italic font-bold text-center"
              style={{
                fontSize: "clamp(1.4rem, 2vw + 0.4rem, 1.65rem)",
                color: "hsl(var(--ink-deep))",
                letterSpacing: "-0.025em",
              }}
            >
              See you soon?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-center font-serif italic text-ds-13" style={{ color: "hsl(var(--olivewood) / 0.75)" }}>
              You'll need to sign back in next time. Your posts and messages stay safe.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col-reverse sm:flex-col-reverse gap-2 sm:space-x-0">
            <AlertDialogCancel className="mt-0 rounded-ds-md border-border/60">
              Stay logged in
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleLogout}
              disabled={loggingOut}
              className="rounded-ds-md"
              style={{
                background: "hsl(var(--bark))",
                color: "hsl(var(--parchment))",
                border: "1px solid hsl(70 22% 24%)",
                fontFamily: "Montserrat, system-ui, sans-serif",
                fontWeight: 600,
                boxShadow:
                  "inset 0 1px 0 0 rgba(255, 255, 255, 0.12), " +
                  "0 1px 2px hsl(70 20% 18% / 0.18), " +
                  "0 6px 14px -4px hsl(var(--bark) / 0.4)",
              }}
            >
              {loggingOut ? "Logging out…" : "Log out"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default DashboardHeader;
