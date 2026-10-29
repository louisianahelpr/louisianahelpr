/**
 * Step 1's "Claude writes your listing" panel (owner 2026-10-28: "claude did
 * not help with the listing so idk how to get it to do the listing for me").
 *
 * A NEW listing runs it by itself as soon as its first photos are added
 * (useSellAiDraft below, requestAiDraftFromPhotos: the photos go in the
 * request and are never stored); a saved draft runs it from its uploaded
 * photos (requestAiDraft), by itself too when the draft is resumed with
 * photos and an empty title or details (audit AA9, 2026-10-29: "Finish
 * listing" only offered a button), filling ONLY the empty fields. Either way the seller sees "Claude is writing your
 * listing…", then what Claude wrote, to change on the next steps, and can ask
 * for it again ("Write it again"). Nothing is saved until step 4.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AiDraft, DeliverySize } from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { CATEGORY_LABEL, CONDITION_LABEL, SIZE_LABEL } from "./declutterUi";

export type AiState =
  | { status: "idle" }
  | { status: "busy" }
  | { status: "done"; draft: AiDraft }
  | { status: "error"; message: string };

/** The form fields Claude fills in. */
export interface AiFields {
  title: string;
  description: string;
  category: string;
  deliverySize: DeliverySize;
  conditionStars: number;
  /** Whole dollars as the price box holds them (owner 2026-10-29: Claude sets the price too). */
  price: string;
}

/**
 * What the seller's form becomes once Claude answers: each field Claude fills
 * in, EXCEPT one the seller changed while Claude was writing (theirs wins).
 */
function mergeAiDraft<F extends AiFields>(current: F, atStart: AiFields, d: AiDraft): F {
  const pick = <K extends keyof AiFields>(k: K, v: AiFields[K]) => (current[k] === atStart[k] ? v : current[k]);
  return {
    ...current,
    title: pick("title", d.title),
    description: pick("description", d.description),
    category: pick("category", d.category),
    deliverySize: pick("deliverySize", d.deliverySize),
    conditionStars: pick("conditionStars", d.conditionStars),
    // No price from Claude (or an older function): the seller's box stays as it is.
    price: typeof d.priceDollars === "number" && d.priceDollars >= 1 ? pick("price", String(d.priceDollars)) : current.price,
  };
}

/**
 * A resumed draft's auto-run (audit AA9): only what the seller left empty is
 * filled. The title and details when blank, the category while it is still
 * "Other"; the condition and size have no empty value, so they stay theirs.
 */
function fillEmptyFields<F extends AiFields>(current: F, d: AiDraft): F {
  return {
    ...current,
    title: current.title.trim() ? current.title : d.title,
    description: current.description.trim() ? current.description : d.description,
    category: current.category === "other" ? d.category : current.category,
    price: !current.price.trim() && typeof d.priceDollars === "number" && d.priceDollars >= 1 ? String(d.priceDollars) : current.price,
  };
}

/**
 * The run itself: `ask` is the call (from held photos or the saved draft).
 * `autoStart` (a new listing with its first photos) runs it once by itself;
 * `autoFillEmpty` (a resumed draft with photos and empty fields) runs it once
 * by itself too, filling only the empty fields. "Write it again" is the
 * seller's own ask, so it fills every field they have not changed since.
 */
