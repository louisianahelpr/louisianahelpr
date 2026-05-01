import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { LogOut, Shield, Menu } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import NotificationPanel from "@/components/NotificationPanel";

import ThemeToggle from "@/components/ThemeToggle";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import helprIcon from "@/assets/helpr-icon-96.png";

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
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-2 px-5">
          <div className="flex items-center gap-2 min-w-0">
            {title ? (
              <span className="font-display font-bold text-foreground text-base truncate">{title}</span>
            ) : (
              <Link to="/dashboard" className="flex items-center gap-2 group">
                <span className="w-8 h-8 rounded-xl bg-white shadow-md flex items-center justify-center overflow-hidden transition-transform duration-200 group-hover:scale-105">
                  <img
                    src={helprIcon}
                    alt="Helpr"
                    className="w-8 h-8 object-contain translate-y-[3px]"
                  />
                </span>
                <span className="text-lg font-display font-bold text-primary leading-none">
                  Helpr
                </span>
              </Link>
            )}
          </div>
          <div className="flex items-center gap-1 -mr-1">
            {isAdmin && (
              <Button variant="ghost" size="icon" onClick={() => navigate("/admin")} className="hover:bg-destructive/10 btn-press rounded-xl h-9 w-9" aria-label="Admin panel">
                <Shield className="w-4 h-4 text-destructive" />
              </Button>
            )}
            <ThemeToggle />
            <NotificationPanel />
            {onMenuClick && (
              <Button variant="ghost" size="icon" onClick={onMenuClick} className="lg:hidden hover:bg-muted btn-press rounded-xl h-9 w-9" aria-label="Open menu">
                <Menu className="w-4 h-4" />
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={() => setShowLogoutDialog(true)} className="hover:bg-destructive/10 hover:text-destructive btn-press rounded-xl h-9 w-9" aria-label="Log out">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <AlertDialog open={showLogoutDialog} onOpenChange={setShowLogoutDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Log out?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to log out of your account?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleLogout} disabled={loggingOut} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {loggingOut ? "Logging out…" : "Log out"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default DashboardHeader;
