/**
 * The Wanted tab is its OWN hub (owner 2026-10-30, via the lead; shot ~/.claude/uploads/.../42e812e7-image.png):
 *   1. a "Post what you're looking for" pill that opens the form in the shared sheet (not the form inline);
 *   2. "Your Wanted posts" and "Wanted near you", each with its own empty state;
 *   3. NO "Let sellers near me reply" switch: a Wanted is always visible to sellers near the poster, and what they
 *      see is plain text under the form.
 * Board 116's fields are kept to what declutter_create_wanted stores: what, category, highest price ("Up to", in
 * money ink), distance.
 *
 * @mutate src/components/declutter/DeclutterWantedViews.tsx | onClick={() => setPosting(true)}>Post what you're looking for</Button> | onClick={() => setPosting(false)}>Post what you're looking for</Button>
 * @mutate src/components/declutter/DeclutterWantedViews.tsx |         <p>{WANTED_SELLERS_SEE}</p> |
 * @mutate src/components/declutter/DeclutterWantedViews.tsx |         <p>Your Wanted stays up 30 days. You can edit or close it anytime.</p> |
 * @mutate src/components/declutter/DeclutterWantedViews.tsx | className="w-full min-w-0 self-stretch rounded-xl bg-transparent font-semibold text-[hsl(var(--burnt-sienna))] outline-none | className="w-full min-w-0 self-stretch rounded-xl bg-transparent font-semibold outline-none
 * @mutate src/components/declutter/DeclutterWantedViews.tsx |       void qc.invalidateQueries({ queryKey: ["declutter", "wanted"] });\n      onClose(); |       void qc.invalidateQueries({ queryKey: ["declutter", "wanted"] });
 * @mutate src/components/declutter/DeclutterWantedViews.tsx | <p className="text-sm text-muted-foreground">You haven't posted anything yet. Each post lasts 30 days, and sellers near you can answer it.</p> | <p />
 * @mutate src/components/declutter/DeclutterWantedReplies.tsx |   const near = useQuery( |   const near = { isError: false, isLoading: false, data: [] as WantedNear[], error: null, refetch: () => {} }; void useQuery(
 * Owner 2026-10-30: replies on your posts, and photos on the form, your post and the near-you cards (20261030064727).
 * @mutate src/components/declutter/DeclutterWantedViews.tsx |       <WantedReplies replies={post.replies} /> |       {null}
 * @mutate src/components/declutter/DeclutterWantedViews.tsx |   if (r.status === "open") return r.awaiting === "buyer" ? "Waiting for you" : "Waiting for the seller"; |   if (r.status === "open") return "Waiting for the seller";
 * @mutate src/components/declutter/DeclutterWantedViews.tsx |       {yourTurn && <Link | {false && <Link
 * @mutate src/components/declutter/DeclutterWantedViews.tsx |       {userId && <WantedPostPhotos post={post} userId={userId} />} |       {null}
 * @mutate src/components/declutter/DeclutterWantedViews.tsx |         try { await addWantedPhoto(userId, id, f); } |         try { void f; }
 * @mutate src/components/declutter/DeclutterWantedViews.tsx | photos={editing ? null : <ProblemPhotoPicker files={files} onChange={setFiles} disabled={post.isPending} />} where= | photos={null} where=
 * @mutate src/components/declutter/DeclutterWantedReplies.tsx |             {w.photo_path && ( |             {false && (
 * @mutate src/components/declutter/DeclutterWantedViews.tsx | ${form.maxPrice ? "text-[hsl(var(--burnt-sienna))]" : "text-muted-foreground"} | text-[hsl(var(--burnt-sienna))]
 * @mutate src/components/declutter/DeclutterWantedViews.tsx |         <p className="text-ds-13 text-muted-foreground" data-wanted-where="">{where}</p> |
 * @mutate src/components/declutter/DeclutterWantedViews.tsx |   if (source === "device") return "Measured from where you are now (a rough area, never your address)."; |
 * @mutate src/components/declutter/DeclutterWantedViews.tsx |       toast(openReplies > 0 | toast(false
 * @mutate src/components/declutter/DeclutterWantedReplies.tsx | <p className="text-sm text-muted-foreground" data-wanted-near-empty="">No one near you has posted a Wanted yet. When someone does, you can answer it with one of your listings.</p> | <p data-wanted-near-empty="" />
 * Tester 10-30: beside "Up to" at 375 the category picker sat in a half-width column, and opening it left an empty one.
 * @mutate src/components/declutter/DeclutterWantedViews.tsx | groups={CATEGORY_PICKER_GROUPS} triggerClassName="border-input" /> | groups={CATEGORY_PICKER_GROUPS} />
 * @mutate src/components/declutter/DeclutterWantedViews.tsx | <div className="min-w-0 space-y-1" data-wanted-category-row=""> | <div className="grid grid-cols-2 gap-3" data-wanted-category-row="">
 * Audit 10-30, one registration per finding:
 * @mutate src/lib/declutter/wanted.ts |   if (!f.category) out.category = "Pick a category."; |   if (!f.category && what === null) out.category = "Pick a category.";
 * @mutate src/components/declutter/DeclutterWantedViews.tsx | <FieldProblem id="wanted-what-problem" text={problems.what} /> |
 * @mutate src/components/declutter/DeclutterWantedViews.tsx | {feeLine(form.maxPrice)} |
 * @mutate src/components/declutter/DeclutterWantedViews.tsx | placeholder="Kids bike" enterKeyHint | placeholder="Kids bike, 16 inch" enterKeyHint
 * @mutate src/components/declutter/DeclutterWantedViews.tsx |   useEffect(() => { if (!editing) saveWantedDraft(form); }, [form, editing]); |   useEffect(() => { saveWantedDraft(form); }, [form, editing]);
 * @mutate src/components/declutter/DeclutterWantedViews.tsx |   const gotIt = post.status === "open" && post.replies.some((r) => r.status === "accepted"); |   const gotIt = false;
 * @mutate src/components/declutter/DeclutterWantedViews.tsx |   const matches = post.matches.filter((m) => !answered.has(m.id)); |   const matches = post.matches;
 * @mutate src/components/declutter/DeclutterWantedViews.tsx | onConfirm={() => remove.mutate()} | onConfirm={() => {}}
 * Audit 10-30 #13: the address drops post=1 once the form is open, and what was typed survives a reload.
 * @mutate src/components/declutter/DeclutterWantedViews.tsx |     next.delete(WANTED_POST_PARAM);\n |
 * @mutate src/components/declutter/DeclutterWantedViews.tsx |   useEffect(() => { if (!editing) saveWantedDraft(form); }, [form, editing]); |
 * @mutate src/components/declutter/DeclutterWantedViews.tsx |       if (!editing) clearWantedDraft();\n |
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WantedNear, WantedPost } from "@/lib/declutter/wanted";

const posted: unknown[] = [];
const near = { rows: [] as WantedNear[] };
const mine = { rows: [] as WantedPost[] };
const photoCalls: unknown[][] = [];
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
const closed: string[] = [];
const edits: unknown[][] = [];
const lifecycle: unknown[][] = [];
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false }) }));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" } }) }));
vi.mock("./useDeclutterOrigin", () => ({
  useDeclutterOrigin: () => ({ origin: { status: "ready", lat: 30, lng: -92, approximate: false }, askDevice: () => {}, asked: false, asking: false, deviceNote: null }),
}));
vi.mock("@/lib/declutter/wanted", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/wanted")>()),
  fetchMyWanted: async () => mine.rows,
  fetchWantedNear: async () => near.rows,
  createWanted: async (f: unknown, at: unknown) => { posted.push([f, at]); return "w1"; },
  addWantedPhoto: async (...a: unknown[]) => { photoCalls.push(["add", ...a]); return 1; },
  checkWantedPhotos: async (...a: unknown[]) => { photoCalls.push(["check", ...a]); return false; },
  removeWantedPhoto: async (...a: unknown[]) => { photoCalls.push(["remove", ...a]); return 0; },
  closeWanted: async (id: string) => { closed.push(id); return "closed"; },
  updateWanted: async (id: string, f: { what: string; maxPrice: string }) => { edits.push([id, f.what, f.maxPrice]); return id; },
  reopenWanted: async (id: string) => { lifecycle.push(["reopen", id]); return "2026-12-01"; },
  removeWanted: async (id: string) => { lifecycle.push(["remove", id]); },
}));
vi.mock("@/lib/declutter/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/api")>()),
  photoPublicUrl: (p: string) => `https://cdn/${p}`,
}));

import { toast } from "sonner";
import { WantedView, wantedWhereWords } from "./DeclutterWantedViews";

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}

function open(url = "/declutter?tab=wanted") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[url]}><WantedView /><Where /></MemoryRouter></QueryClientProvider>);
}

describe("the Wanted hub", () => {
  beforeEach(() => { posted.length = 0; near.rows = []; mine.rows = []; photoCalls.length = 0; edits.length = 0; lifecycle.length = 0; localStorage.clear(); });

  it("#13: post=1 opens the form once and leaves the address, so Cancel and a reload don't bring it back", async () => {
    open("/declutter?tab=wanted&post=1");
    await screen.findByRole("dialog");
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/declutter?tab=wanted"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    // The sheet hides the page from the role query while it is open, so this finds the pill only once it has closed.
    await screen.findByRole("button", { name: "Post what you're looking for" });
    const after = screen.getByTestId("where").textContent!;
    cleanup();
    open(after);
    await screen.findByRole("button", { name: "Post what you're looking for" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("#13: words typed survive a reload, a broken draft is ignored, and a successful post forgets them", async () => {
    open("/declutter?tab=wanted&post=1");
    fireEvent.change(await screen.findByLabelText("I'm looking for"), { target: { value: "Oak dresser" } });
    fireEvent.change(screen.getByLabelText("The most you'd pay for the item"), { target: { value: "40" } });
    cleanup();
    open("/declutter?tab=wanted&post=1");
    expect(await screen.findByLabelText("I'm looking for")).toHaveValue("Oak dresser");
    expect(screen.getByLabelText("The most you'd pay for the item")).toHaveValue("40");
    cleanup();
    localStorage.setItem("helpr_wanted_draft", "{not json");
    open("/declutter?tab=wanted&post=1");
    expect(await screen.findByLabelText("I'm looking for")).toHaveValue("");
    cleanup();
    localStorage.setItem("helpr_wanted_draft", JSON.stringify({ what: "Crib", category: "baby_kids", maxPrice: "40", radius: 10 }));
    open("/declutter?tab=wanted&post=1");
    expect(await screen.findByLabelText("I'm looking for")).toHaveValue("Crib");
    fireEvent.click(screen.getByRole("button", { name: "Post wanted" }));
    await waitFor(() => expect(posted.length).toBe(1));
    await screen.findByRole("button", { name: "Post what you're looking for" });
    expect(localStorage.getItem("helpr_wanted_draft")).toBeNull();
  });

  const POST: WantedPost = {
    id: "w9", what: "Kids bike", category: "baby_kids", max_price_cents: 3000, radius_miles: 10, status: "open",
    expires_at: "2026-11-29", created_at: "2026-10-30", matches: [], public: true,
    photo_paths: ["u1/wanted/w9/a.jpg"],
    replies: [
      { offer_id: "o1", item_id: "i1", item_title: "Red bike", seller_name: "Sam G.", amount_cents: 2500, status: "open", awaiting: "buyer", created_at: "2026-10-30" },
      { offer_id: "o2", item_id: "i2", item_title: "Blue bike", seller_name: "Ann B.", amount_cents: 2000, status: "declined", awaiting: "buyer", created_at: "2026-10-29" },
    ],
  };

  it("your post shows its replies (which listing, which seller, what price, where it stands) and Answer in Buying", async () => {
    mine.rows = [POST];
    open();
    const row = await screen.findByText("Red bike");
    const card = row.closest("li[data-wanted-post]")!;
    expect(within(card as HTMLElement).getByText("2 replies from sellers:")).toBeInTheDocument();
    const first = card.querySelector('[data-wanted-reply="o1"]')!;
    expect(first.textContent).toBe("Red bike · Sam G. · $25 · Waiting for you");
    expect(within(first as HTMLElement).getByRole("link", { name: "Red bike" })).toHaveAttribute("href", "/declutter/item/i1");
    expect(card.querySelector('[data-wanted-reply="o2"]')!.textContent).toContain("Declined");
    expect(within(card as HTMLElement).getByRole("link", { name: "Answer in Buying" })).toHaveAttribute("href", "/declutter?tab=buying");
  });

  it("your post shows its photos with Remove, and Add a photo while it has fewer than 3", async () => {
    mine.rows = [POST];
    open();
    const img = await screen.findByAltText("Photo 1 of Kids bike");
    expect(img).toHaveAttribute("src", "https://cdn/u1/wanted/w9/a.jpg");
    fireEvent.click(screen.getByRole("button", { name: "Remove photo 1" }));
    await waitFor(() => expect(photoCalls).toEqual([["remove", "w9", "u1/wanted/w9/a.jpg"]]));
    expect(screen.getByRole("button", { name: "Add a photo" })).toBeInTheDocument();
  });

  // Audit W5: closing a post does not withdraw an answer already sent, and the toast says where it stays.
  it("Close with an open answer says it stays in Buying", async () => {
    mine.rows = [POST];
    closed.length = 0;
    vi.mocked(toast).mockClear();
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Close" }));
    await waitFor(() => expect(closed).toEqual(["w9"]));
    await waitFor(() => expect(vi.mocked(toast)).toHaveBeenCalledWith(
      "Closed. No more alerts or answers. The answer you already have stays in Buying until you accept or decline."));
  });

  // Audit W2: the form says where the post is measured from; W8: the "$" is grey until a price is typed.
  it("the form says where it is measured from, and the $ turns rust only once a price is typed", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Post what you're looking for" }));
    const sheet = await screen.findByRole("dialog");
    expect(sheet.querySelector("[data-wanted-where]")!.textContent).toBe("Measured from your ZIP code on file (a rough area, never your address).");
    const dollar = sheet.querySelector("[data-wanted-dollar]")!;
    expect(dollar.className).toContain("text-muted-foreground");
    fireEvent.change(within(sheet).getByLabelText("The most you'd pay for the item"), { target: { value: "30" } });
    expect(sheet.querySelector("[data-wanted-dollar]")!.className).toContain("--burnt-sienna");
    expect(wantedWhereWords("device")).toBe("Measured from where you are now (a rough area, never your address).");
    expect(wantedWhereWords("parish")).toContain("your parish");
  });

  it("Category has its own full-width row, between what you want and Up to", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Post what you're looking for" }));
    const category = await screen.findByRole("button", { name: "Category" });
    expect(category.className).toContain("border-input"); // this form's fields' border
    const form = category.closest("form")!;
    // No column layout around any of the three, so nothing sits beside the picker when it opens.
    for (const id of ["wanted-what", "wanted-category", "wanted-max"]) {
      expect(form.querySelector(`#${id}`)!.closest(".grid")).toBeNull();
    }
    const order = [...form.querySelectorAll("#wanted-what, #wanted-category, #wanted-max")].map((el) => el.id);
    expect(order).toEqual(["wanted-what", "wanted-category", "wanted-max"]);
    expect(category.closest("[data-wanted-category-row]")!.parentElement).toBe(form);
  });

  it("#22/#18: a blank form says everything at once, each beside its field, tied to it for a screen reader", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Post what you're looking for" }));
    const sheet = await screen.findByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: "Post wanted" }));
    const alerts = await within(sheet).findAllByRole("alert");
    expect(alerts.map((a) => a.textContent)).toEqual([
      "Say what you want in 3 to 60 letters, like \"crib\" or \"oak dresser\".",
      "Pick a category.",
      "Set your highest price in whole dollars, $1 to $1,000.",
    ]);
    const what = within(sheet).getByLabelText("I'm looking for");
    expect(what).toHaveAttribute("aria-invalid", "true");
    expect(what).toHaveAttribute("aria-describedby", "wanted-what-problem");
    expect(what).toHaveAttribute("aria-required", "true");
    expect(what).toHaveAttribute("enterkeyhint", "next");
    expect(document.activeElement).toBe(what);
    expect(alerts[0].closest("div")).toBe(what.closest("div"));
    expect(posted).toHaveLength(0);
  });

  it("#10: says what the most you'd pay comes to with the fee, from the price typed", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Post what you're looking for" }));
    const sheet = await screen.findByRole("dialog");
    expect(sheet.querySelector("[data-wanted-fee]")!.textContent).toContain("A $30 item costs $32.20 with our fee.");
    fireEvent.change(within(sheet).getByLabelText("The most you'd pay for the item"), { target: { value: "100" } });
    expect(sheet.querySelector("[data-wanted-fee]")!.textContent).toContain("A $100 item costs $105.70 with our fee.");
  });

  it("#4: the toast says what matching does and the placeholder is what it finds", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Post what you're looking for" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByLabelText("I'm looking for")).toHaveAttribute("placeholder", "Kids bike");
  });

  it("#9: an open post can be edited, on its own words, without touching the new-post draft", async () => {
    mine.rows = [{ ...POST, replies: [] }];
    open();
    localStorage.setItem("helpr_wanted_draft", JSON.stringify({ what: "Kept draft", category: "", maxPrice: "", radius: 10 }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("Edit your post")).toBeInTheDocument();
    const what = within(sheet).getByLabelText("I'm looking for");
    expect(what).toHaveValue("Kids bike");
    expect(within(sheet).getByLabelText("The most you'd pay for the item")).toHaveValue("30");
    fireEvent.change(what, { target: { value: "Blue bike" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(edits).toEqual([["w9", "Blue bike", "30"]]));
    expect(posted).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem("helpr_wanted_draft")!).what).toBe("Kept draft");
  });

  it("#9: closed and expired posts offer Post again and Remove (with a confirm), not Edit or Close", async () => {
    mine.rows = [{ ...POST, status: "closed", replies: [] }];
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Post again" }));
    await waitFor(() => expect(lifecycle).toEqual([["reopen", "w9"]]));
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    const confirm = await screen.findByRole("dialog");
    expect(lifecycle).toHaveLength(1);
    fireEvent.click(within(confirm).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(lifecycle).toEqual([["reopen", "w9"], ["remove", "w9"]]));
  });

  it("#16: once an answer is accepted, the post asks to be closed", async () => {
    mine.rows = [{ ...POST, replies: [{ ...POST.replies[0], status: "accepted" }] }];
    open();
    expect(await screen.findByText(/Got what you needed\? Close this post/)).toBeInTheDocument();
    cleanup();
    mine.rows = [POST];
    open();
    await screen.findByText("Red bike");
    expect(screen.queryByText(/Got what you needed/)).toBeNull();
  });

  it("#19: a reply shows its photo, and a listing that answered isn't listed again as a match", async () => {
    mine.rows = [{ ...POST, matches: [{ id: "i1", title: "Red bike", price_cents: 2500 }, { id: "i7", title: "Green bike", price_cents: 2000 }],
      replies: [{ ...POST.replies[0], photo_path: "s/declutter/i1/a.jpg" }] }];
    open();
    await screen.findByText(/Green bike/);
    expect(screen.getAllByText(/Red bike/)).toHaveLength(1);
    expect(document.querySelector("[data-wanted-reply-photo]")).toHaveAttribute("src", "https://cdn/s/declutter/i1/a.jpg");
  });

  it("a post with no replies says so", async () => {
    mine.rows = [{ ...POST, replies: [] }];
    open();
    expect(await screen.findByText("No replies from sellers yet.")).toBeInTheDocument();
  });

  it("the form takes up to 3 photos and adds each to the new post after it is posted", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Post what you're looking for" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("Photos (optional, up to 3)")).toBeInTheDocument();
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
    const file = new File(["x"], "bike.jpg", { type: "image/jpeg" });
    fireEvent.change(sheet.querySelector('input[type="file"]')!, { target: { files: [file] } });
    fireEvent.change(within(sheet).getByLabelText("I'm looking for"), { target: { value: "Kids bike" } });
    fireEvent.change(within(sheet).getByLabelText("The most you'd pay for the item"), { target: { value: "30" } });
    fireEvent.click(within(sheet).getByLabelText("Category"));
    fireEvent.click(within(sheet).getByRole("button", { name: "Family" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Baby and kids" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Post wanted" }));
    // The photo first, then its automatic check (audit 10-30 #8).
    await waitFor(() => expect(photoCalls).toEqual([["add", "u1", "w1", file], ["check", "w1"]]));
  });

  it("a Wanted near you card shows the post's first photo", async () => {
    near.rows = [{ id: "n1", what: "Crib", category: "baby_kids", max_price_cents: 4000, poster_name: "Sam R.", miles: 3, expires_at: "2026-11-20", replied: false, photo_path: "u2/wanted/n1/c.jpg" }];
    open();
    expect(await screen.findByAltText("Crib")).toHaveAttribute("src", "https://cdn/u2/wanted/n1/c.jpg");
  });

  it("opens on the hub, not the form: the pill, Your Wanted posts and Wanted near you, each with an empty state", async () => {
    open();
    expect(await screen.findByRole("button", { name: "Post what you're looking for" })).toBeInTheDocument();
    expect(screen.queryByLabelText("I'm looking for"), "the form is not inline").toBeNull();
    expect(screen.getByRole("heading", { name: "Your Wanted posts" })).toBeInTheDocument();
    expect(await screen.findByText("You haven't posted anything yet. Each post lasts 30 days, and sellers near you can answer it.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Wanted near you" })).toBeInTheDocument();
    expect(await screen.findByText(/No one near you has posted a Wanted yet/)).toBeInTheDocument();
  });

  // The sell chooser's "Looking for something? Post a Wanted" (owner 2026-10-30) links ?post=1: the form opens at once.
  // @mutate src/components/declutter/DeclutterWantedViews.tsx |   const [posting, setPosting] = useState(() => params.get(WANTED_POST_PARAM) === "1"); |   const [posting, setPosting] = useState(false); void params;
  it("?post=1 (from the sell chooser) opens the form straight away", async () => {
    open("/declutter?tab=wanted&post=1");
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("What are you looking for?")).toBeInTheDocument();
  });

  it("Wanted near you lists other members' posts with I have this", async () => {
    near.rows = [{ id: "n1", what: "Crib", category: "baby_kids", max_price_cents: 4000, poster_name: "Sam R.", miles: 3, expires_at: "2026-11-20", replied: false }];
    open();
    const section = (await screen.findByRole("heading", { name: "Wanted near you" })).closest("section")!;
    expect(await within(section).findByText("Crib")).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "I have this" })).toBeInTheDocument();
  });

  it("the pill opens the form in a sheet: no reply switch, what sellers see in plain words, money ink, 30-day rule; it posts and closes", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Post what you're looking for" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("What are you looking for?")).toBeInTheDocument();
    expect(within(sheet).queryByRole("switch"), "no 'Let sellers near me reply' switch").toBeNull();
    for (const gone of [/Let sellers near me reply/, /Only you see your post/, /How you'd get it/, /Details/]) expect(within(sheet).queryByText(gone)).toBeNull();
    expect(within(sheet).getByText("Sellers near you see your first name and last initial, what you want and your max price, never your address.")).toBeInTheDocument();
    expect(within(sheet).getByText("Your Wanted stays up 30 days. You can edit or close it anytime.")).toBeInTheDocument();
    const price = within(sheet).getByLabelText("The most you'd pay for the item");
    expect(price.className).toContain("--burnt-sienna");
    fireEvent.change(within(sheet).getByLabelText("I'm looking for"), { target: { value: "Kids bike, 16 inch" } });
    fireEvent.change(price, { target: { value: "30" } });
    fireEvent.click(within(sheet).getByLabelText("Category"));
    fireEvent.click(within(sheet).getByRole("button", { name: "Family" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Baby and kids" }));
    // "Within" wears Browse's distance chips (lead 2026-10-28, shot 39), one pressed at a time, 10 mi by default.
    // @mutate src/components/declutter/DeclutterWantedViews.tsx |             <Chip key={m} on={form.radius === m} onClick={() => setForm((f) => ({ ...f, radius: m }))}>{`${m} mi`}</Chip> |             <button key={m} type="button" className="text-ds-11" onClick={() => setForm((f) => ({ ...f, radius: m }))}>{`${m} mi`}</button>
    const chips = within(sheet).getByRole("group", { name: "Within" }).querySelectorAll("button");
    expect([...chips].map((c) => c.textContent)).toEqual(["5 mi", "10 mi", "25 mi", "50 mi"]);
    expect(within(sheet).getByRole("button", { name: "10 mi" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(sheet).getByRole("button", { name: "25 mi" }));
    expect(within(sheet).getByRole("button", { name: "25 mi" })).toHaveAttribute("aria-pressed", "true");
    for (const c of chips) expect(c.className).toMatch(/\btext-ds-13\b/);
    fireEvent.click(within(sheet).getByRole("button", { name: "Post wanted" }));
    // The post went out AND the sheet closed (one wait: the absence is checked only once the post is seen).
    await waitFor(() => {
      expect(posted).toHaveLength(1);
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(posted[0]).toEqual([{ what: "Kids bike, 16 inch", maxPrice: "30", category: "baby_kids", radius: 25 }, { lat: 30, lng: -92 }]);
  });
});
