/**
 * IndexNow (SEO P1, owner 11-19): after each production deploy of main, the sitemap's URLs go to IndexNow (Bing,
 * Yandex, Seznam, Naver). The protocol verifies the key by fetching https://www.louisianahelpr.com/<key>.txt, so the
 * key file must exist in public/ with exactly the key, the script must send only our own sitemap URLs, and the
 * workflow step must run only on main after a real deploy (never from a laptop, never on a skipped run).
 *
 * @mutate scripts/indexnow-ping.mjs |       return x.protocol === "https:" && x.host === INDEXNOW_HOST; |       return true;
 * @mutate .github/workflows/prod-deploy.yml | steps.run.outputs.action == 'deploy' }} | true }}
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { INDEXNOW_HOST, INDEXNOW_KEY, indexNowBodies, sitemapUrls } from "../../scripts/indexnow-ping.mjs";

const ROOT = resolve(__dirname, "..", "..");

describe("IndexNow ping", () => {
  it("the key file is public/<key>.txt and holds exactly the key", () => {
    expect(INDEXNOW_KEY).toMatch(/^[a-f0-9]{32}$/);
    expect(readFileSync(resolve(ROOT, "public", `${INDEXNOW_KEY}.txt`), "utf8").trim()).toBe(INDEXNOW_KEY);
  });

  it("sends the sitemap's own URLs only, with the key and its location", () => {
    const xml = readFileSync(resolve(ROOT, "public/sitemap.xml"), "utf8");
    const urls = sitemapUrls(xml);
    expect(urls.length).toBeGreaterThan(69); // 111 on 2026-11-20; 77 on 2026-11-21 (owner 11-21: only Her, Him and Kids guides live); 70 on 2026-11-22 (guides audit 1122 #1/#7: the relationship pages 301 to Her/Him and /shop-small to Small Business Saturday)
    expect(urls).toContain("https://www.louisianahelpr.com/gift-guides/her");
    expect(urls).not.toContain("https://www.louisianahelpr.com/gift-guides/mom"); // owner 11-21: Mom 301s to Her
    expect(sitemapUrls("<loc>https://evil.example/x</loc><loc>http://www.louisianahelpr.com/y</loc>")).toEqual([]);
    const [body] = indexNowBodies(urls);
    expect(body).toMatchObject({ host: INDEXNOW_HOST, key: INDEXNOW_KEY, keyLocation: `https://${INDEXNOW_HOST}/${INDEXNOW_KEY}.txt` });
    expect(body.urlList).toEqual(urls);
  });

  it("prod-deploy.yml runs it only on main, after a real deploy, and it can never fail the deploy", () => {
    const wf = readFileSync(resolve(ROOT, ".github/workflows/prod-deploy.yml"), "utf8");
    const step = wf.slice(wf.indexOf("- name: IndexNow ping"), wf.indexOf("- name: Summary"));
    expect(step).toContain("run: node scripts/indexnow-ping.mjs");
    expect(step).toContain("github.ref == 'refs/heads/main'");
    expect(step).toContain("steps.run.outputs.action == 'deploy'");
    expect(step).toContain("continue-on-error: true");
  });
});
