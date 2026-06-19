import { Shield } from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";

/* ─── Admin badge that toggles the sidebar ─── */
const AdminBadgeToggle = () => {
  const { toggleSidebar } = useSidebar();
  return (
    <button
      type="button"
      onClick={toggleSidebar}
      aria-label="Toggle admin menu"
      className="flex items-center gap-1.5 px-2 h-9 rounded-ds-md bg-destructive/10 text-destructive hover:bg-destructive/20 mr-1 btn-press"
    >
      <Shield className="w-3.5 h-3.5" />
      <span className="text-ds-11 font-bold uppercase tracking-wide">Admin</span>
    </button>
  );
};

export default AdminBadgeToggle;
