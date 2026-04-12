import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.louisianahelpr.app',
  appName: 'Louisiana Helpr',
  webDir: 'dist',
  server: {
    url: 'https://louisianahelpr.com',
    cleartext: true
  }
};

export default config;
