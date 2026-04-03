import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { LogOut, Shield, Menu, MessageSquare } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import NotificationPanel from "@/components/NotificationPanel";

import ThemeToggle from "@/components/ThemeToggle";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";

interface DashboardHeaderProps {
  title?: string;
  onMenuClick?: () => void;
}

const DashboardHeader = ({ title, onMenuClick }: DashboardHeaderProps) => {
  const navigate = useNavigate();
  const { isAdmin, user } = useCurrentUser();
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [unreadMessages, setUnreadMessages] = useState(0);

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
      <header className="sticky top-0 z-40 glass border-b border-border/30">
        <div className="container mx-auto flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-2">
            {title ? (
              <span className="text-lg font-display font-bold text-foreground">{title}</span>
            ) : (
              <Link to="/dashboard" className="flex items-center gap-2 group">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-md transition-transform duration-200 group-hover:scale-105">
                  <span className="text-primary-foreground font-bold text-sm">H</span>
                </div>
                <span className="text-lg font-display font-bold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
                  Helpr
                </span>
              </Link>
            )}
          </div>
          <div className="flex items-center gap-1">
            {isAdmin && (
              <Button variant="ghost" size="icon" onClick={() => navigate("/admin")} className="hover:bg-destructive/10 btn-press rounded-xl h-9 w-9" aria-label="Admin panel">
                <Shield className="w-4 h-4 text-destructive" />
              </Button>
            )}
            
            <Button variant="ghost" size="icon" onClick={() => navigate("/messages")} className="relative hover:bg-muted btn-press rounded-xl h-9 w-9" aria-label="Messages">
              <MessageSquare className="w-4 h-4" />
              {unreadMessages > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full bg-destructive text-destructive-foreground text-[10px] flex items-center justify-center font-bold px-1">
                  {unreadMessages > 9 ? "9+" : unreadMessages}
                </span>
              )}
            </Button>
            
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
