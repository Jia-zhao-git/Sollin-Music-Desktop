import { Capacitor } from '@capacitor/core'
import { ScreenOrientation } from '@capacitor/screen-orientation'

/**
 * Lock the app to landscape on native platforms (Android/iOS). Used by the
 * video players when entering fullscreen so playback actually goes landscape.
 * No-op on web (browser fullscreen + CSS handle it there).
 */
export const lockLandscape = async (): Promise<void> => {
  if (!Capacitor.isNativePlatform?.()) return
  try {
    await ScreenOrientation.lock({ orientation: 'landscape' })
  } catch (error) {
    console.warn('[screenOrientation] landscape lock failed:', error)
  }
}

/** Release the orientation lock (restore auto-rotation / portrait). */
export const unlockOrientation = async (): Promise<void> => {
  if (!Capacitor.isNativePlatform?.()) return
  try {
    await ScreenOrientation.unlock()
  } catch (error) {
    console.warn('[screenOrientation] unlock failed:', error)
  }
}
