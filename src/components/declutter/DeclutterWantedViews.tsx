/**
 * Declutter wanted posts (docs/specs/declutter-wanted-price-hint.md, W1-W17).
 * Plain words only. (The fair-price hint is DeclutterPriceHint.tsx.)
 *
 *   WantedView     the "Wanted" view inside /declutter (W14): post what you
 *                  want (words, category, highest price, how far), see the
 *                  live listings that match now, close a post. Shown only
 *                  while 'declutter_wanted' is on for the member.
 *
 * The server enforces every rule (20261016053541); this file only explains.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { Switch } from "@/components/ui/switch";
import { useAgeGate } from "@/hooks/useAgeGate";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { WantedNearSection } from "./DeclutterWantedReplies";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { formatPrice } from "@/lib/declutter/distance";
import {
  WANTED_RADIUS_CHOICES,
  closeWanted,
  createWanted,
  fetchMyWanted,
  setWantedPublic,
  wantedFormProblem,
  type WantedForm,
  type WantedPost,
} from "@/lib/declutter/wanted";
import { CATEGORY_LABEL, DeclutterNotice } from "./declutterUi";
import { Chip } from "./DeclutterFilterPanel";
import { useDeclutterOrigin } from "./useDeclutterOrigin";

// Q2267: "Let sellers near me reply" starts ON in the form (owner 2026-10-21); the server default stays off.
const EMPTY: WantedForm = { what: "", category: "", maxPrice: "", radius: 10, public: true };

function WantedForm({ at, onPosted }: { at: { lat: number; lng: number }; onPosted: () => void }) {
  const [form, setForm] = useState<WantedForm>(EMPTY);
  const [problem, setProblem] = useState<string | null>(null);
  const post = useMutation({
    mutationFn: () => createWanted(form, at),
    onSuccess: (r) => {
      setForm(EMPTY);
      setProblem(null);
      toast.success(
        r.repliesOn
          ? "Posted. Sellers near you can answer it, and we'll tell you when a match is listed at or under your price."
          : "Posted. If your New offers alerts are on, we'll tell you when a match is listed at or under your price.",
      );
      onPosted();
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const input = "h-12 w-full min-w-0 rounded-2xl border border-input glass-field px-4 text-ds-15";
  return (
    // Board 116 "Post a Wanted", kept to what the server stores (declutter_create_wanted: words, category, highest price,
    // distance). Not built: how you'd get it, details, a reference photo (no fields), and neighbors replying (a Wanted is
    // private by design, W-spec: sellers get a heads-up with your price, never your name or words; board 117 is parked).
    <form
      className="rounded-2xl border border-border bg-card p-4 space-y-4"
      aria-labelledby="wanted-form-title"
      onSubmit={(e) => {
        e.preventDefault();
        const p = wantedFormProblem(form);
        setProblem(p);
        if (!p) post.mutate();
      }}
    >
      <div className="space-y-1">
        <h2 id="wanted-form-title" className="font-moment text-ds-28 leading-tight">What are you looking for?</h2>
        <p className="text-ds-13 text-muted-foreground">
          {form.public
            ? "Sellers near you can see it and answer with one of their listings. You get a heads-up when a match is listed at or under your price."
            : "Sellers near you with a matching listing get a heads-up with your highest price, never your name or your words. You get one when a match is listed at or under your price. Only you see your post."}
        </p>
      </div>
      <div className="space-y-1">
        <label className="block text-ds-15 font-semibold" htmlFor="wanted-what">I'm looking for</label>
        <input id="wanted-what" className={input} maxLength={60} value={form.what} placeholder="Kids bike, 16 inch"
          onChange={(e) => setForm((f) => ({ ...f, what: e.target.value }))} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0 space-y-1">
          <label className="block text-ds-15 font-semibold" htmlFor="wanted-max">Up to</label>
          <div className={`${input} flex items-center gap-1`}>
            <span aria-hidden className="font-semibold text-[hsl(var(--burnt-sienna))]">$</span>
            <input id="wanted-max" className="w-full min-w-0 self-stretch rounded-xl bg-transparent font-semibold text-[hsl(var(--burnt-sienna))] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring placeholder:font-normal placeholder:text-muted-foreground"
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
        {/* Browse's distance chips (DeclutterFilterPanel's Chip), not an 11px segmented control (lead walkthrough
            2026-10-28, shot 39: "Within" read tiny beside the 15px fields). */}
        <div role="group" aria-labelledby="wanted-within" className="flex flex-wrap gap-2" data-wanted-within="">
          {WANTED_RADIUS_CHOICES.map((m) => (
            <Chip key={m} on={form.radius === m} onClick={() => setForm((f) => ({ ...f, radius: m }))}>{`${m} mi`}</Chip>
          ))}
        </div>
      </div>
      {/* Q2267 (owner 2026-10-21): on by default, in plain view, with what sellers see. */}
      <div className="flex items-start justify-between gap-3 rounded-2xl border border-border px-4 py-3">
        <div className="min-w-0">
          <label htmlFor="wanted-public" className="block text-ds-15 font-semibold">Let sellers near me reply</label>
          <p className="text-ds-13 text-muted-foreground">Sellers near you see your first name, what you want and your max price, never your address.</p>
        </div>
        <Switch id="wanted-public" checked={form.public} onCheckedChange={(v) => setForm((f) => ({ ...f, public: v }))} />
      </div>
      {problem && <p className="text-sm text-destructive-ink" role="alert">{problem}</p>}
      <div className="space-y-2">
        <p className="text-ds-13 text-muted-foreground">Your Wanted stays up 30 days. You can close it anytime.</p>
        <Button type="submit" className="w-full sm:w-auto" disabled={post.isPending}>{post.isPending ? "Posting…" : "Post wanted"}</Button>
      </div>
    </form>
  );
}

