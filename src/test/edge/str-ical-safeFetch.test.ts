/**
 * Unit tests for `supabase/functions/str-ical-sync/safeFetch.ts` — the SSRF gate
 * on the ONE user-supplied URL this platform dereferences server-side.
 *
 * WHY THESE ARE UNIT TESTS AND NOT A HARNESS RUN
 *
 * The vulnerability is a property of URL and ADDRESS handling, not of the
 * function's Supabase wiring, and the two cases that actually matter cannot be
 * observed through the edge harness at all:
 *
 *   - a hostname that RESOLVES to a private address (the stored URL is a
 *     perfectly ordinary public name, so nothing about the string is wrong),
 *   - a public URL that 302s to a private one (hop 1 is innocent by design).
 *
 * Both were reproduced against production on 2026-09-01 from a signed-in
 * non-admin account before this module existed — `http://localtest.me/`
 * (public DNS → 127.0.0.1) and
 * `https://httpbin.org/redirect-to?url=http://127.0.0.1/` each reached loopback
 * and reported "Connection refused" back to the attacker. So the resolver and
 * the fetch are injected here, and the tests assert on which addresses the
 * module was willing to CONNECT to.
 */
import { describe, it, expect, vi } from "vitest";

type DnsResolver = (hostname: string) => Promise<string[]>;

interface SafeFetchModule {
  BlockedUrlError: new (reason: string) => Error & { reason: string };
  FeedTooLargeError: new (limitBytes: number) => Error;
  classifyIp(ip: string): "public" | "blocked" | "invalid";
  normalizeAndCheckShape(raw: string): URL;
  assertPublicUrl(raw: string, resolve?: DnsResolver): Promise<URL>;
  fetchIcalFeed(
    rawUrl: string,
    opts?: {
      resolve?: DnsResolver;
      maxBytes?: number;
      maxRedirects?: number;
      fetchImpl?: typeof fetch;
      now?: () => number;
    },
  ): Promise<string>;
}

/**
 * Loaded through a NON-LITERAL specifier, for the same reason
 * `paginate.test.ts` does it — see the long note there.
 *
 * `tsconfig.app.json` enumerates the handful of `supabase/functions/*` modules
 * the app compiles, and this one is not among them, so a static import fails
 * with TS6307. The module IS typechecked, by `npm run typecheck:edge`, which is
 * the check that owns `supabase/functions/**`. Adding it to the app tsconfig's
 * include list would let this be a plain import — worth doing, but that file is
 * not this lane's to edit.
 */
const SAFE_FETCH_PATH = "../../../supabase/functions/str-ical-sync/safeFetch.ts";
const {
  BlockedUrlError,
  FeedTooLargeError,
  classifyIp,
  normalizeAndCheckShape,
  assertPublicUrl,
  fetchIcalFeed,
} = (await import(/* @vite-ignore */ SAFE_FETCH_PATH)) as SafeFetchModule;

/** A resolver that maps names to whatever the test says they resolve to. */
const resolverFor = (table: Record<string, string[]>) => (host: string) =>
  table[host] ? Promise.resolve(table[host]) : Promise.reject(new Error("NXDOMAIN"));

describe("classifyIp", () => {
  it("blocks every IPv4 range that is not publicly routable", () => {
    for (const ip of [
      "127.0.0.1",       // loopback
      "127.255.255.254", // loopback, far end
      "10.0.0.1",        // RFC1918
      "172.16.0.1",      // RFC1918 low
      "172.31.255.255",  // RFC1918 high
      "192.168.1.1",     // RFC1918
      "169.254.169.254", // link-local — cloud metadata
      "100.64.0.1",      // CGNAT
      "0.0.0.0",         // "this network"
      "198.18.0.1",      // benchmarking
      "192.0.2.1",       // documentation
      "203.0.113.9",     // documentation
      "224.0.0.1",       // multicast
      "255.255.255.255", // broadcast / reserved
    ]) {
      expect(classifyIp(ip), ip).toBe("blocked");
    }
  });

  it("allows genuinely public IPv4", () => {
    // 172.15/172.32 sit either side of the RFC1918 block — an off-by-one in the
    // range check shows up here and nowhere else.
    for (const ip of ["1.1.1.1", "8.8.8.8", "172.15.0.1", "172.32.0.1", "93.184.216.34"]) {
      expect(classifyIp(ip), ip).toBe("public");
    }
  });

  it("blocks IPv6 loopback, unique-local, link-local and multicast", () => {
    for (const ip of ["::1", "::", "fd00::1", "fc00::1", "fe80::1", "ff02::1", "2001:db8::1"]) {
      expect(classifyIp(ip), ip).toBe("blocked");
    }
  });

  it("unwraps IPv4-mapped and 6to4 addresses instead of treating them as opaque v6", () => {
    // The classic bypass: ::ffff:127.0.0.1 IS loopback, and a v6 range check
    // that does not unwrap it will wave it through.
    expect(classifyIp("::ffff:127.0.0.1")).toBe("blocked");
    expect(classifyIp("::ffff:10.0.0.1")).toBe("blocked");
    expect(classifyIp("::ffff:8.8.8.8")).toBe("public");
    expect(classifyIp("2002:7f00:0001::")).toBe("blocked"); // 6to4 wrapping 127.0.0.1
    expect(classifyIp("2002:0808:0808::")).toBe("public");  // 6to4 wrapping 8.8.8.8
  });

  it("allows public IPv6", () => {
    expect(classifyIp("2606:4700:4700::1111")).toBe("public");
  });
});

