import Capacitor
import CoreLocation
import Foundation

/**
 WHY THIS FILE EXISTS AT ALL.

 `@capacitor/geolocation` (8.2.2, backed by IONGeolocationLib 2.1.0) CANNOT
 deliver location while the app is backgrounded, and it fails silently when it
 stops. Grep the whole dependency for `allowsBackgroundLocationUpdates`:

     $ grep -rn "allowsBackgroundLocationUpdates" \
         node_modules/@capacitor/geolocation ion-ios-geolocation-2.1.0
     (no matches)

 CoreLocation's contract is that a `CLLocationManager` stops delivering to a
 suspended app unless that flag is set to `true` — declaring
 `UIBackgroundModes: location` in Info.plist is necessary but NOT sufficient on
 its own. So the stock plugin's `watchPosition` goes quiet the instant the
 helper locks their phone or switches to Maps, which is precisely what someone
 driving to a job does. It emits no error when this happens; worse,
 IONGeolocationLib's own publisher catches `locationUnavailable` and logs
 "(likely due to backgrounding). Keeping watch callbacks alive" — a watch that
 is alive and never fires again.

 This is the AppDelegate lesson in a different costume (see CLAUDE.md): the
 framework declares the capability, observes it, and leaves one link for the
 host app to supply, with nothing warning you that it is missing.

 WHAT THIS PLUGIN DOES DIFFERENTLY
 - Owns its OWN CLLocationManager, so it never fights the Geolocation plugin's.
 - Sets `allowsBackgroundLocationUpdates = true` while, and only while, a
   session is running. Flipped back off on stop so the app holds no background
   location claim outside an en-route window.
 - `showsBackgroundLocationIndicator = true` — the blue pill is deliberate. The
   helper must be able to see, at a glance, that Helpr has their location.
 - `pausesLocationUpdatesAutomatically = false` — iOS's auto-pause never
   resumes on its own, which would be another silent death.
 - Distance-filtered, not time-filtered: a helper stopped at a light or parked
   writes nothing.

 AUTHORIZATION: this plugin never prompts. It requires an existing
 when-in-use (or always) grant, obtained through @capacitor/geolocation on the
 JS side so there is exactly one prompt path in the app. When-in-use plus the
 `location` background mode plus this flag is a supported, documented
 combination and is all an active en-route session needs; it does NOT survive
 the app being force-quit by the user, which is the honest limit and is stated
 in the JS layer.
 */
