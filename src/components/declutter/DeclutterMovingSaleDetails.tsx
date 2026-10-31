/**
 * Board 164 / Q2269: name the moving sale and say when it starts ("Moving to Lafayette · everything goes",
 * Oct 30 – Nov 1). Both optional; saved on every open moving-sale item (declutter_set_moving_sale), shown on the
 * profile banner. The name is public, so it is checked for contact details on the server.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DatePickerField } from "@/components/DatePickerField";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { fetchMyMovingSale, setMovingSale } from "@/lib/declutter/moves";

/** The server takes a start up to 30 days back (a sale already running). */
function monthBefore(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 30)).toISOString().slice(0, 10);
}

const field = "h-12 w-full min-w-0 rounded-2xl border border-input glass-field px-4 text-ds-15";

export function MovingSaleDetails({ userId, moveOutOn, today }: { userId: string; moveOutOn: string; today: string }) {
  const qc = useQueryClient();
  // What the seller saved (drafts too), so saving only a date never erases a name (lh-authz-rls review #7).
  const mine = useQuery({ queryKey: ["declutter", "my-moving-sale", userId], queryFn: fetchMyMovingSale });
  const [name, setName] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (touched || !mine.data) return;
    setName(mine.data.saleName ?? "");
    setStartsOn(mine.data.startsOn ?? "");
  }, [mine.data, touched]);
  const save = useMutation({
    mutationFn: () => setMovingSale(name.trim(), startsOn || null),
    onSuccess: (n) => {
      if (n === "not_deployed") toast.error("Sale names aren't available yet. Try again later.");
      else toast(n === 0 ? "Saved. It shows once your items are listed." : "Saved. Buyers see it on your moving sale.");
      void qc.invalidateQueries({ queryKey: ["declutter", "moving-sale"] });
      void qc.invalidateQueries({ queryKey: ["declutter", "my-moving-sale"] });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  return (
    <div className="space-y-3 border-t border-border pt-3" data-moving-sale-details="">
      <div className="min-w-0 space-y-1">
        <label className="block text-sm font-medium" htmlFor="move-sale-name">
          Sale name <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <input
          id="move-sale-name"
          className={field}
          maxLength={60}
          value={name}
          placeholder="Moving to Lafayette · everything goes"
          onChange={(e) => { setTouched(true); setName(e.target.value); }}
        />
      </div>
      <div className="min-w-0 space-y-1">
        <label className="block text-sm font-medium" htmlFor="move-sale-start">
          Sale starts <span className="font-normal text-muted-foreground">(optional, ends on your move-out date)</span>
        </label>
        <DatePickerField id="move-sale-start" value={startsOn} min={monthBefore(today)} max={moveOutOn} onChange={(v) => { setTouched(true); setStartsOn(v); }} placeholder="Pick a date" />
      </div>
      <p className="text-xs text-muted-foreground">Buyers see the name and dates on your moving sale. Keep phone numbers and links out.</p>
      <Button type="button" variant="outline" size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
        {save.isPending ? "Saving…" : "Save sale details"}
      </Button>
    </div>
  );
}
