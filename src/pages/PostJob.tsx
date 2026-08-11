import { useEffect } from "react";
import PageHeader from "@/components/PageHeader";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
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
      ? { eyebrow: "Almost there", title: "Order summary", meta: "Review and pay to publish" }
      : form.step === "entry"
        ? { eyebrow: "New request", title: "Post a job", meta: "Pick how you'd like to begin." }
        : { eyebrow: "New request", title: "What do you need done?", meta: "The more detail, the better." };

  return (
    <div className="min-h-screen bg-premium-page relative pb-safe-nav">
      {form.redirecting && <RedirectingOverlay />}

      {/* Use the real DashboardHeader so the pinned top nav here is identical
          to the rest of the app — full-width Helpr·LA wordmark on the left and
          the notification bell on the right — rather than PageHeader's
          centered, bell-less brand bar, which read as a different top nav. */}
      {/* The rail inset is applied ONCE, globally: `#root` is padded by the
          sidebar width for non-app-shell document pages (index.css). This page
          must NOT re-inset itself or the content is pushed off-center by a
          second rail-width gutter. */}
      <DashboardHeader />
      <PageHeader
        eyebrow={header.eyebrow}
        title={header.title}
        meta={header.meta}
        onBack={form.handlePostJobBack}
        topInsetHandled
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
          Form + checkout keep the same 5xl column since they're dense.

          The entry column previously carried `min-h-[60vh] flex flex-col
          justify-center`, which vertically centred four cards inside a 60vh
          box and produced a large empty band above AND below them on a phone —
          the cards floated in the middle of the screen with nothing anchoring
          them. Content now starts under the header and flows naturally. */}
      <div className="container mx-auto px-4 py-6">
        {form.step === "entry" ? (
          <div className="max-w-lg md:max-w-3xl lg:max-w-5xl mx-auto space-y-6">
            <EntryChoice form={form} />
          </div>
        ) : (
          <div className="max-w-lg lg:max-w-5xl mx-auto space-y-6">
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
      />
    </div>
  );
};

export default PostJob;
