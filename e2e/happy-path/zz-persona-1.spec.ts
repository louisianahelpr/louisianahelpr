import { test, installSupabaseMocks, seedAuthedSession, FAKE_CUSTOMER, FAKE_HELPER } from "./fixtures";
import { Walk } from "./zz-persona-lib";
test.setTimeout(400_000);

test("guest: post a job tap", async ({ page }) => {
  await installSupabaseMocks(page, {});
  const w = new Walk(page, "p1");
  await page.goto("/");
  await w.step("landing", undefined, { settle: 2000 });
  await w.step("tap-post-a-job", async (p) => { await p.getByRole("link", { name: /post a job/i }).first().click().catch(async () => p.getByRole("button", { name: /post a job/i }).first().click()); }, { settle: 2500 });
  await w.step("after-post-tap-full", undefined, { full: true });
  await w.step("tap-get-started", async (p) => { await p.goto("/"); await p.getByRole("link", { name: /get started/i }).first().click(); }, { settle: 2500 });
  await w.step("get-started-full", undefined, { full: true });
  w.done();
});

test("guest: browse jobs tap", async ({ page }) => {
  await installSupabaseMocks(page, { seed: true });
  const w = new Walk(page, "p2");
  await page.goto("/");
  await w.step("tap-browse-jobs", async (p) => { await p.getByRole("link", { name: /browse jobs/i }).first().click(); }, { settle: 3000 });
  await w.step("browse-full", undefined, { full: true });
  w.done();
});

test("authed customer: orientation dumps", async ({ context, page, baseURL }) => {
  await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
  await installSupabaseMocks(page, { user: FAKE_CUSTOMER, seed: true });
  const w = new Walk(page, "cust");
  await page.goto("/dashboard");
  await w.step("dashboard", undefined, { settle: 3000 });
  await w.step("dashboard-full", undefined, { full: true });
  for (const r of ["/post-job", "/my-posts", "/messages", "/activity", "/profile", "/settings", "/browse"]) {
    await w.step(r.slice(1).replace(/\W/g, "-"), async (p) => { await p.goto(r); }, { settle: 3000, full: true });
  }
  w.done();
});

test("authed helper: orientation dumps", async ({ context, page, baseURL }) => {
  await seedAuthedSession(context, FAKE_HELPER, baseURL ?? "");
  await installSupabaseMocks(page, { user: FAKE_HELPER, seed: true });
  const w = new Walk(page, "help");
  await page.goto("/dashboard");
  await w.step("dashboard", undefined, { settle: 3000 });
  await w.step("dashboard-full", undefined, { full: true });
  for (const r of ["/my-jobs", "/activity", "/messages", "/profile", "/profile?tab=earnings", "/profile?tab=payment", "/profile?tab=accessibility"]) {
    await w.step(r.slice(1).replace(/\W/g, "-"), async (p) => { await p.goto(r); }, { settle: 3000, full: true });
  }
  w.done();
});
