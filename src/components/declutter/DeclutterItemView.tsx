/**
 * /declutter/item/:id — one Declutter item, photo-first (owner, 2026-10-19:
 * Facebook Marketplace / OfferUp / Mercari): the swipeable gallery, then the
 * price, condition and title, the seller card, Buy now / Make an offer
 * (OfferPanel, with a bar above the dock on a phone), the details, pickup
 * (area + miles: rows 5, 27), and the public Q&A (row 35, through the
 * contact-leak filter server-side; messages open after checkout). Share and
 * the watch heart (row 46) sit on the title row. Two columns from lg.
 */
import { useState, type ReactNode } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Heart, Share2 } from "lucide-react";
import { toast } from "sonner";
import AppPage from "@/components/AppPage";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDeclutterOrigin } from "./useDeclutterOrigin";
import { DeclutterItemSkeleton, DeclutterItemUnavailable, isItemId } from "./DeclutterSkeletons";
import {
  answerQuestion,
  askQuestion,
  fetchItem,
  fetchMyItemReview,
  fetchPhotos,
  fetchQuestions,
  fetchWatching,
  photoPublicUrl,
  setWatch,
  type DeclutterQuestion,
} from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { formatPrice, milesBetween, milesLabel } from "@/lib/declutter/distance";
import {
  CATEGORY_LABEL,
  CONDITION_LABEL,
  ConditionStars,
  DeclutterNotice,
  SIZE_LABEL,
  STATUS_HELP,
  STATUS_LABEL,
} from "./declutterUi";
import { OfferPanel } from "./DeclutterOfferPanel";
import PriceHint from "./DeclutterPriceHint";
import { DeclutterGallery } from "./DeclutterGallery";
import { DeclutterSellerCard } from "./DeclutterSellerCard";
import { DeclutterItemRows } from "./DeclutterItemRows";
import { shareNative } from "@/lib/nativeShare";
import { getPublicOrigin } from "@/lib/authRedirects";

/** Share (native sheet, else copy the link): the item's own address, never a filler page. */
function shareItem(it: { id: string; title: string; current_price_cents: number }) {
  void shareNative({
    title: it.title,
    text: `${it.title} · ${formatPrice(it.current_price_cents)} on Louisiana Helpr`,
    url: `${getPublicOrigin()}/declutter/item/${it.id}`,
  });
}

/** One label / value row of the details list. */
function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="text-sm text-muted-foreground shrink-0">{label}</dt>
      <dd className="text-sm text-right min-w-0 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

function QuestionRow({ q, isSeller, itemId }: { q: DeclutterQuestion; isSeller: boolean; itemId: string }) {
  const qc = useQueryClient();
  const [answer, setAnswer] = useState("");
  const send = useMutation({
    mutationFn: () => answerQuestion(q.id, answer.trim()),
    onSuccess: () => {
      setAnswer("");
      void qc.invalidateQueries({ queryKey: ["declutter", "questions", itemId] });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  return (
    <li className="rounded-xl border border-border p-3 space-y-1">
      <p className="text-sm font-medium [overflow-wrap:anywhere]">Q: {q.question}</p>
      {q.answer ? (
        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">A: {q.answer}</p>
      ) : isSeller ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (answer.trim()) send.mutate();
          }}
        >
          <label className="sr-only" htmlFor={`answer-${q.id}`}>Your answer</label>
          <input
            id={`answer-${q.id}`}
            className="flex-1 min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-sm"
            value={answer}
            maxLength={1000}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Write an answer"
          />
          <Button type="submit" size="sm" disabled={send.isPending || !answer.trim()}>
            Answer
          </Button>
        </form>
      ) : (
        <p className="text-xs text-muted-foreground">Not answered yet.</p>
      )}
    </li>
  );
}

