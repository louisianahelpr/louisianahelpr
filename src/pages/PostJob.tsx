import { useEffect } from "react";
import PageHeader from "@/components/PageHeader";
import { IDVPromptDialog } from "@/components/IDVPromptDialog";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { usePostJobForm } from "./postjob/usePostJobForm";
import { RedirectingOverlay } from "./postjob/RedirectingOverlay";
import { EntryChoice } from "./postjob/EntryChoice";
import { FormStep } from "./postjob/FormStep";
import { CheckoutStepView } from "./postjob/CheckoutStepView";

const PostJob = () => {
  usePageTitle("Post a Job — Helpr");
  const form = usePostJobForm();

  // iOS keeps the focused field under the keyboard when it sits near the
  // bottom of this long document-scroll form (e.g. the logistics notes /
  // budget fields). When the keyboard rises, scroll the focused control
  // into view. Mirrors how Messages consumes useKeyboardInset to lift its
  // composer above the keyboard.
  const keyboardInset = useKeyboardInset();
  useEffect(() => {
    if (keyboardInset <= 0) return;
    const el = document.activeElement;
    if (
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement
    ) {
      // Defer to the next frame so the layout has settled to the smaller
      // (keyboard-inset) viewport before we measure where the field is.
      requestAnimationFrame(() => {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
  }, [keyboardInset]);

  // Per-step header copy. The entry landing is the new first step where the
  // poster picks how to begin (start fresh / draft / template).
  const header =
    form.step === "checkout"
      ? { eyebrow: "Almost there", title: "Order Summary", meta: "Review and pay to publish" }
      : form.step === "entry"
        ? { eyebrow: "New request", title: "Post a Job", meta: "Pick how you'd like to begin." }
        : { eyebrow: "New request", title: "Job Details", meta: "The more detail, the better." };

  return (
    <div className="min-h-screen bg-premium-page relative pb-safe-nav">
      {form.redirecting && <RedirectingOverlay />}

      {/* The rail inset is applied ONCE, globally: `#root` is padded by the
          sidebar width for non-app-shell document pages (index.css). This page
          must NOT re-inset itself or the content is pushed off-center by a
          second rail-width gutter. */}
      {/* No app bar. PostJob stacked <DashboardHeader/> above its own
          back-button header, so the screen opened with two bars before any
          content — the same stacked-header problem removed from Messages,
          Profile, My Jobs and My Posts. PageHeader's `topInsetHandled` is
          dropped with it: that flag said "something above me already took the
          safe-area inset", which is no longer true. */}
      <PageHeader
        eyebrow={header.eyebrow}
        title={header.title}
        meta={header.meta}
        onBack={form.handlePostJobBack}
        width="5xl"
      />

      {/* Body column width matches PageHeader's "5xl" variant above so the
          title aligns with the form beneath it — see PageHeader's `width`
          prop doc. The ENTRY step's column now widens WITH the viewport
          (max-w-lg → md:max-w-3xl → lg:max-w-5xl) instead of jumping
          straight from a 512px column to 5xl only at lg: previously the
          tablet / wide-phone band (768–1024px, no desktop rail) stranded
          the entry cards in a 512px column with big dead gutters. At md the
          column fills to 3xl and EntryChoice flips its cards to a
          md:grid-cols-2 grid so the space is consumed, not gutter'd.

          The FORM and CHECKOUT column now carries the same ladder. It was
          `max-w-lg lg:max-w-5xl` — no md rung — so from 768px to 1024px
          (tablets, wide phones in landscape, small laptop windows) the whole
          form stayed pinned in a 512px column with wide dead gutters either
          side. The entry step had already been fixed for exactly this reason;
          the form and checkout never got the same treatment.

          The entry column previously carried `min-h-[60vh] flex flex-col
          justify-center`, which vertically centred four cards inside a 60vh
          box and produced a large empty band above AND below them on a phone —
          the cards floated in the middle of the screen with nothing anchoring
          them. Content now starts under the header and flows naturally. */}
      {/* This page stops at lg:max-w-5xl instead of continuing to the app's
          canonical content ladder (5xl → 6xl → 7xl → 90rem). That is on
          purpose, not an unswept ladder: this is a FORM, and a 90rem-wide
          input row is harder to fill in than a narrow one — the reading
          column is the feature. M2 unified the CONTENT pages, which were
          disagreeing with each other; forms are a different problem and
          keep their own width. */}
      {/* `pb-6`, not `py-6`. The page wrapper already carries `pb-safe-nav`
           for the floating dock, so a second 24px of bottom padding stacked on
           top of it and left a visible dead band under the last card (owner:
           "too much spacing at the bottom"). */}
      <div className="container mx-auto px-4 pt-6">
        {form.step === "entry" ? (
          <div className="max-w-lg md:max-w-3xl lg:max-w-5xl mx-auto space-y-6">
            <EntryChoice form={form} />
          </div>
        ) : (
          <div className="max-w-lg md:max-w-3xl lg:max-w-5xl mx-auto space-y-6">
            {/* STEP 1: FORM */}
            {form.step === "form" && <FormStep form={form} />}

            {/* STEP 2: ORDER SUMMARY / CHECKOUT */}
            {form.step === "checkout" && <CheckoutStepView form={form} />}
          </div>
        )}
      </div>

      <IDVPromptDialog
        open={form.idvDialogOpen}
        onOpenChange={form.setIdvDialogOpen}
        reason="Helpr requires a quick ID + selfie check before you can post a job. This keeps the platform safe for the Helprs you'll be hiring."
        status={form.idvStatus as never}
        failureReason={form.idvFailureReason}
        context="job_post"
      />
    </div>
  );
};

export default PostJob;
