/**
 * Declutter wanted posts (docs/specs/declutter-wanted-price-hint.md, W1-W17).
 * Plain words only. (The fair-price hint is DeclutterPriceHint.tsx.)
 *
 *   WantedView     the "Wanted" tab inside /declutter: its OWN hub (owner 2026-10-30, via the lead), not a form:
 *                  a "Post what you're looking for" pill that opens the form in the shared sheet, "Your Wanted
 *                  posts" (each with what is for sale now at or under its price, and Close), and "Wanted near you"
 *                  (other members' open posts nearby; "I have this" answers one with one of your listings,
 *                  DeclutterWantedReplies). Shown only while 'declutter_wanted' is on for the member.
 *
 * A Wanted is ALWAYS visible to sellers near the poster (owner 2026-10-30: "Wanted exists so sellers reply"): the
 * "Let sellers near me reply" switch is gone, and what they see is said as plain text under the form.
 * The server enforces every rule (20261016053541, 20261021031757); this file only explains.
 */
import { useEffect, useId, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Camera, X } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { Sheet, SheetContent, SheetFooter, SheetHero, SheetPrimaryAction, SheetSecondaryAction } from "@/components/ui/sheet";
import { safeStorage } from "@/lib/safeStorage";
import { useAgeGate } from "@/hooks/useAgeGate";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { WantedNearSection } from "./DeclutterWantedReplies";
import { DECLUTTER_OFFLINE_COPY, declutterErrorMessage } from "@/lib/declutter/errors";
import { CONNECTION_TROUBLE_COPY } from "@/lib/networkFailure";
import { formatPrice } from "@/lib/declutter/distance";
import { checkoutAmounts } from "@/lib/declutter/money";
import { ConfirmSheet } from "./DeclutterConfirmSheet";
import { photoPublicUrl } from "@/lib/declutter/api";
import { WANTED_POST_PARAM } from "@/lib/declutter/sellChooser";
import {
  WANTED_PHOTO_MAX,
  WANTED_RADIUS_CHOICES,
  addWantedPhoto,
  checkWantedPhotos,
  closeWanted,
  createWanted,
  dollarsToCents,
  fetchMyWanted,
  removeWanted,
  removeWantedPhoto,
  reopenWanted,
  updateWanted,
  wantedFormProblems,
  type WantedForm,
  type WantedFormProblems,
  type WantedPost,
  type WantedReply,
} from "@/lib/declutter/wanted";
import { FallbackImg } from "./FallbackImg";
import { ProblemPhotoPicker } from "./DeclutterProblemPhotos";
import { TwoStepCategoryPicker } from "@/components/ui/TwoStepCategoryPicker";
import { CATEGORY_PICKER_GROUPS } from "@/lib/declutter/categoryIcons";
import { CATEGORY_LABEL, DeclutterNotice } from "./declutterUi";
import { Chip } from "./DeclutterFilterPanel";
import { useDeclutterOrigin } from "./useDeclutterOrigin";
import { focusSheetItself } from "./focusSheetItself";

const EMPTY: WantedForm = { what: "", category: "", maxPrice: "", radius: 10 };
const FORM_ID = "wanted-form";

/**
 * Audit 10-30 #13: what was typed survives a reload, an app kill or leaving the page. Words, category, price and
 * distance only; chosen photos can't be kept and are picked again.
 */
const WANTED_DRAFT_KEY = "helpr_wanted_draft";

function readWantedDraft(): WantedForm {
  try {
    const raw = safeStorage.getItem(WANTED_DRAFT_KEY);
    if (!raw) return EMPTY;
    const d = JSON.parse(raw) as Partial<WantedForm>;
    return {
      what: typeof d.what === "string" ? d.what : "",
      category: typeof d.category === "string" ? d.category : "",
      maxPrice: typeof d.maxPrice === "string" ? d.maxPrice : "",
      radius: WANTED_RADIUS_CHOICES.find((m) => m === d.radius) ?? EMPTY.radius,
    };
  } catch (err) {
    console.warn("[declutter] ignored an unreadable Wanted draft", err);
    return EMPTY;
  }
}

