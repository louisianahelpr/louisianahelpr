import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { X, Info, AlertTriangle, Megaphone } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { report } from "@/lib/errorLogger";
import { useReducedMotion } from "@/lib/accessibility";

interface Broadcast {
  id: string;
  title: string;
  message: string;
  type: string;
  expires_at: string;
}

const typeStyles: Record<string, { bg: string; border: string; icon: React.ReactNode }> = {
  info: { bg: "bg-primary/5", border: "border-primary/20", icon: <Info className="w-4 h-4 text-primary" /> },
  warning: { bg: "bg-accent/10", border: "border-accent/30", icon: <AlertTriangle className="w-4 h-4 text-[hsl(var(--accent-ink))]" /> },
  urgent: { bg: "bg-destructive/10", border: "border-destructive/30", icon: <AlertTriangle className="w-4 h-4 text-[hsl(var(--destructive-ink))]" /> },
  promo: { bg: "bg-primary/5", border: "border-primary/20", icon: <Megaphone className="w-4 h-4 text-primary" /> },
};

const BroadcastBanner = () => {
  const reducedMotion = useReducedMotion();
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);

      const now = new Date().toISOString();

      // Get active broadcasts
      const { data: active, error: activeErr } = await supabase
        .from("broadcast_messages")
        .select("id, title, message, type, expires_at")
        .lte("starts_at", now)
        .gt("expires_at", now)
        .order("created_at", { ascending: false });

      if (activeErr) report(activeErr, { tags: { source: "BroadcastBanner.loadActive" } });
      if (!active || active.length === 0) return;

      // Get user's dismissals
      const { data: dismissals, error: dismissalsErr } = await supabase
        .from("broadcast_dismissals")
        .select("broadcast_id")
        .eq("user_id", user.id);

      if (dismissalsErr) report(dismissalsErr, { tags: { source: "BroadcastBanner.loadDismissals" } });
      const dismissedIds = new Set(dismissals?.map(d => d.broadcast_id) || []);
      setBroadcasts(active.filter(b => !dismissedIds.has(b.id)));
    };
    load();
  }, []);

  const dismiss = async (broadcastId: string) => {
    setBroadcasts(prev => prev.filter(b => b.id !== broadcastId));
    if (userId) {
      const { error: dismissErr } = await supabase.from("broadcast_dismissals").insert({
        broadcast_id: broadcastId,
        user_id: userId,
      });
      if (dismissErr) report(dismissErr, { tags: { source: "BroadcastBanner.dismiss" } });
    }
  };

  if (broadcasts.length === 0) return null;

  return (
    <AnimatePresence>
      {broadcasts.map((b) => {
        const style = typeStyles[b.type] || typeStyles.info;
        return (
          <motion.div
            key={b.id}
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
            animate={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: reducedMotion ? 0.15 : 0.3 }}
            className={`rounded-ds-md border ${style.border} ${style.bg} px-4 py-3 relative`}
          >
            <button
              onClick={() => dismiss(b.id)}
              className="absolute top-2.5 right-2.5 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="flex items-start gap-3 pr-6">
              <div className="mt-0.5 shrink-0">{style.icon}</div>
              <div>
                <p className="text-ds-13 font-semibold text-foreground">{b.title}</p>
                <p className="text-ds-11 text-muted-foreground mt-0.5">{b.message}</p>
              </div>
            </div>
          </motion.div>
        );
      })}
    </AnimatePresence>
  );
};

export default BroadcastBanner;
