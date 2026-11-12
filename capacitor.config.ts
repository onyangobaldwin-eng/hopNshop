import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hopnshop.app',
  appName: 'hopNshop',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    cleartext: false
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1000,
      launchAutoHide: true,
      backgroundColor: '#050505',
      androidScaleType: 'CENTER_INSIDE',
      showSpinner: false
    },
    StatusBar: {
      backgroundColor: '#102a43',
      style: 'LIGHT',
      overlaysWebView: false
    },
    Keyboard: {
      resize: 'native',
      style: 'DARK',
      resizeOnFullScreen: true
    }
  },
  android: {
    allowMixedContent: false,
    webContentsDebuggingEnabled: false
  }
};

export default config;