function clearWantedDraft() {
  safeStorage.removeItem(WANTED_DRAFT_KEY);
}

function saveWantedDraft(form: WantedForm) {
  if (form.what === "" && form.category === "" && form.maxPrice === "" && form.radius === EMPTY.radius) clearWantedDraft();
  else safeStorage.setItem(WANTED_DRAFT_KEY, JSON.stringify(form));
}

/** What sellers near the poster see (shown under the form, in place of the old switch). */
const WANTED_SELLERS_SEE = "Sellers near you see your first name and last initial, what you want and your max price, never your address.";

type FieldsProps = {
  form: WantedForm;
  setForm: (next: (f: WantedForm) => WantedForm) => void;
  problems: WantedFormProblems;
  onSubmit: () => void;
  /** The photo picker (optional, up to 3: the problem form's shared ProblemPhotoPicker). */
  photos: ReactNode;
  /** Audit W2: where the post is placed (the form never said), in plain words. */
  where: string;
};

/** Audit 10-30 #18, #22: a field's problem sits beside it, and the field points at it for a screen reader. */
function FieldProblem({ id, text }: { id: string; text?: string }) {
  if (!text) return null;
  return <p id={id} className="text-sm text-destructive-ink" role="alert">{text}</p>;
}

/** What the most you'd pay comes to for the buyer (audit 10-30 #10): the fee is 5% + 70 cents, money.ts's own sum. */
function feeLine(maxPrice: string): string {
  const typed = dollarsToCents(maxPrice);
  const cents = typed !== null && typed >= 100 && typed <= 100_000 && typed % 100 === 0 ? typed : 3000;
  return `A ${formatPrice(cents)} item costs ${formatMoneyExact(checkoutAmounts([cents]).totalCents)} with our fee. A first purchase also has a one-time setup fee.`;
}

