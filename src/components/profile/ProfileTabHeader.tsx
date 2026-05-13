import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

interface ProfileTabHeaderProps {
  eyebrow?: string;
  title: string;
  meta?: ReactNode;
  onBack: () => void;
  rightSlot?: ReactNode;
}

export function ProfileTabHeader({ eyebrow, title, meta, onBack, rightSlot }: ProfileTabHeaderProps) {
  return (
    <div className="flex items-start gap-3 mb-3 shrink-0">
      <button
        onClick={onBack}
        aria-label="Back"
        className="w-10 h-10 rounded-full flex items-center justify-center transition-all active:scale-[0.94] hover:opacity-80 shrink-0 mt-0.5"
        style={{
          // Frosted glass surface with a faint olivewood outline so the
          // back button reads as a discrete tap target instead of a
          // floating icon. Bigger 40px hit area than the previous 28px.
          background: "hsla(0, 0%, 100%, 0.65)",
          border: "1px solid hsl(var(--olivewood) / 0.18)",
          color: "hsl(var(--olivewood))",
          backdropFilter: "blur(10px) saturate(150%)",
          WebkitBackdropFilter: "blur(10px) saturate(150%)",
          boxShadow:
            "inset 0 1px 1px 0 rgba(255, 255, 255, 0.55), " +
            "0 1px 2px hsl(var(--olivewood) / 0.06), " +
            "0 4px 10px -4px hsl(var(--olivewood) / 0.10)",
        }}
      >
        <ArrowLeft className="w-4 h-4" strokeWidth={2.25} />
      </button>
      <div className="flex flex-col leading-none min-w-0 flex-1">
        {eyebrow && (
          <span
            className="font-serif italic uppercase text-[0.62rem]"
            style={{
              color: "hsl(var(--burnt-sienna) / 0.78)",
              letterSpacing: "0.18em",
            }}
          >
            {eyebrow}
          </span>
        )}
        <h1
          className="font-display italic font-bold leading-tight mt-1 truncate"
          style={{
            fontSize: "clamp(1.4rem, 2vw + 0.4rem, 1.75rem)",
            color: "hsl(var(--ink-deep))",
            letterSpacing: "-0.025em",
          }}
        >
          {title}
        </h1>
        {meta && (
          <span
            className="font-serif italic mt-0.5 text-[0.78rem]"
            style={{ color: "hsl(var(--olivewood) / 0.7)" }}
          >
            {meta}
          </span>
        )}
      </div>
      {rightSlot && <div className="shrink-0">{rightSlot}</div>}
    </div>
  );
}

export default ProfileTabHeader;
