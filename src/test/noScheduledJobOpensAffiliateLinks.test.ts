// @mutate .github/workflows/broken-links.yml | \|mavely\.app\.link\|walmrt\.us\|goto\.walmart\.com\| | \|mavely\.app\.link\|goto\.walmart\.com\|
// @mutate .github/workflows/broken-links.yml |             --exclude-path node_modules |             --exclude-mail\n            --exclude-path node_modules
/**
 * CLASS GUARD: no scheduled job or link check ever requests one of OUR affiliate links (owner 2026-11-24 ~10 PM,
 * "Yes, change it").
 *
 * Why: a request to an affiliate short link (go.shopmy.us, mavely.app.link, walmrt.us, amzn.to, CJ, Rakuten, Awin,
 * Impact, samsclub.co, or an Amazon page carrying our tag) is a click on the owner's dashboards. Later showed ~1,800
 * clicks a week with $0 in sales and ShopMy showed dozens of links at exactly 10 clicks; the networks can treat
 * self-clicks as invalid traffic. Measured 2026-11-24 (memory never-open-own-affiliate-links): the Desktop price
 * job's cache holds 2,439 short links resolved with a redirect-following curl on 2026-11-20 between 12:40 and
 * 1:02 PM CST (2,216 go.shopmy.us, 143 mavely.app.link, 81 walmrt.us). In this repo the one scheduled link checker
 * is broken-links.yml's lychee step: it had no affiliate exclude (and was dead on a removed flag, so it checked 0
 * links; fixing that flag without the exclude would have turned it into a weekly affiliate clicker the moment a
 * guide link reached the homepage HTML). A pick's price and stock are checked from its stored store URL instead
 * (Desktop Link-library fill_prices.py cache / walmrt-to-ip.json / _shopmy-pins.json; never the short link).
 *
 * What is scanned, from the repo's own inventory (comments blanked with the shared helpers):
 *   1. Every workflow and composite action: an affiliate host may appear ONLY on a `--exclude` line.
 *   2. Every lychee run in a workflow excludes every affiliate host (its --exclude patterns are compiled and tried
 *      against a sample link per host) while still checking plain store pages, and uses no flag lychee 0.24 refuses
 *      (`--exclude-mail` made the step a silent no-op: runs 44143458785 and 45474556150).
 *   3. Every file a SCHEDULED workflow runs (scripts/e2e/tools/ops paths it names, `npm run` targets expanded through
 *      package.json, composite actions it uses, and the relative scripts/ and e2e/ imports of those) names no
 *      affiliate host at all.
 *   4. Repo-wide: no non-test file under scripts/, supabase/functions/ (pg_cron calls these), api/, e2e/, tools/,
 *      ops/ or .github/ both makes a network request and names an affiliate host. Exact allowlist (empty today).
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";
import { blankComments, blankHashComments } from "./helpers/blankNonCode";
import { AFFILIATE_HOSTS } from "@/content/giftGuides";
import { GO_LINK_HOSTS } from "@/lib/goLinks.mjs";

const ROOT = resolve(__dirname, "../..");

/**
 * Every affiliate redirect host we earn through, plus the network's alternate click domains. A sample link per host
 * is what check 2 feeds lychee's exclude patterns. Must cover the app's own lists (asserted below).
 */
