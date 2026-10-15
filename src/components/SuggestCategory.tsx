import { useState } from "react";
import { Lightbulb, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHero,
  DialogPrimaryAction,
  DialogSecondaryAction,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useFeature } from "@/hooks/useFeature";
import {
  SUGGESTION_MAX,
  suggestCategory,
  suggestionErrorMessage,
  suggestionProblem,
  type SuggestionArea,
} from "@/lib/categorySuggestions";

/**
 * "Suggest a category" (owner decision I1, 2026-10-14): a small link under any
 * category picker. The user types a suggestion; it goes to the admin queue
 * (Admin -> Settings -> Category suggestions). "Other" keeps working, so the
 * copy says so: nobody has to wait on the queue to post.
 *
 * Renders nothing unless the hidden switch `suggest_category` reaches this
 * account; suggest_category() refuses everyone else on the server too.
 */
export function SuggestCategory({ area }: { area: SuggestionArea }) {
  const on = useFeature("suggest_category");
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [touched, setTouched] = useState(false);
  const [sending, setSending] = useState(false);
  if (!on) return null;

  const problem = suggestionProblem(text);

  const send = async () => {
    setTouched(true);
    if (problem) return;
    setSending(true);
    try {
      await suggestCategory(area, text);
      toast.success("Thanks! We'll look at your suggestion. Pick \"Other\" for now.");
      setOpen(false);
      setText("");
      setTouched(false);
    } catch (err) {
      toast.error(suggestionErrorMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 min-h-[44px] text-ds-12 font-sans font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-ds-sm"
        style={{ color: "hsl(var(--burnt-sienna))" }}
      >
        <Lightbulb className="w-3.5 h-3.5" aria-hidden />
        Don&apos;t see yours? Suggest a category
      </button>
      <Dialog open={open} onOpenChange={(o) => !sending && setOpen(o)}>
        <DialogContent>
          <DialogHero title="Suggest a Category" />
          <DialogBody>
            <p>
              Tell us what&apos;s missing and we&apos;ll look at adding it for everyone. You can pick
              &ldquo;Other&rdquo; and post right now.
            </p>
          </DialogBody>
          <div className="space-y-1.5 mt-2">
            <label htmlFor="suggest-category-input" className="text-ds-12 font-sans font-semibold block">
              Category name
            </label>
            <Input
              id="suggest-category-input"
              value={text}
              maxLength={SUGGESTION_MAX + 10}
              placeholder="e.g. Tutoring"
              autoComplete="off"
              onChange={(e) => setText(e.target.value)}
              onBlur={() => setTouched(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void send();
                }
              }}
              aria-invalid={touched && !!problem}
              aria-describedby="suggest-category-help"
            />
            <p
              id="suggest-category-help"
              className="text-ds-11 font-sans"
              role={touched && problem ? "alert" : undefined}
              style={{ color: touched && problem ? "hsl(var(--destructive-ink))" : "hsl(var(--olivewood) / 0.8)" }}
            >
              {touched && problem ? problem : `Up to ${SUGGESTION_MAX} characters.`}
            </p>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <DialogSecondaryAction disabled={sending}>Cancel</DialogSecondaryAction>
            </DialogClose>
            <DialogPrimaryAction onClick={() => void send()} disabled={sending}>
              {sending ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : null}
              Send Suggestion
            </DialogPrimaryAction>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
