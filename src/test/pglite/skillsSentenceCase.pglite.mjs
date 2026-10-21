#!/usr/bin/env node
/**
 * PGlite proof for 20261021110324_skills_sentence_case.sql (lead ruling 2026-10-21).
 *
 *   node src/test/pglite/skillsSentenceCase.pglite.mjs                    # AFTER: applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/skillsSentenceCase.pglite.mjs # RED: without it
 *
 * Saved skill chips in Title Case become the sentence-case chip words; whole comma items only, case-sensitive,
 * "&" kept literally; free text and other members' words untouched; idempotent.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const FIX = readFileSync(new URL("../../../supabase/migrations/20261021110324_skills_sentence_case.sql", import.meta.url).pathname, "utf8");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: without the rewrite (expect FAILs)`);

const db = new PGlite();
await db.exec(`
  CREATE TABLE public.profiles (user_id int PRIMARY KEY, skills text);
  INSERT INTO public.profiles VALUES
    (1, 'Yard Work, Pet Care, Moving Help'),
    (2, 'Auto & Small Engine,Flooring & Tile'),
    (3, 'Yard Work and more, Cleaning'),
    (4, NULL),
    (5, 'Storm Prep'),
    (6, 'Yard work, Pressure washing');
`);
if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(FIX);

let fails = 0, n = 0;
const check = (name, ok, got) => { n++; if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  got ${JSON.stringify(got)}`}`); };
const skills = async (id) => (await db.query(`SELECT skills FROM public.profiles WHERE user_id = ${id}`)).rows[0].skills;
check("chip words become sentence case, spacing kept", (await skills(1)) === "Yard work, Pet care, Moving help", await skills(1));
check('"&" stays literal; no-space commas kept', (await skills(2)) === "Auto & small engine,Flooring & tile", await skills(2));
check("free text that merely contains a chip word is untouched", (await skills(3)) === "Yard Work and more, Cleaning", await skills(3));
check("NULL stays NULL", (await skills(4)) === null, await skills(4));
check("a single item is rewritten", (await skills(5)) === "Storm prep", await skills(5));
check("already sentence case: unchanged", (await skills(6)) === "Yard work, Pressure washing", await skills(6));
const before = JSON.stringify((await db.query(`SELECT * FROM public.profiles ORDER BY 1`)).rows);
await db.exec(FIX);
check("another run changes nothing", JSON.stringify((await db.query(`SELECT * FROM public.profiles ORDER BY 1`)).rows) === before);
console.log(`\n${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);
