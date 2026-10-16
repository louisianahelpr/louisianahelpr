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
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useAgeGate } from "@/hooks/useAgeGate";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { formatPrice } from "@/lib/declutter/distance";
import {
  WANTED_RADIUS_CHOICES,
  closeWanted,
  createWanted,
  fetchMyWanted,
  wantedFormProblem,
  type WantedForm,
  type WantedPost,
  type WantedRadius,
} from "@/lib/declutter/wanted";
import { CATEGORY_LABEL, DeclutterNotice } from "./declutterUi";
import { useDeclutterOrigin } from "./useDeclutterOrigin";

const EMPTY: WantedForm = { what: "", category: "", maxPrice: "", radius: 10 };

function WantedForm({ at, onPosted }: { at: { lat: number; lng: number }; onPosted: () => void }) {
  const [form, setForm] = useState<WantedForm>(EMPTY);
  const [problem, setProblem] = useState<string | null>(null);
  const post = useMutation({
    mutationFn: () => createWanted(form, at),
    onSuccess: () => {
      setForm(EMPTY);
      setProblem(null);
      toast.success("Posted. If your New offers alerts are on, we'll tell you when a match is listed at or under your price.");
      onPosted();
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const input = "w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-sm";
  return (
    <form
      className="rounded-2xl border border-border bg-card p-4 space-y-3"
      aria-labelledby="wanted-form-title"
      onSubmit={(e) => {
        e.preventDefault();
        const p = wantedFormProblem(form);
        setProblem(p);
        if (!p) post.mutate();
      }}
    >
      <h2 id="wanted-form-title" className="text-base font-semibold">Looking for something?</h2>
      <p className="text-xs text-muted-foreground">
        Sellers near you with a matching listing get a heads-up with your highest price, never your name or your words. You get one when a match is listed at or under your price. Only you see your post.
      </p>
      <div>
        <label className="block text-sm font-medium" htmlFor="wanted-what">What you want</label>
        <input id="wanted-what" className={input} maxLength={60} value={form.what} placeholder="Crib"
          onChange={(e) => setForm((f) => ({ ...f, what: e.target.value }))} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="min-w-0">
          <label className="block text-sm font-medium" htmlFor="wanted-category">Category</label>
          <select id="wanted-category" className={input} value={form.category}
            onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
            <option value="">Pick one</option>
            {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="min-w-0">
          <label className="block text-sm font-medium" htmlFor="wanted-max">Highest price ($)</label>
          <input id="wanted-max" className={input} inputMode="numeric" value={form.maxPrice} placeholder="80"
            onChange={(e) => setForm((f) => ({ ...f, maxPrice: e.target.value }))} />
        </div>
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">How far you'd go</p>
        <SegmentedControl
          ariaLabel="How far you'd go"
          layout="wrap"
          value={String(form.radius)}
          onChange={(v) => setForm((f) => ({ ...f, radius: Number(v) as WantedRadius }))}
          options={WANTED_RADIUS_CHOICES.map((m) => ({ value: String(m), label: `${m} mi` }))}
        />
      </div>
      {problem && <p className="text-sm text-destructive" role="alert">{problem}</p>}
      <Button type="submit" disabled={post.isPending}>{post.isPending ? "Posting…" : "Post what I want"}</Button>
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
