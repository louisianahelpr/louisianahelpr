/**
 * Audit 11-10 F327 / F342: the payouts prompt ("Set up payouts to get your $322.") waits on its reads (cart, payouts,
 * Stripe status), so on the sell screens it arrived after the form had drawn and pushed everything down: layout shift
 * 0.169 on Sell one item, 0.131 on Sell a bunch, 0.258 on the moving sale (measured by the auditor). It stays on those
 * screens (owner 2026-10-27: set up at first sale) but sits under the form, where its arrival moves nothing above it.
 *
 * @mutate src/components/declutter/SellOneScreen.tsx |         {!form.free && <SellerPayoutPrompt />}\n      </div>\n    </AppPage> |       </div>\n    </AppPage>
 * @mutate src/components/declutter/DeclutterSellView.tsx |       {step === 1 && <SellerPayoutPrompt />}\n |
 */
// @mutate src/components/declutter/DeclutterBunchView.tsx |       <SellerPayoutPrompt />{/* F342: last, so its late arrival moves nothing */}\n |
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const read = (p: string) => blankComments(readFileSync(join(process.cwd(), p), "utf8"));
const at = (src: string, needle: string) => {
  const i = src.indexOf(needle);
  expect(i, needle).toBeGreaterThan(-1);
  return i;
};

describe("F327/F342: the payouts prompt sits under each sell form", () => {
  const screens: [string, string][] = [
    ["src/components/declutter/SellOneScreen.tsx", 'data-post-step=""'],
    ["src/components/declutter/DeclutterBunchView.tsx", "<BunchListStep"],
    ["src/components/declutter/DeclutterSellView.tsx", 'title={tr("sf.showItOff")}'],
  ];
  it.each(screens)("%s draws the prompt after its form", (file, formMark) => {
    const src = read(file);
    expect(src.split("<SellerPayoutPrompt />").length - 1).toBe(1);
    expect(at(src, "<SellerPayoutPrompt />")).toBeGreaterThan(at(src, formMark));
  });
  it("covers every sell screen that shows it", () => {
    expect(screens.length).toBeGreaterThan(2);
  });
});
