#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const metadataPath = path.join(repoRoot, "fastlane/ios_app_metadata.yml");
const projectPath = path.join(repoRoot, "ios/App/App.xcodeproj/project.pbxproj");
const plistPath = path.join(repoRoot, "ios/App/App/Info.plist");
const capacitorTsPath = path.join(repoRoot, "capacitor.config.ts");
const capacitorJsonPath = path.join(repoRoot, "ios/App/App/capacitor.config.json");
const configXmlPath = path.join(repoRoot, "ios/App/App/config.xml");
const capAppPackagePath = path.join(repoRoot, "ios/App/CapApp-SPM/Package.swift");

const read = (relativeOrAbsolute) => fs.readFileSync(relativeOrAbsolute, "utf8");
const write = (relativeOrAbsolute, contents) => fs.writeFileSync(relativeOrAbsolute, contents);

const yaml = read(metadataPath);
const pick = (key) => {
  const match = yaml.match(new RegExp(`^\\s*${key}:\\s*["']?([^"'\\n]+)["']?\\s*$`, "m"));
  if (!match) throw new Error(`Missing ${key} in ${metadataPath}`);
  return match[1].trim();
};
const pickBool = (key) => pick(key) === "true";
// Reads a double-quoted single-line value from the permission_strings block.
// The standard pick() regex fails on strings containing apostrophes, so this
// uses a stricter double-quote-only pattern that captures the full value.
const pickPermission = (key) => {
  const match = yaml.match(new RegExp(`^[ \\t]*${key}:[ \\t]+"([^"]+)"\\s*$`, "m"));
  return match ? match[1] : null;
};

const metadata = {
  bundleId: pick("bundle_id"),
  teamId: pick("team_id"),
  appleId: pick("apple_id"),
  sku: pick("sku"),
  displayName: pick("name"),
  productName: pick("product_name"),
  category: pick("category_uti"),
  marketingVersion: pick("marketing_version"),
  buildNumber: pick("current_project_version"),
  deploymentTarget: pick("ios_deployment_target"),
  usesNonExemptEncryption: pickBool("uses_non_exempt_encryption"),
  marketingUrl: pick("marketing_url"),
  privacyUrl: pick("privacy_url"),
  supportUrl: pick("support_url"),
};

const escapeXml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

