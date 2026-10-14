/*
 * CLASS CHECK — every Swift file in the iOS app folder is COMPILED into the App
 * target, and every local Capacitor plugin in it is REGISTERED with the bridge.
 *
 * THE BUG (measured 2026-10-13 on 1.0.4 build 7119, commit c16b0f0dc):
 * ios/App/App/BackgroundLocationPlugin.swift sat on disk but was not in the App
 * target (0 hits in project.pbxproj, 0 hits from `strings` on the archived
 * binary), and Main.storyboard used the stock CAPBridgeViewController, so
 * nothing registered it. `BackgroundLocation` answered UNIMPLEMENTED and the
 * en-route tracker fell back to a foreground-only watch, while Info.plist
 * declared UIBackgroundModes=[location] and promised sharing "when your screen
 * is off". No compiler, linter or test noticed: a file Xcode does not list is
 * simply not built, and a local plugin Capacitor is not told about simply does
 * not exist at runtime (packageClassList only names npm plugin packages).
 *
 * THE CHECKS, built from the app's own inventory (every .swift file under
 * ios/App/App, every CAPPlugin subclass declared in them):
 *  1. each .swift file has a PBXFileReference, a PBXBuildFile for it, and that
 *     build file is in the Sources phase of the "App" native target;
 *  2. Main.storyboard's initial view controller is a class declared in those
 *     files that subclasses CAPBridgeViewController, and is resolvable by the
 *     storyboard (an explicit @objc(Name), since the target's module is
 *     "Louisiana_Helpr", not "App");
 *  3. that class's capacitorDidLoad() calls registerPluginInstance(<Plugin>())
 *     for EVERY local CAPPlugin subclass;
 *  4. each local plugin's jsName is the name src/ passes to registerPlugin, and
 *     each method it lists in pluginMethods has an @objc func of that name.
 */
// @mutate ios/App/App.xcodeproj/project.pbxproj | 0A1B2C3D4E5F600000000011 /* BackgroundLocationPlugin.swift in Sources */, | /* removed from Sources */
// @mutate ios/App/App/HelprBridgeViewController.swift | bridge?.registerPluginInstance(BackgroundLocationPlugin()) | _ = BackgroundLocationPlugin.self
// @mutate ios/App/App/Base.lproj/Main.storyboard | customClass="HelprBridgeViewController" | customClass="CAPBridgeViewController" customModule="Capacitor"
import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { readdirSync, trackedFiles } from "./helpers/trackedFiles";

const REPO = resolve(__dirname, "..", "..");
const APP_DIR = join(REPO, "ios/App/App");
const PBXPROJ = readFileSync(join(REPO, "ios/App/App.xcodeproj/project.pbxproj"), "utf8");
const STORYBOARD = readFileSync(join(APP_DIR, "Base.lproj/Main.storyboard"), "utf8");

/** Every .swift file under ios/App/App (the synced web bundle `public/` holds none). */
function swiftFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "public") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...swiftFiles(p));
    else if (name.endsWith(".swift")) out.push(p);
  }
  return out.sort();
}

const SWIFT = swiftFiles(APP_DIR).map((path) => ({
  path,
  name: basename(path),
  code: blankComments(readFileSync(path, "utf8")),
}));

/** The `files = ( ... )` ids of the App target's Sources build phase. */
function appTargetSourceIds(): Set<string> {
  // Each native target is one `isa = PBXNativeTarget;` block ending at its
  // productType line; take the one named App.
  const blocks = [...PBXPROJ.matchAll(/isa = PBXNativeTarget;([\s\S]*?)productType = /g)].map((m) => m[1]);
  const app = blocks.find((b) => /\n\s*name = App;/.test(b));
  const phases = app?.match(/buildPhases = \(([\s\S]*?)\);/);
  if (!phases) return new Set();
  const phaseIds = [...phases[1].matchAll(/([0-9A-F]{24})/g)].map((m) => m[1]);
  for (const id of phaseIds) {
    const phase = PBXPROJ.match(new RegExp(`${id}[^=\\n]*= \\{\\s*isa = PBXSourcesBuildPhase;[\\s\\S]*?files = \\(([\\s\\S]*?)\\);`));
    if (phase) return new Set([...phase[1].matchAll(/([0-9A-F]{24})/g)].map((m) => m[1]));
  }
  return new Set();
}

/** Is `fileName` compiled by the App target? Follows fileRef -> buildFile -> Sources phase by id. */
function compiledByApp(fileName: string, sources: Set<string>): boolean {
  const esc = fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const refIds = [...PBXPROJ.matchAll(new RegExp(`([0-9A-F]{24})[^=\\n]*= \\{isa = PBXFileReference;[^}]*\\bpath = "?${esc}"?;`, "g"))].map((m) => m[1]);
  for (const ref of refIds) {
    const builds = [...PBXPROJ.matchAll(new RegExp(`([0-9A-F]{24})[^=\\n]*= \\{isa = PBXBuildFile; fileRef = ${ref}\\b`, "g"))].map((m) => m[1]);
    if (builds.some((b) => sources.has(b))) return true;
  }
  return false;
}

