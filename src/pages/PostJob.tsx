import { useEffect } from "react";
import AppPage from "@/components/AppPage";
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
    /* ONE shell, like every other in-app sub-screen (owner, 2026-08-30:
       "should be one component like the others"). This page used to
       hand-assemble its own: a `min-h-screen` document-scroll wrapper, a
       <PageHeader width="5xl">, and a body on a DIFFERENT ladder
       (`max-w-lg md:max-w-3xl lg:max-w-5xl`) — so the title and the content
       it titled sat in two different columns.

       `onBack` rather than `backTo`: back here steps the multi-step form
       backwards and only leaves the route from the first step. */
    <AppPage title={header.title} onBack={form.handlePostJobBack}>
      {form.redirecting && <RedirectingOverlay />}
      {form.step === "entry" ? (
        <div className="space-y-6">
          <EntryChoice form={form} />
        </div>
      ) : (
        <div className="space-y-6">
            {/* STEP 1: FORM */}
            {form.step === "form" && <FormStep form={form} />}

            {/* STEP 2: ORDER SUMMARY / CHECKOUT */}
            {form.step === "checkout" && <CheckoutStepView form={form} />}
        </div>
      )}

      <IDVPromptDialog
        open={form.idvDialogOpen}
        onOpenChange={form.setIdvDialogOpen}
        reason="Helpr requires a quick ID + selfie check before you can post a job. This keeps the platform safe for the Helprs you'll be hiring."
        status={form.idvStatus as never}
        failureReason={form.idvFailureReason}
        context="job_post"
      />
    </AppPage>
  );
};

export default PostJob;