let project = read(projectPath);
const highestExistingBuild = Math.max(
  Number(metadata.buildNumber),
  ...[...project.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((match) => Number(match[1])),
);

const projectReplacements = new Map([
  [/INFOPLIST_KEY_CFBundleDisplayName = .*?;/g, `INFOPLIST_KEY_CFBundleDisplayName = ${JSON.stringify(metadata.displayName)};`],
  [/INFOPLIST_KEY_LSApplicationCategoryType = .*?;/g, `INFOPLIST_KEY_LSApplicationCategoryType = ${JSON.stringify(metadata.category)};`],
  [/PRODUCT_NAME = .*?;/g, `PRODUCT_NAME = ${JSON.stringify(metadata.productName)};`],
  [/PRODUCT_BUNDLE_IDENTIFIER = .*?;/g, `PRODUCT_BUNDLE_IDENTIFIER = ${metadata.bundleId};`],
  [/DEVELOPMENT_TEAM = .*?;/g, `DEVELOPMENT_TEAM = ${metadata.teamId};`],
  [/MARKETING_VERSION = .*?;/g, `MARKETING_VERSION = ${metadata.marketingVersion};`],
  [/CURRENT_PROJECT_VERSION = .*?;/g, `CURRENT_PROJECT_VERSION = ${highestExistingBuild};`],
  [/IPHONEOS_DEPLOYMENT_TARGET = .*?;/g, `IPHONEOS_DEPLOYMENT_TARGET = ${metadata.deploymentTarget};`],
]);
for (const [pattern, replacement] of projectReplacements) project = project.replace(pattern, replacement);
write(projectPath, project);

let plist = read(plistPath);
const upsertPlistString = (key, value) => {
  const pattern = new RegExp(`(<key>${key}<\\/key>\\s*\\n\\s*<string>)[^<]*(<\\/string>)`, "m");
  if (pattern.test(plist)) plist = plist.replace(pattern, `$1${value}$2`);
  else plist = plist.replace(/<\/dict>\s*<\/plist>/, `\t<key>${key}</key>\n\t<string>${value}</string>\n</dict>\n</plist>`);
};
const upsertPlistBool = (key, value) => {
  const pattern = new RegExp(`(<key>${key}<\\/key>\\s*\\n\\s*)<(?:true|false)\\/>`, "m");
  const boolXml = value ? "<true/>" : "<false/>";
  if (pattern.test(plist)) plist = plist.replace(pattern, `$1${boolXml}`);
  else plist = plist.replace(/<\/dict>\s*<\/plist>/, `\t<key>${key}</key>\n\t${boolXml}\n</dict>\n</plist>`);
};

upsertPlistString("CFBundleDisplayName", metadata.displayName);
upsertPlistString("CFBundleName", metadata.productName);
upsertPlistString("LSApplicationCategoryType", metadata.category);
upsertPlistBool("ITSAppUsesNonExemptEncryption", metadata.usesNonExemptEncryption);

// Sync permission strings from the YAML permission_strings block.
// This upserts (never removes) so unknown keys added by Capacitor plugins
// are preserved. Keys absent from the YAML are silently skipped.
const PERMISSION_KEYS = [
  "NSCameraUsageDescription",
  "NSContactsUsageDescription",
  "NSFaceIDUsageDescription",
  "NSLocationWhenInUseUsageDescription",
  "NSMicrophoneUsageDescription",
  "NSSpeechRecognitionUsageDescription",
  "NSPhotoLibraryAddUsageDescription",
  "NSPhotoLibraryUsageDescription",
];
for (const key of PERMISSION_KEYS) {
  const value = pickPermission(key);
  if (value) upsertPlistString(key, value);
}

write(plistPath, plist);

let capacitorTs = read(capacitorTsPath);
const tsReplacements = new Map([
  [/appId: ['"].*?['"],/g, `appId: '${metadata.bundleId}',`],
  [/appName: ['"].*?['"],/g, `appName: '${metadata.displayName}',`],
  [/appleId: ['"].*?['"],/g, `appleId: '${metadata.appleId}',`],
  [/sku: ['"].*?['"],/g, `sku: '${metadata.sku}',`],
  [/version: ['"].*?['"],/g, `version: '${metadata.marketingVersion}',`],
  [/build: ['"].*?['"],/g, `build: '${highestExistingBuild}',`],
  [/category: ['"].*?['"],/g, `category: '${metadata.category}',`],
  [/supportUrl: ['"].*?['"],/g, `supportUrl: '${metadata.supportUrl}',`],
  [/privacyPolicyUrl: ['"].*?['"],/g, `privacyPolicyUrl: '${metadata.privacyUrl}',`],
  [/marketingUrl: ['"].*?['"],/g, `marketingUrl: '${metadata.marketingUrl}',`],
]);
for (const [pattern, replacement] of tsReplacements) capacitorTs = capacitorTs.replace(pattern, replacement);
write(capacitorTsPath, capacitorTs);

const capacitorJson = fs.existsSync(capacitorJsonPath) ? JSON.parse(read(capacitorJsonPath)) : {};
capacitorJson.appId = metadata.bundleId;
capacitorJson.appName = metadata.displayName;
capacitorJson.webDir = capacitorJson.webDir ?? "dist";
capacitorJson.ios = {
  ...capacitorJson.ios,
  appleId: metadata.appleId,
  sku: metadata.sku,
  version: metadata.marketingVersion,
  build: String(highestExistingBuild),
  category: metadata.category,
  supportUrl: metadata.supportUrl,
  privacyPolicyUrl: metadata.privacyUrl,
  marketingUrl: metadata.marketingUrl,
};
write(capacitorJsonPath, `${JSON.stringify(capacitorJson, null, "\t")}\n`);

write(
  configXmlPath,
  `<?xml version='1.0' encoding='utf-8'?>
<widget id="${escapeXml(metadata.bundleId)}" version="${escapeXml(metadata.marketingVersion)}" xmlns="http://www.w3.org/ns/widgets">
    <name>${escapeXml(metadata.displayName)}</name>
    <description>${escapeXml(metadata.displayName)}</description>
    <author></author>
    <content src="index.html" />
    <access origin="*" />
</widget>
`,
);

fs.mkdirSync(path.join(repoRoot, "fastlane/metadata/en-US"), { recursive: true });
write(path.join(repoRoot, "fastlane/metadata/en-US/name.txt"), `${metadata.displayName}\n`);
write(path.join(repoRoot, "fastlane/metadata/en-US/marketing_url.txt"), `${metadata.marketingUrl}\n`);
write(path.join(repoRoot, "fastlane/metadata/en-US/privacy_url.txt"), `${metadata.privacyUrl}\n`);
write(path.join(repoRoot, "fastlane/metadata/en-US/support_url.txt"), `${metadata.supportUrl}\n`);
write(path.join(repoRoot, "fastlane/metadata/primary_category.txt"), `${metadata.category.split(".").pop().toUpperCase().replaceAll("-", "_")}\n`);

if (fs.existsSync(capAppPackagePath)) {
  let capAppPackage = read(capAppPackagePath);
  capAppPackage = capAppPackage.replace(
    /path: "\.\.\/\.\.\/\.\.\/node_modules\/\.bun\/@capacitor\+([^@]+)@[^\"]+\/node_modules\/@capacitor\/([^\"]+)"/g,
    'path: "../../../node_modules/@capacitor/$2"',
  );
  write(capAppPackagePath, capAppPackage);
}

console.log(`Synced iOS metadata: ${metadata.displayName} / ${metadata.bundleId} / ${metadata.category} / ${metadata.marketingVersion} (${highestExistingBuild})`);