import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    // MARK: - Remote notifications (APNs)
    //
    // THESE TWO METHODS ARE NOT OPTIONAL AND THEY ARE NOT IN THE STOCK
    // CAPACITOR TEMPLATE. Without them push cannot work, at all, ever.
    //
    // How the plugin actually gets a device token:
    //   1. JS calls PushNotifications.register().
    //   2. PushNotificationsPlugin.register() calls
    //      UIApplication.shared.registerForRemoteNotifications().
    //   3. APNs answers by calling
    //      application(_:didRegisterForRemoteNotificationsWithDeviceToken:)
    //      on THIS AppDelegate.
    //   4. The plugin is listening on NotificationCenter for
    //      .capacitorDidRegisterForRemoteNotifications, and only then fires
    //      its JS "registration" event.
    //
    // Step 4 never happens unless step 3 forwards the token. Capacitor does
    // NOT swizzle or proxy these callbacks — grep the framework: it declares
    // Notification.Name.capacitorDidRegisterForRemoteNotifications in
    // CAPNotifications.swift and posts it from nowhere. The host app is the
    // only thing that can post it.
    //
    // This file did not post it. That is why `push_tokens` was empty for
    // every user in production on 2026-08-31 and `notification_logs` had
    // never recorded a single `channel='push'` row: iOS was handing the app
    // a perfectly good device token on every launch and the app was dropping
    // it on the floor. The JS side (nativePush.ts) had a correct
    // "registration" listener that could never be called.
    //
    // Ref: https://capacitorjs.com/docs/apis/push-notifications#ios
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(
            name: .capacitorDidRegisterForRemoteNotifications,
            object: deviceToken
        )
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(
            name: .capacitorDidFailToRegisterForRemoteNotifications,
            object: error
        )
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
