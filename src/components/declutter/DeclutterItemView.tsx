/**
 * /declutter/item/:id — one Declutter item: photos, condition stars, size,
 * price, area + miles (rows 5, 27), the seller and their rating, the watch
 * heart (row 46) and the public Q&A (row 35, through the contact-leak
 * filter server-side), and Buy / Make an offer (slice 3, OfferPanel).
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Heart } from "lucide-react";
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
  fetchSellerRating,
  fetchWatching,
  photoPublicUrl,
  setWatch,
  type DeclutterQuestion,
} from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { formatPrice, milesBetween, milesLabel } from "@/lib/declutter/distance";
import {
  CATEGORY_LABEL,
  ConditionStars,
  DeclutterNotice,
  SIZE_LABEL,
  STATUS_HELP,
  STATUS_LABEL,
} from "./declutterUi";
import { OfferPanel } from "./DeclutterTradeViews";

function SellerLine({ sellerId }: { sellerId: string }) {
  const stats = useQuery({ queryKey: ["declutter", "seller-stats", sellerId], queryFn: () => fetchSellerRating(sellerId) });
  const reviews = stats.data?.count ?? 0;
  return (
    <p className="text-sm">
      <Link to={`/user/${sellerId}`} className="link-standard font-semibold">
        See the seller
      </Link>
      <span className="text-muted-foreground">
        {" · "}
        {stats.isLoading
          ? "Loading rating…"
          : reviews > 0
            ? `${(stats.data?.avg ?? 0).toFixed(1)} stars from ${reviews} review${reviews === 1 ? "" : "s"}`
            : "No reviews yet"}
      </span>
    </p>
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

  if (item.isLoading) return <DeclutterItemSkeleton />;
  if (item.isError || !item.data) {
    return <DeclutterItemUnavailable detail={item.isError ? declutterErrorMessage(item.error) : undefined} />;
  }
  const it = item.data;
  const miles =
    geo.status === "ready" ? milesBetween({ lat: geo.lat, lng: geo.lng }, { lat: Number(it.area_lat), lng: Number(it.area_lng) }) : null;
  const away = milesLabel(miles, geo.status === "ready" && geo.approximate);
  const canAct = !isSeller && (it.status === "live" || it.status === "reserved");

  return (
    <AppPage
      title={it.title}
      backTo="/declutter"
      titleActions={
        canAct ? (
          <button
            type="button"
            aria-pressed={isWatching}
            aria-label={isWatching ? "Stop watching this item" : "Watch this item"}
            className="w-11 h-11 rounded-full border border-border flex items-center justify-center"
            disabled={toggleWatch.isPending}
            onClick={() => toggleWatch.mutate()}
          >
            <Heart className="w-5 h-5" fill={isWatching ? "currentColor" : "none"} />
          </button>
        ) : undefined
      }
    >
      <div className="flex gap-2 overflow-x-auto snap-x snap-mandatory -mx-1 px-1" role="group" aria-label="Photos">
        {(photos.data ?? []).map((p, i) => (
          <img
            key={p.id}
            src={photoPublicUrl(p.storage_path)}
            alt={`Photo ${i + 1} of ${(photos.data ?? []).length}`}
            className="snap-start shrink-0 w-[80%] max-w-sm aspect-square object-cover rounded-2xl bg-muted"
          />
        ))}
      </div>

      <section className="rounded-2xl border border-border bg-card p-4 space-y-2">
        <p className="text-2xl font-bold">{formatPrice(it.current_price_cents)}</p>
        {it.current_price_cents < it.price_cents && (
          <p className="text-xs text-muted-foreground">Price dropped · was {formatPrice(it.price_cents)}. The price can drop again in the evening.</p>
        )}
        <ConditionStars stars={it.condition_stars} />
        <p className="text-sm">{SIZE_LABEL[it.delivery_size]}</p>
        <p className="text-sm text-muted-foreground">{CATEGORY_LABEL[it.category] ?? "Other"}</p>
        <p className="text-sm">
          Pickup in {it.area_label}
          {away ? ` · ${away}` : ""}
        </p>
        <p className="text-xs text-muted-foreground">The exact address is shared after you pay.</p>
        {!isSeller && <SellerLine sellerId={it.seller_id} />}
      </section>

      {isSeller && (
        <DeclutterNotice title={`Your listing: ${STATUS_LABEL[it.status]}`}>
          {STATUS_HELP[it.status] ?? null}
          {it.status === "rejected" && review.data?.review_note ? <p className="mt-1">Reason: {review.data.review_note}</p> : null}
        </DeclutterNotice>
      )}

      {it.description && (
        <section className="space-y-1">
          <h2 className="text-base font-semibold">About this item</h2>
          <p className="text-sm whitespace-pre-line [overflow-wrap:anywhere]">{it.description}</p>
        </section>
      )}

      {canAct && user && <OfferPanel item={it} userId={user.id} />}

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
    </AppPage>
  );
}