function formatMoneyExact(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** The form's fields; the sheet's footer holds Cancel and "Post wanted" (it submits this form). */
function WantedFormFields({ form, setForm, problems, onSubmit, photos, where }: FieldsProps) {
  const input = "h-12 w-full min-w-0 rounded-2xl border border-input glass-field px-4 text-ds-15";
  return (
    // Board 116 "Post a Wanted", kept to what the server stores (declutter_create_wanted: words, category, highest price,
    // distance). Not built: how you'd get it and details (no fields).
    <form
      id={FORM_ID}
      className="space-y-4"
      aria-label="What are you looking for?"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="space-y-1">
        <label className="block text-ds-15 font-semibold" htmlFor="wanted-what">I'm looking for</label>
        <input id="wanted-what" className={input} maxLength={60} value={form.what} placeholder="Kids bike" enterKeyHint="next" aria-required="true"
          aria-invalid={problems.what ? true : undefined} aria-describedby={problems.what ? "wanted-what-problem" : undefined}
          onChange={(e) => setForm((f) => ({ ...f, what: e.target.value }))} />
        <FieldProblem id="wanted-what-problem" text={problems.what} />
      </div>
      {/* Its own row (tester 10-30): beside "Up to" at 375 its subs wrapped in a half-width column, and opening it left
          an empty column under "Up to". */}
      <div className="min-w-0 space-y-1" data-wanted-category-row="">
        <label className="block text-ds-15 font-semibold" htmlFor="wanted-category">Category</label>
        <TwoStepCategoryPicker id="wanted-category" value={form.category} placeholder="Pick one"
          onChange={(category) => setForm((f) => ({ ...f, category }))} groups={CATEGORY_PICKER_GROUPS} triggerClassName="border-input" />
        <FieldProblem id="wanted-category-problem" text={problems.category} />
      </div>
      <div className="min-w-0 space-y-1">
        <label className="block text-ds-15 font-semibold" htmlFor="wanted-max">The most you'd pay for the item</label>
        <div className={`${input} flex items-center gap-1`}>
          {/* Audit W8: the "$" turns rust only once a price is typed, so the grey 30 never reads as a set price. */}
          <span aria-hidden className={`font-semibold ${form.maxPrice ? "text-[hsl(var(--burnt-sienna))]" : "text-muted-foreground"}`} data-wanted-dollar="">$</span>
          <input id="wanted-max" className="w-full min-w-0 self-stretch rounded-xl bg-transparent font-semibold text-[hsl(var(--burnt-sienna))] outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring placeholder:font-normal placeholder:text-muted-foreground"
            inputMode="numeric" value={form.maxPrice} placeholder="30" enterKeyHint="done" aria-required="true"
            aria-invalid={problems.maxPrice ? true : undefined} aria-describedby={problems.maxPrice ? "wanted-max-problem wanted-max-fee" : "wanted-max-fee"}
            onChange={(e) => setForm((f) => ({ ...f, maxPrice: e.target.value }))} />
        </div>
        <p id="wanted-max-fee" className="text-ds-13 text-muted-foreground" data-wanted-fee="">{feeLine(form.maxPrice)}</p>
        <FieldProblem id="wanted-max-problem" text={problems.maxPrice} />
      </div>
      <div className="space-y-1">
        <p id="wanted-within" className="text-ds-15 font-semibold">Within</p>
        <p className="text-ds-13 text-muted-foreground" data-wanted-where="">{where}</p>
        {/* Browse's distance chips (DeclutterFilterPanel's Chip), not an 11px segmented control (lead walkthrough
            2026-10-28, shot 39: "Within" read tiny beside the 15px fields). */}
        <div role="group" aria-labelledby="wanted-within" className="flex flex-wrap gap-2" data-wanted-within="">
          {WANTED_RADIUS_CHOICES.map((m) => (
            <Chip key={m} on={form.radius === m} onClick={() => setForm((f) => ({ ...f, radius: m }))}>{`${m} mi`}</Chip>
          ))}
        </div>
      </div>
      {/* Owner 2026-10-30: a photo of what you're looking for, like a quick listing (shown on your post and on
          "Wanted near you" cards). */}
      {photos}
      <FieldProblem id="wanted-radius-problem" text={problems.radius} />
      <div className="space-y-1 text-ds-13 text-muted-foreground" data-wanted-privacy="">
        <p>{WANTED_SELLERS_SEE}</p>
        <p>Your Wanted stays up 30 days. You can edit or close it anytime.</p>
      </div>
    </form>
  );
}

/** "Post what you're looking for": the form in the shared bottom sheet (a side panel on the desktop website). */
function WantedFormSheet({ open, at, userId, onClose, where, editing = null }: { open: boolean; at: { lat: number; lng: number }; userId: string; onClose: () => void; where: string; editing?: WantedPost | null }) {
  const webDesktop = useIsWebDesktop();
  const qc = useQueryClient();
  // Audit 10-30 #9: Edit opens this form on the post's own words. An edit never touches the new-post draft.
  const [form, setForm] = useState<WantedForm>(() => editing
    ? { what: editing.what, category: editing.category, maxPrice: String(editing.max_price_cents / 100), radius: WANTED_RADIUS_CHOICES.find((m) => m === editing.radius_miles) ?? EMPTY.radius }
    : readWantedDraft());
  useEffect(() => { if (!editing) saveWantedDraft(form); }, [form, editing]);
  const [files, setFiles] = useState<File[]>([]);
  const [problems, setProblems] = useState<WantedFormProblems>({});
  const post = useMutation({
    // The post first, then its photos (each attaches to the new post's own folder). A photo that fails never takes
    // the post down with it: the post stays up, and the poster is told to add that photo again from the post.
    mutationFn: async () => {
      if (editing) {
        await updateWanted(editing.id, form);
        return 0;
      }
      const id = await createWanted(form, at);
      let failed = 0;
      for (const f of files.slice(0, WANTED_PHOTO_MAX)) {
        try { await addWantedPhoto(userId, id, f); } catch (err) { failed += 1; console.warn("[declutter] Wanted photo not added", err); }
      }
      if (files.length > failed) checkPhotosInBackground(id);
      return failed;
    },
    onSuccess: (failed) => {
      setForm(EMPTY);
      if (!editing) clearWantedDraft();
      setFiles([]);
      setProblems({});
      if (editing) toast("Saved. Sellers near you see the new words and price.");
      else if (failed > 0) toast.error(`Posted, but ${failed === 1 ? "a photo" : `${failed} photos`} didn't upload. Add ${failed === 1 ? "it" : "them"} again from your post.`);
      // Audit 10-30 #4: what matching really does. It looks for any of the words, and a match can be missed.
      else toast("Posted. Sellers near you can answer it. We also watch new listings for your words and tell you if one looks like a match at or under your price.");
      void qc.invalidateQueries({ queryKey: ["declutter", "wanted"] });
      onClose();
    },
    // D4-14: offline mid-post says so; the form keeps what was typed (it clears only on success).
    onError: (err) => {
      const msg = declutterErrorMessage(err);
      toast.error(msg === DECLUTTER_OFFLINE_COPY || msg === CONNECTION_TROUBLE_COPY ? `${msg} We kept what you typed.` : msg);
    },
  });
  const submit = () => {
    if (post.isPending) return;
    const p = wantedFormProblems(form);
    setProblems(p);
    if (Object.keys(p).length === 0) post.mutate();
    else if (p.what) document.getElementById("wanted-what")?.focus();
    else if (p.category) document.getElementById("wanted-category")?.focus();
    else if (p.maxPrice) document.getElementById("wanted-max")?.focus();
  };
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="bottom" floor={!webDesktop} onOpenAutoFocus={focusSheetItself}
        className={`bg-premium-page max-h-[90dvh] overflow-y-auto ${webDesktop ? "sm:max-w-[520px]" : ""}`} data-wanted-sheet="">
        <SheetHero title={editing ? "Edit your post" : "What are you looking for?"} />
        <div className="mt-2">
          <WantedFormFields form={form} setForm={setForm} problems={problems} onSubmit={submit}
            photos={editing ? null : <ProblemPhotoPicker files={files} onChange={setFiles} disabled={post.isPending} />} where={editing ? "Measured from where you first posted it." : where} />
        </div>
        {/* Audit 10-30 #18: at 375 the form is taller than the sheet; the buttons stay in view as it scrolls. */}
        <SheetFooter className="sticky bottom-0 z-10 mt-4 bg-premium-page pt-2" data-wanted-footer="">
          <SheetSecondaryAction onClick={onClose}>Cancel</SheetSecondaryAction>
          <SheetPrimaryAction type="submit" form={FORM_ID} disabled={post.isPending}>{post.isPending ? (editing ? "Saving…" : "Posting…") : editing ? "Save" : "Post wanted"}</SheetPrimaryAction>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/** Where one reply stands, from the poster's side (the offer card in Buying is where it is answered). */
function replyStatus(r: WantedReply): string {
  if (r.status === "open") return r.awaiting === "buyer" ? "Waiting for you" : "Waiting for the seller";
  return { accepted: "Accepted", declined: "Declined", expired: "Expired", withdrawn: "Withdrawn", voided: "Ended" }[r.status];
}

/** The sellers' replies to one of your posts: which listing, which seller (First L.), what price, where it stands. */
function WantedReplies({ replies }: { replies: WantedReply[] }) {
  if (replies.length === 0) return <p className="text-xs text-muted-foreground" data-wanted-replies="none">No replies from sellers yet.</p>;
  const yourTurn = replies.some((r) => r.status === "open" && r.awaiting === "buyer");
  return (
    <div className="space-y-1" data-wanted-replies="">
      <p className="text-xs font-medium">{replies.length === 1 ? "1 reply from a seller:" : `${replies.length} replies from sellers:`}</p>
      <ul className="space-y-1">
        {replies.map((r) => (
          <li key={r.offer_id} className="flex min-w-0 items-center gap-2 text-sm" data-wanted-reply={r.offer_id}>
            {/* Audit 10-30 #19: the listing's photo, not only a line of text. */}
            {r.photo_path && <FallbackImg src={photoPublicUrl(r.photo_path)} alt="" className="h-11 w-11 shrink-0 rounded-lg bg-photo-empty object-cover" data-wanted-reply-photo="" />}
            <span className="min-w-0 [overflow-wrap:anywhere]">
              <Link to={`/declutter/item/${r.item_id}`} className="link-standard inline-flex min-h-11 items-center">{r.item_title}</Link>
              {" · "}{r.seller_name}{" · "}{formatPrice(r.amount_cents)}{" · "}
              <span className="text-muted-foreground">{replyStatus(r)}</span>
            </span>
          </li>
        ))}
      </ul>
      {yourTurn && <Link to="/declutter?tab=buying" className="link-standard inline-flex min-h-11 items-center text-sm font-semibold">Answer in Buying</Link>}
    </div>
  );
}

/** Your post's photos: each with Remove, and Add a photo while it is open and has fewer than 3. */
/** Audit 10-30 #8: runs behind the screen, because the post is already up. The poster hears only about a held photo. */
function checkPhotosInBackground(wantedId: string) {
  void checkWantedPhotos(wantedId).then((held) => {
    if (held) toast("Your post is up. A photo is waiting for a quick look before sellers see it.");
  });
}

function WantedPostPhotos({ post, userId }: { post: WantedPost; userId: string }) {
  const qc = useQueryClient();
  const inputId = useId();
  const refresh = () => void qc.invalidateQueries({ queryKey: ["declutter", "wanted"] });
  const add = useMutation({ mutationFn: (f: File) => addWantedPhoto(userId, post.id, f), onSuccess: () => { refresh(); checkPhotosInBackground(post.id); }, onError: (err) => toast.error(declutterErrorMessage(err)) });
  const remove = useMutation({ mutationFn: (p: string) => removeWantedPhoto(post.id, p), onSuccess: refresh, onError: (err) => toast.error(declutterErrorMessage(err)) });
  const open = post.status === "open";
  if (post.photo_paths.length === 0 && !open) return null;
  const busy = add.isPending || remove.isPending;
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Photos" data-wanted-photos="">
      {post.photo_paths.map((p, i) => (
        <li key={p} className="relative h-20 w-20">
          <FallbackImg src={photoPublicUrl(p)} alt={`Photo ${i + 1} of ${post.what}`} className="h-full w-full rounded-xl bg-photo-empty object-cover" />
          {open && (
            <button type="button" aria-label={`Remove photo ${i + 1}`} disabled={busy}
              className="absolute -right-2 -top-2 flex h-11 w-11 items-center justify-center" onClick={() => remove.mutate(p)}>
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-background/90 text-foreground shadow" aria-hidden>
                <X className="h-4 w-4" />
              </span>
            </button>
          )}
        </li>
      ))}
      {open && post.photo_paths.length < WANTED_PHOTO_MAX && (
        <li>
          <input id={inputId} type="file" accept="image/*" className="sr-only" tabIndex={-1} disabled={busy}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f && f.type.startsWith("image/")) add.mutate(f); }} />
          <button type="button" disabled={busy} onClick={() => document.getElementById(inputId)?.click()}
            className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-[hsl(var(--bark)/0.45)] text-ds-12 font-semibold text-[hsl(var(--bark))] dark:text-foreground">
            <Camera className="h-5 w-5" aria-hidden />
            {add.isPending ? "Adding…" : "Add a photo"}
          </button>
        </li>
      )}
    </ul>
  );
}

