import { create } from 'zustand'
import type { VideoDetail, VideoEpisode, VideoListItem } from '@/types/video'

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
  setCurrentVideo: (video: VideoDetail | null, episode?: VideoEpisode | null) => void
  setCurrentEpisode: (episode: VideoEpisode | null) => void
  upsertHistory: (item: VideoHistoryItem) => void
  toggleFavorite: (video: VideoListItem) => void
  isFavorite: (id: string) => boolean
}

const HISTORY_KEY = 'sollin-video-history-v1'
const FAVORITES_KEY = 'sollin-video-favorites-v1'

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

  setCurrentVideo: (video, episode = null) => set({ currentVideo: video, currentEpisode: episode }),
  setCurrentEpisode: (episode) => set({ currentEpisode: episode }),

  upsertHistory: (item) => set((state) => {
    const next = [
      item,
      ...state.history.filter((history) => history.video.id !== item.video.id),
    ].slice(0, 100)
    writeJson(HISTORY_KEY, next)
    return { history: next }
  }),

  toggleFavorite: (video) => set((state) => {
    const exists = state.favorites.some((item) => item.id === video.id)
    const next = exists
      ? state.favorites.filter((item) => item.id !== video.id)
      : [video, ...state.favorites].slice(0, 200)
    writeJson(FAVORITES_KEY, next)
    return { favorites: next }
  }),

  isFavorite: (id) => get().favorites.some((item) => item.id === id),
}))
