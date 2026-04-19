import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.louisianahelpr.app',
  appName: 'Louisiana Helpr',
  webDir: 'dist',
  server: {
    url: 'https://louisianahelpr.com',
    cleartext: true
  },
  ios: {
    content: `
      <key>NSCameraUsageDescription</key>
      <string>Helpr needs camera access so you can take photos of tasks or completed jobs.</string>
      <key>NSLocationWhenInUseUsageDescription</key>
      <string>We use your location to show you available help and jobs in your local community.</string>
      <key>NSPhotoLibraryUsageDescription</key>
      <string>Allows you to upload photos from your library to show details of a task.</string>
    `
  }
};

export default config;
