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
import { useId, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Camera, X } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { BarkPillButton } from "@/components/ui/BarkPillButton";
import { ErrorState } from "@/components/ui/ErrorState";
import { Sheet, SheetContent, SheetFooter, SheetHero, SheetPrimaryAction, SheetSecondaryAction } from "@/components/ui/sheet";
import { useAgeGate } from "@/hooks/useAgeGate";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { WantedNearSection } from "./DeclutterWantedReplies";
import { DECLUTTER_OFFLINE_COPY, declutterErrorMessage } from "@/lib/declutter/errors";
import { CONNECTION_TROUBLE_COPY } from "@/lib/networkFailure";
import { formatPrice } from "@/lib/declutter/distance";
import { photoPublicUrl } from "@/lib/declutter/api";
import {
  WANTED_PHOTO_MAX,
  WANTED_RADIUS_CHOICES,
  addWantedPhoto,
  closeWanted,
  createWanted,
  fetchMyWanted,
  removeWantedPhoto,
  wantedFormProblem,
  type WantedForm,
  type WantedPost,
  type WantedReply,
} from "@/lib/declutter/wanted";
import { FallbackImg } from "./FallbackImg";
import { ProblemPhotoPicker } from "./DeclutterProblemPhotos";
import { CATEGORY_LABEL, DeclutterNotice } from "./declutterUi";
import { Chip } from "./DeclutterFilterPanel";
import { useDeclutterOrigin } from "./useDeclutterOrigin";

const EMPTY: WantedForm = { what: "", category: "", maxPrice: "", radius: 10 };
const FORM_ID = "wanted-form";

/** What sellers near the poster see (shown under the form, in place of the old switch). */
const WANTED_SELLERS_SEE = "Sellers near you see your first name, what you want and your max price, never your address.";

type FieldsProps = {
  form: WantedForm;
  setForm: (next: (f: WantedForm) => WantedForm) => void;
  problem: string | null;
  onSubmit: () => void;
  /** The photo picker (optional, up to 3: the problem form's shared ProblemPhotoPicker). */
  photos: ReactNode;
  /** Audit W2: where the post is placed (the form never said), in plain words. */
  where: string;
};

/** The form's fields; the sheet's footer holds Cancel and "Post wanted" (it submits this form). */
function WantedFormFields({ form, setForm, problem, onSubmit, photos, where }: FieldsProps) {
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
        <input id="wanted-what" className={input} maxLength={60} value={form.what} placeholder="Kids bike, 16 inch"
          onChange={(e) => setForm((f) => ({ ...f, what: e.target.value }))} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0 space-y-1">
          <label className="block text-ds-15 font-semibold" htmlFor="wanted-max">Up to</label>
          <div className={`${input} flex items-center gap-1`}>
            {/* Audit W8: the "$" turns rust only once a price is typed, so the grey 30 never reads as a set price. */}
            <span aria-hidden className={`font-semibold ${form.maxPrice ? "text-[hsl(var(--burnt-sienna))]" : "text-muted-foreground"}`} data-wanted-dollar="">$</span>
            <input id="wanted-max" className="w-full min-w-0 self-stretch rounded-xl bg-transparent font-semibold text-[hsl(var(--burnt-sienna))] outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring placeholder:font-normal placeholder:text-muted-foreground"
              inputMode="numeric" value={form.maxPrice} placeholder="30"
              onChange={(e) => setForm((f) => ({ ...f, maxPrice: e.target.value }))} />
          </div>
        </div>
        <div className="min-w-0 space-y-1">
          <label className="block text-ds-15 font-semibold" htmlFor="wanted-category">Category</label>
          <select id="wanted-category" className={input} value={form.category}
            onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
            <option value="">Pick one</option>
            {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
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
      {problem && <p className="text-sm text-destructive-ink" role="alert">{problem}</p>}
      <div className="space-y-1 text-ds-13 text-muted-foreground" data-wanted-privacy="">
        <p>{WANTED_SELLERS_SEE}</p>
        <p>Your Wanted stays up 30 days. You can close it anytime.</p>
      </div>
    </form>
  );
}