const AFFILIATE_SAMPLES: Record<string, string> = {
  "go.shopmy.us": "https://go.shopmy.us/p-109205223",
  "shopmy.us": "https://shopmy.us/collections/123",
  "mavely.app.link": "https://mavely.app.link/e/abc123",
  "walmrt.us": "https://walmrt.us/4jcFSs7",
  "goto.walmart.com": "https://goto.walmart.com/c/1/2/3",
  "samsclub.co": "https://samsclub.co/abc",
  "amzn.to": "https://amzn.to/3abcd",
  "amzn.com": "https://amzn.com/B000000000",
  "a.co": "https://a.co/d/abc",
  "link.amazon": "https://link.amazon/B0iFLKy56",
  "amzlinks.in": "https://amzlinks.in/B0iFLKy56",
  "www.amazon.com": "https://www.amazon.com/dp/B000000000?tag=louisianahelpr-20",
  "www.anrdoezrs.net": "https://www.anrdoezrs.net/click-1-2?url=https%3A%2F%2Fexample.com",
  "www.jdoqocy.com": "https://www.jdoqocy.com/click-1-2",
  "www.tkqlhce.com": "https://www.tkqlhce.com/click-1-2",
  "www.dpbolvw.net": "https://www.dpbolvw.net/click-1-2",
  "www.kqzyfj.com": "https://www.kqzyfj.com/click-1-2",
  "click.linksynergy.com": "https://click.linksynergy.com/deeplink?id=x&mid=1",
  "www.awin1.com": "https://www.awin1.com/cread.php?awinmid=1&awinaffid=2",
  "brand.sjv.io": "https://brand.sjv.io/c/1/2/3",
  "brand.pxf.io": "https://brand.pxf.io/c/1/2/3",
  "brand.7eer.net": "https://brand.7eer.net/c/1/2/3",
  "brand.evyy.net": "https://brand.evyy.net/c/1/2/3",
  "brand.ojrq.net": "https://brand.ojrq.net/c/1/2/3",
};
/** Plain store / profile pages a link check must still be able to request. */
const PLAIN_PAGES = [
  "https://www.walmart.com/ip/123456",
  "https://www.baublebar.com/products/mini-custom-name-necklace",
  "https://www.facebook.com/louisianahelpr",
  "https://fncmgoasalhdgfwzhsqa.supabase.co",
];

/** A literal affiliate host in source text (hosts only; an Amazon product page counts only with our tag). */
const AFFILIATE_HOST_RE =
  /(?:^|[^a-z0-9.-])(?:[a-z0-9-]+\.)*(?:go\.shopmy\.us|shopmy\.us\/(?:p-|collections)|mavely\.app\.link|walmrt\.us|goto\.walmart\.com|samsclub\.co(?![a-z])|amzn\.(?:to|com)(?![a-z])|a\.co(?![a-z.])|amzlinks\.in|link\.amazon(?![a-z.])|anrdoezrs\.net|jdoqocy\.com|tkqlhce\.com|dpbolvw\.net|kqzyfj\.com|linksynergy\.com|awin1\.com|sjv\.io|pxf\.io|7eer\.net|evyy\.net|ojrq\.net)|tag=louisianahelpr/i;

