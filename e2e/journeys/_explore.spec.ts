import { writeFileSync, mkdirSync } from "node:fs";
import { test, getSession, newUserContext } from "./fixtures";

// Development aid (not a journey): screenshot + aria snapshot of routes per role.
// EXPLORE_PLAN="guest:/browse;poster:/post-job,/my-posts"
const OUT = process.env.EXPLORE_OUT || "test-results/explore";
const PLAN = process.env.EXPLORE_PLAN || "guest:/browse";

test("explore", async ({ browser, request }) => {
  test.skip(!process.env.EXPLORE_PLAN, "development aid only");
  test.setTimeout(20 * 60_000);
  mkdirSync(OUT, { recursive: true });
  for (const part of PLAN.split(";")) {
    const [role, routes] = part.split(":");
    const s = role === "guest" ? null : await getSession(request, role as "poster" | "helper");
    const ctx = await newUserContext(browser, s);
    const page = await ctx.newPage();
    for (const r of routes.split(",")) {
      await page.goto(r);
      await page.waitForTimeout(7000);
      const name = `${role}${r.replace(/[^a-z0-9]+/gi, "_")}`;
      await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
      writeFileSync(`${OUT}/${name}.txt`, `${page.url()}\n` + (await page.locator("body").ariaSnapshot()));
    }
    await ctx.close();
  }
});
