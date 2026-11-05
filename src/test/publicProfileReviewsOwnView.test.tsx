/**
 * Share-profile audit 2026-11-05 (~/.lh-shots/audit-1105-share-profile.md), Builder 2, on /u/<handle>:
 *  M2 reviews were up to 10 bare rows: no count, no kind of work or date, the member's reply returned but never shown,
 *     no way past the first rows. Now "Reviews · N", category and month, "Reply from <first>", then "See all N reviews".
 *  M3 your own view had no "This is what others see", no Edit profile, and no prompt for what is still empty. Now an
 *     owner strip (Edit profile, Copy link, a step for each of photo / a line about you / skills that is empty).
 *  L6 loading was one text line, so the page jumped. Now hero-shaped skeleton bones.
 *
 * @mutate src/components/profile/publicProfile/PublicProfileReviews.tsx | const shown = all ? reviews : reviews.slice(0, REVIEWS_FIRST); | const shown = reviews;
 * @mutate src/components/profile/publicProfile/PublicProfileReviews.tsx | {reply && ( | {false && (
 * @mutate src/components/profile/publicProfile/PublicProfileReviews.tsx | {meta && <p | {false && <p
 * @mutate src/components/profile/publicProfile/PublicProfileReviews.tsx | ?? p.stats.review_count ?? 0; | ?? 0;
 * @mutate src/components/profile/publicProfile/PublicProfileReviews.tsx | p.helpr.review_total ?? p.stats.review_count | p.stats.review_count ?? p.helpr.review_total
 * @mutate src/pages/u/PublicProfilePage.tsx | {ctaReady && isMe && <PublicProfileOwnerSteps p={p} />} | {null}
 * @mutate src/components/profile/publicProfile/PublicProfileOwnerSteps.tsx | if (!(p.bio ?? "").trim()) steps.push | if (false) steps.push
 * @mutate src/pages/u/PublicProfilePage.tsx | <PublicProfileSkeleton column={`${PUBLIC_LINK_COLUMN} ${PROFILE_WIDE}`} /> | <p role="status">Loading this profile…</p>
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const rpc = vi.fn();
let signedIn: { id: string } | null = null;
let myHandle: string | null = null;
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/components/AppPage", () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: () => undefined }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: signedIn, ready: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ profile: myHandle ? { handle: myHandle } : null, isLoading: false }) }));
vi.mock("@/lib/nativeShare", () => ({ shareNative: vi.fn(async () => "shared"), copyToClipboard: vi.fn(async () => true) }));

const { default: PublicProfilePage } = await import("@/pages/u/PublicProfilePage");
const { REVIEWS_FIRST } = await import("@/components/profile/publicProfile/PublicProfileReviews");

const review = (i: number) => ({
  rating: 5, feedback: `Great work ${i}`, created_at: "2026-03-14T17:00:00Z", reviewer_name: `Ann ${i}.`,
  job_category: "yard_work", response_text: i === 0 ? "Thanks, Ann!" : null, response_at: i === 0 ? "2026-03-15T12:00:00Z" : null,
});
const REVIEWS = Array.from({ length: 5 }, (_, i) => review(i));
const PAGE = {
  handle: "eli-b", name: "Eli B.", photo_url: null, member_since: "2025-03-01T12:00:00Z", bio: null, skills: null,
  stats: { review_count: 12, avg_rating: 4.9 }, listings: [], jobs: [], wanted: [],
  helpr: { jobs_done: 12, categories: ["yard_work"], reviews: REVIEWS },
};
let page: Record<string, unknown> = PAGE;

const show = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/u/eli-b"]}>
        <Routes><Route path="/u/:handle" element={<PublicProfilePage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  rpc.mockReset();
  rpc.mockImplementation(async () => ({ data: page, error: null }));
  page = PAGE;
  signedIn = null;
  myHandle = null;
});

describe("M2: reviews show their count, kind of work, month and reply, then See all", () => {
  it("shows the first few with the true count and expands to every row in hand", async () => {
    show();
    expect(REVIEWS.length).toBeGreaterThan(REVIEWS_FIRST);
    expect((await screen.findByTestId("pp-reviews-title")).textContent).toBe("Reviews · 12");
    expect(screen.getAllByTestId("pp-review")).toHaveLength(REVIEWS_FIRST);
    const all = screen.getByTestId("pp-reviews-all");
    expect(all.textContent).toBe("See all 12 reviews");
    fireEvent.click(all);
    expect(screen.getAllByTestId("pp-review")).toHaveLength(REVIEWS.length);
    expect(screen.queryByTestId("pp-reviews-all")).toBeNull();
    expect(screen.getByTestId("pp-reviews-newest").textContent).toBe("Showing the newest 5 of 12.");
  });

  it("each review carries its kind of work and month, and the member's reply under it", async () => {
    show();
    const [firstRow, second] = await screen.findAllByTestId("pp-review");
    expect(within(firstRow).getByTestId("pp-review-meta").textContent).toBe("Yard work · March 2026");
    const reply = within(firstRow).getByTestId("pp-review-reply");
    expect(reply.textContent).toBe("Reply from EliThanks, Ann!");
    expect(within(second).queryByTestId("pp-review-reply")).toBeNull();
  });

  it("the read's review_total is the count (it leaves out one person's own accounts, L4)", async () => {
    page = { ...PAGE, stats: { review_count: 12, avg_rating: 4.9 }, helpr: { ...PAGE.helpr, review_total: 9 } };
    show();
    expect((await screen.findByTestId("pp-reviews-title")).textContent).toBe("Reviews · 9");
    expect(screen.getByTestId("pp-reviews-all").textContent).toBe("See all 9 reviews");
  });

  it("no See all when every review already shows", async () => {
    page = { ...PAGE, stats: { review_count: 2, avg_rating: 5 }, helpr: { ...PAGE.helpr, reviews: REVIEWS.slice(0, 2) } };
    show();
    expect((await screen.findByTestId("pp-reviews-title")).textContent).toBe("Reviews · 2");
    expect(screen.queryByTestId("pp-reviews-all")).toBeNull();
  });
});

describe("M3: your own view has next steps", () => {
  it("your page: what others see, Edit profile, Copy link, and a step for each empty part", async () => {
    signedIn = { id: "u1" };
    myHandle = "eli-b";
    show();
    const strip = await screen.findByTestId("pp-owner");
    expect(strip.textContent).toContain("This is what others see");
    expect(within(strip).getByTestId("pp-owner-edit").getAttribute("href")).toBe("/profile?tab=profile");
    expect(within(strip).getByTestId("pp-owner-copy")).toBeTruthy();
    const steps = within(strip).getAllByRole("link").filter((a) => a.dataset.testid?.startsWith("pp-owner-step-"));
    expect(steps.map((a) => a.dataset.testid)).toEqual(["pp-owner-step-photo", "pp-owner-step-bio", "pp-owner-step-skills"]);
    expect(within(strip).getByTestId("pp-owner-step-skills").getAttribute("href")).toBe("/profile?tab=profile&focus=skills");
    expect(screen.queryByTestId("pp-hire")).toBeNull();
  });

  it("a filled part has no step", async () => {
    signedIn = { id: "u1" };
    myHandle = "eli-b";
    page = { ...PAGE, bio: "Yard work in Delcambre.", photo_url: "https://x.test/a.jpg" };
    show();
    await screen.findByTestId("pp-owner");
    expect(screen.queryByTestId("pp-owner-step-bio")).toBeNull();
    expect(screen.queryByTestId("pp-owner-step-photo")).toBeNull();
    expect(screen.getByTestId("pp-owner-step-skills")).toBeTruthy();
  });

  it("someone else's page has no owner strip", async () => {
    signedIn = { id: "u2" };
    myHandle = "ann-c";
    show();
    await screen.findByTestId("pp-hire");
    expect(screen.queryByTestId("pp-owner")).toBeNull();
  });
});

describe("L6: loading shows skeleton bones, not one text line", () => {
  it("renders the hero-shaped skeleton while the read is pending", async () => {
    rpc.mockImplementation(() => new Promise(() => {}));
    show();
    const sk = await screen.findByTestId("pp-skeleton");
    expect(sk.getAttribute("role")).toBe("status");
    expect(sk.querySelectorAll("[data-skeleton]").length).toBeGreaterThan(4);
  });
});
