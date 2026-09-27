/**
 * CLASS GUARD (Q54): every upload site checks the file's MIME type against a
 * list that sits inside its bucket's `allowed_mime_types`, and every file
 * picker offers only types that bucket takes.
 *
 * WHY. Supabase Storage refuses any type outside a bucket's
 * `allowed_mime_types`, matched literally (parameters included). Eight upload
 * sites had no client type check at all, so a GIF on a proof photo or a Word
 * document on an application attachment (the picker offered `.doc,.docx` over
 * a bucket that takes none) failed with a raw storage error; the voice
 * recorder could pick an audio format the bucket then refused.
 *
 * HOW, derived both ways from source:
 *   bucket MIME lists <- supabase/migrations replayed in order
 *                        (computeState in storageBucketLimits.test.ts)
 *   upload sites      <- every non-test file under src/ whose code (comments
 *                        blanked) calls `.upload(`; each must be in SITES and
 *                        every SITES file must still upload.
 *   pickers           <- every non-test file with an `accept=` attribute; each
 *                        must be in PICKERS and every PICKERS file must still
 *                        carry one.
 * For each site: its gate list (read from source) is a subset of the bucket's
 * list, the site's code uses the gate (not just imports it), and it names the
 * bucket. For each picker: every explicit type is in the bucket's list and
 * every `x/*` wildcard matches at least one type the bucket takes.
 */
// @mutate src/lib/uploadTypes.ts | export const PROOF_PHOTO_TYPES: readonly string[] = ["image/jpeg", "image/png", "image/webp", "image/heic"]; | export const PROOF_PHOTO_TYPES: readonly string[] = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/gif"];
// @mutate src/components/DisputeDialog.tsx | if (!isAllowedUploadType(f, PROOF_PHOTO_TYPES)) { | if (!f) {
// @mutate src/pages/jobs/appliedJobCard/PendingApplicationSection.tsx | accept="image/*,application/pdf" | accept="image/*,.pdf,.doc,.docx"
// @mutate src/lib/messageAttachments.ts | ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg"] | ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg", "audio/wav"]
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { computeState } from "./storageBucketLimits.test";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

