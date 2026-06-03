import PageHeader from "@/components/PageHeader";
import { IDVPromptDialog } from "@/components/IDVPromptDialog";
import { usePageTitle } from "@/hooks/usePageTitle";
import { usePostJobForm } from "./postjob/usePostJobForm";
import { RedirectingOverlay } from "./postjob/RedirectingOverlay";
import { FormStep } from "./postjob/FormStep";
import { CheckoutStepView } from "./postjob/CheckoutStepView";

const PostJob = () => {
  usePageTitle("Post a Task — Helpr");
  const form = usePostJobForm();

  return (
    <div className="min-h-screen bg-premium-page relative pb-safe-nav">
      {form.redirecting && <RedirectingOverlay />}

      <PageHeader
        showBrand
        eyebrow={form.step === "checkout" ? "Almost there" : "New request"}
        title={form.step === "checkout" ? "Order summary" : "What do you need done?"}
        meta={form.step === "checkout" ? "Review and pay to publish" : "The more detail, the better."}
        onBack={form.handlePostJobBack}
      />

      <main className="container mx-auto px-4 py-6">
        <div className="max-w-lg mx-auto space-y-6">
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
