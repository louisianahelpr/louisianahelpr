import BackButton from "@/components/BackButton";
import type { ReactNode } from "react";

interface ProfileTabHeaderProps {
  title: string;
  onBack: () => void;
  rightSlot?: ReactNode;
}

export function ProfileTabHeader({ title, onBack, rightSlot }: ProfileTabHeaderProps) {
  // Deliberately a single clean title beside the back button — no eyebrow or
  // subtitle line. The header previously accepted (but silently ignored)
  // `eyebrow`/`meta` props after the declutter pass; those are now removed
  // from the interface entirely so a caller can't pass copy that never renders.
  return (
    <div className="flex items-center gap-3 mb-3 shrink-0">
      <BackButton onClick={onBack} />
      <div className="flex flex-col leading-none min-w-0 flex-1">
        <h1
          className="font-display italic font-bold leading-tight truncate"
          style={{
            fontSize: "clamp(1.4rem, 2vw + 0.4rem, 1.75rem)",
            color: "hsl(var(--ink-deep))",
            letterSpacing: "-0.025em",
          }}
        >
          {title}
        </h1>
      </div>
      {rightSlot && <div className="shrink-0">{rightSlot}</div>}
    </div>
  );
}

export default ProfileTabHeader;
