import { create } from 'zustand'
import type { LocalBook, NovelChapter, NovelDetail, NovelListItem } from '@/types/novel'

export type NovelHistoryItem = {
  novel: NovelListItem
  chapter?: NovelChapter
  readAt: number
}

// 阅读书签 / 笔记：记录某一本书的某个章节 + 阅读位置（分页模式记页码，滚动模式记滚动比例），
// 以及一处正文摘录与用户批注。按书聚合、按创建时间倒序展示。
export type NovelBookmark = {
  id: string
  bookId: string
  chapterId: string
  chapterTitle: string
  readerPage?: number
  scrollRatio?: number
  snippet?: string
  note?: string
  createdAt: number
}

// 章内阅读进度（续读位置）：在「继续阅读 / 打开章节」时恢复到上次读到的精确位置，
// 而非每次都从章首开始。分页模式记页码，滚动模式记滚动比例。
export type ReadingPosition = {
  bookId: string
  chapterId: string
  readerPage?: number
  scrollRatio?: number
  updatedAt: number
}

type NovelState = {
  currentNovel: NovelDetail | null
  currentChapter: NovelChapter | null
  history: NovelHistoryItem[]
  favorites: NovelListItem[]
  localBooks: LocalBook[]
  bookmarks: NovelBookmark[]
  setCurrentNovel: (novel: NovelDetail | null, chapter?: NovelChapter | null) => void
  setCurrentChapter: (chapter: NovelChapter | null) => void
  upsertHistory: (item: NovelHistoryItem) => void
  toggleFavorite: (novel: NovelListItem) => void
  isFavorite: (id: string) => boolean
  addLocalBooks: (books: LocalBook[]) => void
  removeLocalBook: (id: string) => void
  getLocalBook: (id: string) => LocalBook | undefined
  addBookmark: (bookmark: Omit<NovelBookmark, 'id' | 'createdAt'>) => void
  updateBookmarkNote: (id: string, note: string) => void
  removeBookmark: (id: string) => void
  getBookmarks: (bookId: string) => NovelBookmark[]
  saveReadingPosition: (bookId: string, chapterId: string, pos: { readerPage?: number; scrollRatio?: number }) => void
  getReadingPosition: (bookId: string, chapterId: string) => ReadingPosition | undefined
}

const HISTORY_KEY = 'sollin-novel-history-v1'
const FAVORITES_KEY = 'sollin-novel-favorites-v1'
const LOCAL_BOOKS_KEY = 'sollin-novel-local-v1'
const BOOKMARKS_KEY = 'sollin-novel-bookmarks-v1'
const POSITIONS_KEY = 'sollin-novel-positions-v1'

const newId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

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

// 续读位置不进 zustand 响应式 state（滚动中会高频写入，避免触发无关 re-render），
// 用模块级对象 + localStorage 承载，仅通过下方 action 读写。
const positionKey = (bookId: string, chapterId: string) => `${bookId}::${chapterId}`
let readingPositions: Record<string, ReadingPosition> = readJson<Record<string, ReadingPosition>>(POSITIONS_KEY, {})

const saveReadingPositionImpl = (bookId: string, chapterId: string, pos: { readerPage?: number; scrollRatio?: number }) => {
  readingPositions = {
    ...readingPositions,
    [positionKey(bookId, chapterId)]: { bookId, chapterId, ...pos, updatedAt: Date.now() },
  }
  writeJson(POSITIONS_KEY, readingPositions)
}

const getReadingPositionImpl = (bookId: string, chapterId: string): ReadingPosition | undefined =>
  readingPositions[positionKey(bookId, chapterId)]

export const useNovelStore = create<NovelState>((set, get) => ({
  currentNovel: null,
  currentChapter: null,
  history: readJson<NovelHistoryItem[]>(HISTORY_KEY, []),
  favorites: readJson<NovelListItem[]>(FAVORITES_KEY, []),
  localBooks: readJson<LocalBook[]>(LOCAL_BOOKS_KEY, []),
  bookmarks: readJson<NovelBookmark[]>(BOOKMARKS_KEY, []),

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

  addLocalBooks: (books) => set((state) => {
    const existing = new Set(state.localBooks.map((book) => book.id))
    const merged = [...state.localBooks]
    for (const book of books) {
      if (!existing.has(book.id)) merged.push(book)
    }
    writeJson(LOCAL_BOOKS_KEY, merged)
    return { localBooks: merged }
  }),

  removeLocalBook: (id) => set((state) => {
    const next = state.localBooks.filter((book) => book.id !== id)
    writeJson(LOCAL_BOOKS_KEY, next)
    return { localBooks: next }
  }),

  getLocalBook: (id) => get().localBooks.find((book) => book.id === id),

  addBookmark: (bookmark) => set((state) => {
    const next = [{ ...bookmark, id: newId(), createdAt: Date.now() }, ...state.bookmarks].slice(0, 500)
    writeJson(BOOKMARKS_KEY, next)
    return { bookmarks: next }
  }),

  updateBookmarkNote: (id, note) => set((state) => {
    const next = state.bookmarks.map((bookmark) => (bookmark.id === id ? { ...bookmark, note } : bookmark))
    writeJson(BOOKMARKS_KEY, next)
    return { bookmarks: next }
  }),

  removeBookmark: (id) => set((state) => {
    const next = state.bookmarks.filter((bookmark) => bookmark.id !== id)
    writeJson(BOOKMARKS_KEY, next)
    return { bookmarks: next }
  }),

  getBookmarks: (bookId) => get()
    .bookmarks
    .filter((bookmark) => bookmark.bookId === bookId)
    .sort((a, b) => b.createdAt - a.createdAt),

  saveReadingPosition: (bookId, chapterId, pos) => saveReadingPositionImpl(bookId, chapterId, pos),
  getReadingPosition: (bookId, chapterId) => getReadingPositionImpl(bookId, chapterId),
}))
