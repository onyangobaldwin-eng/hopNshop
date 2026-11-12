import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { Network } from '@capacitor/network';
import { PushNotifications } from '@capacitor/push-notifications';
import { StatusBar, Style } from '@capacitor/status-bar';
import { notificationService } from './notifications';
import { supabase } from './supabase';

const isHopNshopAuthCallback = (callbackUrl: URL) =>
  (callbackUrl.protocol === 'hopnshop:' && callbackUrl.hostname === 'auth' && callbackUrl.pathname === '/callback')
  || (callbackUrl.protocol === 'https:' && callbackUrl.hostname === 'hopnshop.co.ke' && callbackUrl.pathname === '/auth/callback');

async function handleAuthCallback(rawUrl: string) {
  if (!supabase) {
    console.error('The authentication callback could not be processed because Supabase is not configured.');
    return;
  }

  let callbackUrl: URL;
  try {
    callbackUrl = new URL(rawUrl);
  } catch {
    console.error('The authentication callback URL was invalid.');
    return;
  }

  if (!isHopNshopAuthCallback(callbackUrl)) return;

  const fragment = new URLSearchParams(callbackUrl.hash.slice(1));
  const providerError = callbackUrl.searchParams.get('error_description')
    ?? fragment.get('error_description')
    ?? callbackUrl.searchParams.get('error')
    ?? fragment.get('error');
  if (providerError) {
    console.error('Supabase authentication could not be completed.', providerError);
    return;
  }

  const code = callbackUrl.searchParams.get('code');
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) console.error('The authentication callback code could not be exchanged.', error.message);
    return;
  }

  const accessToken = fragment.get('access_token') ?? callbackUrl.searchParams.get('access_token');
  const refreshToken = fragment.get('refresh_token') ?? callbackUrl.searchParams.get('refresh_token');
  if (!accessToken || !refreshToken) {
    console.error('The authentication callback did not contain a valid session.');
    return;
  }

  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken
  });
  if (error) console.error('The authentication callback session could not be saved.', error.message);
}

async function saveNativePushToken(deviceToken: string) {
  if (!supabase) return;
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError) {
    console.error('The current account could not be checked for push registration.', userError.message);
    return;
  }
  if (!user) return;

  const { data: preference, error: preferenceError } = await supabase
    .from('notification_preferences')
    .select('enabled')
    .eq('user_id', user.id)
    .eq('channel', 'push')
    .maybeSingle();
  if (preferenceError) {
    console.error('Push notification preference could not be checked.', preferenceError.message);
    return;
  }
  if (!preference?.enabled) return;

  try {
    await notificationService.registerDeviceToken(deviceToken, 'android');
  } catch (error) {
    console.error('The Android push token could not be saved to the account.', error);
  }
}

interface NativeAppCallbacks {
  onBack: () => boolean;
  onNetworkChange: (connected: boolean) => void;
}

export const getAuthRedirectUrl = () => Capacitor.isNativePlatform()
  ? 'hopnshop://auth/callback'
  : window.location.origin;

export function initializeNativeApp(callbacks: NativeAppCallbacks) {
  if (!Capacitor.isNativePlatform()) return () => {};

  let disposed = false;
  const listeners: PluginListenerHandle[] = [];

  const registerListener = (
    label: string,
    listener: Promise<PluginListenerHandle>
  ) => {
    void listener.then(async handle => {
      if (disposed) {
        await handle.remove();
      } else {
        listeners.push(handle);
      }
    }).catch(error => {
      console.error(`The native ${label} listener could not be started.`, error);
    });
  };

  void StatusBar.setStyle({ style: Style.Light }).catch(error => {
    console.error('The Android status bar style could not be configured.', error);
  });
  void StatusBar.setBackgroundColor({ color: '#102a43' }).catch(error => {
    console.error('The Android status bar color could not be configured.', error);
  });
  void StatusBar.setOverlaysWebView({ overlay: false }).catch(error => {
    console.error('The Android status bar overlay mode could not be configured.', error);
  });

  registerListener('authentication callback', CapacitorApp.addListener('appUrlOpen', ({ url }) => {
    void handleAuthCallback(url).catch(error => {
      console.error('The authentication callback could not be completed.', error);
    });
  }));
  registerListener('back button', CapacitorApp.addListener('backButton', ({ canGoBack }) => {
    if (callbacks.onBack()) return;
    if (canGoBack) window.history.back();
    else void CapacitorApp.exitApp();
  }));
  registerListener('network status', Network.addListener('networkStatusChange', status => {
    callbacks.onNetworkChange(status.connected);
  }));
  registerListener('push registration', PushNotifications.addListener('registration', token => {
    void saveNativePushToken(token.value);
  }));
  registerListener('push registration error', PushNotifications.addListener('registrationError', error => {
    console.error('Android push registration failed. Check Firebase configuration.', error);
  }));

  void Network.getStatus().then(status => {
    callbacks.onNetworkChange(status.connected);
  }).catch(error => {
    console.error('The Android network status could not be read.', error);
  });

  return () => {
    disposed = true;
    for (const listener of listeners) {
      void listener.remove().catch(error => {
        console.error('A native app listener could not be removed.', error);
      });
    }
  };
}

export async function registerNativePushNotifications(userId: string, requestPermission = false) {
  if (!Capacitor.isNativePlatform() || !supabase) return;

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user || user.id !== userId) return;

  const { data: preference, error: preferenceError } = await supabase
    .from('notification_preferences')
    .select('enabled')
    .eq('user_id', userId)
    .eq('channel', 'push')
    .maybeSingle();
  if (preferenceError) throw preferenceError;
  if (!preference?.enabled) return;

  let permission = await PushNotifications.checkPermissions();
  if (permission.receive === 'prompt' && requestPermission) {
    permission = await PushNotifications.requestPermissions();
  }
  if (permission.receive !== 'granted') {
    if (permission.receive === 'prompt' && !requestPermission) return;
    throw new Error('Android push notification permission was not granted.');
  }

  await PushNotifications.register();
}