describe("normalizeAndCheckShape", () => {
  it("rejects every scheme except http/https", () => {
    for (const u of [
      "file:///etc/passwd",
      "gopher://example.com/",
      "data:text/calendar,BEGIN:VCALENDAR",
      "ftp://example.com/cal.ics",
    ]) {
      expect(() => normalizeAndCheckShape(u), u).toThrow(BlockedUrlError);
    }
  });

  it("normalises webcal: to https:, because that is what Airbnb/VRBO hand out", () => {
    expect(normalizeAndCheckShape("webcal://example.com/cal.ics").toString())
      .toBe("https://example.com/cal.ics");
  });

  it("rejects embedded credentials", () => {
    expect(() => normalizeAndCheckShape("http://user:pass@example.com/")).toThrow(/credentials/);
  });

  it("rejects any port other than 80/443, which removes port scanning as a payload", () => {
    expect(() => normalizeAndCheckShape("http://example.com:22/")).toThrow(/port/);
    expect(() => normalizeAndCheckShape("http://example.com:6379/")).toThrow(/port/);
    expect(() => normalizeAndCheckShape("http://example.com:5432/")).toThrow(/port/);
    expect(normalizeAndCheckShape("https://example.com:443/x").hostname).toBe("example.com");
  });

  it("rejects a literal private IP without needing DNS", () => {
    expect(() => normalizeAndCheckShape("http://169.254.169.254/latest/meta-data/"))
      .toThrow(/not publicly routable/);
    expect(() => normalizeAndCheckShape("http://[::1]/")).toThrow(/not publicly routable/);
  });

  it("normalises the obfuscated IPv4 spellings that defeat string matching", () => {
    // WHATWG URL parsing turns all of these into 127.0.0.1 before we classify,
    // which is exactly why the check is on the parsed host and not the raw text.
    for (const u of ["http://2130706433/", "http://0177.0.0.1/", "http://0x7f000001/"]) {
      expect(() => normalizeAndCheckShape(u), u).toThrow(/not publicly routable/);
    }
  });
});

describe("assertPublicUrl", () => {
  it("blocks a PUBLIC hostname that resolves to a private address", async () => {
    // The `localtest.me` case, reproduced against prod. Nothing about the URL
    // string is suspicious; only the answer from DNS is.
    await expect(
      assertPublicUrl("http://feeds.example.com/cal.ics", resolverFor({
        "feeds.example.com": ["127.0.0.1"],
      })),
    ).rejects.toThrow(/not publicly routable/);
  });

  it("blocks when ANY resolved address is private, not just the first", async () => {
    // Checking only addrs[0] is a live bypass: the connect can pick either.
    await expect(
      assertPublicUrl("http://split.example.com/c.ics", resolverFor({
        "split.example.com": ["93.184.216.34", "10.1.2.3"],
      })),
    ).rejects.toThrow(/not publicly routable/);
  });

  it("allows a hostname that resolves entirely to public addresses", async () => {
    const url = await assertPublicUrl("https://cal.example.com/x.ics", resolverFor({
      "cal.example.com": ["93.184.216.34", "2606:4700::1111"],
    }));
    expect(url.hostname).toBe("cal.example.com");
  });

  it("fails CLOSED when the name cannot be resolved", async () => {
    await expect(
      assertPublicUrl("https://nope.example.com/x.ics", resolverFor({})),
    ).rejects.toThrow(BlockedUrlError);
  });

  it("fails CLOSED when the runtime offers no resolver at all", async () => {
    // A resolver-less runtime must not degrade into "fetch it anyway".
    await expect(
      assertPublicUrl("https://cal.example.com/x.ics", () => {
        throw new BlockedUrlError("address could not be verified");
      }),
    ).rejects.toThrow(/could not be verified/);
  });
});

