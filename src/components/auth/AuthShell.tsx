import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { isNativePlatform } from "@/lib/nativeInit";
import { ReactNode } from "react";

interface AuthShellProps {
  children: ReactNode;
  eyebrow?: string;
  hideBack?: boolean;
  /** When true, hides the Helpr·LA wordmark + eyebrow block above
      the slot. Useful when the inner card has its own headline. */
  hideHeader?: boolean;
  maxWidth?: "sm" | "md" | "lg" | "2xl";
}

const widthMap = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-md sm:max-w-lg",
  "2xl": "max-w-md sm:max-w-lg md:max-w-2xl",
};

const AuthShell = ({
  children,
  eyebrow = "Your Local Task Partner",
  hideBack = false,
  hideHeader = false,
  maxWidth = "lg",
}: AuthShellProps) => {
  return (
    <div className="min-h-screen page-warmth relative">
      <div aria-hidden className="mesh-gradient-global" />
      <div className="relative z-10 flex items-start sm:items-center justify-center px-5 pb-10 sm:px-8 sm:py-16 pt-[calc(env(safe-area-inset-top)+24px)] sm:pt-16">
        <div className={`w-full ${widthMap[maxWidth]}`}>
          {!hideBack && (
            <div className="mb-5">
              <Link
                to={isNativePlatform ? "/browse" : "/"}
                className="inline-flex items-center gap-1.5 text-xs font-sans tracking-wide hover:opacity-80 transition-opacity"
                style={{ color: "hsl(var(--olivewood) / 0.65)" }}
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                {isNativePlatform ? "Back" : "Back to home"}
              </Link>
            </div>
          )}

          {!hideHeader && (
            <div className="text-center mb-7">
              <Link to="/" className="inline-flex items-baseline gap-1">
                <span
                  className="font-display italic font-bold leading-none"
                  style={{
                    fontSize: "2.25rem",
                    color: "hsl(var(--olivewood))",
                    letterSpacing: "-0.02em",
                  }}
                >
                  Helpr
                </span>
                <span
                  className="font-display italic font-bold leading-none"
                  style={{
                    fontSize: "1.4rem",
                    color: "hsl(var(--burnt-sienna))",
                    letterSpacing: "0.22em",
                    marginLeft: "0.12em",
                  }}
                >
                  · LA
                </span>
              </Link>
              <p
                className="mt-2 text-[0.72rem] tracking-[0.18em] uppercase font-serif italic"
                style={{ color: "hsl(var(--burnt-sienna) / 0.7)" }}
              >
                {eyebrow}
              </p>
            </div>
          )}

          {children}
        </div>
      </div>
    </div>
  );
};

export default AuthShell;
