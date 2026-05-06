import { Capacitor } from '@capacitor/core';
import { SocialLogin } from '@capgo/capacitor-social-login';

// Initialize @capgo/capacitor-social-login on native platforms.
// No-op on web — web flow uses supabase.auth.signInWithOAuth.
export async function initSocialLogin(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
    await SocialLogin.initialize({
        apple: { clientId: 'com.Helpr.signin' },
            google: { iOSClientId: '830470550612-4q4rslusnsu72c62vo18udtjb638q8is.apps.googleusercontent.com', mode: 'online' },
              });
              }
              
