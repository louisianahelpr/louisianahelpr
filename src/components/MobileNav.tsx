import { useLocation, useNavigate } from "react-router-dom";
import { Home, ClipboardList, MessageSquare, User, Plus } from "lucide-react";

const leftItems = [
  { path: "/dashboard", icon: Home, label: "Home" },
  { path: "/activity", icon: ClipboardList, label: "Activity" },
];

const rightItems = [
  { path: "/messages", icon: MessageSquare, label: "Messages" },
  { path: "/profile", icon: User, label: "Profile" },
];

const MobileNav = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const authPages = ["/dashboard", "/activity", "/post-job", "/profile", "/messages", "/admin", "/support"];
  if (!authPages.some((p) => location.pathname.startsWith(p))) return null;

  const renderItem = ({ path, icon: Icon, label }: { path: string; icon: any; label: string }) => {
    const active = location.pathname === path;
    return (
      <button
        key={path}
        onClick={() => navigate(path)}
        className={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full text-xs transition-colors ${
          active ? "text-primary" : "text-muted-foreground"
        }`}
      >
        <Icon className="w-5 h-5" />
        <span className="font-medium">{label}</span>
      </button>
    );
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden">
      <div className="mx-3 mb-2 flex items-end gap-2">
        {/* Main nav pill */}
        <div className="flex-1 rounded-2xl border border-white/20 bg-background/60 backdrop-blur-xl shadow-[0_-4px_30px_-4px_hsl(158_45%_42%/0.12),inset_0_1px_0_0_hsl(0_0%_100%/0.15)]">
          <div className="flex items-center justify-around h-14 px-2">
            {leftItems.map(renderItem)}
            {rightItems.map(renderItem)}
          </div>
        </div>

        {/* Post button bubble */}
        <button
          onClick={() => navigate("/post-job")}
          className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-[0_4px_20px_-2px_hsl(158_45%_42%/0.5)] flex items-center justify-center transition-transform hover:scale-105 active:scale-95 shrink-0 border border-white/20"
        >
          <Plus className="w-7 h-7" strokeWidth={2.5} />
        </button>
      </div>
    </nav>
  );
};

export default MobileNav;
