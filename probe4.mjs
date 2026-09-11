import { chromium } from "playwright";
const b = await chromium.launch({ headless: true });
const page = await b.newPage();
page.on("response", (r) => { if (r.status() >= 400) console.log(r.status(), r.url()); });
await page.goto("http://localhost:4205/admin", { waitUntil: "networkidle" });
await b.close();
