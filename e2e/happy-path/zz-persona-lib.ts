/* Throwaway persona-walk harness (uncommitted scratch — not a suite contract). */
import type { Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { findErrorScreen } from "../errorScreens";

export const OUT = "/private/tmp/claude-501/-Users-lexilombas-louisianahelpr/bc11eaf8-ad26-4f66-aa56-bbea85bb0e86/scratchpad/shots";

export class Walk {
  n = 0;
  log: string[] = [];
  constructor(readonly page: Page, readonly persona: string) {
    mkdirSync(`${OUT}/${persona}`, { recursive: true });
  }
  async step(name: string, act?: (p: Page) => Promise<void>, opts: { full?: boolean; settle?: number } = {}) {
    let actErr = "";
    if (act) {
      try { await act(this.page); } catch (e) {
        // Recorded into the step report as ACTION_ERROR — a failed tap IS the observation, not a failure to hide.
        actErr = String(e).split("\n")[0];
      }
    }
    await this.page.waitForTimeout(opts.settle ?? 1200);
    this.n++;
    const id = `${String(this.n).padStart(2, "0")}-${name}`;
    const dir = `${OUT}/${this.persona}`;
    await this.page.screenshot({ path: `${dir}/${id}.png`, fullPage: !!opts.full }).catch(() => {});
    const text = await this.page.evaluate(() => document.body.innerText).catch(() => "");
    const stuck = await this.page.evaluate(() => {
      const t = (document.body?.innerText ?? "").trim();
      if (t.length < 20) return `blank page (${t.length} chars)`;
      if (document.getElementById("boot-loader")) return "boot loader still showing";
      const busy = document.querySelectorAll('[aria-busy="true"]').length;
      const pulses = [...document.querySelectorAll('[class*="animate-pulse"]')].filter((e) => !e.closest("[aria-hidden='true']")).length;
      if (busy || pulses) return `still loading (${busy} aria-busy, ${pulses} pulses)`;
      return null;
    }).catch((e) => `eval failed ${e}`);
    const err = findErrorScreen(text);
    const controls = await this.page.evaluate(() => {
      const els = [...document.querySelectorAll('a,button,[role=button],[role=tab],input,select,textarea,[role=radio],[role=checkbox],[role=switch],[role=option],[role=menuitem]')] as HTMLElement[];
      return els.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; })
        .map((e) => {
          const r = e.getBoundingClientRect();
          const label = (e.getAttribute('aria-label') || e.innerText || (e as HTMLInputElement).placeholder || e.getAttribute('name') || '').trim().replace(/\s+/g, ' ').slice(0, 70);
          const t = (e as HTMLInputElement).type;
          return `${e.tagName.toLowerCase()}${e.getAttribute('role') ? '[' + e.getAttribute('role') + ']' : ''} "${label}" @${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}${e.getAttribute('href') ? ' -> ' + e.getAttribute('href') : ''}${t && e.tagName !== 'BUTTON' ? ' type=' + t : ''}${(e as HTMLButtonElement).disabled ? ' DISABLED' : ''}`;
        });
    }).catch(() => [] as string[]);
    const url = this.page.url();
    const hscroll = await this.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth).catch(() => 0);
    const report = `# ${id}\nURL: ${url}\nACTION_ERROR: ${actErr || '-'}\nSTUCK: ${stuck ?? '-'}\nERROR_SCREEN: ${err ? err.name + ' :: ' + err.excerpt : '-'}\nHSCROLL: ${hscroll}\n\n## TEXT\n${text}\n\n## CONTROLS\n${controls.join('\n')}\n`;
    writeFileSync(`${dir}/${id}.txt`, report);
    this.log.push(`${id} url=${url} stuck=${stuck ?? '-'} err=${err?.name ?? '-'} actErr=${actErr || '-'}`);
    return { text, controls, url, err, stuck };
  }
  done() { writeFileSync(`${OUT}/${this.persona}/_log.txt`, this.log.join('\n')); }
}
