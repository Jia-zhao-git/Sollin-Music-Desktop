import { create } from 'zustand'
import type { VideoCacheItem, VideoDetail, VideoEpisode, VideoListItem } from '@/types/video'

export type VideoHistoryItem = {
  video: VideoListItem
  episode?: VideoEpisode
  playedAt: number
  currentTime?: number
}

type VideoState = {
  currentVideo: VideoDetail | null
  currentEpisode: VideoEpisode | null
  history: VideoHistoryItem[]
  favorites: VideoListItem[]
  watchLater: VideoListItem[]
  cacheDirectory: string
  downloads: VideoCacheItem[]
  setCurrentVideo: (video: VideoDetail | null, episode?: VideoEpisode | null) => void
  setCurrentEpisode: (episode: VideoEpisode | null) => void
  upsertHistory: (item: VideoHistoryItem) => void
  removeHistory: (videoId: string) => void
  clearHistory: () => void
  toggleFavorite: (video: VideoListItem) => void
  removeFavorite: (videoId: string) => void
  clearFavorites: () => void
  addWatchLater: (video: VideoListItem) => void
  removeWatchLater: (id: string) => void
  isWatchLater: (id: string) => boolean
  isFavorite: (id: string) => boolean
  setCacheDirectory: (directory: string) => void
  addDownload: (item: VideoCacheItem) => void
  removeDownload: (id: string) => void
  // 扫描缓存目录，把磁盘上真实存在的视频与 store 记录合并：
  // 保留仍在磁盘的带元数据记录，补上「磁盘有但 store 没有」的孤儿文件（按文件名推断剧名/集数），
  // 并清理 store 中文件已不存在的失效条目。web 端无 electronAPI 时直接跳过，不破坏既有记录。
  scanCache: () => Promise<void>
}

type VideoCacheFileOnDisk = { filePath: string; name: string; size: number; mtimeMs: number }

const buildCacheItemFromFile = (file: VideoCacheFileOnDisk): VideoCacheItem => {
  const base = file.name.replace(/\.[^.]+$/, '')
  const dashIndex = base.lastIndexOf('-')
  const videoName = dashIndex > 0 ? base.slice(0, dashIndex).trim() : base
  const episodeTitle = dashIndex > 0 ? base.slice(dashIndex + 1).trim() : ''
  return {
    id: `cache:${file.filePath}`,
    videoName,
    episodeTitle,
    url: '',
    filePath: file.filePath,
    size: file.size,
    status: 'completed',
    downloadedAt: file.mtimeMs,
    quality: '',
    videoId: '',
  }
}

const HISTORY_KEY = 'sollin-video-history-v1'
const FAVORITES_KEY = 'sollin-video-favorites-v1'
const WATCH_LATER_KEY = 'sollin-video-watch-later-v1'
const CACHE_DIR_KEY = 'sollin-video-cache-dir-v1'
const DOWNLOADS_KEY = 'sollin-video-downloads-v1'

const readJson = <T>(key: string, fallback: T): T => {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : fallback
  } catch {
    return fallback
  }
}

const writeJson = (key: string, value: unknown) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // ignore quota / privacy mode failures
  }
}

export const useVideoStore = create<VideoState>((set, get) => ({
  currentVideo: null,
  currentEpisode: null,
  history: readJson<VideoHistoryItem[]>(HISTORY_KEY, []),
  favorites: readJson<VideoListItem[]>(FAVORITES_KEY, []),
  watchLater: readJson<VideoListItem[]>(WATCH_LATER_KEY, []),
  cacheDirectory: readJson<string>(CACHE_DIR_KEY, ''),
  downloads: readJson<VideoCacheItem[]>(DOWNLOADS_KEY, []),

  setCurrentVideo: (video, episode = null) => set({ currentVideo: video, currentEpisode: episode }),
  setCurrentEpisode: (episode) => set({ currentEpisode: episode }),

  upsertHistory: (item) => set((state) => {
    // 按「影片 id + 集数」去重，同一部剧可保留多集进度，仅覆盖同集记录。
    const episodeKey = item.episode?.url || ''
    const next = [
      item,
      ...state.history.filter((history) => !(
        history.video.id === item.video.id && (history.episode?.url || '') === episodeKey
      )),
    ].slice(0, 100)
    writeJson(HISTORY_KEY, next)
    return { history: next }
  }),

  removeHistory: (videoId) => set((state) => {
    const next = state.history.filter((history) => history.video.id !== videoId)
    writeJson(HISTORY_KEY, next)
    return { history: next }
  }),

  clearHistory: () => {
    writeJson(HISTORY_KEY, [])
    set({ history: [] })
  },

  toggleFavorite: (video) => set((state) => {
    const exists = state.favorites.some((item) => item.id === video.id)
    const next = exists
      ? state.favorites.filter((item) => item.id !== video.id)
      : [video, ...state.favorites].slice(0, 200)
    writeJson(FAVORITES_KEY, next)
    return { favorites: next }
  }),

  removeFavorite: (videoId) => set((state) => {
    const next = state.favorites.filter((item) => item.id !== videoId)
    writeJson(FAVORITES_KEY, next)
    return { favorites: next }
  }),

  clearFavorites: () => {
    writeJson(FAVORITES_KEY, [])
    set({ favorites: [] })
  },

  addWatchLater: (video) => set((state) => {
    if (state.watchLater.some((item) => item.id === video.id)) return state
    const next = [video, ...state.watchLater].slice(0, 200)
    writeJson(WATCH_LATER_KEY, next)
    return { watchLater: next }
  }),

  removeWatchLater: (id) => set((state) => {
    const next = state.watchLater.filter((item) => item.id !== id)
    writeJson(WATCH_LATER_KEY, next)
    return { watchLater: next }
  }),

  isWatchLater: (id) => get().watchLater.some((item) => item.id === id),

  isFavorite: (id) => get().favorites.some((item) => item.id === id),

  setCacheDirectory: (directory) => {
    writeJson(CACHE_DIR_KEY, directory)
    set({ cacheDirectory: directory })
  },

  addDownload: (item) => set((state) => {
    const next = [item, ...state.downloads.filter((download) => download.id !== item.id)].slice(0, 200)
    writeJson(DOWNLOADS_KEY, next)
    return { downloads: next }
  }),

  removeDownload: (id) => set((state) => {
    const next = state.downloads.filter((download) => download.id !== id)
    writeJson(DOWNLOADS_KEY, next)
    return { downloads: next }
  }),

  scanCache: async () => {
    const api = (window as unknown as { electronAPI?: { listVideoCache?: () => Promise<VideoCacheFileOnDisk[]> } }).electronAPI
    if (!api?.listVideoCache) return
    let files: VideoCacheFileOnDisk[] = []
    try {
      files = await api.listVideoCache()
    } catch {
      return
    }
    const byPath = new Map(files.map((file) => [file.filePath, file]))
    // 保留仍在磁盘上的带元数据记录（优先用 store 中的剧名/集数/封面信息）。
    const kept = get().downloads.filter((download) => byPath.has(download.filePath))
    const keptPaths = new Set(kept.map((download) => download.filePath))
    // 磁盘上有、store 没有的孤儿文件：按文件名推断最小条目补入。
    const orphans = files
      .filter((file) => !keptPaths.has(file.filePath))
      .map((file) => buildCacheItemFromFile(file))
    const merged = [...kept, ...orphans].sort((a, b) => (b.downloadedAt || 0) - (a.downloadedAt || 0))
    writeJson(DOWNLOADS_KEY, merged)
    set({ downloads: merged })
  },
}))