function listSrc(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e === "test" || e === "__tests__") continue;
      out.push(...listSrc(p));
    } else if (/\.(?:ts|tsx)$/.test(e) && !/\.(?:test|spec)\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

type Site = {
  file: string;
  bucket: string;
  /** [file declaring the list, const name]. */
  gate: [string, string];
  /** Names the site's code must use (outside import lines). */
  via: string[];
  /** File that holds the bucket id literal, when not the site itself. */
  bucketSrc?: string;
};

const UT = "src/lib/uploadTypes.ts";
const SITES: Site[] = [
  { file: "src/components/DisputeDialog.tsx", bucket: "proof-photos", gate: [UT, "PROOF_PHOTO_TYPES"], via: ["isAllowedUploadType", "PROOF_PHOTO_TYPES"] },
  { file: "src/components/DisputeTimelineDialog.tsx", bucket: "proof-photos", gate: [UT, "PROOF_PHOTO_TYPES"], via: ["isAllowedUploadType", "PROOF_PHOTO_TYPES"] },
  { file: "src/components/PhotoProof.tsx", bucket: "proof-photos", gate: [UT, "PROOF_PHOTO_TYPES"], via: ["isAllowedUploadType", "PROOF_PHOTO_TYPES"] },
  { file: "src/pages/posts/CompletionChoiceSheet.tsx", bucket: "proof-photos", gate: [UT, "PROOF_PHOTO_TYPES"], via: ["isAllowedUploadType", "PROOF_PHOTO_TYPES"] },
  { file: "src/components/reviewPanel/ReviewForm.tsx", bucket: "job-photos", gate: [UT, "REVIEW_PHOTO_TYPES"], via: ["isAllowedUploadType", "REVIEW_PHOTO_TYPES"] },
  { file: "src/components/profile/SupportInline.tsx", bucket: "user-documents", gate: [UT, "SUPPORT_SCREENSHOT_TYPES"], via: ["isAllowedUploadType", "SUPPORT_SCREENSHOT_TYPES"] },
  { file: "src/pages/jobs/AppliedJobsTab.tsx", bucket: "application-attachments", gate: [UT, "APPLICATION_ATTACHMENT_TYPES"], via: ["isAllowedUploadType", "APPLICATION_ATTACHMENT_TYPES"] },
  { file: "src/pages/home/useApplyFlow.ts", bucket: "application-attachments", gate: [UT, "APPLICATION_ATTACHMENT_TYPES"], via: ["isAllowedUploadType", "APPLICATION_ATTACHMENT_TYPES"] },
  { file: "src/components/profile/CredentialsTab.tsx", bucket: "user-documents", gate: ["src/components/profile/CredentialsTab.tsx", "ALLOWED_TYPES"], via: ["ALLOWED_TYPES"] },
  { file: "src/lib/messageAttachments.ts", bucket: "message-attachments", gate: ["src/lib/messageAttachments.ts", "MESSAGE_ATTACHMENT_MIME_WHITELIST"], via: ["MESSAGE_ATTACHMENT_MIME_WHITELIST"] },
  { file: "src/lib/messageAttachments.ts", bucket: "message-attachments", gate: ["src/lib/messageAttachments.ts", "VOICE_NOTE_MIME_TYPES"], via: ["VOICE_NOTE_MIME_TYPES"] },
  { file: "src/lib/avatarStorage.ts", bucket: "avatars", gate: ["src/lib/avatarStorage.ts", "AVATAR_MIME_EXT"], via: ["AVATAR_MIME_EXT"] },
  { file: "src/lib/portfolioStorage.ts", bucket: "avatars", gate: ["src/lib/avatarStorage.ts", "AVATAR_MIME_EXT"], via: ["PORTFOLIO_MIME_EXT"] },
  { file: "src/components/admin/marketing/marketingMedia.ts", bucket: "marketing-media", gate: ["src/components/admin/marketing/marketingMedia.ts", "MARKETING_MEDIA_MIME_EXT"], via: ["MARKETING_MEDIA_MIME_EXT"] },
  { file: "src/pages/post-job/useJobMediaUpload.ts", bucket: "job-photos", gate: ["src/pages/post-job/useJobMediaUpload.ts", "allowedImageTypes"], via: ["allowedImageTypes"] },
  { file: "src/pages/post-job/useJobMediaUpload.ts", bucket: "job-photos", gate: ["src/lib/scopeVideo.ts", "SCOPE_VIDEO_TYPES"], via: ["scopeVideoFileProblem", "SCOPE_VIDEO_BUCKET"], bucketSrc: "src/lib/scopeVideo.ts" },
];

/** Picker file -> the bucket its chosen files go to (and where an accept={CONST} is declared). */
const PICKERS: Record<string, { bucket: string; constSrc?: string }> = {
  "src/components/DisputeDialog.tsx": { bucket: "proof-photos" },
  "src/components/DisputeTimelineDialog.tsx": { bucket: "proof-photos" },
  "src/components/PhotoProof.tsx": { bucket: "proof-photos" },
  "src/pages/posts/CompletionChoiceSheet.tsx": { bucket: "proof-photos" },
  "src/components/reviewPanel/ReviewForm.tsx": { bucket: "job-photos" },
  "src/components/profile/SupportInline.tsx": { bucket: "user-documents" },
  "src/pages/jobs/appliedJobCard/PendingApplicationSection.tsx": { bucket: "application-attachments" },
  "src/components/RichMessageInput.tsx": { bucket: "message-attachments" },
  "src/components/profile/CredentialsTab.tsx": { bucket: "user-documents" },
  "src/components/profile/profileEditForm/PhotoNameSection.tsx": { bucket: "avatars" },
  "src/components/profile/profileEditForm/RecentWorkSection.tsx": { bucket: "avatars" },
  "src/pages/auth/signup/SignupStep2.tsx": { bucket: "avatars" },
  "src/pages/auth/CompleteProfile.tsx": { bucket: "avatars" },
  "src/components/postjob/detailsSection/PhotoUpload.tsx": { bucket: "job-photos" },
  "src/components/postjob/detailsSection/VideoScope.tsx": { bucket: "job-photos" },
  "src/components/admin/marketing/MarketingComposerDialog.tsx": {
    bucket: "marketing-media",
    constSrc: "src/components/admin/marketing/marketingMedia.ts",
  },
};

const MIME_RE = /^[a-z]+\/[a-z0-9.+-]+(?:;[^"'`]*)?$/;

/** The MIME strings in `const NAME ... = <bracketed literal>` (Record keys, arrays, Set args). */
export function gateList(text: string, name: string): string[] {
  const code = blankComments(text);
  const decl = new RegExp(`\\bconst\\s+${name}\\b`).exec(code);
  if (!decl) return [];
  const eq = code.indexOf("=", decl.index);
  let i = eq + 1;
  while (i < code.length && !"[{(".includes(code[i])) i++;
  let depth = 0;
  let end = i;
  for (; end < code.length; end++) {
    if ("[{(".includes(code[end])) depth++;
    else if ("]})".includes(code[end]) && --depth === 0) break;
  }
  return [...code.slice(i, end + 1).matchAll(/["'`]([^"'`]+)["'`]/g)].map((m) => m[1]).filter((s) => MIME_RE.test(s));
}

/** Code with comments blanked and import statements removed. */
const bodyOf = (text: string) => blankComments(text).replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];?/gm, "");

/** Problems with one site: names it must use but does not. */
export function siteProblems(text: string, via: string[]): string[] {
  const body = bodyOf(text);
  return via.filter((v) => !new RegExp(`\\b${v}\\b`).test(body)).map((v) => `never uses ${v}`);
}

/** Types in the list that the bucket does not take. */
export function outsideBucket(list: readonly string[], bucketMime: readonly string[]): string[] {
  return list.filter((t) => !bucketMime.includes(t));
}

const EXT_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".gif": "image/gif",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/** Problems with one accept value against the bucket's list. */
export function acceptProblems(accept: string, bucketMime: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of accept.split(",").map((t) => t.trim()).filter(Boolean)) {
    if (raw.endsWith("/*")) {
      const fam = raw.slice(0, -1);
      if (!bucketMime.some((m) => m.startsWith(fam))) out.push(`${raw}: bucket takes no ${fam}*`);
      continue;
    }
    const mime = raw.startsWith(".") ? EXT_MIME[raw] : raw;
    if (!mime) out.push(`${raw}: unmapped extension`);
    else if (!bucketMime.includes(mime)) out.push(`${raw}: bucket refuses ${mime}`);
  }
  return out;
}

/** Every accept value in a file: literals, plus accept={CONST} resolved in constSrc. */
function acceptsIn(text: string, constSrc?: string): string[] {
  const code = blankComments(text);
  const vals = [...code.matchAll(/\baccept="([^"]*)"/g)].map((m) => m[1]);
  for (const m of code.matchAll(/\baccept=\{([A-Z_][A-Z0-9_]*)\}/g)) {
    const src = blankComments(constSrc ? read(constSrc) : text);
    const def = new RegExp(`\\bconst\\s+${m[1]}\\s*=\\s*"([^"]*)"`).exec(src);
    vals.push(def ? def[1] : `<unresolved ${m[1]}>`);
  }
  return vals;
}

describe("upload MIME types stay inside their bucket's allowed_mime_types (Q54)", () => {
  const state = computeState();
  const mimeOf = (b: string) => state.get(b)?.mime ?? [];
  const files = listSrc(join(ROOT, "src")).map((f) => relative(ROOT, f).split("\\").join("/"));
  const uploaders = files.filter((f) => /\.upload\(/.test(blankComments(read(f))));
  const pickerFiles = files.filter((f) => /\baccept=["{]/.test(blankComments(read(f))));

  it("finds the buckets' MIME lists, the sites and the pickers (cannot pass vacuously)", () => {
    expect(mimeOf("proof-photos")).toEqual(["image/jpeg", "image/png", "image/webp", "image/heic"]);
    expect(mimeOf("message-attachments")).toContain("audio/webm;codecs=opus");
    expect(new Set(SITES.map((s) => s.bucket)).size).toBeGreaterThanOrEqual(7);
    expect(uploaders.length).toBeGreaterThanOrEqual(14);
    expect(pickerFiles.length).toBeGreaterThanOrEqual(16);
    for (const s of SITES) expect(gateList(read(s.gate[0]), s.gate[1]).length, `${s.gate[1]} read empty`).toBeGreaterThan(0);
  });

  it("every uploading file is a registered site, and every site still uploads", () => {
    const registered = new Set(SITES.map((s) => s.file));
    expect(uploaders.filter((f) => !registered.has(f)), "upload sites with no MIME gate registered").toEqual([]);
    expect([...registered].filter((f) => !uploaders.includes(f)), "registered sites that no longer upload").toEqual([]);
  });

  it("every site's gate list is inside its bucket, used by the site, and the site names the bucket", () => {
    const bad: string[] = [];
    for (const s of SITES) {
      const list = gateList(read(s.gate[0]), s.gate[1]);
      for (const t of outsideBucket(list, mimeOf(s.bucket))) bad.push(`${s.file}: ${s.gate[1]} has ${t}, which ${s.bucket} refuses`);
      for (const p of siteProblems(read(s.file), s.via)) bad.push(`${s.file}: ${p}`);
      const bsrc = blankComments(read(s.bucketSrc ?? s.file));
      if (!bsrc.includes(`"${s.bucket}"`)) bad.push(`${s.file}: bucket "${s.bucket}" not named in ${s.bucketSrc ?? s.file}`);
    }
    expect(bad).toEqual([]);
  });

  it("every picker is registered, and offers only types its bucket takes", () => {
    expect(pickerFiles.filter((f) => !PICKERS[f]), "pickers with no bucket registered").toEqual([]);
    expect(Object.keys(PICKERS).filter((f) => !pickerFiles.includes(f)), "registered pickers with no accept=").toEqual([]);
    const bad: string[] = [];
    for (const [file, { bucket, constSrc }] of Object.entries(PICKERS)) {
      for (const a of acceptsIn(read(file), constSrc)) for (const p of acceptProblems(a, mimeOf(bucket))) bad.push(`${file}: ${p}`);
    }
    expect(bad).toEqual([]);
  });

  it("is RED on the original defects", () => {
    const aa = mimeOf("application-attachments");
    // The picker that offered Word documents over a bucket that takes none.
    expect(acceptProblems("image/*,.pdf,.doc,.docx", aa)).toHaveLength(2);
    // A gate list that lets a GIF through to proof-photos.
    expect(outsideBucket(["image/jpeg", "image/gif"], mimeOf("proof-photos"))).toEqual(["image/gif"]);
    // A dispute dialog that imports the list but never checks a file against it.
    const ungated = `import { PROOF_PHOTO_TYPES, isAllowedUploadType } from "@/lib/uploadTypes";\nconst ok = files.filter((f) => f.size < MAX);`;
    expect(siteProblems(ungated, ["isAllowedUploadType", "PROOF_PHOTO_TYPES"])).toHaveLength(2);
    // A voice format the bucket does not list literally.
    expect(outsideBucket(["audio/wav"], mimeOf("message-attachments"))).toEqual(["audio/wav"]);
  });
});
