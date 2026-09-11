// Checklist probe: run in page, returns structured misses.
export async function checklist(page) {
  return page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && r.bottom > 0 && r.top < innerHeight; };
    const txt = (el) => (el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    const out = { fonts: [], italics: [], titles: [], smallTargets: [], flatPrimaries: [], boxInBox: [], clipped: [], overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
    const seen = new Set();
    for (const el of document.querySelectorAll('body *')) {
      if (!vis(el)) continue;
      const cs = getComputedStyle(el);
      const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
      if (hasText) {
        const fam = cs.fontFamily.toLowerCase();
        const isBodoni = fam.includes('bodoni'); const isMont = fam.includes('montserrat');
        if (!isBodoni && !isMont && !el.closest('[data-sonner-toaster]')) { const k = fam.slice(0, 30); if (!seen.has('f' + k)) { seen.add('f' + k); out.fonts.push(`${el.tagName} "${txt(el)}" ${fam.slice(0, 40)}`); } }
        if (cs.fontStyle === 'italic' && !isBodoni) out.italics.push(`${el.tagName} "${txt(el)}" ${fam.slice(0, 20)}`);
        if (/^H1$/.test(el.tagName) && !el.classList.contains('sr-only')) out.titles.push(`H1 "${txt(el)}" ${cs.fontSize} ${cs.fontWeight} ${fam.slice(0, 12)}`);
        if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && (cs.overflowX === 'hidden' || cs.overflowX === 'clip') && cs.textOverflow !== 'ellipsis' && el.children.length === 0 && !el.classList.contains('sr-only') && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') out.clipped.push(`${el.tagName} "${txt(el)}" sw=${el.scrollWidth} cw=${el.clientWidth}`);
      }
      if ((el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button') && !el.closest('[data-sonner-toaster]')) {
        const r = el.getBoundingClientRect();
        if ((r.height < 44 || r.width < 44) && !el.classList.contains('sr-only')) {
          // allow inline text links & tabs (row height counts via padding); flag icon-only + chips
          const iconOnly = !el.innerText.trim();
          if (iconOnly || r.height < 32) out.smallTargets.push(`${el.tagName} "${txt(el)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
        const bg = cs.backgroundImage; const bgc = cs.backgroundColor;
        const cls = el.className?.toString?.() || '';
        if (/btn-grad-primary/.test(cls) && !/gradient/.test(bg)) out.flatPrimaries.push(`${el.tagName} "${txt(el)}" bg-image=${bg.slice(0, 30)}`);
      }
      // box-in-box: bordered element whose only child is bordered and fills ≥85% of it
      const b = parseFloat(cs.borderTopWidth);
      if (b > 0 && el.children.length === 1) { const c = el.children[0]; const ccs = getComputedStyle(c); if (parseFloat(ccs.borderTopWidth) > 0 && vis(c)) { const rp = el.getBoundingClientRect(), rc = c.getBoundingClientRect(); if (rc.width / rp.width > 0.85 && rc.height / rp.height > 0.85 && rp.width > 120) out.boxInBox.push(`${el.tagName}.${(el.className||'').toString().slice(0,30)} > ${c.tagName} ${Math.round(rp.width)}x${Math.round(rp.height)}`); } }
    }
    out.italics = [...new Set(out.italics)].slice(0, 12); out.smallTargets = out.smallTargets.slice(0, 15); out.clipped = out.clipped.slice(0, 10); out.boxInBox = out.boxInBox.slice(0, 8);
    return out;
  });
}
