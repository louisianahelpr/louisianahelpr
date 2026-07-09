import BackButton from "@/components/BackButton";
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
      <BackButton onClick={onBack} />
      <div className="flex flex-col leading-none min-w-0 flex-1">
        {eyebrow && (
          <span
            className="font-serif italic uppercase text-[0.62rem]"
            style={{
              color: "hsl(var(--burnt-sienna))",
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
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
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
