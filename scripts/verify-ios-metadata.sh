#!/usr/bin/env bash
# Run this on your Mac AFTER `git pull` in GitHub Desktop.
# It tells you, in plain English, whether the iOS identity metadata
# is on your laptop's disk. If this prints all green checks but Xcode
# still shows blanks, the problem is Xcode's cache — not the repo.
#
# Usage:
#   bash scripts/verify-ios-metadata.sh

set -e
cd "$(dirname "$0")/.."

PBXPROJ="ios/App/App.xcodeproj/project.pbxproj"
PLIST="ios/App/App/Info.plist"
CAP_JSON="ios/App/App/capacitor.config.json"
CONFIG_XML="ios/App/App/config.xml"
CAPAPP_SPM="ios/App/CapApp-SPM/Package.swift"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass=0
fail=0

check() {
  local label="$1"
  local file="$2"
  local needle="$3"
  if grep -qF "$needle" "$file"; then
    printf "  ${GREEN}✓${NC} %s\n" "$label"
    pass=$((pass+1))
  else
    printf "  ${RED}✗${NC} %s   (missing: %s)\n" "$label" "$needle"
    fail=$((fail+1))
  fi
}

# Numeric floor check. `check` is a literal grep, which is wrong for the build
# number: CURRENT_PROJECT_VERSION is a FLOOR that fastlane bumps past
# TestFlight's latest on every archive (see the Fastfile), so pinning the
# literal made this fail on every run once the number moved off the seed value
# — and print "your repo is OUT OF DATE, pull from GitHub Desktop" at a repo
# that was perfectly in sync. Assert the invariant that actually holds.
check_min() {
  local label="$1"
  local file="$2"
  local key="$3"
  local floor="$4"
  local actual
  actual=$(grep -oE "$key = [0-9]+;" "$file" | grep -oE '[0-9]+' | sort -n | head -1)
  if [ -n "$actual" ] && [ "$actual" -ge "$floor" ]; then
    printf "  ${GREEN}✓${NC} %s   (found: %s)\n" "$label" "$actual"
    pass=$((pass+1))
  else
    printf "  ${RED}✗${NC} %s   (found: %s, need >= %s)\n" "$label" "${actual:-none}" "$floor"
    fail=$((fail+1))
  fi
}

echo ""
echo "=== iOS metadata check ==="
echo ""
echo "Repo HEAD commit:"
git log -1 --pretty=format:"  %h  %s  (%cr)" 2>/dev/null || echo "  (not a git repo)"
echo ""
echo ""

echo "Rewriting iOS metadata from fastlane/ios_app_metadata.yml first..."
npm run sync:ios-metadata >/dev/null
echo ""

echo "Xcode project ($PBXPROJ):"
check "Bundle ID = com.Helpr"             "$PBXPROJ" "PRODUCT_BUNDLE_IDENTIFIER = com.Helpr;"
check "Team = P85MCK558V"                  "$PBXPROJ" "DEVELOPMENT_TEAM = P85MCK558V;"
check "Display Name = Louisiana Helpr"     "$PBXPROJ" 'INFOPLIST_KEY_CFBundleDisplayName = "Louisiana Helpr";'
check "Category = lifestyle"               "$PBXPROJ" 'INFOPLIST_KEY_LSApplicationCategoryType = "public.app-category.lifestyle";'
check "Marketing Version = 1.0.4"          "$PBXPROJ" "MARKETING_VERSION = 1.0.4;"
check_min "Build floor >= 19"              "$PBXPROJ" "CURRENT_PROJECT_VERSION" 19
check "Deployment target = 15.0"           "$PBXPROJ" "IPHONEOS_DEPLOYMENT_TARGET = 15.0;"

echo ""
echo "Info.plist ($PLIST):"
check "CFBundleDisplayName = Louisiana Helpr"  "$PLIST" "<string>Louisiana Helpr</string>"
check "LSApplicationCategoryType = lifestyle"  "$PLIST" "<string>public.app-category.lifestyle</string>"
check "ITSAppUsesNonExemptEncryption present"  "$PLIST" "ITSAppUsesNonExemptEncryption"

echo ""
echo "Generated Capacitor native files:"
check "Native capacitor appId = com.Helpr"       "$CAP_JSON" '"appId": "com.Helpr"'
check "Native capacitor appName = Louisiana Helpr" "$CAP_JSON" '"appName": "Louisiana Helpr"'
check "Native config.xml widget id = com.Helpr" "$CONFIG_XML" 'widget id="com.Helpr"'
check "Native config.xml name = Louisiana Helpr" "$CONFIG_XML" '<name>Louisiana Helpr</name>'

echo ""
echo "Capacitor Swift Package ($CAPAPP_SPM):"
check "Uses npm-compatible Capacitor plugin paths" "$CAPAPP_SPM" 'path: "../../../node_modules/@capacitor/app"'
if grep -qF 'node_modules/.bun/' "$CAPAPP_SPM"; then
  printf "  ${RED}✗${NC} No Bun-only plugin paths remain   (found node_modules/.bun/)\n"
  fail=$((fail+1))
else
  printf "  ${GREEN}✓${NC} No Bun-only plugin paths remain\n"
  pass=$((pass+1))
fi

echo ""
echo "=== Result ==="
echo ""
if [ $fail -eq 0 ]; then
  printf "${GREEN}All %d checks passed.${NC}\n" "$pass"
  echo ""
  printf "${YELLOW}If Xcode STILL shows blanks after this passes:${NC}\n"
  echo "  1. Quit Xcode completely (Cmd+Q, not just close window)"
  echo "  2. Delete Xcode's derived data:"
  echo "     rm -rf ~/Library/Developer/Xcode/DerivedData/App-*"
  echo "  3. From the project root run your same commands again:"
  echo "     npm run build:ios"
  echo "     npm run sync:ios"
  echo "     open ios/App/App.xcodeproj"
  echo "  4. Reopen with:  open ios/App/App.xcodeproj"
  echo "     (this project uses Swift Package Manager; no pod install needed)"
  echo "  5. In Xcode select the BLUE 'App' icon at the very top of the"
  echo "     left sidebar, then the 'App' TARGET (not the project), then"
  echo "     the 'General' tab. The fields populate from the values above."
  exit 0
else
  printf "${RED}%d check(s) failed.${NC} The repo on this Mac is OUT OF DATE.\n" "$fail"
  echo ""
  echo "Fix:"
  echo "  1. Open GitHub Desktop"
  echo "  2. Make sure 'Current Branch' shows the same branch the workflow"
  echo "     committed to (usually 'main')"
  echo "  3. Click 'Fetch origin', then 'Pull origin' if it appears"
  echo "  4. Re-run this script:  bash scripts/verify-ios-metadata.sh"
  exit 1
fi
