/**
 * F260q (owner 11-11 "Spanish EVERYTHING now"): the Selling tab's list (Your listings, the row buttons, the take-down
 * sheet and its toasts) reads enDeclutter (decl.sl.*), which DeclutterHomeView already loads. Every word has its
 * Spanish, the same placeholders, and none of the row words is written into the screen in English any more.
 *
 * @mutate src/components/declutter/DeclutterHomeView.tsx |       toast(t("decl.sl.takenDown"));\n |       toast("Taken down.");\n
 * @mutate src/components/declutter/DeclutterHomeView.tsx |                     {t("decl.sl.manage")}\n |                     Manage\n
 * @mutate src/components/declutter/DeclutterHomeView.tsx | title={asking?.status === "draft" ? t("decl.sl.deleteQ") : t("decl.sl.takeDownQ")} | title={asking?.status === "draft" ? t("decl.sl.deleteQ") : "Take this item off sale?"}
 * @mutate src/lib/i18n/esDeclutter.ts |   "decl.sl.takenDown": "Retirado.",\n |
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { enDeclutter } from "@/lib/i18n/enDeclutter";
import { esDeclutter } from "@/lib/i18n/esDeclutter";
import { es } from "@/lib/i18n/es";

const home = blankComments(readFileSync(resolve(__dirname, "../..", "src/components/declutter/DeclutterHomeView.tsx"), "utf8"));

describe("the Selling list follows the member's language (F260q)", () => {
  it("every Selling-list word has its Spanish, and es.ts carries it", () => {
    const keys = (Object.keys(enDeclutter) as (keyof typeof enDeclutter)[]).filter((k) => k.startsWith("decl.sl."));
    expect(keys.length).toBeGreaterThan(20);
    for (const k of keys) {
      expect(esDeclutter[k], k).toBeTruthy();
      expect(es[k], k).toBe(esDeclutter[k]);
      expect(esDeclutter[k], `${k} still English`).not.toBe(enDeclutter[k]);
      expect([...esDeclutter[k].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort(), k).toEqual([...enDeclutter[k].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort());
    }
  });

  it("the screen says none of those words in English", () => {
    for (const k of ["takenDown", "manage", "takeDownQ", "deleteQ", "finish", "empty", "yours", "backOnSale"] as const) {
      const words = enDeclutter[`decl.sl.${k}`];
      expect(home, words).not.toMatch(new RegExp(`[>"]\\s*${words.replace(/[.?()]/g, "\\$&")}\\s*[<"]`));
    }
  });
});
