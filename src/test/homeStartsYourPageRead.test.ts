/**
 * Home LCP (prod-audit run 43650083979, 11-14, "every first screen: FCP/LCP"): mobile /home LCP 9776 ms against its
 * KNOWN ceiling 6630. The largest paint was the Your page card's line ("Your page is hidden right now..." for the
 * test account; the card for a member). That card mounts only once the top cards settle (topSettled), and only then
 * asked public_profile_by_handle whether the page opens, so its paint waited for two steps in a row. Home now starts
 * that read as soon as the profile names the handle, with the card's own query options (publicPageQuery: same key,
 * same staleTime), so the card draws from the cache when it mounts.
 * Measured on local builds against prod, phone 390, CPU 3x, test poster, 5 cold loads each (11-14): before, the line
 * painted 6-10 ms after the read answered (LCP 1300 ms median); after, the read answers at about 0.5 s and the line
 * paints with the columns (LCP 1020 ms median).
 *
 * @mutate src/pages/home/HomeDashboard.tsx |     if (myHandle) void queryClient.prefetchQuery(publicPageQuery(myHandle)); |
 * @mutate src/components/profile/YourPageLink.tsx |   const { data: publicPage } = useQuery({ ...publicPageQuery(handle ?? ""), enabled: !!handle }); |   const { data: publicPage } = useQuery({ queryKey: ["public-page", handle], queryFn: () => fetchPublicProfile(handle as string), enabled: !!handle });
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "@/test/helpers/blankNonCode";
import { publicPageQuery } from "@/components/profile/YourPageLink";

const home = blankComments(readFileSync("src/pages/home/HomeDashboard.tsx", "utf8"));
const card = blankComments(readFileSync("src/components/profile/YourPageLink.tsx", "utf8"));

describe("Home starts the Your page read before the card mounts (home LCP)", () => {
  it("Home prefetches the card's own query as soon as the profile names the handle, outside the topSettled gate", () => {
    const at = home.indexOf("void queryClient.prefetchQuery(publicPageQuery(myHandle))");
    expect(at).toBeGreaterThan(-1);
    expect(home).toMatch(/const myHandle = profile\?\.handle \?\? null;/);
    // Hooks run before the JSX; the topSettled-gated columns are in the JSX.
    const gate = home.indexOf("{topSettled && <div data-home-columns");
    expect(gate).toBeGreaterThan(-1);
    expect(at).toBeLessThan(gate);
  });

  it("the card reads with the same options, so the prefetch is what it reads", () => {
    expect(card).toContain('useQuery({ ...publicPageQuery(handle ?? ""), enabled: !!handle })');
    const q = publicPageQuery("e2e-p");
    // Same key as the /u page's read (PublicProfilePage), so opening the page stays instant.
    expect(q.queryKey).toEqual(["public-profile", "e2e-p"]);
    expect(q.staleTime).toBeGreaterThan(60_000);
  });
});
