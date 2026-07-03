import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CheckoutStep } from "@/components/postjob/CheckoutStep";
import { PostingQualityMeter } from "@/components/postjob/PostingQualityMeter";
import { usePostingQuality } from "@/hooks/usePostingQuality";
import { CheckoutStepIndicator } from "./CheckoutStepIndicator";
import type { usePostJobForm } from "./usePostJobForm";

interface CheckoutStepViewProps {
  form: ReturnType<typeof usePostJobForm>;
}

/**
 * STEP 2: order summary / checkout. Thin wrapper that wires the
 * usePostJobForm state into the existing CheckoutStep component.
 *
 * A two-step rail at the top makes it visible that the form (step 1) is
 * still tappable to go back. Without this, the only way back from the
 * checkout was the page-header arrow, which the user often missed.
 */
export function CheckoutStepView({ form }: CheckoutStepViewProps) {
  const quality = usePostingQuality({
    title: form.title,
    description: form.description,
    budget: form.budgetNum || null,
    category: form.category,
    photos: form.imagePreviews,
    city: form.city,
    scheduledDate: form.dateNeeded || null,
    credentialTier: form.credentialTier,
    pricingMode: form.pricingMode,
  });

  // Fetch the preferred helper's name so the checkout card can show
  // "Send to [Name] first?" — only fires when there's a preferredHelperId.
  const preferredHelperId = form.preferredHelperId;
  const { data: preferredHelperProfile } = useQuery({
    queryKey: ["profile_stub", preferredHelperId],
    queryFn: async () => {
      const res = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .eq("user_id", preferredHelperId!)
        .maybeSingle();
      if (res.error) throw res.error;
      return res.data;
    },
    enabled: !!preferredHelperId,
    staleTime: 5 * 60_000,
  });

  const preferredHelper = preferredHelperId
    ? {
        id: preferredHelperId,
        name: preferredHelperProfile?.full_name ?? null,
      }
    : null;

  return (
    <div key="checkout-step" className="space-y-6 animate-ds-page-in">
      <CheckoutStepIndicator onBackToForm={() => form.setStep("form")} />
      {/* Quality meter — placed above the summary card so the poster can
          see their post strength before committing to payment. Shows
          completed/missing signals so they know exactly what to improve. */}
      <PostingQualityMeter
        score={quality.score}
        label={quality.label}
        color={quality.color}
        completedChecks={quality.completedChecks}
        missingChecks={quality.missingChecks}
      />
      <CheckoutStep
        title={form.title}
        description={form.description}
        category={form.category}
        categoryLabel={form.categoryLabel}
        imagePreviews={form.imagePreviews}
        streetAddress={form.streetAddress}
        city={form.city}
        addrState={form.addrState}
        zipCode={form.zipCode}
        dateNeeded={form.dateNeeded}
        startTime={form.startTime}
        estimatedHours={form.estimatedHours}
        isFlexibleSchedule={form.isFlexibleSchedule}
        specialRequirements={form.specialRequirements}
        isRecurring={form.isRecurring}
        recurrenceInterval={form.recurrenceInterval}
        recurrenceEndDate={form.recurrenceEndDate}
        isUrgent={form.isUrgent}
        urgentFeeNum={form.urgentFeeNum}
        budgetNum={form.budgetNum}
        helprActivity={form.helprActivity}
        customerFee={form.customerFee}
        customerFeeAmount={form.customerFeeAmount}
        onboardingFeeAmount={form.onboardingFeeAmount}
        totalCharge={form.totalCharge}
        confirmed={form.confirmed}
        setConfirmed={form.setConfirmed}
        saveCardForFuture={form.saveCardForFuture}
        setSaveCardForFuture={form.setSaveCardForFuture}
        saving={form.saving || form.redirecting}
        uploading={form.uploading}
        uploadProgress={form.uploadProgress}
        onEdit={() => form.setStep("form")}
        onSubmit={form.handleSubmit}
        isInstantBook={form.isInstantBook}
        parish={null}
        preferredHelper={preferredHelper}
        sendToPreferred={form.sendToPreferred}
        onSendToPreferredChange={form.setSendToPreferred}
      />
    </div>
  );
}
