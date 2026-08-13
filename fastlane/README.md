fastlane documentation
----

# Installation

Make sure you have the latest version of the Xcode command line tools installed:

```sh
xcode-select --install
```

For _fastlane_ installation instructions, see [Installing _fastlane_](https://docs.fastlane.tools/#installing-fastlane)

# Available Actions

## iOS

### ios sync_xcode_metadata

```sh
[bundle exec] fastlane ios sync_xcode_metadata
```

Sync fastlane/ios_app_metadata.yml into the committed Xcode project and Info.plist

### ios beta

```sh
[bundle exec] fastlane ios beta
```

Bump build number, archive, upload to TestFlight

### ios metadata

```sh
[bundle exec] fastlane ios metadata
```

Upload App Store listing metadata (text, URLs, screenshots) without building or submitting

### ios release

```sh
[bundle exec] fastlane ios release
```

Bump build, archive, upload, and submit for App Store review

### ios sync_app_icon

```sh
[bundle exec] fastlane ios sync_app_icon
```

Regenerate iOS AppIcon set from public/apple-touch-icon.png

----

This README.md is auto-generated and will be re-generated every time [_fastlane_](https://fastlane.tools) is run.

More information about _fastlane_ can be found on [fastlane.tools](https://fastlane.tools).

The documentation of _fastlane_ can be found on [docs.fastlane.tools](https://docs.fastlane.tools).
