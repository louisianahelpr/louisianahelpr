/**
 * The post form composes its `location` string in ONE place, and it never
 * writes a stray empty part (lead, 2026-10-25: the owner's saved post-job draft
 * held ", Delcambre, LA ": the "{street}, {city}, {state} {zip}" template with
 * no street yet). composeLocationString (postJobFormHelpers.ts) joins only the
 * non-empty parts through composeJobAddress (lib/geocode.ts), and
 * parseLocationIntoFields reads every shape it writes back into the fields.
 *
 * Class guard, inventory from source: no non-test file under src/ builds the
 * post form's address (its streetAddress / addrState fields) from a template
 * literal joined with ", "; the four writers (draft autosave, job row, quote
 * request, map preview) call the shared composer.
 *
 * @mutate src/lib/geocode.ts |   ].filter(Boolean);\n  return segments.join(", "); |   ];\n  return segments.join(", ");
 * @mutate src/pages/post-job/useJobFormEffects.ts |     const location = composeLocationString({ streetAddress, city, addrState, zipCode }); |     const location = `${streetAddress.trim()}, ${city.trim()}, ${addrState.trim()} ${zipCode}`;
 * @mutate src/pages/post-job/jobSubmitHelpers.ts |     location: composeLocationString({ streetAddress, city, addrState, zipCode }), |     location: `${streetAddress.trim()}, ${city.trim()}, ${addrState.trim()} ${zipCode}`,
 * @mutate src/pages/post-job/postJobFormHelpers.ts |       if (/^\d/.test(locParts[0].trim())) { |       if (false) {
 * @mutate src/pages/post-job/postJobFormHelpers.ts |     zipCode: f.zipCode.replace(/\D/g, "").slice(0, 5), |     zipCode: f.zipCode,
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { trackedFiles } from "./helpers/trackedFiles";
import { composeLocationString, parseLocationIntoFields } from "@/pages/post-job/postJobFormHelpers";

const ROOT = process.cwd();
const read = (rel: string) => blankComments(readFileSync(join(ROOT, rel), "utf8"));

const f = (streetAddress: string, city: string, addrState: string, zipCode: string) => ({ streetAddress, city, addrState, zipCode });

describe("post form location: one composer, no empty parts", () => {
  it("no street yet: 'Delcambre, LA', never ', Delcambre, LA '", () => {
    expect(composeLocationString(f("", "Delcambre", "LA", ""))).toBe("Delcambre, LA");
    expect(composeLocationString(f("  ", " Delcambre ", "LA", ""))).toBe("Delcambre, LA");
    expect(composeLocationString(f("", "", "LA", ""))).toBe("LA");
    expect(composeLocationString(f("", "", "", ""))).toBe("");
  });

  it("a full address keeps the stored shape, ZIP cut to five digits", () => {
    expect(composeLocationString(f("314 Lynn St", "Delcambre", "LA", "70528"))).toBe("314 Lynn St, Delcambre, LA 70528");
    expect(composeLocationString(f("314 Lynn St", "Delcambre", "LA", "70528-1234"))).toBe("314 Lynn St, Delcambre, LA 70528");
  });

  it("every shape it writes reads back into the same fields", () => {
    const shapes = [
      f("314 Lynn St", "Delcambre", "LA", "70528"),
      f("", "Delcambre", "LA", ""),
      f("", "Delcambre", "LA", "70528"),
      f("314 Lynn St", "", "LA", "70528"),
      f("314 Lynn St", "", "LA", ""),
    ];
    for (const s of shapes) {
      const back = parseLocationIntoFields(composeLocationString(s));
      expect(back, JSON.stringify(s)).toEqual(s);
    }
  });

  it("no file under src/ builds the post form's address from a template (inventory)", () => {
    const files = trackedFiles("src").filter((p) => /\.(ts|tsx)$/.test(p) && !/\.test\.|\/test\//.test(p));
    expect(files.length).toBeGreaterThan(500);
    // The post form's own field names (streetAddress / addrState) inside a
    // template that joins parts with ", ". Other features' addresses (a rental's
    // stored street_address, a "city, state" label) are complete by
    // construction and are not this class.
    const template = /`[^`]*\$\{[^}`]*\b(streetAddress|addrState)\b[^}`]*\}[^`]*,[^`]*`/;
    const offenders = files.filter((p) => template.test(read(p)));
    expect(offenders).toEqual([]);
  });

  it("the four writers call the shared composer", () => {
    expect(read("src/pages/post-job/useJobFormEffects.ts")).toMatch(/const location = composeLocationString\(/);
    expect(read("src/pages/post-job/jobSubmitHelpers.ts")).toMatch(/location: composeLocationString\(/);
    expect(read("src/components/quotes/PostJobQuoteChoice.tsx")).toMatch(/const location = composeLocationString\(f\)/);
    expect(read("src/components/postjob/AppleMapPreview.tsx")).toMatch(/const composed = composeJobAddress\(/);
  });
});
