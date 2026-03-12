import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { LogOut, Shield, Briefcase, Heart } from "lucide-react";
import NotificationPanel from "@/components/NotificationPanel";
import { supabase } from "@/integrations/supabase/client";

interface DashboardHeaderProps {
  isAdmin: boolean;
}

const DashboardHeader = ({ isAdmin }: DashboardHeaderProps) => {
  const navigate = useNavigate();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  return (
    <header className="border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-40">
      <div className="container mx-auto flex items-center justify-between h-16 px-4">
        <Link to="/dashboard" className="text-2xl font-display font-bold text-primary">Helpr</Link>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Button variant="ghost" size="icon" onClick={() => navigate("/admin")}>
              <Shield className="w-4 h-4 text-destructive" />
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => navigate("/post-job")} className="hidden sm:flex">
            <Briefcase className="w-4 h-4 mr-1" /> Post task
          </Button>
          <Button variant="ghost" size="icon" onClick={() => navigate("/favorites")} title="Favorite Helprs">
            <Heart className="w-4 h-4" />
          </Button>
          <NotificationPanel />
          <Button variant="ghost" size="icon" onClick={handleLogout}>
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </header>
  );
};

export default DashboardHeader;
