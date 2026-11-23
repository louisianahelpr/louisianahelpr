import { listFeaturedLocal } from "@/lib/sbsFeaturedApi";

/**
 * How many approved "Featured local" businesses Small Business Saturday lists: the page's own read (listFeaturedLocal,
 * the public approved-only list from sbs_public_featured, a STABLE read-only function; nothing is written), counted for
 * the gift guides menu's number (owner 2026-11-22, 8:36 PM: "add the count to small business saturday too";
 * src/pages/info/giftGuides/railCounts.ts smallBizCount). Throws on a failed read, as listFeaturedLocal does.
 * Its own module so unit tests not about this read get 0 without a network call (src/test/setup.ts mocks it;
 * src/test/giftGuideRailCounts1122.test.tsx unmocks it).
 */
export const featuredLocalCount = async (): Promise<number> => (await listFeaturedLocal()).length;