/** A network request in code: fetch, curl/wget, Python urllib/requests/httpx, node http(s), a browser goto, lychee. */
const REQUEST_RE =
  /\bfetch\s*\(|\bboundedFetch\b|\bcurl\s+(?:-|["'$]|https?:)|["']curl["']|\bwget\s|\burlopen\s*\(|\brequests\.(?:get|head|post|request)\s*\(|\bhttpx\.|\bhttps?\.(?:get|request)\s*\(|\.goto\s*\(|\blychee\b/;

function tracked(...dirs: string[]): string[] {
  return execFileSync("git", ["ls-files", "-z", "--", ...dirs], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 })
    .split("\0")
    .filter(Boolean)
    .filter((f) => existsSync(join(ROOT, f)));
}

/** Source text with comments blanked by the file's own comment syntax (strings kept: a URL is a string). */
function code(rel: string, raw = readFileSync(join(ROOT, rel), "utf8")): string {
  return /\.(ya?ml|sh|py|bash)$/.test(rel) ? blankHashComments(raw) : blankComments(raw);
}

const WORKFLOWS = tracked(".github/workflows").filter((f) => /\.ya?ml$/.test(f));
const ACTIONS = tracked(".github/actions").filter((f) => /\.(ya?ml|sh)$/.test(f));
const PKG_SCRIPTS: Record<string, string> = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts;

/** Repo files a command line or workflow names directly. */
const FILE_REF_RE = /(?:^|[\s"'=(./])((?:scripts|e2e|tools|ops)\/[A-Za-z0-9_./-]+\.(?:mjs|cjs|js|ts|tsx|sh|py))\b/g;

function filesNamedBy(text: string, seenNpm = new Set<string>()): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(FILE_REF_RE)) out.add(normalize(m[1]));
  for (const m of text.matchAll(/\bnpm run ([A-Za-z0-9:._-]+)/g)) {
    const name = m[1];
    if (seenNpm.has(name) || !PKG_SCRIPTS[name]) continue;
    seenNpm.add(name);
    for (const f of filesNamedBy(PKG_SCRIPTS[name], seenNpm)) out.add(f);
  }
  for (const m of text.matchAll(/uses:\s*\.\/(\.github\/actions\/[A-Za-z0-9_.-]+)/g)) {
    for (const a of ACTIONS.filter((f) => f.startsWith(m[1] + "/"))) {
      out.add(a);
      for (const f of filesNamedBy(readFileSync(join(ROOT, a), "utf8"), seenNpm)) out.add(f);
    }
  }
  return [...out].filter((f) => existsSync(join(ROOT, f)));
}

/** Relative imports of a JS/TS file that stay inside scripts/ or e2e/ (where job logic lives), transitively. */
function withLocalImports(files: string[]): string[] {
  const seen = new Set<string>();
  const queue = [...files];
  while (queue.length) {
    const f = queue.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    if (!/\.(mjs|cjs|js|ts|tsx)$/.test(f)) continue;
    const src = blankComments(readFileSync(join(ROOT, f), "utf8"));
    for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g)) {
      const base = normalize(join(dirname(f), m[1]));
      const hit = [base, ...[".mjs", ".js", ".ts", ".tsx", ".cjs"].map((e) => base + e)].find(
        (p) => /^(scripts|e2e)\//.test(p) && /\.(mjs|cjs|js|ts|tsx)$/.test(p) && existsSync(join(ROOT, p)),
      );
      if (hit) queue.push(hit);
    }
  }
  return [...seen].sort();
}

function isScheduled(rel: string): boolean {
  return /^\s*schedule\s*:/m.test(code(rel));
}

/** The lychee runs in a workflow: the args of each lychee-action step and each `lychee ...` command line. */
function lycheeArgBlocks(rel: string): string[] {
  const src = code(rel);
  const blocks: string[] = [];
  const lines = src.split("\n");
  lines.forEach((line, i) => {
    if (/uses:\s*lycheeverse\/lychee-action@/.test(line)) {
      // the step's `args:` block: from `args:` to the next key at the `with:` indentation or shallower
      const rest = lines.slice(i + 1);
      const argsAt = rest.findIndex((l) => /^\s*args:\s*/.test(l));
      if (argsAt === -1) {
        blocks.push("");
        return;
      }
      const indent = rest[argsAt].search(/\S/);
      const body = [rest[argsAt].replace(/^\s*args:\s*(>-?|\|-?)?/, "")];
      for (const l of rest.slice(argsAt + 1)) {
        if (l.trim() && l.search(/\S/) <= indent) break;
        body.push(l);
      }
      blocks.push(body.join("\n"));
    } else if (/(^|[\s;&|])lychee\s+-/.test(line) && !/lychee-action/.test(line)) {
      blocks.push(line);
    }
  });
  return blocks;
}

/** The regexes a lychee arg block passes to --exclude (quotes stripped, as the action's shell does). */
function excludePatterns(block: string): RegExp[] {
  const out: RegExp[] = [];
  for (const m of block.matchAll(/--exclude(?:=|\s+)(?:'([^']*)'|"([^"]*)"|(\S+))/g)) {
    const pat = m[1] ?? m[2] ?? m[3];
    out.push(new RegExp(pat));
  }
  return out;
}

const SCHEDULED = WORKFLOWS.filter(isScheduled);
const SCHEDULED_FILES = withLocalImports(
  [...new Set(SCHEDULED.flatMap((w) => filesNamedBy(readFileSync(join(ROOT, w), "utf8"))))].filter(
    (f) => !/\.(ya?ml)$/.test(f) || f.startsWith(".github/actions/"),
  ),
);

/**
 * Non-test files that both make a request and name an affiliate host. Each entry needs a reason. Empty today. Exact
 * both ways: an entry whose file stopped matching fails the same toEqual as a new offender.
 */
// @two-way src/test/noScheduledJobOpensAffiliateLinks.test.ts:expect(hits.sort()).toEqual(Object.keys(REQUEST_AND_AFFILIATE_ALLOWED).sort());
const REQUEST_AND_AFFILIATE_ALLOWED: Record<string, string> = {};

describe("no scheduled job or link check requests our own affiliate links", () => {
  it("the sample list covers every affiliate host the app links through", () => {
    const sampleHosts = Object.values(AFFILIATE_SAMPLES).map((u) => new URL(u).hostname);
    for (const h of [...AFFILIATE_HOSTS, ...GO_LINK_HOSTS]) expect(sampleHosts, h).toContain(h);
    for (const u of Object.values(AFFILIATE_SAMPLES)) expect(AFFILIATE_HOST_RE.test(u), u).toBe(true);
    for (const u of PLAIN_PAGES) expect(AFFILIATE_HOST_RE.test(u), u).toBe(false);
  });

  it("workflows and actions name an affiliate host only on a lychee --exclude line", () => {
    expect(WORKFLOWS.length).toBeGreaterThan(60);
    const offenders: string[] = [];
    for (const f of [...WORKFLOWS, ...ACTIONS]) {
      code(f)
        .split("\n")
        .forEach((line, i) => {
          if (AFFILIATE_HOST_RE.test(line) && !/--exclude(?:=|\s)/.test(line)) offenders.push(`${f}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it("every lychee run excludes every affiliate host, still checks plain pages, and uses no refused flag", () => {
    const runs = WORKFLOWS.flatMap((w) => lycheeArgBlocks(w).map((block) => ({ w, block })));
    expect(runs.length).toBeGreaterThan(0);
    for (const { w, block } of runs) {
      expect(block, `${w}: --exclude-mail is refused by lychee 0.24 (the step then checks 0 links)`).not.toMatch(/--exclude-mail\b/);
      const pats = excludePatterns(block);
      const leaked = Object.values(AFFILIATE_SAMPLES).filter((u) => !pats.some((re) => re.test(u)));
      expect(leaked, `${w}: lychee would request these affiliate links`).toEqual([]);
      const overExcluded = PLAIN_PAGES.filter((u) => pats.some((re) => re.test(u)));
      expect(overExcluded, `${w}: lychee would skip these plain pages`).toEqual([]);
    }
  });

  it("no file a scheduled workflow runs names an affiliate host", () => {
    expect(SCHEDULED.length).toBeGreaterThan(30);
    expect(SCHEDULED_FILES.length).toBeGreaterThan(200);
    const offenders = SCHEDULED_FILES.filter((f) => AFFILIATE_HOST_RE.test(code(f)));
    expect(offenders).toEqual([]);
  });

  it("no repo job code both makes a request and names an affiliate host (exact allowlist)", () => {
    const files = tracked("scripts", "supabase/functions", "api", "e2e", "tools", "ops", ".github").filter(
      (f) => /\.(mjs|cjs|js|ts|tsx|sh|py|ya?ml)$/.test(f) && !/\.test\.|\/__tests__\/|\.d\.m?ts$/.test(f),
    );
    expect(files.length).toBeGreaterThan(800);
    const hits = files.filter((f) => {
      const src = code(f);
      if (!AFFILIATE_HOST_RE.test(src) || !REQUEST_RE.test(src)) return false;
      // a workflow whose only affiliate mentions are lychee excludes is check 2's business
      if (/\.ya?ml$/.test(f)) return src.split("\n").some((l) => AFFILIATE_HOST_RE.test(l) && !/--exclude(?:=|\s)/.test(l));
      return true;
    });
    expect(hits.sort()).toEqual(Object.keys(REQUEST_AND_AFFILIATE_ALLOWED).sort());
  });

  it("the scanners see a planted affiliate request (self-test)", () => {
    const planted = 'const r = await fetch("https://walmrt.us/4jcFSs7", { method: "HEAD" });';
    expect(AFFILIATE_HOST_RE.test(code("scripts/x.mjs", planted)) && REQUEST_RE.test(code("scripts/x.mjs", planted))).toBe(true);
    const shell = 'curl -sIL "https://go.shopmy.us/p-1" -o /dev/null';
    expect(AFFILIATE_HOST_RE.test(code("scripts/x.sh", shell)) && REQUEST_RE.test(code("scripts/x.sh", shell))).toBe(true);
    const py = 'subprocess.run(["curl", "-sIL", u])  # u from mavely.app.link';
    expect(REQUEST_RE.test(code("scripts/x.py", py))).toBe(true);
    expect(AFFILIATE_HOST_RE.test(code("scripts/x.py", py))).toBe(false); // a comment is not code
    expect(REQUEST_RE.test("heatless.*curl cream")).toBe(false);
    expect(excludePatterns(`--exclude '^https?://(www\\.)?louisianahelpr\\.com'`)[0].test("https://www.louisianahelpr.com/x")).toBe(true);
  });
});