@objc(BackgroundLocationPlugin)
public class BackgroundLocationPlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
    public let identifier = "BackgroundLocationPlugin"
    public let jsName = "BackgroundLocation"
    public let pluginMethods: [CAPPluginMethod] = [
        .init(name: "start", returnType: CAPPluginReturnPromise),
        .init(name: "stop", returnType: CAPPluginReturnPromise),
        .init(name: "isAvailable", returnType: CAPPluginReturnPromise),
        .init(name: "drain", returnType: CAPPluginReturnPromise)
    ]

    private var manager: CLLocationManager?
    private var running = false

    /// Positions emitted to JS that JS may never have processed.
    ///
    /// WHY A BUFFER EXISTS. CoreLocation delivering to Swift while the app is
    /// backgrounded is guaranteed by the background mode; the WebView's
    /// JavaScript still running to *consume* those events is NOT — WebKit
    /// throttles background WebContent, and the listener does its Supabase
    /// write in JS. So every position is also retained here and the JS layer
    /// drains it on resume, backfilling anything the throttle swallowed. A
    /// gap in the poster's trail is a defect; a late-arriving trail is not.
    ///
    /// Capped so a long drive with no foregrounding cannot grow without bound.
    private var buffer: [[String: Any]] = []
    private static let bufferCap = 200

    /// Event names. Kept in one place because the JS side keys off the exact
    /// strings and a typo here is a listener that is never called — the same
    /// silent-gap class this whole file exists to close.
    private enum Event {
        static let position = "position"
        static let authorizationDenied = "authorizationDenied"
        static let failed = "failed"
    }

    // MARK: - JS surface

    /// Reports whether this build actually contains the plugin AND whether
    /// Info.plist carries the background mode it needs. A `true` from here is
    /// the JS layer's licence to claim background tracking; anything else and
    /// it degrades to a foreground-only watch and says so in the UI.
    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve([
            "available": true,
            "backgroundModeDeclared": Self.backgroundModeDeclared,
            "authorization": Self.authorizationString(Self.currentAuthorization)
        ])
    }

    @objc func start(_ call: CAPPluginCall) {
        // Default 50m. A helper driving 30mph crosses that in ~4s; a helper
        // sitting still crosses it never, which is the entire point.
        let distanceFilter = call.getDouble("distanceFilter") ?? 50

        DispatchQueue.main.async {
            let status = Self.currentAuthorization
            guard status == .authorizedWhenInUse || status == .authorizedAlways else {
                // Never prompt from here — see the file header. Tell JS what
                // the state is and let it render a designed state.
                self.notifyListeners(Event.authorizationDenied, data: [
                    "authorization": Self.authorizationString(status)
                ])
                call.reject(
                    "Location permission not granted",
                    "PERMISSION_DENIED",
                    nil,
                    ["authorization": Self.authorizationString(status)]
                )
                return
            }

            let manager = self.manager ?? CLLocationManager()
            self.manager = manager
            manager.delegate = self
            manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
            manager.distanceFilter = distanceFilter
            manager.pausesLocationUpdatesAutomatically = false

            // THE LINE THE STOCK PLUGIN NEVER WRITES.
            //
            // Setting this to true throws an ObjC exception if the app does not
            // declare UIBackgroundModes `location`. That exception is not
            // catchable from Swift, so check the plist first and degrade to a
            // foreground-only watch rather than crashing a helper mid-drive.
            if Self.backgroundModeDeclared {
                manager.allowsBackgroundLocationUpdates = true
                manager.showsBackgroundLocationIndicator = true
            }

            self.buffer = []
            manager.startUpdatingLocation()
            self.running = true

            call.resolve([
                "background": Self.backgroundModeDeclared,
                "distanceFilter": distanceFilter,
                "authorization": Self.authorizationString(status)
            ])
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.teardown()
            call.resolve()
        }
    }

    private func teardown() {
        guard let manager else {
            running = false
            return
        }
        manager.stopUpdatingLocation()
        // Drop the background claim immediately. Leaving it set would keep the
        // app eligible for background location for the rest of the process
        // lifetime even with no session running — a battery and privacy cost
        // with no feature behind it.
        if Self.backgroundModeDeclared {
            manager.allowsBackgroundLocationUpdates = false
        }
        running = false
    }

    deinit {
        // No DispatchQueue.main.async here: deinit may already be on main and
        // hopping would capture a deallocating self.
        manager?.stopUpdatingLocation()
    }

    // MARK: - CLLocationManagerDelegate

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard running, let location = locations.last else { return }
        let payload: [String: Any] = [
            "latitude": location.coordinate.latitude,
            "longitude": location.coordinate.longitude,
            "accuracy": location.horizontalAccuracy,
            "speed": location.speed,
            "timestamp": location.timestamp.timeIntervalSince1970 * 1000
        ]
        buffer.append(payload)
        if buffer.count > Self.bufferCap { buffer.removeFirst(buffer.count - Self.bufferCap) }
        notifyListeners(Event.position, data: payload)
    }

    /// Hand JS everything buffered since the last drain and clear it. Called on
    /// app resume — and NOT on a timer, because the only moment JS is certainly
    /// able to write is the moment it is certainly running.
    @objc func drain(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let pending = self.buffer
            self.buffer = []
            call.resolve(["positions": pending])
        }
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // kCLErrorLocationUnknown is transient — CoreLocation keeps trying and
        // reporting it would produce a stream of false "tracking broke"
        // signals in the UI.
        if let clError = error as? CLError, clError.code == .locationUnknown { return }
        notifyListeners(Event.failed, data: ["message": error.localizedDescription])
    }

    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        switch status {
        case .denied, .restricted:
            // Revoked mid-session (Settings is reachable while the app is
            // backgrounded). Tear down rather than leave a manager that will
            // never deliver again.
            teardown()
            notifyListeners(Event.authorizationDenied, data: [
                "authorization": Self.authorizationString(status)
            ])
        default:
            break
        }
    }

    // MARK: - Plist / status helpers

    /// True when Info.plist declares the `location` background mode. Read once:
    /// the bundle cannot change at runtime.
    private static let backgroundModeDeclared: Bool = {
        let modes = Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String]
        return modes?.contains("location") ?? false
    }()

    private static var currentAuthorization: CLAuthorizationStatus {
        CLLocationManager().authorizationStatus
    }

    private static func authorizationString(_ status: CLAuthorizationStatus) -> String {
        switch status {
        case .authorizedAlways: return "always"
        case .authorizedWhenInUse: return "whenInUse"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "notDetermined"
        @unknown default: return "unknown"
        }
    }
}
