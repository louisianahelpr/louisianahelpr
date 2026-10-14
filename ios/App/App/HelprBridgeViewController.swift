import Capacitor
import UIKit

/**
 The app's root view controller. Main.storyboard names it with
 customClass="HelprBridgeViewController" customModuleProvider="target", so the
 storyboard resolves it in the App target's own module ("Louisiana_Helpr").
 Measured 2026-10-14: with the @objc name alone and no module the Release
 build logged "Unknown class HelprBridgeViewController" and launched to a
 black screen.

 WHY IT EXISTS. Capacitor 8 auto-registers only the classes named in
 `packageClassList` of the generated capacitor.config.json, which
 `npx cap sync` fills from npm plugin packages. A plugin class compiled into
 the App target itself is never in that list, so nothing loads it unless the
 host registers an instance. Build
 7119 (1.0.4) shipped with BackgroundLocationPlugin.swift on disk but outside
 the App target AND with no registration, so `BackgroundLocation` answered
 UNIMPLEMENTED and the en-route tracker silently fell back to a
 foreground-only watch, while Info.plist promised "including when your screen
 is off".

 Every local CAPPlugin subclass in ios/App/App must be registered here;
 src/test/iosLocalPluginsCompiledAndRegistered.test.ts fails CI otherwise.
 */
@objc(HelprBridgeViewController)
class HelprBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(BackgroundLocationPlugin())
    }
}
