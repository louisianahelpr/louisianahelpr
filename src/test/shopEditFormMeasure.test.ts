/**
 * Builder 1 Shops screenshot pass (11-10): at 1440 the /shops/mine form inputs spanned the full ~1600px column
 * (~/.lh-shots/b1-shops-1110/shops-mine-p1-P-1440-light.png). The page column stays full width (owner 2026-10-21,
 * src/lib/pageColumn.ts); the shop form and the field sections that save on their own carry one LINE measure
 * (SHOP_FORM_MEASURE), as Edit profile's fields do (editProfileFieldMeasure.test.ts). The items list keeps the column.
 *
 * @mutate src/components/shops/ShopEditView.tsx |   <form className={`space-y-5 pb-8 ${SHOP_FORM_MEASURE}`} onSubmit={onSubmit} noValidate> |   <form className="space-y-5 pb-8" onSubmit={onSubmit} noValidate>
 * @mutate src/components/shops/ShopEditView.tsx | const SHOP_FORM_MEASURE = "max-w-[40rem]"; | const SHOP_FORM_MEASURE = "lg:max-w-[40rem]";
 */
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { readSource } from "./helpers/walkSource";

const view = blankComments(readSource("src/components/shops/ShopEditView.tsx") ?? "");

describe("/shops/mine: the shop form has a line measure, the page column stays wide", () => {
  it("the measure is an unprefixed rem cap, never a breakpoint page measure", () => {
    const m = view.match(/const SHOP_FORM_MEASURE = "([^"]+)";/);
    expect(m?.[1]).toMatch(/^max-w-\[\d+(?:\.\d+)?rem\]$/);
  });

  it("the form and each field section that saves on its own carry it", () => {
    const uses = view.match(/\$\{SHOP_FORM_MEASURE\}/g) ?? [];
    expect(uses.length).toBeGreaterThan(3);
    expect(view).toMatch(/<form className=\{`[^`]*\$\{SHOP_FORM_MEASURE\}`\}/);
    for (const section of ["<ShopPickupAddressSection />", "<ShopPermitSection ", "<ShopFaqsEditor "]) {
      const at = view.indexOf(section);
      expect(at).toBeGreaterThan(0);
      const wrapper = view.slice(view.lastIndexOf("<div", at), at);
      expect(wrapper).toContain("${SHOP_FORM_MEASURE}");
    }
  });
});