/** "Post what you're looking for": the form in the shared bottom sheet (a side panel on the desktop website). */
function WantedFormSheet({ open, at, userId, onClose, where }: { open: boolean; at: { lat: number; lng: number }; userId: string; onClose: () => void; where: string }) {
  const webDesktop = useIsWebDesktop();
  const qc = useQueryClient();
  const [form, setForm] = useState<WantedForm>(EMPTY);
  const [files, setFiles] = useState<File[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const post = useMutation({
    // The post first, then its photos (each attaches to the new post's own folder). A photo that fails never takes
    // the post down with it: the post stays up, and the poster is told to add that photo again from the post.
    mutationFn: async () => {
      const id = await createWanted(form, at);
      let failed = 0;
      for (const f of files.slice(0, WANTED_PHOTO_MAX)) {
        try { await addWantedPhoto(userId, id, f); } catch (err) { failed += 1; console.warn("[declutter] Wanted photo not added", err); }
      }
      return failed;
    },
    onSuccess: (failed) => {
      setForm(EMPTY);
      setFiles([]);
      setProblem(null);
      if (failed > 0) toast.error(`Posted, but ${failed === 1 ? "a photo" : `${failed} photos`} didn't upload. Add ${failed === 1 ? "it" : "them"} again from your post.`);
      else toast.success("Posted. Sellers near you can answer it, and we'll tell you when a match is listed at or under your price.");
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
    const p = wantedFormProblem(form);
    setProblem(p);
    if (!p) post.mutate();
  };
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="bottom" floor={!webDesktop} onOpenAutoFocus={(e) => e.preventDefault()}
        className={`bg-premium-page max-h-[90dvh] overflow-y-auto ${webDesktop ? "sm:max-w-[520px]" : ""}`} data-wanted-sheet="">
        <SheetHero title="What are you looking for?" />
        <div className="mt-2">
          <WantedFormFields form={form} setForm={setForm} problem={problem} onSubmit={submit}
            photos={<ProblemPhotoPicker files={files} onChange={setFiles} disabled={post.isPending} />} where={where} />
        </div>
        <SheetFooter className="mt-4">
          <SheetSecondaryAction onClick={onClose}>Cancel</SheetSecondaryAction>
          <SheetPrimaryAction type="submit" form={FORM_ID} disabled={post.isPending}>{post.isPending ? "Posting…" : "Post wanted"}</SheetPrimaryAction>
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
          <li key={r.offer_id} className="min-w-0 text-sm" data-wanted-reply={r.offer_id}>
            <Link to={`/declutter/item/${r.item_id}`} className="link-standard">{r.item_title}</Link>
            {" · "}{r.seller_name}{" · "}{formatPrice(r.amount_cents)}{" · "}
            <span className="text-muted-foreground">{replyStatus(r)}</span>
          </li>
        ))}
      </ul>
      {yourTurn && <Link to="/declutter?tab=buying" className="link-standard text-sm font-semibold">Answer in Buying</Link>}
    </div>
  );
}

/** Your post's photos: each with Remove, and Add a photo while it is open and has fewer than 3. */
function WantedPostPhotos({ post, userId }: { post: WantedPost; userId: string }) {
  const qc = useQueryClient();
  const inputId = useId();
  const refresh = () => void qc.invalidateQueries({ queryKey: ["declutter", "wanted"] });
  const add = useMutation({ mutationFn: (f: File) => addWantedPhoto(userId, post.id, f), onSuccess: refresh, onError: (err) => toast.error(declutterErrorMessage(err)) });
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

function WantedRow({ post, userId }: { post: WantedPost; userId: string | null }) {
  const qc = useQueryClient();
  const openReplies = post.replies.filter((r) => r.status === "open").length;
  const close = useMutation({
    mutationFn: () => closeWanted(post.id),
    onSuccess: () => {
      // Audit W5: an answer already sent stays open in Buying; closing the post does not withdraw it, so say so.
      toast.success(openReplies > 0
        ? `Closed. No more alerts or answers. ${openReplies === 1 ? "The answer you already have stays" : `The ${openReplies} answers you already have stay`} in Buying until you accept or decline.`
        : "Closed. No more alerts or answers for this one.");
      void qc.invalidateQueries({ queryKey: ["declutter", "wanted"] });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const matches = post.matches;
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
                  <Link to={`/declutter/item/${m.id}`} className="link-standard text-sm block truncate" title={`${m.title}, ${formatPrice(m.price_cents)}`}>
                    {m.title} · {formatPrice(m.price_cents)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )
      )}
      {post.status === "open" && (
        <Button type="button" variant="outline" size="sm" className="rounded-full" disabled={close.isPending} onClick={() => close.mutate()}>
          Close
        </Button>
      )}
    </li>
  );
}

export function WantedView() {
  const { underAge } = useAgeGate();
  const { user } = useCurrentUser();
  const { origin, askDevice, asked, asking, deviceNote } = useDeclutterOrigin();
  const mine = useQuery({ queryKey: ["declutter", "wanted"], queryFn: fetchMyWanted });
  const [posting, setPosting] = useState(false);
  const at = origin.status === "ready" ? { lat: origin.lat, lng: origin.lng } : null;

  return (
    <div className="space-y-6" data-wanted-hub="">
      {underAge ? (
        <DeclutterNotice title="You must be 18 or older to buy on Declutter." />
      ) : origin.status === "pending" ? (
        <p className="text-sm text-muted-foreground" role="status">Finding your area…</p>
      ) : at ? (
        <div className="flex justify-center sm:justify-start">
          <BarkPillButton type="button" onClick={() => setPosting(true)}>Post what you're looking for</BarkPillButton>
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
            {(mine.data ?? []).map((w) => <WantedRow key={w.id} post={w} userId={user?.id ?? null} />)}
          </ul>
        )}
      </section>
      {/* Q2267: other members' open posts near you that you can answer with one of your listings. */}
      {!underAge && user && at && <WantedNearSection at={at} userId={user.id} />}
      {at && user && <WantedFormSheet open={posting} at={at} userId={user.id} onClose={() => setPosting(false)} where={wantedWhereWords(origin.status === "ready" ? origin.source : null)} />}
    </div>
  );
}
