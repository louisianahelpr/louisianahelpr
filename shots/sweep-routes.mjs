import { launch, VP, measure, shoot, goto, report } from "./lib.mjs";

const routes = [
  "/dashboard", "/my-jobs", "/profile",
  ...["earnings", "availability", "credentials", "work_record", "reviews", "referral", "wrapped", "pets", "home_history",
    "accessibility", "security", "notifications", "subscription", "schedule", "analytics", "auto_tip", "str_settings", "warnings", "support", "legal", "privacy"]
    .map((t) => `/profile?tab=${t}`),
];
const who = process.argv[2] || "helper";
const only = process.argv[3];
for (const vpName of ["phone", "desktop"]) {
  for (const theme of ["light", "dark"]) {
    if (only && !`${vpName}-${theme}`.includes(only)) continue;
    const { browser, page, errors } = await launch({ who, viewport: VP[vpName], theme, headless: process.env.HEADLESS === "1" });
    for (const r of routes) {
      const name = `${who}-${vpName}-${theme}-${r.replace(/[^a-z_]+/g, "_").replace(/^_|_$/g, "") || "root"}`;
      try {
        await goto(page, r, { wait: 5000 });
        const m = await measure(page);
        await shoot(page, name);
        report(name, m, errors);
      } catch (e) { console.log(`!! ${name} THREW ${String(e).slice(0, 200)}`); }
    }
    await browser.close();
  }
}
