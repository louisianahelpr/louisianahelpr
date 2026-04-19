import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.Helpr',
  appName: 'Helpr',
  webDir: 'dist',
  server: {
    url: 'https://louisianahelpr.com',
    cleartext: true
  },
  ios: {
    appleId: '6754470134',
    sku: 'Helpr',
    version: '1.0.4',
    build: '17',
    category: 'public.app-category.lifestyle',
    supportUrl: 'https://louisianahelpr.com/support',
    privacyPolicyUrl: 'https://louisianahelpr.com/privacy',
    marketingUrl: 'https://louisianahelpr.com',
    content: `
      <key>NSCameraUsageDescription</key>
      <string>Helpr needs camera access so you can take photos of tasks or completed jobs.</string>
      <key>NSLocationWhenInUseUsageDescription</key>
      <string>Helpr uses your location to show you available help and jobs in your local community.</string>
      <key>NSPhotoLibraryUsageDescription</key>
      <string>Allows you to upload photos from your library to show details of a task.</string>
      <key>ITSAppUsesNonExemptEncryption</key>
      <false/>
    `
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#ffffff',
      iosSpinnerStyle: 'small',
      showSpinner: false
    }
  }
};

export default config;
