import { launch, ctx, goto } from './lib.mjs';
const b = await launch(true); const page = await ctx(b, 'm', 'light');
await goto(page, '/my-posts');
await page.getByRole('button', { name: 'Filter by status' }).click(); await page.waitForTimeout(500);
console.log(await page.evaluate(() => {
  const strip = document.getElementById('activity-status-tabs');
  const g = strip.firstElementChild;
  const out = { strip: [strip.clientWidth, strip.scrollWidth], group: getComputedStyle(g).gap, items: [] };
  for (const btn of g.children) { const r = btn.getBoundingClientRect(); const spans = [...btn.children].map(s => { const q = s.getBoundingClientRect(); return `${s.textContent}@${Math.round(q.left)}-${Math.round(q.right)} fs=${getComputedStyle(s).fontSize}`; }); out.items.push(`${Math.round(r.left)}-${Math.round(r.right)}: ${spans.join(' ')}`); }
  return out;
}));
await b.close();