const STATUS_WORDS: Record<WantedPost["status"], string> = {
  open: "Open",
  closed: "Closed",
  expired: "Expired",
};

function WantedRow({ post }: { post: WantedPost }) {
  const qc = useQueryClient();
  const close = useMutation({
    mutationFn: () => closeWanted(post.id),
    onSuccess: () => {
      toast.success("Closed. No more alerts for this one.");
      void qc.invalidateQueries({ queryKey: ["declutter", "wanted"] });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  // Q2267: turn replies on or off later (only once the server reports the setting).
  const replies = useMutation({
    mutationFn: (on: boolean) => setWantedPublic(post.id, on),
    onSuccess: (on) => {
      toast.success(on ? "Sellers near you can answer this post." : "Only you see this post now.");
      void qc.invalidateQueries({ queryKey: ["declutter", "wanted"] });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const matches = post.matches;
  return (
    <li className="rounded-2xl border border-border bg-card p-4 space-y-2">
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
      {post.status === "open" && post.public !== undefined && (
        <div className="flex items-center justify-between gap-3">
          <label htmlFor={`wanted-public-${post.id}`} className="text-ds-13">Sellers near me can reply</label>
          <Switch id={`wanted-public-${post.id}`} checked={post.public} disabled={replies.isPending} onCheckedChange={(v) => replies.mutate(v)} />
        </div>
      )}
      {post.status === "open" && (
        <Button type="button" variant="outline" size="sm" disabled={close.isPending} onClick={() => close.mutate()}>
          Close
        </Button>
      )}
    </li>
  );
}

export function WantedView() {
  const qc = useQueryClient();
  const { underAge } = useAgeGate();
  const { user } = useCurrentUser();
  const { origin, askDevice, asked, asking, deviceNote } = useDeclutterOrigin();
  const mine = useQuery({ queryKey: ["declutter", "wanted"], queryFn: fetchMyWanted });

  if (mine.isError) {
    return <ErrorState variant="inline" title="We couldn't load your wanted posts." body={declutterErrorMessage(mine.error)} onRetry={() => void mine.refetch()} />;
  }
  return (
    <div className="space-y-4">
      {underAge ? (
        <DeclutterNotice title="You must be 18 or older to buy on Declutter." />
      ) : origin.status === "pending" ? (
        <p className="text-sm text-muted-foreground" role="status">Finding your area…</p>
      ) : origin.status === "ready" ? (
        <WantedForm at={{ lat: origin.lat, lng: origin.lng }} onPosted={() => void qc.invalidateQueries({ queryKey: ["declutter", "wanted"] })} />
      ) : (
        <DeclutterNotice title="We need your area to find matches near you.">
          <p>{asked ? "Add your ZIP code in your profile, then come back." : "Use your location, or add your ZIP code in your profile."}</p>
          {deviceNote && <p className="mt-1" role="status">{deviceNote}</p>}
          {asking && <p className="mt-1" role="status">Finding you…</p>}
          {!asked && (
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={askDevice}>
              Use my location
            </Button>
          )}
        </DeclutterNotice>
      )}
      {/* Q2267: public posts near you that you can answer with one of your listings. */}
      {!underAge && user && origin.status === "ready" && <WantedNearSection at={{ lat: origin.lat, lng: origin.lng }} userId={user.id} />}
      <section className="space-y-2" aria-labelledby="wanted-mine-title">
        <h2 id="wanted-mine-title" className="text-base font-semibold">Your wanted posts</h2>
        {mine.isLoading ? (
          <p className="text-sm text-muted-foreground" role="status">Loading your wanted posts…</p>
        ) : (mine.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">You haven't posted anything yet. Each post lasts 30 days.</p>
        ) : (
          <ul className="space-y-3">
            {(mine.data ?? []).map((w) => <WantedRow key={w.id} post={w} />)}
          </ul>
        )}
      </section>
    </div>
  );
}
