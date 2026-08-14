import { create } from 'zustand'
import type { NovelChapter, NovelDetail, NovelListItem } from '@/types/novel'

export type NovelHistoryItem = {
  novel: NovelListItem
  chapter?: NovelChapter
  readAt: number
}

type NovelState = {
  currentNovel: NovelDetail | null
  currentChapter: NovelChapter | null
  history: NovelHistoryItem[]
  favorites: NovelListItem[]
  setCurrentNovel: (novel: NovelDetail | null, chapter?: NovelChapter | null) => void
  setCurrentChapter: (chapter: NovelChapter | null) => void
  upsertHistory: (item: NovelHistoryItem) => void
  toggleFavorite: (novel: NovelListItem) => void
  isFavorite: (id: string) => boolean
}

const HISTORY_KEY = 'sollin-novel-history-v1'
const FAVORITES_KEY = 'sollin-novel-favorites-v1'

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
    // ignore
  }
}

export const useNovelStore = create<NovelState>((set, get) => ({
  currentNovel: null,
  currentChapter: null,
  history: readJson<NovelHistoryItem[]>(HISTORY_KEY, []),
  favorites: readJson<NovelListItem[]>(FAVORITES_KEY, []),

  setCurrentNovel: (novel, chapter = null) => set({ currentNovel: novel, currentChapter: chapter }),
  setCurrentChapter: (chapter) => set({ currentChapter: chapter }),

  upsertHistory: (item) => set((state) => {
    const next = [item, ...state.history.filter((history) => history.novel.id !== item.novel.id)].slice(0, 100)
    writeJson(HISTORY_KEY, next)
    return { history: next }
  }),

  toggleFavorite: (novel) => set((state) => {
    const exists = state.favorites.some((item) => item.id === novel.id)
    const next = exists
      ? state.favorites.filter((item) => item.id !== novel.id)
      : [novel, ...state.favorites].slice(0, 200)
    writeJson(FAVORITES_KEY, next)
    return { favorites: next }
  }),

  isFavorite: (id) => get().favorites.some((item) => item.id === id),
}))
