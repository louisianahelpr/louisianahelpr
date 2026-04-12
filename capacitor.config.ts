import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.helpr',
  appName: 'Helpr',
  webDir: 'dist',
  server: {
    url: 'https://215189c5-272d-4716-babd-430ab4187c14.lovableproject.com?forceHideBadge=true',
    cleartext: true
  }
};

export default config;
