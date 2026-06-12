import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { X, Plus, CloudLightning, Truck, RefreshCw, Briefcase, PawPrint } from "lucide-react";
import type { LifeEventTrigger } from "@/lib/lifeEventTriggers";

const ICON_MAP: Record<string, React.ReactNode> = {
  Plus: <Plus className="w-5 h-5" strokeWidth={2.25} />,
  CloudLightning: <CloudLightning className="w-5 h-5" strokeWidth={2} />,
  Truck: <Truck className="w-5 h-5" strokeWidth={2} />,
  RefreshCw: <RefreshCw className="w-5 h-5" strokeWidth={2} />,
  Briefcase: <Briefcase className="w-5 h-5" strokeWidth={2} />,
  PawPrint: <PawPrint className="w-5 h-5" strokeWidth={2} />,
};

interface Props {
  trigger: LifeEventTrigger;
  onDismiss: () => void;
}

/**
 * LifeEventCard — dismissible contextual prompt banner on the home feed.
 * Appears above the storm banner (even more personalized).
 * Styled as a glass card with bark-adjacent accent.
 */
export const LifeEventCard = ({ trigger, onDismiss }: Props) => {
  const navigate = useNavigate();

  const handleDismiss = () => {
    try {
      localStorage.setItem(trigger.dismissKey, "1");
    } catch {
      /* private-browsing / quota — ignore */
    }
    onDismiss();
  };

  const handleCta = () => {
    handleDismiss();
    navigate(trigger.ctaPath);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
      transition={{ duration: 0.28 }}
      className="shrink-0 mx-4 mb-1 rounded-ds-md px-3 py-3 flex items-center gap-3"
      style={{
        background:
          "radial-gradient(70% 100% at 0% 50%, hsl(var(--burnt-sienna) / 0.08) 0%, transparent 60%)",
        border: "0.5px solid hsl(var(--burnt-sienna) / 0.22)",
        backdropFilter: "blur(10px)",
      }}
    >
      {/* Icon tile */}
      <div
        className="shrink-0 w-9 h-9 rounded-ds-sm flex items-center justify-center"
        style={{
          background: "hsl(var(--burnt-sienna) / 0.12)",
          color: "hsl(var(--burnt-sienna))",
        }}
        aria-hidden
      >
        {ICON_MAP[trigger.icon] ?? <Plus className="w-5 h-5" strokeWidth={2.25} />}
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p
          className="font-display italic font-semibold leading-tight"
          style={{ fontSize: "0.87rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.01em" }}
        >
          {trigger.headline}
        </p>
        <p
          className="font-serif italic text-ds-11 leading-snug mt-0.5"
          style={{ color: "hsl(var(--olivewood) / 0.75)" }}
        >
          {trigger.subtext}
        </p>
        <button
          type="button"
          onClick={handleCta}
          className="mt-1.5 font-sans font-semibold text-ds-11 tracking-wide underline underline-offset-2 active:opacity-70 transition-opacity"
          style={{ color: "hsl(var(--burnt-sienna))" }}
        >
          {trigger.ctaLabel}
        </button>
      </div>

      {/* Dismiss */}
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss"
        className="shrink-0 -mt-1 -mr-1 w-9 h-9 flex items-center justify-center rounded-full active:opacity-70 hover:bg-black/[0.04] transition-colors"
        style={{ color: "hsl(var(--olivewood) / 0.55)" }}
      >
        <X className="w-4 h-4" />
      </button>
    </motion.div>
  );
};

export default LifeEventCard;
