import { AMAZON_TAG } from "@/content/giftGuideConstants";

/**
 * Buy-now links for the gift guides (owner 2026-11-21, pop-up choice "Amazon + Walmart Buy Now").
 *
 * Amazon: the Associates "Add to Cart form" (Product Advertising API docs, "Add to Cart form":
 * https://webservices.amazon.com/paapi5/documentation/add-to-cart-form.html, also the older
 * https://images-na.ssl-images-amazon.com/images/G/09/associates/paapi/dg/AddToCartForm.html). One GET link puts any
 * number of items in the shopper's Amazon cart: https://www.amazon.com/gp/aws/cart/add.html?AssociateTag=<tag>&
 * ASIN.1=<asin>&Quantity.1=1&ASIN.2=... The AssociateTag is what credits the sale; it is always ours
 * (AMAZON_TAG, louisianahelpr-20), never one read from a link. The ASIN is the 10 characters after /dp/ in our links.
 *
 * Walmart: NOT built. The only "buy now" / addToCart URL format found (affil.walmart.com/cart/buynow?items=...) comes
 * from an unofficial community page, not from Walmart's or Impact's documentation, so no Walmart link is made from a
 * guess. Guard: src/test/retailerCart1121.test.ts.
 */
const AMAZON_CART = "https://www.amazon.com/gp/aws/cart/add.html";
const ASIN = /^https:\/\/(?:www\.)?amazon\.com\/(?:[^/?#]+\/)?(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?#]|$)/;

/** The ASIN of one of our Amazon links ("https://www.amazon.com/dp/B0D3L9BYFZ?tag=..."), or null. */
export function amazonAsin(href: string | undefined): string | null {
  const m = href ? ASIN.exec(href) : null;
  return m ? m[1] : null;
}

/** One link that adds these Amazon items (one of each, each once, in order) to the cart, credited to our tag; null for none. */
export function amazonCartUrl(hrefs: (string | undefined)[]): string | null {
  const asins = [...new Set(hrefs.map(amazonAsin).filter((a): a is string => a !== null))];
  if (asins.length === 0) return null;
  const q = new URLSearchParams({ AssociateTag: AMAZON_TAG });
  asins.forEach((a, k) => {
    q.set(`ASIN.${k + 1}`, a);
    q.set(`Quantity.${k + 1}`, "1");
  });
  return `${AMAZON_CART}?${q.toString()}`;
}
