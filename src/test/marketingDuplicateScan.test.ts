import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  findRecentDuplicate,
  type MarketingRow,
  type MetaEnv,
} from "../../supabase/functions/_shared/marketing/meta";

/**
 * The only thing standing between a retry and a DOUBLE POST on the owner's real
 * Instagram and Facebook.
 *
 * The race it exists for: the dispatcher publishes, Meta accepts, and the
 * response is lost (timeout, cold start, a killed function). The row stays
 * `publishing`, the reclaim picks it up, and a naive retry posts the same
 * caption to a live business page a second time. Before any retry, this asks
 * Meta whether the previous attempt actually landed and adopts it instead.
 *
 * Two failure directions, and they are NOT symmetrical:
 *   - failing to ADOPT a post that did land → the audience sees it twice.
 *   - failing to publish because the SCAN failed → nothing goes out at all.
 * So a scan error must never propagate as an exception; it has to degrade to
 * `scan_failed` and let the publish proceed. Both directions are asserted here.
 *
 * Auto-publish is on, so nothing human is between this function and the feed.
 */

const env: MetaEnv = {
  pageId: "page-1",
  pageAccessToken: "tok-1",
  igUserId: "ig-1",
  appId: "app-1",
  appSecret: "secret-1",
};

const row = (over: Partial<MarketingRow> = {}): MarketingRow => ({
  id: "row-1",
  channel: "facebook",
  body: "Storm prep season starts June 1 and board-up work gets posted every week.",
  hashtags: ["Louisiana"],
  media_urls: null,
  attempts: 2,
  ...over,
});

/** The caption the scanner will be looking for, built the same way it builds it. */
const captionFor = (r: MarketingRow) =>
  r.hashtags?.length ? `${r.body}\n\n#${r.hashtags[0]}` : r.body;

const okJson = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

const nowIso = () => new Date().toISOString();
const hoursAgoIso = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("findRecentDuplicate — Facebook", () => {
  it("adopts our own post from a lost attempt instead of posting it twice", async () => {
    const r = row();
    fetchMock.mockResolvedValue(
      okJson({ data: [{ id: "post-9", message: captionFor(r), created_time: nowIso() }] }),
    );
    const scan = await findRecentDuplicate(r, env);
    expect(scan.kind).toBe("adopt");
    if (scan.kind === "adopt") {
      expect(scan.result.externalId).toBe("post-9");
      expect(scan.result.adopted).toBe(true);
      expect(scan.result.externalUrl).toBe("https://www.facebook.com/post-9");
    }
  });

  it("matches despite whitespace and case differences Meta may introduce", async () => {
    const r = row();
    const mangled = captionFor(r).toUpperCase().replace(/ /g, "   ");
    fetchMock.mockResolvedValue(
      okJson({ data: [{ id: "post-9", message: mangled, created_time: nowIso() }] }),
    );
    expect((await findRecentDuplicate(r, env)).kind).toBe("adopt");
  });

  it("does NOT adopt an identical post older than the 2h lookback", async () => {
    // A genuine repeat of an evergreen caption from last week is not the lost
    // attempt this is hunting for — adopting it would silently skip a post the
    // calendar actually scheduled.
    const r = row();
    fetchMock.mockResolvedValue(
      okJson({ data: [{ id: "old-post", message: captionFor(r), created_time: hoursAgoIso(3) }] }),
    );
    expect((await findRecentDuplicate(r, env)).kind).toBe("none");
  });

  it("returns none when nothing on the page matches", async () => {
    fetchMock.mockResolvedValue(
      okJson({ data: [{ id: "other", message: "A completely different post", created_time: nowIso() }] }),
    );
    expect((await findRecentDuplicate(row(), env)).kind).toBe("none");
  });

  it("returns none on an empty feed", async () => {
    fetchMock.mockResolvedValue(okJson({ data: [] }));
    expect((await findRecentDuplicate(row(), env)).kind).toBe("none");
  });
});

describe("findRecentDuplicate — Instagram", () => {
  it("adopts by caption and keeps Meta's own permalink", async () => {
    const r = row({ channel: "instagram", media_urls: ["https://example.test/a.jpg"] });
    fetchMock.mockResolvedValue(
      okJson({
        data: [{ id: "ig-9", caption: captionFor(r), timestamp: nowIso(), permalink: "https://instagram.com/p/abc" }],
      }),
    );
    const scan = await findRecentDuplicate(r, env);
    expect(scan.kind).toBe("adopt");
    if (scan.kind === "adopt") {
      expect(scan.result.externalId).toBe("ig-9");
      expect(scan.result.externalUrl).toBe("https://instagram.com/p/abc");
    }
  });

  it("adopts even when Meta returns no permalink", async () => {
    const r = row({ channel: "instagram" });
    fetchMock.mockResolvedValue(
      okJson({ data: [{ id: "ig-9", caption: captionFor(r), timestamp: nowIso() }] }),
    );
    const scan = await findRecentDuplicate(r, env);
    // A missing permalink is not a reason to post twice.
    expect(scan.kind).toBe("adopt");
    if (scan.kind === "adopt") expect(scan.result.externalUrl).toBeNull();
  });

  it("queries the IG media endpoint, not the Page feed", async () => {
    fetchMock.mockResolvedValue(okJson({ data: [] }));
    await findRecentDuplicate(row({ channel: "instagram" }), env);
    expect(String(fetchMock.mock.calls[0][0])).toContain("ig-1/media");
  });
});

describe("findRecentDuplicate — a scan failure must never block a publish", () => {
  it("degrades to scan_failed when the network throws, rather than raising", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));
    const scan = await findRecentDuplicate(row(), env);
    expect(scan.kind).toBe("scan_failed");
  });

  it("degrades to scan_failed on a Graph error response", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "Invalid OAuth access token" } }), { status: 401 }),
    );
    expect((await findRecentDuplicate(row(), env)).kind).toBe("scan_failed");
  });

  it("degrades to scan_failed on a malformed body", async () => {
    fetchMock.mockResolvedValue(new Response("<html>gateway</html>", { status: 200 }));
    expect((await findRecentDuplicate(row(), env)).kind).toBe("scan_failed");
  });

  it("reports scan_failed — not 'none' — when the token is missing", async () => {
    // The distinction is the whole point: 'none' would assert that nothing was
    // posted, which an unauthenticated scan cannot possibly establish.
    const scan = await findRecentDuplicate(row(), { ...env, pageAccessToken: null });
    expect(scan.kind).toBe("scan_failed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports scan_failed when the channel's id is unset", async () => {
    expect((await findRecentDuplicate(row(), { ...env, pageId: null })).kind).toBe("scan_failed");
    expect(
      (await findRecentDuplicate(row({ channel: "instagram" }), { ...env, igUserId: null })).kind,
    ).toBe("scan_failed");
  });
});

describe("findRecentDuplicate — captions too short to match on", () => {
  it("returns none without calling Meta when the caption is under 20 chars", async () => {
    // 'none' rather than 'scan_failed': this is a real answer. A caption this
    // short could collide with an unrelated post, and adopting the wrong post
    // would mark a scheduled row published against a stranger's permalink.
    const scan = await findRecentDuplicate(row({ body: "Hi y'all", hashtags: null }), env);
    expect(scan.kind).toBe("none");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
