#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const removeIfExists = (targetPath) => {
  if (!fs.existsSync(targetPath)) return false;
  fs.rmSync(targetPath, { recursive: true, force: true });
  return true;
};

let removed = 0;

if (process.platform === "darwin") {
  const derivedDataRoot = path.join(os.homedir(), "Library/Developer/Xcode/DerivedData");
  if (fs.existsSync(derivedDataRoot)) {
    for (const entry of fs.readdirSync(derivedDataRoot)) {
      if (entry === "App" || entry.startsWith("App-")) {
        removed += removeIfExists(path.join(derivedDataRoot, entry)) ? 1 : 0;
      }
    }
  }
}

for (const relativePath of [
  "ios/App/.build",
  "ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm",
  "ios/App/App.xcodeproj/xcuserdata",
  "ios/App/App.xcodeproj/project.xcworkspace/xcuserdata",
  "ios/App/App.xcworkspace/xcuserdata",
]) {
  removed += removeIfExists(path.join(repoRoot, relativePath)) ? 1 : 0;
}

console.log(removed ? `Cleared ${removed} stale Xcode cache folder(s).` : "No stale Xcode cache folders found.");