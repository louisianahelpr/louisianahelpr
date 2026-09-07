import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Dialog, DialogPortal, DialogOverlay, DialogHero } from "@/components/ui/dialog";
import { X, Cake } from "lucide-react";
import { Button } from "@/components/ui/button";
import { safeStorage } from "@/lib/safeStorage";
import { useReducedMotion } from "@/lib/accessibility";
import { parseLocalDate } from "@/lib/dateUtils";

interface BirthdayPopupProps {
  dateOfBirth: string | null | undefined;
  firstName: string;
  /**
   * Hold this card closed while something with a prior claim on the screen is
   * still up — in practice the onboarding tour, its only sibling overlay on
   * Dashboard.
   *
   * Both dialogs are Radix modals at `z-50` and were mounted as unconditional
   * siblings that opened independently. On a first login that landed on the
   * member's birthday the tour card (337×191) covered this one (187×250)
   * entirely: the greeting was on screen, focus-trapped underneath, and
   * unreachable until the tour was skipped. Ordering them — tour first, then
   * the greeting — is what this prop is.
   *
   * It does NOT change the once-per-day rule: nothing is written to storage
   * while deferred, so the greeting still appears the moment the tour clears.
   */
  deferred?: boolean;
}

const BirthdayPopup = ({ dateOfBirth, firstName, deferred = false }: BirthdayPopupProps) => {
  const reducedMotion = useReducedMotion();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!dateOfBirth || deferred) return;

    const today = new Date();
    const dob = parseLocalDate(dateOfBirth);
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
  }, [dateOfBirth, deferred]);

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
                // `w-auto` + `max-w-*`, NOT `w-[calc(100%-2rem)]`. The old width
                // forced the card to fill its max regardless of content, so a
                // three-element celebration (icon, one line, one button) sat in
                // a box sized for a paragraph, with the title stranded against
                // the left edge and dead space to its right.
                // Fixed positioning makes `w-auto` shrink-to-fit, so the card
                // now hugs its longest line and stays centred by the
                // `translate: -50% -50%` below.
                className="fixed left-1/2 top-1/2 z-50 rounded-2xl liquid-glass shadow-2xl px-6 py-5 w-auto max-w-[calc(100%-2rem)] sm:max-w-sm text-center focus:outline-none"
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

                {/* `mt-1` clears the absolutely-positioned close X above-right
                    of it now that the card hugs its content and the two are no
                    longer separated by surplus width. */}
                <div
                  className="w-12 h-12 mx-auto mt-1 rounded-full flex items-center justify-center mb-3"
                  style={{
                    background: "hsl(var(--burnt-sienna) / 0.18)",
                    color: "hsl(var(--burnt-sienna))",
                    border: "0.5px solid hsl(var(--burnt-sienna) / 0.36)",
                    boxShadow: "inset 0 1px 1px 0 rgba(255,255,255,0.55), 0 8px 22px -6px hsl(var(--burnt-sienna) / 0.30)",
                  }}
                >
                  <Cake className="w-5 h-5" strokeWidth={1.75} />
                </div>
                {/* Canonical DialogHero, not a hand-rolled header (Cowork
                    2026-07-08 required the shared component).

                    No `eyebrow` — it used to pass "From the Helpr family",
                    which has not rendered since the 2026-07-25 "one main
                    title" decision made DialogHero drop the eyebrow/subtitle
                    slots. The prop is still accepted so stray usages are a
                    no-op rather than a build break, so this silently painted
                    nothing. Removed rather than left implying a line that
                    isn't there. */}
                {/* `[&_h2]:text-center` is load-bearing, not decoration.
                    DialogHero renders its DialogHeader with a hardcoded
                    `text-left` and deliberately exposes no className escape
                    hatch, so this card's own `text-center` lost to it: the
                    icon and the button centred while the title alone sat
                    left-aligned. Overriding the h2 here keeps the shared
                    component (and its one type ramp) while letting the one
                    genuinely centred dialog in the app be centred. */}
                <div className="[&_h2]:text-center">
                  {/* Title Case, no trailing period — the app's popup titles
                      are 95/117 Title Case and 109/117 end in "?" or nothing
                      (docs/PLATFORM_CONVENTIONS.md:15). This was the only
                      Sentence-case-plus-period title outside the four that
                      have since been fixed. */}
                  <DialogHero title={`Happy Birthday, ${firstName}`} />
                </div>
                {/* The shared glossy primary. This was a hand-rolled 40px
                    (`h-10`, under the 44px tap-target floor) button painting a
                    FLAT `--bark` fill with a copy of the elevation recipe —
                    the same flat-primary rule break as the other six, in the
                    one dialog nobody opens twice. */}
                <Button variant="primary" onClick={dismiss} className="mt-4">
                  Thank You
                </Button>
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPortal>
        )}
      </AnimatePresence>
    </Dialog>
  );
};

export default BirthdayPopup;