describe("fetchIcalFeed", () => {
  const PUBLIC_DNS = resolverFor({
    "cal.example.com": ["93.184.216.34"],
    "evil.example.com": ["93.184.216.34"],
    "internal.example.com": ["10.0.0.5"],
  });

  const okResponse = (body: string) =>
    new Response(body, { status: 200, headers: { "content-type": "text/calendar" } });

  it("fetches a well-formed public feed", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse("BEGIN:VCALENDAR\r\nEND:VCALENDAR"));
    const text = await fetchIcalFeed("https://cal.example.com/x.ics", {
      resolve: PUBLIC_DNS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(text).toContain("BEGIN:VCALENDAR");
    // Redirects must be handled by US, not by the runtime — with "follow" there
    // is no seam at which a hop can be checked.
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });

  it("BLOCKS a public URL that 302s to loopback — the bypass proven against prod", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "http://127.0.0.1/" } }),
    );
    await expect(
      fetchIcalFeed("https://evil.example.com/r", {
        resolve: PUBLIC_DNS,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/not publicly routable/);
    // It must refuse BEFORE issuing the second request.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("BLOCKS a 302 to the cloud metadata endpoint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } }),
    );
    await expect(
      fetchIcalFeed("https://evil.example.com/r", {
        resolve: PUBLIC_DNS,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/not publicly routable/);
  });

  it("BLOCKS a 302 to a public NAME that resolves privately", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "https://internal.example.com/x" } }),
    );
    await expect(
      fetchIcalFeed("https://evil.example.com/r", {
        resolve: PUBLIC_DNS,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/not publicly routable/);
  });

  it("re-validates a RELATIVE redirect against the current hop", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: "/real.ics" } }))
      .mockResolvedValueOnce(okResponse("BEGIN:VCALENDAR"));
    const text = await fetchIcalFeed("https://cal.example.com/old.ics", {
      resolve: PUBLIC_DNS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(text).toContain("BEGIN:VCALENDAR");
    expect(fetchImpl.mock.calls[1][0]).toBe("https://cal.example.com/real.ics");
  });

  it("caps the redirect chain", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "https://cal.example.com/loop" } }),
    );
    await expect(
      fetchIcalFeed("https://cal.example.com/loop", {
        resolve: PUBLIC_DNS,
        maxRedirects: 2,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/too many redirects/);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // initial + 2 permitted hops
  });

  it("caps the body by DECLARED content-length before reading a byte", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("x".repeat(50), { status: 200, headers: { "content-length": "999999999" } }),
    );
    await expect(
      fetchIcalFeed("https://cal.example.com/big.ics", {
        resolve: PUBLIC_DNS,
        maxBytes: 1024,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(FeedTooLargeError);
  });

  it("caps a CHUNKED body mid-stream, where content-length lies or is absent", async () => {
    // The OOM case that a content-length check alone cannot catch: an endless
    // stream with no declared length. `.text()` would buffer it forever.
    let pushed = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pushed += 1;
        if (pushed > 1000) return controller.close();
        controller.enqueue(new Uint8Array(1024));
      },
    });
    const fetchImpl = vi.fn().mockResolvedValue(new Response(body, { status: 200 }));
    await expect(
      fetchIcalFeed("https://cal.example.com/endless.ics", {
        resolve: PUBLIC_DNS,
        maxBytes: 4096,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(FeedTooLargeError);
    // Bailed out early rather than draining the whole stream.
    expect(pushed).toBeLessThan(20);
  });

  it("refuses the initial URL before issuing any request at all", async () => {
    const fetchImpl = vi.fn();
    await expect(
      fetchIcalFeed("http://169.254.169.254/latest/meta-data/", {
        resolve: PUBLIC_DNS,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/not publicly routable/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("surfaces a non-2xx as a plain error carrying the status for the operator log", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 404 }));
    await expect(
      fetchIcalFeed("https://cal.example.com/gone.ics", {
        resolve: PUBLIC_DNS,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/iCal fetch failed: 404/);
  });
});
