import type { CapacitorConfig } from '@capacitor/cli'

const webDir = process.env.CAPACITOR_WEB_DIR || 'dist-mobile'

const config: CapacitorConfig = {
  appId: 'com.zjmusic.app',
  appName: 'JiaMusic',
  webDir,
  bundledWebRuntime: false,
  android: {
    path: 'android',
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