export default function ItemView({ itemId }: { itemId: string }) {
  const { user } = useCurrentUser();
  const qc = useQueryClient();
  // Miles from what we already know; this screen never asks for location.
  const { origin: geo } = useDeclutterOrigin();
  const [question, setQuestion] = useState("");
  // A link whose id is not an item id at all can never load one: say so at
  // once instead of asking the server (and showing a skeleton) first.
  const validId = isItemId(itemId);
  const item = useQuery({ queryKey: ["declutter", "item", itemId], queryFn: () => fetchItem(itemId), enabled: validId });
  const photos = useQuery({ queryKey: ["declutter", "item-photos", itemId], queryFn: () => fetchPhotos([itemId]), enabled: validId });
  const questions = useQuery({ queryKey: ["declutter", "questions", itemId], queryFn: () => fetchQuestions(itemId), enabled: validId });
  const watching = useQuery({
    queryKey: ["declutter", "watching", user?.id],
    queryFn: () => fetchWatching(user!.id),
    enabled: !!user,
  });
  const isSeller = !!user && item.data?.seller_id === user.id;
  const review = useQuery({
    queryKey: ["declutter", "my-review", itemId],
    queryFn: () => fetchMyItemReview(itemId),
    enabled: isSeller && item.data?.status === "rejected",
  });
  const isWatching = watching.data?.has(itemId) ?? false;
  const toggleWatch = useMutation({
    mutationFn: () => setWatch(itemId, !isWatching),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["declutter", "watching"] }),
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const ask = useMutation({
    mutationFn: () => askQuestion(itemId, question.trim()),
    onSuccess: () => {
      setQuestion("");
      toast.success("Question posted. The seller's answer will show here.");
      void qc.invalidateQueries({ queryKey: ["declutter", "questions", itemId] });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });

  // One gate for the item and its photos: the gallery paints once, never a placeholder that pops into a photo.
  if (item.isLoading || photos.isLoading) return <DeclutterItemSkeleton />;
  if (item.isError || !item.data) {
    return <DeclutterItemUnavailable detail={item.isError ? declutterErrorMessage(item.error) : undefined} />;
  }
  const it = item.data;
  const miles =
    geo.status === "ready" ? milesBetween({ lat: geo.lat, lng: geo.lng }, { lat: Number(it.area_lat), lng: Number(it.area_lng) }) : null;
  const away = milesLabel(miles, geo.status === "ready" && geo.approximate);
  const canAct = !isSeller && (it.status === "live" || it.status === "reserved");

  const dropped = it.current_price_cents < it.price_cents;
  const urls = (photos.data ?? []).map((p) => photoPublicUrl(p.storage_path));

  return (
    <AppPage
      title={it.title}
      backTo="/declutter"
      // Phone (lead, 2026-10-19): back + share + heart only, the photo is the hero; the full title sits under the price.
      phoneHidesTitle
      titleActions={
        <>
          <button
            type="button"
            aria-label="Share this item"
            className="w-11 h-11 rounded-full border border-border flex items-center justify-center"
            onClick={() => shareItem(it)}
          >
            <Share2 className="w-5 h-5" aria-hidden />
          </button>
          {canAct && (
            <button
              type="button"
              aria-pressed={isWatching}
              aria-label={isWatching ? "Stop watching this item" : "Watch this item"}
              className={`w-11 h-11 rounded-full border border-border flex items-center justify-center ${isWatching ? "text-[hsl(var(--burnt-sienna))]" : ""}`}
              disabled={toggleWatch.isPending}
              onClick={() => toggleWatch.mutate()}
            >
              <Heart className="w-5 h-5" fill={isWatching ? "currentColor" : "none"} />
            </button>
          )}
        </>
      }
    >
      <div className="lg:grid lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start lg:gap-8">
        <div className="lg:sticky lg:top-0">
          <DeclutterGallery urls={urls} category={it.category} title={it.title} />
        </div>

        <div className="mt-4 lg:mt-0 min-w-0 space-y-5">
          <section aria-label="Price and condition" className="space-y-1.5">
            <p data-item-price="" className="text-3xl font-bold leading-tight tabular-nums">
              {formatPrice(it.current_price_cents)}
              {dropped && (
                <span className="ml-2 text-base font-medium text-muted-foreground">
                  <span className="sr-only">Price dropped, was </span>
                  <s aria-hidden>{formatPrice(it.price_cents)}</s>
                </span>
              )}
            </p>
            <ConditionStars stars={it.condition_stars} />
            <h2 className="pt-1 text-lg font-semibold leading-snug [overflow-wrap:anywhere]">{it.title}</h2>
            {dropped && <p className="text-xs text-muted-foreground">The price can drop again in the evening.</p>}
          </section>

          {isSeller && (
            <DeclutterNotice title={`Your listing: ${STATUS_LABEL[it.status]}`}>
              {STATUS_HELP[it.status] ?? null}
              {it.status === "rejected" && review.data?.review_note ? <p className="mt-1">Reason: {review.data.review_note}</p> : null}
            </DeclutterNotice>
          )}

          {!isSeller && <DeclutterSellerCard sellerId={it.seller_id} />}

          {/* Buy now and Make an offer sit right under the price and seller (owner, 2026-10-19). */}
          {canAct && user && <OfferPanel item={it} userId={user.id} />}

          <PriceHint category={it.category} conditionStars={it.condition_stars} at={{ lat: Number(it.area_lat), lng: Number(it.area_lng) }} place="this_area" />

          <section className="space-y-1" aria-labelledby="declutter-details">
            <h2 id="declutter-details" className="text-base font-semibold">Details</h2>
            <dl className="divide-y divide-border">
              <Detail label="Condition">{CONDITION_LABEL[it.condition_stars] ?? "Not stated"}</Detail>
              <Detail label="Category">{CATEGORY_LABEL[it.category] ?? "Other"}</Detail>
              <Detail label="Size">{SIZE_LABEL[it.delivery_size]}</Detail>
            </dl>
            {it.description && <p className="pt-2 text-sm whitespace-pre-line [overflow-wrap:anywhere]">{it.description}</p>}
          </section>

          <section className="space-y-1" aria-labelledby="declutter-pickup">
            <h2 id="declutter-pickup" className="text-base font-semibold">Pickup</h2>
            <p className="text-sm">
              Pickup in {it.area_label}
              {away ? ` · ${away}` : ""}
            </p>
            <p className="text-sm" data-testid="declutter-porch-line">
              {it.porch_ok !== false ? "Porch pickup available" : "Meet at the seller's home only"}
            </p>
            <p className="text-xs text-muted-foreground">The exact address is shared after you pay.</p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold">Questions</h2>
            <p className="text-xs text-muted-foreground">Everyone can see questions and answers. Keep phone numbers and payment apps out: messages open after checkout.</p>
            {questions.isError ? (
              <ErrorState variant="inline" title="We couldn't load the questions." body={declutterErrorMessage(questions.error)} onRetry={() => void questions.refetch()} />
            ) : (questions.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No questions yet.</p>
            ) : (
              <ul className="space-y-2">
                {(questions.data ?? []).map((q) => (
                  <QuestionRow key={q.id} q={q} isSeller={isSeller} itemId={itemId} />
                ))}
              </ul>
            )}
            {canAct && (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (question.trim().length >= 2) ask.mutate();
                }}
              >
                <label className="sr-only" htmlFor="declutter-question">Ask the seller a question</label>
                <input
                  id="declutter-question"
                  className="flex-1 min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-sm"
                  value={question}
                  maxLength={500}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Ask the seller a question"
                />
                <Button type="submit" size="sm" disabled={ask.isPending || question.trim().length < 2}>
                  Ask
                </Button>
              </form>
            )}
          </section>
        </div>
      </div>
      {!isSeller && (
        <div className="mt-8">
          <DeclutterItemRows item={it} viewerId={user?.id ?? null} from={geo.status === "ready" ? { lat: geo.lat, lng: geo.lng, approximate: geo.approximate } : null} />
        </div>
      )}
    </AppPage>
  );
}
