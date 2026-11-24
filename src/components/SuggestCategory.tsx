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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFeature } from "@/hooks/useFeature";
import { useCloseOnBack } from "@/hooks/useCloseOnBack";
import {
  SUGGESTION_MAX,
  suggestCategory,
  suggestionErrorMessage,
  suggestionProblem,
  type SuggestionArea,
} from "@/lib/categorySuggestions";
import "@/lib/i18n/enSuggest";
import { useLanguage } from "@/lib/i18n/language";

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
  const { t: tr } = useLanguage();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [touched, setTouched] = useState(false);
  const [sending, setSending] = useState(false);
  // C2 (flow audit 11-23): phone Back / swipe-back closes this overlay, not the page under it.
  useCloseOnBack(open, () => { if (!sending) setOpen(false); });
  if (!on) return null;

  const problem = suggestionProblem(text);

  const send = async () => {
    setTouched(true);
    if (problem) return;
    setSending(true);
    try {
      await suggestCategory(area, text);
      toast.success("Thanks, we'll look at your suggestion. Pick \"Something else\" for now.");
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
      {/* Q2709: the shared link Button (44px, h-11). Owner 2026-11-17: body size (16px, was 11px) and a 20px glyph. */}
      <Button
        type="button"
        variant="link"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-1.5 px-0 text-ds-15 font-sans font-semibold [&_svg]:size-5"
        style={{ color: "hsl(var(--bark))" }}
      >
        <Lightbulb className="w-5 h-5" aria-hidden />
        {tr("sug.link")}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !sending && setOpen(o)}>
        <DialogContent>
          <DialogHero title={tr("sug.title")} />
          <DialogBody>
            <p>{tr("sug.body")}</p>
          </DialogBody>
          <div className="space-y-1.5 mt-2">
            <label htmlFor="suggest-category-input" className="text-ds-12 font-sans font-semibold block">
              {tr("sug.name")}
            </label>
            <Input
              id="suggest-category-input"
              value={text}
              maxLength={SUGGESTION_MAX + 10}
              placeholder={tr("sug.placeholder")}
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
              {touched && problem ? problem : tr("sug.max", { n: SUGGESTION_MAX })}
            </p>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <DialogSecondaryAction disabled={sending}>{tr("sug.cancel")}</DialogSecondaryAction>
            </DialogClose>
            <DialogPrimaryAction onClick={() => void send()} disabled={sending}>
              {sending ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : null}
              {tr("sug.send")}
            </DialogPrimaryAction>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
