/**
 * Q1963 (lh-money-escrow + lh-silent-failure review of 9c855c737, finding #2): tapping Post in the nav while on an
 * Add a Helpr (?declutterOrder=) or haul-away (?haulAway=) post navigated to a bare /post-job; the route is not
 * keyed, so the same form stayed mounted with the link gone. Read live, the draft gate turned off (the Add a Helpr
 * form autosaved as a plain draft) and the order id turned null (the job posted and paid with no link to the order,
 * so a seller-fault refund of the order would not cancel or refund it).
 *
 * The fix, both layers: usePostJobForm reads the link ONCE per mount (useDeclutterIntent), and PostJob remounts the
 * form when the link changes (key = postJobIntentKey), so tapping Post opens a fresh, unlinked post.
 *
 * @mutate src/pages/post-job/useDeclutterIntent.ts |   const [intent] = useState(() => readDeclutterIntent(searchParams));\n  return intent; |   return readDeclutterIntent(searchParams);
 * @mutate src/pages/post-job/useDeclutterIntent.ts |   return { declutterOrderId, noDraft: !!(declutterOrderId \|\| searchParams.get("haulAway")) }; |   return { declutterOrderId, noDraft: !!declutterOrderId };
 * @mutate src/pages/post-job/usePostJobForm.ts |     declutterOrderId,\n |     declutterOrderId: searchParams.get("declutterOrder"),\n
 * @mutate src/pages/post-job/usePostJobForm.ts |   const { noDraft, declutterOrderId } = useDeclutterIntent(searchParams); |   const { declutterOrderId } = useDeclutterIntent(searchParams);\n  const noDraft = !!(searchParams.get("haulAway") \|\| searchParams.get("declutterOrder"));
 * @mutate src/pages/post-job/PostJob.tsx |   return <PostJob key={postJobIntentKey(searchParams)} />; |   return <PostJob />;
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, useNavigate, useSearchParams } from "react-router-dom";
import { useRef } from "react";
import { blankComments } from "@/test/helpers/blankNonCode";
import { postJobIntentKey, useDeclutterIntent } from "./useDeclutterIntent";

let go: (to: string) => void = () => {};

function Probe() {
  const [searchParams] = useSearchParams();
  const intent = useDeclutterIntent(searchParams);
  go = useNavigate();
  return <p data-testid="intent">{`${intent.declutterOrderId ?? "none"}|${intent.noDraft ? "nodraft" : "draft"}`}</p>;
}

/** Counts how many times the keyed child mounted, as PostJob's route wrapper keys the form. */
function KeyedProbe() {
  const [searchParams] = useSearchParams();
  go = useNavigate();
  return <Mounted key={postJobIntentKey(searchParams)} />;
}
let mounts = 0;
function Mounted() {
  const first = useRef(true);
  if (first.current) { first.current = false; mounts++; }
  return null;
}

const code = (f: string) => blankComments(readFileSync(f, "utf8"));

describe("Q1963: the Declutter link survives a tap on Post", () => {
  it("Add a Helpr: the order link and the no-draft gate hold when the URL loses ?declutterOrder=", () => {
    render(<MemoryRouter initialEntries={["/post-job?declutterOrder=o-1&help=move"]}><Probe /></MemoryRouter>);
    expect(screen.getByTestId("intent").textContent).toBe("o-1|nodraft");
    act(() => go("/post-job"));
    expect(screen.getByTestId("intent").textContent).toBe("o-1|nodraft");
  });

  it("haul-away: the no-draft gate holds when the URL loses ?haulAway=", () => {
    render(<MemoryRouter initialEntries={["/post-job?haulAway=i-1,i-2"]}><Probe /></MemoryRouter>);
    expect(screen.getByTestId("intent").textContent).toBe("none|nodraft");
    act(() => go("/post-job"));
    expect(screen.getByTestId("intent").textContent).toBe("none|nodraft");
  });

  it("a plain post stays a plain post (drafts on, no link)", () => {
    render(<MemoryRouter initialEntries={["/post-job"]}><Probe /></MemoryRouter>);
    expect(screen.getByTestId("intent").textContent).toBe("none|draft");
  });

  it("the form remounts when the link changes or goes, and not on other params", () => {
    mounts = 0;
    render(<MemoryRouter initialEntries={["/post-job?declutterOrder=o-1"]}><KeyedProbe /></MemoryRouter>);
    expect(mounts).toBe(1);
    act(() => go("/post-job?declutterOrder=o-1&step=2"));
    expect(mounts).toBe(1);
    act(() => go("/post-job"));
    expect(mounts).toBe(2);
    act(() => go("/post-job?haulAway=i-1"));
    expect(mounts).toBe(3);
  });

  it("usePostJobForm and PostJob use it: the draft gate and the submit's order id come from the one-time read; the route keys the form", () => {
    const form = code("src/pages/post-job/usePostJobForm.ts");
    expect(form).toContain("const { noDraft, declutterOrderId } = useDeclutterIntent(searchParams);");
    expect(form).not.toMatch(/noDraft = !!\(searchParams/);
    expect(form).not.toMatch(/declutterOrderId: searchParams/);
    expect(form).toMatch(/\n\s+declutterOrderId,\n/);
    const page = code("src/pages/post-job/PostJob.tsx");
    expect(page).toContain("return <PostJob key={postJobIntentKey(searchParams)} />;");
    expect(page).toMatch(/export default PostJobRoute;/);
  });
});
