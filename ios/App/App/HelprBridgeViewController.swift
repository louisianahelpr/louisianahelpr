import Capacitor
import UIKit

/**
 The app's root view controller. Main.storyboard names it by its Objective-C
 name (customClass="HelprBridgeViewController", no customModule): the App
 target's PRODUCT_NAME is "Louisiana Helpr", so its Swift module is not "App",
 and the explicit @objc name makes the storyboard lookup independent of that.

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
