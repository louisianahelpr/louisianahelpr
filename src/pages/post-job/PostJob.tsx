import { useEffect, useLayoutEffect, useRef } from "react";
import AppPage from "@/components/AppPage";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { usePostJobForm } from "./usePostJobForm";
import { RedirectingOverlay } from "./RedirectingOverlay";
import { EntryChoice } from "./EntryChoice";
import { FormStep } from "./FormStep";
import { CheckoutStepView } from "./CheckoutStepView";
import { ShieldCheck } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { BarkPillButton } from "@/components/ui/BarkPillButton";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { needsIdentityCheck, openIdentityCheck } from "@/lib/identityCheck";

const PostJob = () => {
  usePageTitle("Post a Job — Helpr");
  const form = usePostJobForm();
  // Stripe Identity before a post (owner 2026-10-21; the server refuses the
  // insert without it, 20261021081258). Say so before the form, not after it.
  const { profile } = useCurrentUser();
  const idGate = needsIdentityCheck(profile);

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

  // Each step opens at its TOP (owner, 2026-10-08: "order summary page needs
  // to open at the top of the page, rn it opens at the bottom"). The steps
  // share one route, so ScrollToTop never fires between them, and the shell's
  // scroller kept the form's offset: Review & pay sits at the form's foot, so
  // Order Summary opened scrolled to its own bottom.
  // The form's four screens (formPage) share the "form" step, so a screen
  // change resets the scroll too.
  const lastStep = useRef(`${form.step}:${form.formPage}:${form.categoryGroup}:${form.entryPanel}`);
  useLayoutEffect(() => {
    const key = `${form.step}:${form.formPage}:${form.categoryGroup}:${form.entryPanel}`;
    if (lastStep.current === key) return;
    lastStep.current = key;
    window.scrollTo(0, 0);
    // AppPage's own column is the scroller on a phone (measured 2026-10-08 in
    // WebKit at 390x844: `[data-app-page-scroll]` sat at 536 of 1200 while the
    // window and .app-shell-scroll were both at 0, so the first fix reset the
    // wrong element and the owner's phone still opened at the bottom).
    document.querySelectorAll<HTMLElement>(".app-shell-scroll, [data-app-page-scroll]").forEach((el) => {
      el.scrollTop = 0;
    });
  }, [form.step, form.formPage, form.categoryGroup, form.entryPanel]);

  // Per-step header copy. The entry landing is the new first step where the
  // poster picks how to begin (start fresh / draft / template).
  // Each screen asks its own question under the bar (PostJobStepHeader), so
  // the bar just names the flow (sentence case, spec §2 Type).
  // The bar reads "Post a job" on all 7 screens (owner 2026-10-21); screen 3's question names the group,
  // and its back arrow still returns to the groups (handlePostJobBack).
  const header = { title: "Post a job" };

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
      {idGate ? (
        <EmptyState
          icon={ShieldCheck}
          title="Verify your ID to post"
          body="Stripe checks a photo ID and a selfie before a member's first job post. It takes about 2 minutes, and you only do it once."
          action={<BarkPillButton onClick={() => openIdentityCheck("post")}>Verify my ID</BarkPillButton>}
        />
      ) : form.step === "entry" ? (
        <div className="space-y-section">
          <EntryChoice form={form} />
        </div>
      ) : (
        <div className="space-y-section">
            {/* STEP 1: FORM */}
            {form.step === "form" && <FormStep form={form} />}

            {/* STEP 2: ORDER SUMMARY / CHECKOUT */}
            {form.step === "checkout" && <CheckoutStepView form={form} />}
        </div>
      )}
    </AppPage>
  );
};

export default PostJob;
