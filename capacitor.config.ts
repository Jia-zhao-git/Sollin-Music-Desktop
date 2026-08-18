import type { CapacitorConfig } from '@capacitor/cli'

const webDir = process.env.CAPACITOR_WEB_DIR || 'dist-mobile'

const config: CapacitorConfig = {
  appId: 'com.zjmusic.app',
  appName: 'JiaMusic',
  webDir,
  bundledWebRuntime: false,
  server: {
    // Allow mixed-content and cleartext for local API calls
    cleartext: true,
    allowNavigation: ['*'],
  },
  // Enable native HTTP bridge on Capacitor Android to avoid WebView CORS/mixed-content Failed to fetch errors.
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  },
  android: {
    path: 'android',
    // Edge-to-edge WebView (content draws behind status/nav bar)
    allowMixedContent: true,
    captureInput: true,
    buildOptions: {
      keystorePath: process.env.CAPACITOR_ANDROID_KEYSTORE_PATH,
      keystorePassword: process.env.CAPACITOR_ANDROID_KEYSTORE_PASSWORD,
      keystoreAlias: process.env.CAPACITOR_ANDROID_KEY_ALIAS,
      keystoreAliasPassword: process.env.CAPACITOR_ANDROID_KEY_PASSWORD,
      releaseType: 'APK',
    },
  },
}

export default config