export function useSellAiDraft<F extends AiFields>({
  ask,
  form,
  setForm,
  autoStart,
  autoFillEmpty = false,
}: {
  ask: (() => Promise<AiDraft>) | null;
  form: F;
  setForm: (update: (f: F) => F) => void;
  autoStart: boolean;
  autoFillEmpty?: boolean;
}) {
  const [state, setState] = useState<AiState>({ status: "idle" });
  const formRef = useRef(form);
  formRef.current = form;
  const ran = useRef(false);
  const run = useCallback(async (onlyEmpty = false) => {
    if (!ask) return;
    ran.current = true;
    const atStart: AiFields = { ...formRef.current };
    setState({ status: "busy" });
    try {
      const d = await ask();
      setForm((f) => (onlyEmpty ? fillEmptyFields(f, d) : mergeAiDraft(f, atStart, d)));
      setState({ status: "done", draft: d });
    } catch (err) {
      // Not silent: the panel shows the seller the plain-words reason and a "Try again" button
      // (the edge function logs the cause server-side), and they can always fill it in themselves.
      console.warn("[declutter] Claude's listing draft failed", err);
      setState({ status: "error", message: declutterErrorMessage(err) });
    }
  }, [ask, setForm]);
  useEffect(() => {
    if ((autoStart || autoFillEmpty) && ask && !ran.current) void run(!autoStart);
  }, [autoStart, autoFillEmpty, ask, run]);
  return { state, run: () => run(false) };
}

/** Claude's suggested price and its one-line reason (owner 2026-10-29); nothing when there is none. */
export function AiPriceLine({ draft }: { draft: AiDraft }) {
  if (typeof draft.priceDollars !== "number" || draft.priceDollars < 1) return null;
  return (
    <p className="text-ds-14 text-foreground [overflow-wrap:anywhere]" data-ai-price="">
      <span className="font-semibold">Suggested price: ${draft.priceDollars}</span>
      {draft.priceReason ? <span className="text-muted-foreground"> · {draft.priceReason}</span> : null}
    </p>
  );
}

export function SellAiDraftPanel({ state, onRun }: { state: AiState; onRun: () => void }) {
  if (state.status === "busy") {
    return (
      <div role="status" aria-live="polite" data-ai-draft="busy" className="flex items-start gap-3 rounded-[20px] border border-border bg-card p-4">
        <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-[hsl(var(--sage-ink))]" aria-hidden />
        <div className="min-w-0">
          <p className="text-ds-15 font-semibold text-foreground">Claude is writing your listing…</p>
          <p className="mt-0.5 text-ds-13 text-muted-foreground">It looks at your photos for the name, details, category, size, condition and a fair price. This takes a few seconds.</p>
        </div>
      </div>
    );
  }
  if (state.status === "done") {
    const d = state.draft;
    return (
      <div role="status" aria-live="polite" data-ai-draft="done" className="space-y-3 rounded-[20px] border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 shrink-0 text-[hsl(var(--sage-ink))]" aria-hidden />
          <p className="text-ds-13 font-semibold text-[hsl(var(--sage-ink))]">Claude wrote your listing</p>
        </div>
        <div className="space-y-1">
          <p className="text-ds-17 font-bold text-foreground [overflow-wrap:anywhere]" data-ai-title="">{d.title}</p>
          <p className="text-ds-13 text-muted-foreground">
            {[CATEGORY_LABEL[d.category] ?? d.category, CONDITION_LABEL[d.conditionStars], SIZE_LABEL[d.deliverySize]].filter(Boolean).join(" · ")}
          </p>
          {d.description && <p className="line-clamp-3 text-ds-14 text-foreground [overflow-wrap:anywhere]">{d.description}</p>}
          <AiPriceLine draft={d} />
        </div>
        {d.flagged && (
          <p className="text-ds-13 font-semibold text-foreground">
            This item may not be allowed, so someone from Louisiana Helpr will look at it before it goes up.
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-ds-13 text-muted-foreground">Check it and change anything on the next steps.</p>
          <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={onRun}>Write it again</Button>
        </div>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div role="alert" data-ai-draft="error" className="space-y-2 rounded-[20px] border border-border bg-card p-4">
        <p className="text-ds-14 text-foreground">{state.message}</p>
        <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={onRun}>Try again</Button>
      </div>
    );
  }
  return (
    <div data-ai-draft="idle" className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-border bg-card p-4">
      <p className="min-w-0 flex-1 text-ds-14 text-muted-foreground">Claude can write the name, details, category, size and condition from your photos.</p>
      <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={onRun}>
        <Sparkles className="mr-1.5 h-4 w-4" aria-hidden />Write my listing
      </Button>
    </div>
  );
}
