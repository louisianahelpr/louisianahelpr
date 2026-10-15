/**
 * /quotes/send/:id: send a quote on an open request (owner Q7): a total price
 * in whole dollars, a note, when you can do it, and up to 4 past-work photos.
 * The poster sees only their own quotes; other quoters never see this one.
 * Contact details in the note are refused by the server (the same filter as
 * messages), and that sentence is shown as it is.
 */
import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ImagePlus, X } from "lucide-react";
import AppPage from "@/components/AppPage";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  MAX_QUOTE_DOLLARS,
  MAX_QUOTE_PHOTOS,
  MIN_QUOTE_DOLLARS,
  fetchOpenQuoteRequests,
  quotePhotoUrl,
  removeQuotePhotos,
  submitJobQuote,
  uploadQuotePhoto,
} from "@/lib/quotes/api";
import { quoteErrorMessage } from "@/lib/quotes/errors";
import { QuotesGate, QuotesNotice, dayLabel, timeLeft } from "@/components/quotes/quotesUi";
import { parseWholeDollars } from "@/components/quotes/QuoteAnswerControls";

const TITLE = "Send a quote";
const NOTE_MAX = 500;
const WHEN_MAX = 120;

function SendQuoteForm({ requestId, userId }: { requestId: string; userId: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const [when, setWhen] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const open = useQuery({ queryKey: ["quotes", "open"], queryFn: fetchOpenQuoteRequests });
  const request = open.data?.find((r) => r.id === requestId);
  const dollarsTyped = parseWholeDollars(price);
  const ready = dollarsTyped != null && note.trim().length > 0 && when.trim().length > 0 && !uploading;

  const send = useMutation({
    mutationFn: () =>
      submitJobQuote({ requestId, priceDollars: dollarsTyped ?? 0, note: note.trim(), when: when.trim(), photoPaths: photos }),
    onSuccess: () => {
      toast.success("Quote sent", { description: "We'll let you know when they answer." });
      void qc.invalidateQueries({ queryKey: ["quotes"] });
      navigate("/quotes?view=mine", { replace: true });
    },
    onError: (err) => toast.error(quoteErrorMessage(err)),
  });

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const room = MAX_QUOTE_PHOTOS - photos.length;
    const picked = Array.from(files).slice(0, Math.max(0, room));
    if (files.length > room) toast.info(`A quote can carry up to ${MAX_QUOTE_PHOTOS} photos.`);
    setUploading(true);
    try {
      for (const f of picked) {
        try {
          const path = await uploadQuotePhoto(userId, f);
          setPhotos((p) => [...p, path]);
        } catch (err) {
          toast.error(quoteErrorMessage(err));
        }
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function removePhoto(path: string) {
    setPhotos((p) => p.filter((x) => x !== path));
    void removeQuotePhotos([path]);
  }

  if (open.isPending) return <p className="text-sm text-muted-foreground">Loading the request…</p>;
  if (open.isError) return <ErrorState variant="inline" onRetry={() => void open.refetch()} />;
  if (!request) {
    return (
      <QuotesNotice title="This request isn't taking quotes anymore">
        It may have closed, been booked, or been cancelled.
      </QuotesNotice>
    );
  }
  if (request.my_quote_id) {
    return (
      <QuotesNotice title="You already sent a quote for this job">
        <Button type="button" size="sm" className="mt-3" onClick={() => navigate("/quotes?view=mine")}>
          See your quotes
        </Button>
      </QuotesNotice>
    );
  }

  return (
    <div className="space-y-5 pb-safe-nav">
      <section className="rounded-2xl border border-border bg-card p-4" aria-label="The job">
        <p className="font-semibold text-foreground break-words">{request.title}</p>
        <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground break-words">{request.description}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          Needed {dayLabel(request.date_needed)}
          {request.estimated_hours ? ` · about ${request.estimated_hours} h` : ""}
          {request.location ? ` · ${request.location}` : request.parish ? ` · ${request.parish}` : ""}
          {timeLeft(request.quotes_close_at) ? ` · ${timeLeft(request.quotes_close_at)}` : ""}
        </p>
      </section>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) send.mutate();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="quote-price">Total price (whole dollars)</Label>
          <Input
            id="quote-price"
            inputMode="numeric"
            autoComplete="off"
            placeholder="150"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            aria-describedby="quote-price-help"
          />
          <p id="quote-price-help" className="text-xs text-muted-foreground">
            The whole job, from ${MIN_QUOTE_DOLLARS} to ${MAX_QUOTE_DOLLARS.toLocaleString("en-US")}. If the poster accepts, this is the job price.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="quote-note">What's included</Label>
          <Textarea
            id="quote-note"
            rows={4}
            maxLength={NOTE_MAX}
            placeholder="What you'll do and what you'll bring"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-describedby="quote-note-help"
          />
          <p id="quote-note-help" className="text-xs text-muted-foreground">
            No phone numbers, emails or links. You can message once you're booked.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="quote-when">When you can do it</Label>
          <Input
            id="quote-when"
            maxLength={WHEN_MAX}
            placeholder="Saturday morning"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">Photos of past work (optional, up to {MAX_QUOTE_PHOTOS})</p>
          {photos.length > 0 && (
            <ul className="grid grid-cols-4 gap-2" aria-label="Photos added">
              {photos.map((p) => (
                <li key={p} className="relative">
                  <img src={quotePhotoUrl(p)} alt="Past work" className="aspect-square w-full rounded-lg object-cover" />
                  <button
                    type="button"
                    onClick={() => removePhoto(p)}
                    className="absolute right-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-full bg-background/90 text-foreground shadow"
                    aria-label="Remove this photo"
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {photos.length < MAX_QUOTE_PHOTOS && (
            <>
              <input
                ref={fileRef}
                id="quote-photos"
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                onChange={(e) => void onFiles(e.target.files)}
              />
              <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
                <ImagePlus className="mr-2 h-4 w-4" aria-hidden />
                {uploading ? "Adding photos…" : "Add photos"}
              </Button>
            </>
          )}
        </div>
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={!ready || send.isPending}>
          {dollarsTyped != null ? `Send quote · $${dollarsTyped}` : "Send quote"}
        </Button>
      </form>
    </div>
  );
}

function SendQuote() {
  const { id = "" } = useParams<{ id: string }>();
  const { user } = useCurrentUser();
  if (!user) return null;
  return <SendQuoteForm requestId={id} userId={user.id} />;
}

export default function SendQuotePage() {
  return (
    <QuotesGate title={TITLE}>
      <AppPage title={TITLE} backTo="/quotes?view=open">
        <SendQuote />
      </AppPage>
    </QuotesGate>
  );
}
