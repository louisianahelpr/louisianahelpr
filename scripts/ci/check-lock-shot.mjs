#!/usr/bin/env node
// Q1008 (11-05): judge the iOS device check's first screenshot from its OCR text (scripts/ci/ocr-png.swift on stdin).
// Run 42003643000 went GREEN on two shots of the update gate ("Update Helpr to continue · Installed build 7112 ·
// requires 7117"), so a green job proved nothing. Now shot 1 must show the lock (AppLockGate's "Louisiana Helpr is
// locked" / "You're still signed in", or the Face ID sheet itself) and must NOT show the update gate or the sign-in
// screen; anything else fails the job with the text it read. Guard: src/test/iosBiometricDeviceCheckIsSafe.test.ts.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const norm = (s) => s.replace(/[‘’]/g, "'").toLowerCase();

/** @param {string} text OCR text of shot 1. @returns {{ ok: boolean, why: string }} */
export function judgeLockShot(text) {
  const t = norm(text);
  if (/update helpr to continue/.test(t)) return { ok: false, why: "shot 1 is the update gate (ForceUpdateGate), not the lock" };
  if (/louisiana helpr is locked|you're still signed in|face id/.test(t)) return { ok: true, why: "shot 1 shows the lock" };
  return { ok: false, why: "shot 1 shows neither the lock screen nor the Face ID sheet" };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const text = readFileSync(0, "utf8");
  const v = judgeLockShot(text);
  if (!v.ok) {
    console.log(`::error::${v.why}. OCR read:\n${text}`);
    process.exit(1);
  }
  console.log(v.why);
}
