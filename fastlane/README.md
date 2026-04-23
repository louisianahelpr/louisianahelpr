# Fastlane — Helpr iOS Release Automation

One-command TestFlight uploads and App Store submissions. Replaces the manual
"Xcode → Archive → Distribute" clickfest.

## First-time setup (one time, on your Mac)

### 1. Install Ruby tooling
```bash
# Install bundler if you don't have it
gem install bundler

# Install Fastlane + CocoaPods (versions pinned in Gemfile)
bundle install
```

### 2. Generate an App Store Connect API key
1. Go to https://appstoreconnect.apple.com/access/api
2. Click **Keys** tab → **Generate API Key** (or the `+` button)
3. Name: `Fastlane Helpr`, Access: **App Manager**
4. Click **Generate** → **Download API Key** (the .p8 file — Apple only lets you download it ONCE)
5. Save the .p8 somewhere safe like `~/AppStoreConnect_AuthKey.p8`
6. Note the **Key ID** (10 chars) and **Issuer ID** (UUID at the top of the page)

### 3. Configure environment variables
```bash
cp fastlane/.env.example fastlane/.env
# Edit fastlane/.env with your real values
```

Fill in:
- `ASC_KEY_ID` — the 10-char Key ID from step 2
- `ASC_ISSUER_ID` — the UUID Issuer ID from step 2
- `ASC_KEY_PATH` — absolute path to your `.p8` file
- `DEVELOPER_TEAM_ID` — from https://developer.apple.com/account (top-right corner)
- `FASTLANE_APPLE_ID` — your Apple ID email

### 4. Verify Xcode signing works
Open `ios/App/App.xcworkspace` in Xcode once, select the **App** target, go to
**Signing & Capabilities**, and confirm:
- **Automatically manage signing** is checked
- **Team** is selected
- A successful local build runs on a simulator

## Daily use

### Push a TestFlight build (internal testing)
```bash
bundle exec fastlane ios beta
```
- Builds the web bundle (`npm run build`)
- Syncs Capacitor (`npx cap sync ios`)
- Bumps the build number
- Archives the .ipa
- Uploads to TestFlight (skips processing wait)

Total time: ~5–10 min. Build appears in TestFlight after Apple processes it (~10 min).

### Submit a new App Store version for review
```bash
bundle exec fastlane ios release
```
- Same as `beta` but also submits for review with auto-release on approval
- Make sure you bumped the **version** (not just build) in `capacitor.config.ts`
  before running this — App Store rejects duplicate versions

### What you still do manually in App Store Connect (browser)
- Update **screenshots** (rarely changes)
- Update **release notes / What's New** for each version
- Respond to App Review if they request changes

## Troubleshooting

**"Could not find provisioning profile"**
→ Open Xcode once, let it auto-fix signing, then re-run Fastlane.

**"Authentication failed"**
→ The `.p8` was probably moved or `ASC_KEY_PATH` is wrong. Verify with `ls $ASC_KEY_PATH`.

**"Build number must be greater than the last submitted build"**
→ The `increment_build_number` step should handle this, but if it didn't:
manually edit the build in `capacitor.config.ts` and run `npx cap sync ios`.

**"Invalid Bundle. The bundle does not support arm64"**
→ Make sure you ran on Apple Silicon Mac OR set the right build settings in Xcode.
