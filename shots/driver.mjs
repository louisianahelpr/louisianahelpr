// Persistent driver: node driver.mjs <who> <port> [phone|desktop] [light|dark] [deny]
// Then: curl -s localhost:<port> --data-binary @- <<< 'await page.goto(...); return await measure(page)'
import http from "node:http";
import { launch, VP, measure, shoot, goto, report, BASE, SHOTS } from "./lib.mjs";
const [who, port = "4310", vp = "phone", theme = "light", geo = "grant"] = process.argv.slice(2);
const ctx = await launch({ who: who === "guest" ? null : who, viewport: VP[vp], theme, headless: process.env.HEADLESS === "1", geo });
const { page, errors, context, browser } = ctx;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    try {
      const fn = new AsyncFunction("page", "context", "browser", "errors", "measure", "shoot", "goto", "report", "BASE", "SHOTS", body);
      const out = await fn(page, context, browser, errors, measure, shoot, goto, report, BASE, SHOTS);
      res.end(typeof out === "string" ? out : JSON.stringify(out, null, 1) ?? "ok");
    } catch (e) { res.statusCode = 500; res.end("ERR " + (e.stack || e)); }
  });
}).listen(Number(port), () => console.log(`driver ${who} on ${port}`));
