import { useLocation, useNavigate } from "react-router-dom";
import { Home, ClipboardList, MessageSquare, User, Plus, LifeBuoy } from "lucide-react";

const leftItems = [
  { path: "/dashboard", icon: Home, label: "Home" },
  { path: "/activity", icon: ClipboardList, label: "Activity" },
];

const rightItems = [
  { path: "/messages", icon: MessageSquare, label: "Messages" },
  { path: "/support", icon: LifeBuoy, label: "Support" },
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
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-background border-t border-border md:hidden">
      <div className="flex items-center justify-around h-16 px-1 relative">
        {leftItems.map(renderItem)}

        {/* Center Post button */}
        <div className="flex flex-col items-center justify-center flex-1">
          <button
            onClick={() => navigate("/post-job")}
            className="-mt-6 w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center transition-transform hover:scale-105 active:scale-95"
          >
            <Plus className="w-7 h-7" strokeWidth={2.5} />
          </button>
        </div>

        {rightItems.map(renderItem)}
      </div>
    </nav>
  );
};

export default MobileNav;
