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
import { PostJobFlowStepper } from "./postjob/PostJobFlowStepper";

const PostJob = () => {
  usePageTitle("Post a Task — Helpr");
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
        ? { eyebrow: "New request", title: "Post a task", meta: "Pick how you'd like to begin." }
        : { eyebrow: "New request", title: "What do you need done?", meta: "The more detail, the better." };

  return (
    <div className="min-h-screen bg-premium-page relative pb-safe-nav">
      {form.redirecting && <RedirectingOverlay />}

      {/* showBrand keeps the standard pinned top nav (Helpr·LA wordmark)
          present here like the Dashboard, instead of dropping the poster
          straight into a chromeless title block. */}
      <PageHeader
        eyebrow={header.eyebrow}
        title={header.title}
        meta={header.meta}
        onBack={form.handlePostJobBack}
        showBrand
      />

      <main className="container mx-auto px-4 py-6">
        <div className="max-w-lg mx-auto space-y-6">
          {/* Whole-flow progress: Entry → Details → Pay. Always visible so the
              poster knows where they are across the three-step machine — the
              in-form/in-checkout rails track only sub-progress within a step. */}
          <PostJobFlowStepper step={form.step} />

          {/* STEP 0: ENTRY CHOICE — start fresh / load draft / use template */}
          {form.step === "entry" && <EntryChoice form={form} />}

          {/* STEP 1: FORM */}
          {form.step === "form" && <FormStep form={form} />}

          {/* STEP 2: ORDER SUMMARY / CHECKOUT */}
          {form.step === "checkout" && <CheckoutStepView form={form} />}
        </div>
      </main>

      <IDVPromptDialog
        open={form.idvDialogOpen}
        onOpenChange={form.setIdvDialogOpen}
        reason="Helpr requires a quick ID + selfie check before you can post a job. This keeps the platform safe for the helprs you'll be hiring."
        status={form.idvStatus as never}
        failureReason={form.idvFailureReason}
      />
    </div>
  );
};

export default PostJob;
