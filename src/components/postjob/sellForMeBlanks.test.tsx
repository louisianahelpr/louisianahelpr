/**
 * POST-H15 (posting audit 10-30 #15): the "Have a Helpr list it for me" job's three blanks, each its own field.
 *
 * @mutate src/lib/declutter/sellForMe.ts |   return description.replace(blankLine(b), () => `${b.label}: ${v \|\| b.placeholder}`); |   return description;
 * @mutate src/lib/declutter/sellForMe.ts |   return v === b.placeholder ? "" : v; |   return v;
 * @mutate src/components/postjob/SellForMeBlanks.tsx |               <Input id={id} inputMode="numeric" |               <input id={id} inputMode="numeric"
 * @mutate src/pages/post-job/FormStep.tsx |           {isSellForMeJob(form.category) && <SellForMeBlanks | {false && <SellForMeBlanks
 */
import { Input } from "@/components/ui/input";
import { describe, expect, it } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SellForMeBlanks } from "./SellForMeBlanks";
import { SELL_FOR_ME_BLANKS, buildSellForMePrefill, fillSellForMeBlank, sellForMeBlankValue } from "@/lib/declutter/sellForMe";
import { hasUnfilledPlaceholders } from "@/lib/postingTemplates";

function Harness({ start }: { start: string }) {
  const [d, setD] = useState(start);
  return <><SellForMeBlanks description={d} setDescription={setD} /><pre data-testid="desc">{d}</pre></>;
}

describe("POST-H15: the three blanks as their own fields", () => {
  const start = buildSellForMePrefill().description;

  it("each blank reads as empty until answered, and an answer goes into its own line", () => {
    expect(SELL_FOR_ME_BLANKS.length).toBe(3);
    for (const b of SELL_FOR_ME_BLANKS) expect(sellForMeBlankValue(start, b)).toBe("");
    const [count, size, pickups] = SELL_FOR_ME_BLANKS;
    let d = fillSellForMeBlank(start, count, "20");
    d = fillSellForMeBlank(d, size, "Furniture");
    d = fillSellForMeBlank(d, pickups, "No");
    expect(d).toContain("How many items: 20\n");
    expect(d).toContain("Rough size: Furniture\n");
    expect(d).toContain("Also handle pickups with buyers: No\n");
    expect(hasUnfilledPlaceholders(d)).toBe(false);
    // Cleared again: the [placeholder] comes back, so Continue still refuses it.
    expect(fillSellForMeBlank(d, count, " ")).toContain("How many items: [about how many]");
    // The rest of the description is untouched.
    expect(d.split("\n").filter((l) => !/^(How many items|Rough size|Also handle pickups with buyers):/.test(l)))
      .toEqual(start.split("\n").filter((l) => !/^(How many items|Rough size|Also handle pickups with buyers):/.test(l)));
  });

  it("the fields write the description", () => {
    render(<Harness start={start} />);
    // Screen check b18 10-31: the count box is the form's own Input (it was a white box over Job title's filled one).
    const { getByTestId } = render(<Input data-testid="shared-input" />);
    expect(screen.getByLabelText("How many items?").className).toBe(getByTestId("shared-input").className);
    fireEvent.change(screen.getByLabelText("How many items?"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "A mix" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    const d = screen.getByTestId("desc").textContent ?? "";
    expect(d).toContain("How many items: 12");
    expect(d).toContain("Rough size: A mix");
    expect(d).toContain("Also handle pickups with buyers: Yes");
    expect(screen.getByRole("button", { name: "Yes" })).toHaveAttribute("aria-pressed", "true");
    // A second tap clears the choice.
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(screen.getByTestId("desc").textContent).toContain("Also handle pickups with buyers: [yes or no]");
  });

  it("a description without the three lines shows no fields", () => {
    const { container } = render(<Harness start="I wrote my own description." />);
    expect(container.querySelector("[data-sell-for-me-blanks]")).toBeNull();
  });

  it("Post a Job's details step shows the fields for a Helpr-list-it job", () => {
    const src = readFileSync(resolve(__dirname, "../../pages/post-job/FormStep.tsx"), "utf8");
    expect(src).toContain("{isSellForMeJob(form.category) && <SellForMeBlanks description={form.description} setDescription={form.setDescription} refused={placeholdersRefused} />}");
  });
});
