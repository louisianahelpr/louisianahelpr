import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Dialog, DialogPortal, DialogOverlay, DialogHero } from "@/components/ui/dialog";
import { X, Cake } from "lucide-react";
import { safeStorage } from "@/lib/safeStorage";
import { useReducedMotion } from "@/lib/accessibility";

interface BirthdayPopupProps {
  dateOfBirth: string | null | undefined;
  firstName: string;
}

const BirthdayPopup = ({ dateOfBirth, firstName }: BirthdayPopupProps) => {
  const reducedMotion = useReducedMotion();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!dateOfBirth) return;

    const today = new Date();
    const dob = new Date(dateOfBirth);
    if (today.getMonth() === dob.getMonth() && today.getDate() === dob.getDate()) {
      const dismissed = safeStorage.getItem("birthday_popup_dismissed");
      if (dismissed) {
        const dismissedDate = new Date(parseInt(dismissed, 10));
        if (
          dismissedDate.getFullYear() === today.getFullYear() &&
          dismissedDate.getMonth() === today.getMonth() &&
          dismissedDate.getDate() === today.getDate()
        ) {
          return;
        }
      }
      setShow(true);
    }
  }, [dateOfBirth]);

  const dismiss = () => {
    setShow(false);
    safeStorage.setItem("birthday_popup_dismissed", Date.now().toString());
  };

  // Radix Dialog onOpenChange — fires on Escape, outside click, and any
  // other dismissal path. Wire it to the same dismiss() handler so all
  // close paths persist the "shown once today" stamp.
  const handleOpenChange = (open: boolean) => {
    if (!open) dismiss();
  };

  return (
    <Dialog open={show} onOpenChange={handleOpenChange}>
      <AnimatePresence>
        {show && (
          <DialogPortal forceMount>
            {/* Shared overlay primitive — backdrop blur, focus trap, and
                escape-to-close come from Radix so this modal behaves
                exactly like every other dialog in the app. We keep
                framer-motion for the spring-scale celebration entrance
                on the inner card. */}
            <DialogOverlay asChild forceMount>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              />
            </DialogOverlay>
            {/* Bare primitive (not DialogContent) so we don't inherit the
                shared glass-modal padding + built-in close X, both of
                which would clash with the bespoke celebratory layout. */}
            <DialogPrimitive.Content asChild forceMount>
              <motion.div
                // Centering MUST NOT share the CSS `transform` property with the
                // scale spring. framer writes `transform` inline every frame, so
                // ANY transform-based centering (Tailwind `-translate-*` classes
                // OR framer `x/y:"-50%"`) gets clobbered mid-animation — dropping
                // the card's top-left corner onto screen-center (off-canvas right
                // + down, worst on iOS/WebKit). Fix: park the -50%/-50% offset on
                // the standalone CSS `translate` property (independent of
                // `transform`); framer then only animates scale/opacity and can
                // never overwrite the centering.
                initial={reducedMotion ? { opacity: 0 } : { scale: 0.8, opacity: 0 }}
                animate={reducedMotion ? { opacity: 1 } : { scale: 1, opacity: 1 }}
                exit={reducedMotion ? { opacity: 0 } : { scale: 0.8, opacity: 0 }}
                transition={reducedMotion ? { duration: 0.15 } : { type: "spring", damping: 20, stiffness: 300 }}
                className="fixed left-1/2 top-1/2 z-50 rounded-2xl liquid-glass shadow-2xl px-7 py-8 max-w-sm w-[calc(100%-2rem)] text-center focus:outline-none"
                style={{
                  translate: "-50% -50%",
                  backgroundImage:
                    "radial-gradient(70% 90% at 100% 0%, hsl(var(--burnt-sienna) / 0.12) 0%, transparent 55%), " +
                    "radial-gradient(60% 80% at 0% 100%, hsl(var(--burnt-sienna) / 0.14) 0%, transparent 60%)",
                  boxShadow:
                    "inset 0 1px 1px 0 rgba(255, 255, 255, 0.45), " +
                    "0 1px 2px hsl(var(--olivewood) / 0.06), " +
                    "0 24px 48px -12px hsl(var(--olivewood) / 0.22)",
                }}
              >
                <button
                  onClick={dismiss}
                  className="absolute top-3 right-3 transition-colors active:opacity-70"
                  style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>

                <div
                  className="w-16 h-16 mx-auto rounded-full flex items-center justify-center mb-4"
                  style={{
                    background: "hsl(var(--burnt-sienna) / 0.18)",
                    color: "hsl(var(--burnt-sienna))",
                    border: "0.5px solid hsl(var(--burnt-sienna) / 0.36)",
                    boxShadow: "inset 0 1px 1px 0 rgba(255,255,255,0.55), 0 8px 22px -6px hsl(var(--burnt-sienna) / 0.30)",
                  }}
                >
                  <Cake className="w-7 h-7" strokeWidth={1.75} />
                </div>
                {/* Canonical DialogHero for eyebrow → title → subtitle
                    stack (Cowork 2026-07-08 required the shared component,
                    not the hand-rolled version). Centered + a slightly
                    larger title reflect the celebratory layout — those
                    are per-instance overrides, not a bespoke header. */}
                <DialogHero
                  className="text-center space-y-0"
                  eyebrow="From the Helpr family"
                  title={`Happy birthday, ${firstName}.`}
                  titleStyle={{ fontSize: "clamp(1.5rem, 2.5vw + 0.4rem, 1.85rem)", letterSpacing: "-0.025em" }}
                />
                <button
                  type="button"
                  onClick={dismiss}
                  className="mt-5 inline-flex items-center gap-1.5 px-5 h-10 rounded-full active:scale-[0.97] transition-transform text-ds-12"
                  style={{
                    background: "hsl(var(--bark))",
                    color: "hsl(var(--parchment))",
                    border: "1px solid hsl(var(--bark-border))",
                    fontFamily: "Montserrat, system-ui, sans-serif",
                    fontWeight: 600,
                    letterSpacing: "0.01em",
                    boxShadow:
                      "inset 0 1px 0 0 rgba(255,255,255,0.12), " +
                      "0 1px 2px hsl(var(--bark) / 0.18), " +
                      "0 8px 18px -6px hsl(var(--bark) / 0.45)",
                  }}
                >
                  Thank you
                </button>
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPortal>
        )}
      </AnimatePresence>
    </Dialog>
  );
};

export default BirthdayPopup;