/** Body of `func <name>(` in `code`, by brace matching (comments already blanked). */
function funcBody(code: string, name: string): string {
  const start = code.search(new RegExp(`func ${name}\\s*\\(`));
  if (start < 0) return "";
  const open = code.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}" && --depth === 0) return code.slice(open + 1, i);
  }
  return "";
}

const LOCAL_PLUGINS = SWIFT.flatMap((f) =>
  [...f.code.matchAll(/class\s+(\w+)\s*:\s*CAPPlugin\b/g)].map((m) => ({ cls: m[1], file: f })),
);

describe("every Swift file in ios/App/App is compiled into the App target", () => {
  const sources = appTargetSourceIds();

  it("finds the inventory (Swift files and the App target's Sources phase)", () => {
    expect(SWIFT.length).toBeGreaterThan(1);
    expect(sources.size).toBeGreaterThan(0);
  });

  it("lists each one in the App target's Sources build phase", () => {
    const missing = SWIFT.filter((f) => !compiledByApp(f.name, sources)).map((f) => f.name);
    expect(missing, "on disk but not built into the app: add each to project.pbxproj (file ref, build file, App group, Sources phase)").toEqual([]);
  });
});

describe("every local Capacitor plugin is registered with the bridge", () => {
  it("finds the local plugins", () => {
    expect(LOCAL_PLUGINS.length).toBeGreaterThan(0);
  });

  const initial = STORYBOARD.match(/initialViewController="([^"]+)"/)?.[1] ?? "";
  const vcTag = STORYBOARD.match(new RegExp(`<viewController[^>]*\\bid="${initial}"[^>]*>`))?.[0] ?? "";
  const customClass = vcTag.match(/customClass="(\w+)"/)?.[1] ?? "";
  const customModule = vcTag.match(/customModule="(\w+)"/)?.[1] ?? null;
  const vcFile = SWIFT.find((f) => new RegExp(`class\\s+${customClass}\\s*:\\s*CAPBridgeViewController\\b`).test(f.code));

  it("Main.storyboard's root view controller is the app's own CAPBridgeViewController subclass", () => {
    expect(customClass, "initial view controller has no customClass").not.toBe("");
    expect(vcFile, `${customClass} is not declared as a CAPBridgeViewController subclass in ios/App/App`).toBeDefined();
    // Resolvable without a module prefix only through an explicit ObjC name.
    if (customModule === null) {
      expect(vcFile!.code).toMatch(new RegExp(`@objc\\(${customClass}\\)\\s*(?:\\w+\\s+)*class\\s+${customClass}\\b`));
    }
  });

  it("registers every local plugin in capacitorDidLoad()", () => {
    const body = vcFile ? funcBody(vcFile.code, "capacitorDidLoad") : "";
    const unregistered = LOCAL_PLUGINS.filter(
      (p) => !new RegExp(`registerPluginInstance\\(\\s*${p.cls}\\s*\\(`).test(body),
    ).map((p) => p.cls);
    expect(unregistered, "local CAPPlugin classes nobody registers (Capacitor will answer UNIMPLEMENTED)").toEqual([]);
  });

  it("each plugin's jsName is the name src/ registers, and every listed method exists", () => {
    const srcCode = trackedFiles("src")
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))
      .map((f) => blankComments(readFileSync(join(REPO, f), "utf8")))
      .join("\n");
    for (const p of LOCAL_PLUGINS) {
      const jsName = p.file.code.match(/jsName\s*=\s*"(\w+)"/)?.[1];
      expect(jsName, `${p.cls} declares no jsName`).toBeDefined();
      expect(srcCode, `${p.cls}.jsName "${jsName}" is never passed to registerPlugin in src/`).toMatch(
        new RegExp(`registerPlugin\\s*(?:<[^>]*>)?\\s*\\(\\s*"${jsName}"`),
      );
      const methods = [...p.file.code.matchAll(/CAPPluginMethod\([^)]*\bname:\s*"(\w+)"|\.init\(\s*name:\s*"(\w+)"/g)].map((m) => m[1] ?? m[2]);
      expect(methods.length).toBeGreaterThan(0);
      for (const m of methods) {
        expect(p.file.code, `${p.cls} lists "${m}" in pluginMethods but has no @objc func ${m}`).toMatch(
          new RegExp(`@objc\\s+func\\s+${m}\\s*\\(`),
        );
      }
    }
  });
});
