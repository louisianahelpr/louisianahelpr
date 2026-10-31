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
import { AI_DRAFT_PHOTOS } from "@/lib/declutter/photoRules";
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

/** The fields as Claude wrote them. No price from Claude (or an older function): the form's price box stays as it is. */
function fieldsFrom(current: AiFields, d: AiDraft): AiFields {
  return {
    title: d.title,
    description: d.description,
    category: d.category,
    deliverySize: d.deliverySize,
    conditionStars: d.conditionStars,
    price: typeof d.priceDollars === "number" && d.priceDollars >= 1 ? String(d.priceDollars) : current.price,
  };
}

const AI_KEYS = ["title", "description", "category", "deliverySize", "conditionStars", "price"] as const;

/**
 * What "theirs" means across rewrites (audit posting 1030 #6: Write it again compared with the form when the rewrite
 * started, so a correction made before it counted as our words and was wiped). `base` is each field as it last came
 * from us (or as it was before our first answer); a field that differs from it is the seller's from then on.
 */
export interface AiMemory {
  base: AiFields;
  theirs: (keyof AiFields)[];
}

/** The form once Claude answers: every field Claude fills in, except the seller's; and what to remember for next time. */
function mergeAiDraft<F extends AiFields>(current: F, before: AiMemory, d: AiDraft): { form: F; memory: AiMemory } {
  const written = fieldsFrom(current, d);
  const theirs = AI_KEYS.filter((k) => before.theirs.includes(k) || current[k] !== before.base[k]);
  const next = { ...written };
  for (const k of theirs) (next as Record<string, unknown>)[k] = current[k];
  return { form: { ...current, ...next }, memory: { base: next, theirs } };
}

const aiFieldsOf = (f: AiFields): AiFields => ({ title: f.title, description: f.description, category: f.category, deliverySize: f.deliverySize, conditionStars: f.conditionStars, price: f.price });

/**
 * Photo coach (owner 2026-10-29): a NEW listing's held photos with Claude's pick for the cover moved
 * first. Matched by the File itself (the one Claude was sent), so photos added or removed while it was
 * writing never move the wrong one; the seller can make another the cover, or undo it.
 */
export function coverFirst(held: File[], cover: File | undefined): File[] {
  if (!cover || held[0] === cover || !held.includes(cover)) return held;
  return [cover, ...held.filter((f) => f !== cover)];
}