/** Audit W2: where a new post is placed, from where the hub found you. */
export function wantedWhereWords(source: "device" | "profile" | "zip" | "parish" | null): string {
  if (source === "device") return "Measured from where you are now (a rough area, never your address).";
  if (source === "parish") return "Measured from your parish (a rough area). Add your ZIP code in your profile to be closer.";
  return "Measured from your ZIP code on file (a rough area, never your address).";
}

const STATUS_WORDS: Record<WantedPost["status"], string> = {
  open: "Open",
  closed: "Closed",
  expired: "Expired",
};

function WantedRow({ post, userId, onEdit }: { post: WantedPost; userId: string | null; onEdit: (post: WantedPost) => void }) {
  const qc = useQueryClient();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["declutter", "wanted"] });
  const again = useMutation({
    mutationFn: () => reopenWanted(post.id),
    onSuccess: () => { toast("Posted again for another 30 days."); refresh(); },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: () => removeWanted(post.id),
    onSuccess: () => { toast("Removed."); setConfirmRemove(false); refresh(); },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  // Audit 10-30 #16: buying from an answer doesn't close the post, so ask once one is accepted.
  const gotIt = post.status === "open" && post.replies.some((r) => r.status === "accepted");
  const openReplies = post.replies.filter((r) => r.status === "open").length;
  const close = useMutation({
    mutationFn: () => closeWanted(post.id),
    onSuccess: () => {
      // Audit W5: an answer already sent stays open in Buying; closing the post does not withdraw it, so say so.
      toast(openReplies > 0
        ? `Closed. No more alerts or answers. ${openReplies === 1 ? "The answer you already have stays" : `The ${openReplies} answers you already have stay`} in Buying until you accept or decline.`
        : "Closed. No more alerts or answers for this one.");
      void qc.invalidateQueries({ queryKey: ["declutter", "wanted"] });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  // Audit 10-30 #19: a listing that already answered is shown as its answer, not a second time as a match.
  const answered = new Set(post.replies.map((r) => r.item_id));
  const matches = post.matches.filter((m) => !answered.has(m.id));
  return (
    <li className="rounded-2xl border border-border bg-card p-4 space-y-2" data-wanted-post={post.id}>
      <div className="flex items-start justify-between gap-3 min-w-0">
        <div className="min-w-0">
          <p className="font-semibold truncate" title={post.what}>{post.what}</p>
          <p className="text-sm text-muted-foreground">
            {CATEGORY_LABEL[post.category] ?? "Other"} · up to {formatPrice(post.max_price_cents)} · within {post.radius_miles} mi
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-medium" data-status={post.status}>
          {STATUS_WORDS[post.status]}
        </span>
      </div>
      {userId && <WantedPostPhotos post={post} userId={userId} />}
      <WantedReplies replies={post.replies} />
      {post.status === "open" && (
        matches.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing for sale matches at or under your price right now.</p>
        ) : (
          <div className="space-y-1">
            <p className="text-xs font-medium">For sale now at or under your price:</p>
            <ul className="space-y-1">
              {matches.map((m) => (
                <li key={m.id} className="min-w-0">
                  <Link to={`/declutter/item/${m.id}`} className="link-standard flex min-h-11 items-center truncate text-sm" title={`${m.title}, ${formatPrice(m.price_cents)}`}>
                    {m.title} · {formatPrice(m.price_cents)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )
      )}
      {gotIt && <p className="text-sm font-medium" data-wanted-got-it="">You accepted an answer. Got what you needed? Close this post.</p>}
      {post.status === "open" ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={() => onEdit(post)}>Edit</Button>
          <Button type="button" variant="outline" size="sm" className="rounded-full" disabled={close.isPending} onClick={() => close.mutate()}>
            Close
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" className="rounded-full" disabled={again.isPending} onClick={() => again.mutate()}>Post again</Button>
          <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={() => setConfirmRemove(true)}>Remove</Button>
        </div>
      )}
      <ConfirmSheet open={confirmRemove} title="Remove this post?" confirmLabel="Remove" pending={remove.isPending} onConfirm={() => remove.mutate()} onClose={() => setConfirmRemove(false)} testId="wanted-remove">
        It comes off your list for good, with its photos. Any answer you already have stays in Buying.
      </ConfirmSheet>
    </li>
  );
}

export function WantedView() {
  const { underAge } = useAgeGate();
  const { user } = useCurrentUser();
  const { origin, askDevice, asked, asking, deviceNote } = useDeclutterOrigin();
  const mine = useQuery({ queryKey: ["declutter", "wanted"], queryFn: fetchMyWanted });
  // The sell chooser's "Looking for something? Post a Wanted" (?post=1, owner 2026-10-30) opens the form at once
  // (it shows once the area is known, as the button does).
  const [params, setParams] = useSearchParams();
  const [posting, setPosting] = useState(() => params.get(WANTED_POST_PARAM) === "1");
  // Audit 10-30 #13: the ask is used up once read, or Cancel, a reload or Back brings the form back.
  useEffect(() => {
    if (!params.has(WANTED_POST_PARAM)) return;
    const next = new URLSearchParams(params);
    next.delete(WANTED_POST_PARAM);
    setParams(next, { replace: true });
  }, [params, setParams]);
  const [editing, setEditing] = useState<WantedPost | null>(null);
  const at = origin.status === "ready" ? { lat: origin.lat, lng: origin.lng } : null;

  return (
    <div className="space-y-6" data-wanted-hub="">
      {underAge ? (
        <DeclutterNotice title="You must be 18 or older to buy on Declutter." />
      ) : origin.status === "pending" ? (
        <p className="text-sm text-muted-foreground" role="status">Finding your area…</p>
      ) : at ? (
        // LEAD-WANTED-POST-BUTTON (owner 2026-10-31): the same button as Selling's "Sell an item" (DeclutterHomeView
        // data-selling-sell): default Button, rounded, left-aligned in the same row, not a centered floating pill.
        <div className="flex items-center gap-3" data-wanted-post="">
          <Button type="button" className="shrink-0 rounded-full" onClick={() => setPosting(true)}>Post what you're looking for</Button>
        </div>
      ) : (
        <DeclutterNotice title="We need your area to find matches near you.">
          <p>{asked ? "Add your ZIP code in your profile, then come back." : "Use your location, or add your ZIP code in your profile."}</p>
          {deviceNote && <p className="mt-1" role="status">{deviceNote}</p>}
          {asking && <p className="mt-1" role="status">Finding you…</p>}
          {!asked && (
            <Button type="button" variant="outline" size="sm" className="mt-2 rounded-full" onClick={askDevice}>
              Use my location
            </Button>
          )}
        </DeclutterNotice>
      )}
      <section className="space-y-2" aria-labelledby="wanted-mine-title">
        <h2 id="wanted-mine-title" className="text-base font-semibold">Your Wanted posts</h2>
        {mine.isError ? (
          <ErrorState variant="inline" title="We couldn't load your wanted posts." body={declutterErrorMessage(mine.error)} onRetry={() => void mine.refetch()} />
        ) : mine.isLoading ? (
          <p className="text-sm text-muted-foreground" role="status">Loading your wanted posts…</p>
        ) : (mine.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">You haven't posted anything yet. Each post lasts 30 days, and sellers near you can answer it.</p>
        ) : (
          <ul className="space-y-3">
            {(mine.data ?? []).map((w) => <WantedRow key={w.id} post={w} userId={user?.id ?? null} onEdit={setEditing} />)}
          </ul>
        )}
      </section>
      {/* Q2267: other members' open posts near you that you can answer with one of your listings. */}
      {!underAge && user && at && <WantedNearSection at={at} userId={user.id} />}
      {at && user && <WantedFormSheet key={editing?.id ?? "new"} open={posting || !!editing} editing={editing} at={at} userId={user.id} onClose={() => { setPosting(false); setEditing(null); }} where={wantedWhereWords(origin.status === "ready" ? origin.source : null)} />}
    </div>
  );
}
