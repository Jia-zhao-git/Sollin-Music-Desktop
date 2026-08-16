export interface MineradioLyricWord {
  text: string
  t: number
  d: number
  c0: number
  c1: number
}

export interface MineradioLyricLine {
  t: number
  duration?: number
  text: string
  words?: MineradioLyricWord[]
  charCount?: number
  source?: string
}

export interface MineradioTrack {
  id: string
  name: string
  artist: string
  album?: string
  cover?: string
  url?: string
  platform?: string
}

export interface MineradioFxState {
  preset: number
  intensity: number
  cinemaShake: number
  depth: number
  coverResolution: number
  point: number
  speed: number
  twist: number
  color: number
  scatter: number
  bgFade: number
  bloomStrength: number
  lyricGlowStrength: number
  lyricScale: number
  lyricOffsetX: number
  lyricOffsetY: number
  lyricOffsetZ: number
  lyricTiltX: number
  lyricTiltY: number
  lyricColorMode: 'auto' | 'custom' | 'preset'
  lyricColor: string
  lyricHighlightMode: 'auto' | 'custom'
  lyricHighlightColor: string
  lyricGlowLinked: boolean
  lyricGlowColor: string
  lyricFont: string
  lyricLetterSpacing: number
  lyricLineHeight: number
  lyricWeight: number
  visualTintMode: 'auto' | 'custom'
  visualTintColor: string
  uiAccentColor: string
  backgroundColorMode: 'cover' | 'custom'
  backgroundColor: string
  backgroundOpacity: number
  controlGlassChromaticOffset: number
  backgroundColorCustom: boolean
  floatLayer: boolean
  cinema: boolean
  edge: boolean
  aiDepth: boolean
  bloom: boolean
  lyricGlow: boolean
  lyricGlowBeat: boolean
  lyricGlowParticles: boolean
  lyricCameraLock: boolean
  particleLyrics: boolean
  performanceBackground: 'auto' | 'keep' | 'release'
  performanceQuality: 'eco' | 'balanced' | 'high' | 'ultra'
  liveBackgroundKeep: boolean
  [key: string]: unknown
}

export interface MineradioUserFxArchive {
  name: string
  createdAt?: number
  savedAt?: number
  snapshot: Record<string, unknown> | null
}

export interface MineradioEngineState {
  fx: MineradioFxState
  presetMeta: Array<{ name: string, desc: string, descHtml?: string }>
  presetIcons: string[]
  presetDisplayOrder: number[]
  lyricColorPresets: Array<{ name: string, color: string }>
  userFxArchives: MineradioUserFxArchive[]
  coverSwatches: string[]
  immersive: boolean
}

export interface MineradioEngineHost {
  canvasContainer: HTMLElement
  albumBg: HTMLElement
  overlayRoot?: HTMLElement
  audio?: HTMLAudioElement | null
  assetBase?: string
  toast?: (msg: string) => void
  onFxChange?: () => void
  onBeatChip?: (state: { visible: boolean, text: string }) => void
  onImmersiveChange?: (on: boolean) => void
}

export interface MineradioEngine {
  setTrack: (song: MineradioTrack | null) => void
  setLyrics: (lines: MineradioLyricLine[], meta?: { hasKaraoke?: boolean, timingSource?: string }) => void
  setPlaying: (playing: boolean) => void
  notifySeek: () => void
  setAudioElement: (el: HTMLAudioElement | null) => void
  getState: () => MineradioEngineState
  setFxValue: (key: string, value: number) => void
  toggleFx: (key: string) => void
  setPreset: (preset: number) => void
  resetFx: () => void
  setLyricFont: (key: string) => void
  setLyricColorAuto: () => void
  setLyricColorCustom: (color: string) => void
  setLyricColorPreset: (index: number) => void
  setLyricHighlightAuto: () => void
  setLyricHighlightCustom: (color: string) => void
  setLyricGlowLinked: (linked: boolean) => void
  setLyricGlowCustom: (color: string) => void
  setUiAccentColor: (color: string) => void
  resetUiAccentColor: () => void
  setVisualTintAuto: () => void
  setVisualTintCustom: (color: string) => void
  resetVisualTintColor: () => void
  setCustomBackgroundColor: (color: string) => void
  setCustomBackgroundCoverMode: () => void
  setCustomBackgroundOpacity: (value: number) => void
  clearCustomBackgroundImage: () => void
  readBackgroundMediaFile: (file: File) => void
  setPerformanceBackgroundMode: (mode: string) => void
  setPerformanceQualityMode: (mode: string) => void
  applyUserFxArchive: (index: number) => void
  saveUserFxArchive: (index: number) => void
  createUserFxArchive: () => void
  removeUserFxArchive: (index: number) => void
  renameUserFxArchive: (index: number, name: string) => void
  exportUserFxArchive: (index: number) => void
  importUserFxArchiveText: (text: string, fileName?: string) => void
  setImmersive: (on: boolean) => void
  toggleLyrics: () => void
  recenterCamera: () => void
  emitProgressDragParticles: (x: number, y: number) => void
  markRenderInteraction: (reason?: string) => void
  syncViewport: () => void
  destroy: () => void
}

export function createMineradioEngine(host: MineradioEngineHost): MineradioEngine