/** A held-photos ask that also names the File Claude picked for the cover (index into what it was sent). */
export function withCoverFile(files: File[], ask: (f: File[]) => Promise<AiDraft>): () => Promise<AiDraft & { coverFile?: File }> {
  return async () => {
    const d = await ask(files);
    return typeof d.coverPhoto === "number" ? { ...d, coverFile: files[d.coverPhoto] } : d;
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
  photosAdded = 0,
  onDraft,
}: {
  ask: (() => Promise<AiDraft>) | null;
  form: F;
  setForm: (update: (f: F) => F) => void;
  autoStart: boolean;
  autoFillEmpty?: boolean;
  /** How many photos a new listing holds: more of them, within what Claude reads, reads again (audit posting 1030 #10). */
  photosAdded?: number;
  /** Called with each answer (the photo coach's cover pick). */
  onDraft?: (d: AiDraft & { coverFile?: File }) => void;
}) {
  const [state, setState] = useState<AiState>({ status: "idle" });
  const formRef = useRef(form);
  formRef.current = form;
  const ran = useRef(false);
  const memory = useRef<AiMemory | null>(null);
  const readPhotos = useRef(0);
  const photosNow = useRef(photosAdded);
  photosNow.current = photosAdded;
  const run = useCallback(async (onlyEmpty = false) => {
    if (!ask) return;
    ran.current = true;
    readPhotos.current = photosNow.current;
    if (!memory.current) memory.current = { base: aiFieldsOf(formRef.current), theirs: [] };
    setState({ status: "busy" });
    try {
      const d = await ask();
      if (onlyEmpty) {
        setForm((f) => fillEmptyFields(f, d));
      } else {
        const merged = mergeAiDraft(formRef.current, memory.current, d);
        memory.current = merged.memory;
        setForm(() => merged.form);
      }
      onDraft?.(d);
      setState({ status: "done", draft: d });
    } catch (err) {
      // Not silent: the panel shows the seller the plain-words reason and a "Try again" button
      // (the edge function logs the cause server-side), and they can always fill it in themselves.
      console.warn("[declutter] Claude's listing draft failed", err);
      setState({ status: "error", message: declutterErrorMessage(err) });
    }
  }, [ask, setForm, onDraft]);
  useEffect(() => {
    if ((autoStart || autoFillEmpty) && ask && !ran.current) void run(!autoStart);
  }, [autoStart, autoFillEmpty, ask, run]);
  // A photo added after the first answer is read too, once Claude has finished; only what isn't the seller's changes.
  const status = state.status;
  useEffect(() => {
    if (!autoStart || !ask || !ran.current || status !== "done") return;
    if (photosAdded > readPhotos.current && readPhotos.current < AI_DRAFT_PHOTOS) void run(false);
  }, [autoStart, ask, photosAdded, status, run]);
  /** A listing brought back from this device: what was ours and what was theirs, and that the photos have been read. */
  const remember = useCallback((m: AiMemory | null, photos: number) => {
    memory.current = m;
    readPhotos.current = photos;
    ran.current = !!m;
  }, []);
  return { state, run: () => run(false), memory, remember };
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

/**
 * `oneScreen` (audit DC-1): a NEW listing is one screen (SellOneScreen), so Claude's rows are below the panel, not
 * on "the next steps"; a saved draft's step form keeps the step words.
 */
const AI_CHANGE_HINT = { oneScreen: "Check it below and change anything.", steps: "Check it and change anything on the next steps." } as const;
export function SellAiDraftPanel({ state, onRun, oneScreen = false, free = false }: { state: AiState; onRun: () => void; oneScreen?: boolean; free?: boolean }) {
  if (state.status === "busy") {
    return (
      <div role="status" aria-live="polite" data-ai-draft="busy" className="flex items-start gap-3 rounded-[20px] border border-border bg-card p-4">
        <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-[hsl(var(--sage-ink))]" aria-hidden />
        <div className="min-w-0">
          <p className="text-ds-15 font-semibold text-foreground">We're writing your listing…</p>
          <p className="mt-0.5 text-ds-13 text-muted-foreground">It looks at your photos for the name, details, category, size, condition{free ? "" : " and a fair price"}. This takes a few seconds.</p>
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
          <p className="text-ds-13 font-semibold text-[hsl(var(--sage-ink))]">We wrote your listing. Check it before you post</p>
        </div>
        {d.photoTip && (
          <p className="text-ds-14 text-foreground [overflow-wrap:anywhere]" data-ai-photo-tip="">
            <span className="font-semibold">One more photo would help:</span> {d.photoTip}
          </p>
        )}
        {/* On the one screen the rows below hold all of this; said twice, it pushed them off the first screen (audit posting 1030 #17). */}
        {!oneScreen && <div className="space-y-1">
          <p className="text-ds-17 font-bold text-foreground [overflow-wrap:anywhere]" data-ai-title="">{d.title}</p>
          <p className="text-ds-13 text-muted-foreground">
            {[CATEGORY_LABEL[d.category] ?? d.category, CONDITION_LABEL[d.conditionStars], SIZE_LABEL[d.deliverySize]].filter(Boolean).join(" · ")}
          </p>
          {d.description && <p className="line-clamp-3 text-ds-14 text-foreground [overflow-wrap:anywhere]">{d.description}</p>}
          {!free && <AiPriceLine draft={d} />}
        </div>}
        {d.flagged && (
          <p className="text-ds-13 font-semibold text-foreground">
            This item may not be allowed, so someone from Louisiana Helpr will look at it before it goes up.
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-ds-13 text-muted-foreground" data-ai-change-hint="">{oneScreen ? AI_CHANGE_HINT.oneScreen : AI_CHANGE_HINT.steps}</p>
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
      <p className="min-w-0 flex-1 text-ds-14 text-muted-foreground">We can write the name, details, category, size and condition from your photos.</p>
      <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={onRun}>
        <Sparkles className="mr-1.5 h-4 w-4" aria-hidden />Write my listing
      </Button>
    </div>
  );
}
