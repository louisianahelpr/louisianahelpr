/**
 * POST-H15 (posting audit 10-30 #15): the "Have a Helpr list it for me" job's three blanks were [placeholders] inside
 * one long description box, hard to fill in on a phone. Each is its own field here, over the description: a short
 * box for how many, chips for the size and for pickups. Each answer is written into its own line of the description
 * (fillSellForMeBlank), so the description stays the one thing that is posted, and Continue still refuses a blank
 * left as its [placeholder] (detailsBlocker). Shown only while the description still has the three lines.
 */
import { CHIP, CHIP_OFF, CHIP_ON } from "@/components/ui/chipClasses";
import { SELL_FOR_ME_BLANKS, fillSellForMeBlank, sellForMeBlankValue } from "@/lib/declutter/sellForMe";

const FIELD =
  "w-full min-w-0 rounded-2xl border border-input bg-card px-4 py-3 text-ds-15 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function SellForMeBlanks({ description, setDescription }: { description: string; setDescription: (v: string) => void }) {
  const values = SELL_FOR_ME_BLANKS.map((b) => sellForMeBlankValue(description, b));
  if (values.some((v) => v === null)) return null;
  return (
    <div className="space-y-4 rounded-[20px] border border-border bg-card p-card" data-sell-for-me-blanks="">
      {SELL_FOR_ME_BLANKS.map((b, i) => {
        const value = values[i] ?? "";
        const id = `sell-for-me-${b.key}`;
        if (!("choices" in b)) {
          return (
            <div key={b.key} className="space-y-1.5">
              <label htmlFor={id} className="block text-ds-15 font-semibold">{b.label}</label>
              <input id={id} className={FIELD} inputMode="numeric" maxLength={40} placeholder="About how many?" value={value}
                onChange={(e) => setDescription(fillSellForMeBlank(description, b, e.target.value))} />
            </div>
          );
        }
        return (
          <fieldset key={b.key} className="space-y-1.5">
            <legend className="text-ds-15 font-semibold">{b.label}?</legend>
            <div className="flex flex-wrap gap-2">
              {b.choices.map((c) => {
                const on = value === c;
                return (
                  <button key={c} type="button" aria-pressed={on} className={`${CHIP} ${on ? CHIP_ON : CHIP_OFF}`}
                    onClick={() => setDescription(fillSellForMeBlank(description, b, on ? "" : c))}>
                    {c}
                  </button>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}
