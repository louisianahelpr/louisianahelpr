/**
 * H5 last slice (share-profile audit 11-05, owner: /u/<handle> is the ONE full profile), Builder 2.
 * Before: a signed-in member on someone else's /u page had no Save, Report or Block (they lived only on /user/<id>),
 * every in-app name tap built its own `/user/${id}` link, and /user/<id> kept members there.
 * Now:
 *   - a member on someone else's /u page gets /user's own VisitorProfileActions (Save, Report user, Block user) with
 *     the same ReportDialog and BlockUserDialog; Hire me stays the one primary and is the Invite to a job (both open
 *     hireOfferPath, /post-job?offerTo=<id>); no Message button anywhere (owner: only the poster messages);
 *   - guests and your own page get none of them;
 *   - every in-app profile link goes through memberProfilePath, and /user/<id> forwards members to /u/<handle>
 *     (src/test/profileLinkForwards.test.tsx); without a public page a member keeps /user, so Block and Report are
 *     reachable from every profile path.
 *
 * @mutate src/pages/u/PublicProfilePage.tsx | const memberActions = user && q.data && ctaReady && !isMe | const memberActions = false
 * @mutate src/pages/u/PublicProfilePage.tsx | const memberActions = user && q.data && ctaReady && !isMe | const memberActions = q.data && ctaReady
 * @mutate src/pages/u/PublicProfilePage.tsx | const memberActions = user && q.data && ctaReady && !isMe | const memberActions = user && q.data && ctaReady
 * @mutate src/components/profile/publicProfile/PublicProfileMemberActions.tsx |       {showBlock && ( |       {false && (
 * @mutate src/components/profile/publicProfile/PublicProfileMemberActions.tsx |       {showReport && ( |       {false && (
 * @mutate src/components/declutter/DeclutterSellerCard.tsx | to={memberProfilePath(sellerId, noun === "seller" ? { from: PROFILE_FROM_DECLUTTER } : undefined)} | to={`/user/${sellerId}`}
 * (The member forward itself is guarded in src/test/profileLinkForwards.test.tsx.)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { trackedFiles } from "./helpers/trackedFiles";

const rpc = vi.fn();
let signedIn: { id: string } | null = null;
let myHandle: string | null = null;
const TARGET = "3f2a1b0c-1111-4222-8333-444455556666";
const reportOpened = vi.fn();
const blockOpened = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/components/AppPage", () => ({
  default: ({ children, titleActions }: { children: ReactNode; titleActions?: ReactNode }) => <main><div data-testid="title-actions">{titleActions}</div>{children}</main>,
}));
vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: () => undefined }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: signedIn, isReady: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ profile: myHandle ? { handle: myHandle } : null, isLoading: false }) }));
vi.mock("@/lib/nativeShare", () => ({ shareNative: vi.fn(async () => "shared"), copyToClipboard: vi.fn(async () => true) }));
// The menu renders its items inline so the test reads them without Radix pointer events.
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div role="menu">{children}</div>,
  DropdownMenuItem: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => <button type="button" role="menuitem" onClick={onClick}>{children}</button>,
}));
vi.mock("@/components/SaveHelperButton", () => ({ default: ({ helperId }: { helperId: string }) => <button type="button" data-testid="save" data-helper={helperId}>Save</button> }));
vi.mock("@/components/ReportDialog", () => ({ default: (p: { reportedType: string; reportedId: string }) => { reportOpened(p.reportedType, p.reportedId); return <p>report dialog</p>; } }));
vi.mock("@/components/BlockUserDialog", () => ({ BlockUserDialog: (p: { blockedUserId: string; blockedUserName: string }) => { blockOpened(p.blockedUserId, p.blockedUserName); return <p>block dialog</p>; } }));

const { default: PublicProfilePage } = await import("@/pages/u/PublicProfilePage");

const PAGE = {
  handle: "eli-b", name: "Eli B.", photo_url: null, member_since: "2025-03-01T12:00:00Z", bio: null, skills: null,
  stats: { review_count: 0, avg_rating: null }, listings: [], jobs: [], wanted: [],
  helpr: { jobs_done: 0, categories: [], reviews: [] },
};

const show = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/u/eli-b"]}>
        <Routes><Route path="/u/:handle" element={<PublicProfilePage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

const read = (p: string) => blankComments(readFileSync(resolve(p), "utf8"));

beforeEach(() => {
  rpc.mockReset();
  rpc.mockImplementation(async (fn: string) => ({ data: fn === "rpc_hire_target_by_handle" ? TARGET : PAGE, error: null }));
  signedIn = null;
  myHandle = null;
  reportOpened.mockReset();
  blockOpened.mockReset();
});

describe("a member on someone else's /u page has the full set of member actions", () => {
  it("Hire me (the Invite to a job), Save, Report user and Block user, for this member's id; no Message", async () => {
    signedIn = { id: "me-0000" };
    myHandle = "me-a";
    show();
    const actions = await screen.findByTestId("pp-member-actions");
    expect(within(actions).getByTestId("save").getAttribute("data-helper")).toBe(TARGET);
    expect(screen.getByTestId("pp-hire").textContent).toContain("Hire me");
    expect(rpc).toHaveBeenCalledWith("rpc_hire_target_by_handle", { p_handle: "eli-b" });
    expect(screen.queryByRole("button", { name: /message/i })).toBeNull();
    fireEvent.click(within(actions).getByRole("menuitem", { name: /Report user/ }));
    expect(await screen.findByText("report dialog")).toBeTruthy();
    expect(reportOpened).toHaveBeenCalledWith("user", TARGET);
    fireEvent.click(within(actions).getByRole("menuitem", { name: /Block user/ }));
    expect(await screen.findByText("block dialog")).toBeTruthy();
    expect(blockOpened).toHaveBeenCalledWith(TARGET, "Eli B.");
    // One primary: Hire me only.
    expect(document.querySelectorAll(".btn-grad-primary")).toHaveLength(1);
  });

  it("a guest gets none of them; Hire me still goes through sign-up", async () => {
    show();
    expect((await screen.findByTestId("pp-hire")).querySelector("a")?.getAttribute("href")).toContain("/signup");
    expect(screen.queryByTestId("pp-member-actions")).toBeNull();
    expect(rpc).not.toHaveBeenCalledWith("rpc_hire_target_by_handle", expect.anything());
  });

  it("your own page gets none of them", async () => {
    signedIn = { id: "me-0000" };
    myHandle = "eli-b";
    show();
    await screen.findByTestId("pp-trust");
    expect(screen.queryByTestId("pp-member-actions")).toBeNull();
    expect(rpc).not.toHaveBeenCalledWith("rpc_hire_target_by_handle", expect.anything());
  });

  it("Invite to a job on /user and Hire me on /u open the same direct offer", () => {
    expect(read("src/lib/hireMe.ts")).toContain("return `/post-job?offerTo=${encodeURIComponent(userId)}`;");
    expect(read("src/pages/user/InviteToJobBar.tsx")).toContain("navigate(`/post-job?offerTo=${userId}`)");
  });
});

describe("Block and Report are reachable from every profile path", () => {
  it("/user still mounts them, and a member is only ever left on /user when they are not forwarded", () => {
    const user = read("src/pages/user/UserProfile.tsx");
    expect(user).toContain("<VisitorProfileActions userId={userId} currentUserId={currentUserId} onReport={() => setShowReport(true)} onBlock={() => setShowBlock(true)} />");
    expect(user).toContain("<ReportDialog");
    expect(user).toContain("<BlockUserDialog");
    const fwd = read("src/components/profile/PublicProfileForward.tsx");
    expect(fwd).toContain("return <PublicProfileForward userId={userId} none={members} notDeployed={members} />;\n}\n\n");
    expect(fwd).toContain("if (blocked.isError || blocked.data) return <>{members}</>;");
  });
});

describe("no in-app link builds /user/<id> by hand", () => {
  // The helper itself, and the one pathname test that is not a link (is the Profile tab active on your own /user page).
  // @two-way src/test/profileLinksGoToTheOnePage.test.tsx:stale baseline entry
  const ALLOWED = new Set(["src/lib/profileLink/memberProfilePath.ts", "src/components/mobileNav/mobileNavHelpers.ts"]);
  it("each allowed file still builds a /user/ path (else it leaves the list)", () => {
    const stale = [...ALLOWED].filter((f) => !/\/user\/\$\{/.test(read(f))).map((f) => `stale baseline entry ${f} — remove it (lower the baseline)`);
    expect(stale).toEqual([]);
  });
  it("every profile link goes through memberProfilePath", () => {
    const files = trackedFiles("src").filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.|\/test\//.test(f));
    const offenders: string[] = [];
    let users = 0;
    for (const f of files) {
      const src = read(f);
      if (src.includes("memberProfilePath(")) users++;
      if (ALLOWED.has(f)) continue;
      if (/\/user\/\$\{|["'`]\/user\/["'`]\s*\+/.test(src)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
    expect(users).toBeGreaterThan(20);
  });
});
