import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, Bookmark, BookmarkPlus, Check, ChevronLeft, ChevronRight, Clock, CornerDownLeft, List, Pause, Pencil, Play, Search, SearchX, Settings2, Trash2, X } from 'lucide-react'
import StatusState from '@/components/StatusState'
import ReadStateBadge from '@/components/ReadStateBadge'
import novelApi from '@/services/novelApi'
import type { LocalBook, NovelDetail, NovelChapter, NovelListItem, NovelSourceId } from '@/types/novel'
import { useNovelStore } from '@/stores/novelStore'
import { cn } from '@/utils/cn'

const CHARS_PER_PAGE = 1800
const READER_MODE_STORAGE_KEY = 'novel-reader-mode'
const READER_FONT_SIZE_STORAGE_KEY = 'novel-reader-font-size'
const READER_THEME_STORAGE_KEY = 'novel-reader-theme'
const READER_LINE_HEIGHT_STORAGE_KEY = 'novel-reader-line-height'
const READER_WIDTH_STORAGE_KEY = 'novel-reader-width'
const READER_AUTO_CONTINUE_STORAGE_KEY = 'novel-reader-auto-continue'

// 自动续读节奏：分页模式按固定间隔翻页；连续滚动模式匀速自动下滚（提词器式）。
const AUTO_CONTINUE_PAGED_INTERVAL = 5000
const AUTO_SCROLL_TICK_MS = 50             // 自动下滚每帧间隔（ms）
const AUTO_SCROLL_VIEWPORT_RATIO = 0.005   // 每帧下滚距离 = 视口高度 × 该比例
const AUTO_SCROLL_RESUME_MS = 1200         // 用户手动滚动后，自动下滚暂停时长（ms）

type ReaderMode = 'paged' | 'scroll'

const READER_THEMES = {
  paper: { bg: '#fff8ee', text: '#1c1917', sub: '#78716c' },
  sepia: { bg: '#f0e6d2', text: '#4b3b2a', sub: '#8a7a63' },
  green: { bg: '#cfe8cf', text: '#1f3d23', sub: '#4f7a52' },
  dark: { bg: '#0c0a09', text: '#e7e5e4', sub: '#a8a29e' },
} as const
type ReaderTheme = keyof typeof READER_THEMES

const WIDTH_CLASS: Record<string, string> = {
  narrow: 'max-w-2xl',
  normal: 'max-w-3xl',
  wide: 'max-w-4xl',
}

const readReaderMode = (): ReaderMode => {
  if (typeof window === 'undefined') return 'paged'
  return window.localStorage.getItem(READER_MODE_STORAGE_KEY) === 'scroll' ? 'scroll' : 'paged'
}

const readReaderFontSize = () => {
  if (typeof window === 'undefined') return 18
  const value = Number(window.localStorage.getItem(READER_FONT_SIZE_STORAGE_KEY) || '18')
  return Number.isFinite(value) ? Math.min(24, Math.max(15, value)) : 18
}

const readAutoContinue = (): boolean => {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(READER_AUTO_CONTINUE_STORAGE_KEY) === '1'
}

const clampNumber = (value: number, min: number, max: number, fallback: number) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback

// 主内容区滚动容器：布局层用 .app-content-scroll（overflow-y-auto h-full）承载页面滚动，而非 window。
// 阅读器的「回顶 / 到底检测 / 平滑下滚」都必须作用在这个容器上，否则在桌面端会完全静默失效。
const getScrollContainer = (): HTMLElement | null => {
  if (typeof document === 'undefined') return null
  return document.querySelector<HTMLElement>('.app-content-scroll')
}

// 跨「切章重挂载」的临时跳转目标（书签跳转 / 续读位置恢复共用）：PageTransition 用 pathname 作 key，
// 切章会卸载并重挂载阅读器，组件内的 ref/state 随之清零，故必须存于模块级才能跨重挂载存活。
// loadChapter 在加载某章内容前，若 pendingJump 尚未被书签跳转占用，则写入该章已保存的续读位置，
// 实现「打开即回到上次读到的精确位置」；书签跳转会先抢占 pendingJump，确保其位置优先。
let pendingJump: { readerPage?: number; scrollRatio?: number } | null = null

// 取当前滚动容器内的阅读位置比例（0-1），用于书签在滚动模式下记录/恢复位置。
const getScrollRatio = (): number => {
  const el = getScrollContainer()
  if (!el || el.scrollHeight <= el.clientHeight) return 0
  return Math.min(1, Math.max(0, el.scrollTop / (el.scrollHeight - el.clientHeight)))
}

const formatBookmarkTime = (ts: number): string => {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const bookmarkPositionLabel = (bm: { readerPage?: number; scrollRatio?: number }): string => {
  if (bm.readerPage != null) return `第 ${bm.readerPage} 页`
  if (bm.scrollRatio != null) return `约 ${Math.round(bm.scrollRatio * 100)}%`
  return ''
}

// 把本地导入的书籍（LocalBook）合成为阅读器所需的 NovelDetail，使其与在线书源走同一套渲染逻辑。
const localBookToDetail = (book: LocalBook): NovelDetail => {
  const chapters: NovelChapter[] = book.chapters.map((chapter) => ({
    id: chapter.id,
    title: chapter.title,
  }))
  const listItem: NovelListItem = {
    id: book.id,
    rawId: book.id,
    sourceId: 'local' as NovelSourceId,
    sourceName: book.sourceName,
    name: book.name,
    author: book.author,
    cover: book.cover,
  }
  return { ...listItem, chapters }
}

export default function NovelReaderPage() {
  const { id, chapterId } = useParams<{ id: string; chapterId: string }>()
  const navigate = useNavigate()
  const setCurrentNovel = useNovelStore((state) => state.setCurrentNovel)
  const setCurrentChapter = useNovelStore((state) => state.setCurrentChapter)
  const upsertHistory = useNovelStore((state) => state.upsertHistory)
  const novelHistory = useNovelStore((state) => state.history)
  const bookmarks = useNovelStore((state) => state.bookmarks)
  const addBookmark = useNovelStore((state) => state.addBookmark)
  const updateBookmarkNote = useNovelStore((state) => state.updateBookmarkNote)
  const removeBookmark = useNovelStore((state) => state.removeBookmark)
  const saveReadingPosition = useNovelStore((state) => state.saveReadingPosition)
  const getReadingPosition = useNovelStore((state) => state.getReadingPosition)
  const [detail, setDetail] = useState<NovelDetail | null>(null)
  const [content, setContent] = useState<string>('')
  const [title, setTitle] = useState('')
  const [readerPage, setReaderPage] = useState(1)
  const [mode, setMode] = useState<ReaderMode>(() => readReaderMode())
  const [fontSize, setFontSize] = useState(() => readReaderFontSize())
  const [theme, setTheme] = useState<ReaderTheme>(() => {
    if (typeof window === 'undefined') return 'paper'
    const value = window.localStorage.getItem(READER_THEME_STORAGE_KEY)
    return (value && value in READER_THEMES ? value : 'paper') as ReaderTheme
  })
  const [lineHeight, setLineHeight] = useState(() => {
    const value = Number(window.localStorage.getItem(READER_LINE_HEIGHT_STORAGE_KEY) || '1.95')
    return clampNumber(value, 1.5, 2.4, 1.95)
  })
  const [contentWidth, setContentWidth] = useState<'narrow' | 'normal' | 'wide'>(() => {
    if (typeof window === 'undefined') return 'normal'
    const value = window.localStorage.getItem(READER_WIDTH_STORAGE_KEY)
    return value === 'narrow' || value === 'wide' ? value : 'normal'
  })
  // 自动续读偏好持久化：路由在切章时会因 pathname 变化而重挂载本组件（见 PageTransition 的 key），
  // 若不持久化，每次切章都会把 autoContinue 重置为 false，表现为「自动续读翻页后自己关掉」。
  const [autoContinue, setAutoContinue] = useState<boolean>(() => readAutoContinue())
  const [showSettings, setShowSettings] = useState(false)
  const [showToc, setShowToc] = useState(false)
  const [tocKeyword, setTocKeyword] = useState('')
  const [tocJump, setTocJump] = useState('')
  const [showBookmarks, setShowBookmarks] = useState(false)
  const [showAddNote, setShowAddNote] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editNoteDraft, setEditNoteDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const tocScrollRef = useRef<HTMLDivElement>(null)
  // 每次加载递增，只有最新一次请求的回调允许写状态，避免切章/重试造成的竞态。
  const loadTokenRef = useRef(0)
  // 用户手动滚动（滚轮/触摸）的时间戳；自动下滚时会据此暂停一小段时间，避免与手动浏览打架。
  const userScrollPauseRef = useRef(0)
  // 续读位置写入防抖计时器；滚动模式滚动 / 分页模式翻页时高频触发，统一 600ms 防抖落库。
  const saveTimerRef = useRef<number | null>(null)

  const loadChapter = useCallback(() => {
    if (!id || !chapterId) return
    const token = loadTokenRef.current + 1
    loadTokenRef.current = token
    const cancelled = () => loadTokenRef.current !== token
    setLoading(true)
    setError(null)
    let loadedDetail: NovelDetail | null = null

    // 本地导入书籍：不经过在线 API，直接从本地书架取内容并合成详情。
    if (id.startsWith('local:')) {
      const book = useNovelStore.getState().getLocalBook(id)
      if (cancelled()) return
      if (!book) {
        setError('未找到该本地书籍，可能已被移除。可在「小说库 › 本地书架」重新导入。')
        setLoading(false)
        return
      }
      const built = localBookToDetail(book)
      const target = built.chapters.find((chapter) => chapter.id === chapterId) || built.chapters[0]
      if (!target) {
        setError('该书籍没有可读章节')
        setLoading(false)
        return
      }
      const localChapter = book.chapters.find((chapter) => chapter.id === target.id)
      loadedDetail = built
      setDetail(built)
      setTitle(target.title)
      // 续读：若未被书签跳转抢占，则恢复本章已保存的精确位置（章内页码 / 滚动比例）。
      if (!pendingJump) {
        const saved = getReadingPosition(built.id, target.id)
        if (saved) pendingJump = { readerPage: saved.readerPage, scrollRatio: saved.scrollRatio }
      }
      setContent(localChapter?.content ?? '')
      setReaderPage(1)
      // 记录真实阅读进度：合成 NovelListItem 用于「继续阅读」与目录「上次读到」标记。
      upsertHistory({ novel: built, chapter: { id: target.id, title: target.title }, readAt: Date.now() })
      setLoading(false)
      return
    }

    novelApi.getDetail(id)
      .then((data) => {
        if (cancelled()) return
        loadedDetail = data
        setDetail(data)
        return novelApi.getChapter(id, chapterId, data?.sourceId)
      })
      .then((chapter) => {
        if (cancelled() || !chapter) return
        setTitle(chapter.title)
        // 续读：若未被书签跳转抢占，则恢复本章已保存的精确位置。
        if (!pendingJump && loadedDetail) {
          const saved = getReadingPosition(loadedDetail.id, chapterId)
          if (saved) pendingJump = { readerPage: saved.readerPage, scrollRatio: saved.scrollRatio }
        }
        setContent(chapter.content)
        setReaderPage(1)
        if (loadedDetail) {
          const matchedChapter = loadedDetail.chapters.find((item) => item.id === chapterId) || { id: chapterId, title: chapter.title }
          setCurrentNovel(loadedDetail, matchedChapter)
          // 记录真实阅读进度：从详情页进入或阅读器内翻章都会落到这里，保证「继续阅读」反映当前章节。
          upsertHistory({ novel: loadedDetail, chapter: matchedChapter, readAt: Date.now() })
        }
      })
      .catch((err) => {
        console.error('Load novel chapter failed:', err)
        if (!cancelled()) setError(err instanceof Error ? err.message : '加载章节失败')
      })
      .finally(() => {
        if (!cancelled()) setLoading(false)
      })
  }, [chapterId, getReadingPosition, id, setCurrentNovel, upsertHistory])

  useEffect(() => {
    loadChapter()
    // 卸载或换章时作废进行中的请求。
    return () => { loadTokenRef.current += 1 }
  }, [loadChapter])

  useEffect(() => {
    return () => setCurrentChapter(null)
  }, [setCurrentChapter])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(READER_MODE_STORAGE_KEY, mode)
  }, [mode])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(READER_FONT_SIZE_STORAGE_KEY, String(fontSize))
  }, [fontSize])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(READER_THEME_STORAGE_KEY, theme)
  }, [theme])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(READER_LINE_HEIGHT_STORAGE_KEY, String(lineHeight))
  }, [lineHeight])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(READER_WIDTH_STORAGE_KEY, contentWidth)
  }, [contentWidth])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(READER_AUTO_CONTINUE_STORAGE_KEY, autoContinue ? '1' : '0')
  }, [autoContinue])

  const chapters = detail?.chapters || []
  const currentIndex = chapters.findIndex((chapter) => chapter.id === chapterId)
  const prevChapter = currentIndex > 0 ? chapters[currentIndex - 1] : null
  const nextChapter = currentIndex >= 0 && currentIndex < chapters.length - 1 ? chapters[currentIndex + 1] : null
  const normalizedContent = content || '暂无内容'
  const pages = useMemo(() => {
    const nextPages: string[] = []
    const paragraphs = normalizedContent.split(/\n{2,}/)
    let current = ''

    for (const paragraph of paragraphs) {
      const next = current ? `${current}\n\n${paragraph}` : paragraph
      if (next.length > CHARS_PER_PAGE && current) {
        nextPages.push(current)
        current = paragraph
      } else {
        current = next
      }
    }

    if (current) nextPages.push(current)
    if (!nextPages.length) nextPages.push('暂无内容')
    return nextPages
  }, [normalizedContent])
  const currentReaderPage = Math.min(readerPage, pages.length)

  // 翻页 / 切章后强制回到顶部：依赖 content（切章）与 currentReaderPage（翻页），
  // 作用在真实滚动容器（.app-content-scroll）上，彻底修复「翻页后仍在底部」。
  // 若存在待恢复的书签跳转（跨章重挂载场景），则优先恢复书签位置而非回顶。
  useEffect(() => {
    if (!content) return
    if (pendingJump) {
      const pending = pendingJump
      pendingJump = null
      if (mode === 'scroll' && pending.scrollRatio != null) {
        const apply = () => {
          const el = getScrollContainer()
          if (el) el.scrollTop = pending.scrollRatio! * Math.max(0, el.scrollHeight - el.clientHeight)
        }
        requestAnimationFrame(apply)
        return
      }
      if (pending.readerPage != null) {
        setReaderPage(pending.readerPage)
        const el = getScrollContainer()
        if (el) el.scrollTo({ top: 0 })
        else if (typeof window !== 'undefined') window.scrollTo({ top: 0 })
        return
      }
    }
    const scroller = getScrollContainer()
    if (scroller) scroller.scrollTo({ top: 0, behavior: 'smooth' })
    else if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [content, currentReaderPage, mode])

  // 用户手动滚动（滚轮/触摸）时记录时间戳，自动下滚据此暂停一小段，避免「自动下滚」与「手动浏览」打架。
  // 监听挂在真实滚动容器 .app-content-scroll 上；容器未就绪时回退到 window（滚轮事件会冒泡到 window）。
  useEffect(() => {
    if (typeof window === 'undefined') return
    const target: HTMLElement | Window = getScrollContainer() ?? window
    const pause = () => { userScrollPauseRef.current = Date.now() }
    target.addEventListener('wheel', pause, { passive: true })
    target.addEventListener('touchmove', pause, { passive: true })
    return () => {
      target.removeEventListener('wheel', pause)
      target.removeEventListener('touchmove', pause)
    }
  }, [mode])

  const goChapter = useCallback((chapterIdValue: string) => {
    if (!detail) return
    setShowToc(false)
    navigate(`/novel/${detail.id}/chapter/${chapterIdValue}`, { replace: true })
  }, [detail, navigate])

  const goBackToDetail = useCallback(() => {
    navigate(id ? `/novel/${id}` : '/novel', { replace: true })
  }, [id, navigate])

  const prevPage = useCallback(() => {
    const scroller = getScrollContainer()
    if (mode === 'scroll' && scroller && scroller.scrollTop > 120) {
      scroller.scrollBy({ top: -Math.floor(scroller.clientHeight * 0.86), behavior: 'smooth' })
      return
    }
    if (currentReaderPage > 1) {
      setReaderPage((value) => Math.max(1, value - 1))
    } else if (prevChapter) {
      goChapter(prevChapter.id)
    }
  }, [currentReaderPage, goChapter, mode, prevChapter])

  const nextPage = useCallback(() => {
    const scroller = getScrollContainer()
    if (mode === 'scroll') {
      const nearBottom = scroller
        ? scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 120
        : window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 120
      if (!nearBottom) {
        const viewportHeight = scroller ? scroller.clientHeight : window.innerHeight
        if (scroller) scroller.scrollBy({ top: Math.floor(viewportHeight * 0.86), behavior: 'smooth' })
        else window.scrollBy({ top: Math.floor(viewportHeight * 0.86), behavior: 'smooth' })
        return
      }
      // 到底则进入下一章（滚动模式不分页，直接跳章）。
      if (nextChapter) goChapter(nextChapter.id)
      else setAutoContinue(false)
      return
    }

    if (currentReaderPage < pages.length) {
      setReaderPage((value) => Math.min(pages.length, value + 1))
    } else if (nextChapter) {
      goChapter(nextChapter.id)
    } else {
      setAutoContinue(false)
    }
  }, [currentReaderPage, goChapter, mode, nextChapter, pages.length])

  // 自动续读：
  // - 分页模式：按固定节奏自动翻页；用 nextPageRef 持有最新实现，避免每翻一页（currentReaderPage 变化会重建 nextPage）就重置计时器，保证节奏稳定。
  // - 连续滚动模式：匀速自动下滚（提词器式）；滚到章末自动进入下一章；无下一章则视为读到末尾并自动关闭。
  const nextPageRef = useRef<() => void>(() => {})
  useEffect(() => { nextPageRef.current = nextPage }, [nextPage])

  useEffect(() => {
    if (!autoContinue || loading || error) return
    if (mode === 'paged') {
      const timer = window.setInterval(() => nextPageRef.current(), AUTO_CONTINUE_PAGED_INTERVAL)
      return () => window.clearInterval(timer)
    }
    if (!nextChapter) {
      setAutoContinue(false)
      return
    }
    const step = Math.max(1, Math.round((getScrollContainer()?.clientHeight || 800) * AUTO_SCROLL_VIEWPORT_RATIO))
    const timer = window.setInterval(() => {
      // 用户刚手动滚动过则暂停，让手动浏览不被自动下滚打断。
      if (Date.now() - userScrollPauseRef.current < AUTO_SCROLL_RESUME_MS) return
      const el = getScrollContainer()
      if (!el) return
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) {
        goChapter(nextChapter.id)
        return
      }
      el.scrollTop += step
    }, AUTO_SCROLL_TICK_MS)
    return () => window.clearInterval(timer)
  }, [autoContinue, error, goChapter, loading, mode, nextChapter])

  // 键盘快捷键：
  // - → / Space / PageDown：下一页（滚动模式为下滚一屏，到底进下一章）
  // - ← / PageUp：上一页（滚动模式为上滚一屏，到顶进上一章）
  // - ↑/k、↓/j：手动上/下滚动一屏（滚动浏览，并暂停自动续读一小段）
  // - t / b / s：开关目录 / 书签 / 设置抽屉
  // - Esc：优先关闭已打开的抽屉，否则返回详情页
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return
      const key = event.key
      if (key === 'Escape') {
        if (showToc || showSettings || showBookmarks) {
          setShowToc(false)
          setShowSettings(false)
          setShowBookmarks(false)
        } else {
          goBackToDetail()
        }
        return
      }
      if (key === 't' || key === 'T') { setShowToc((value) => !value); return }
      if (key === 'b' || key === 'B') { setShowBookmarks((value) => !value); return }
      if (key === 's' || key === 'S') { setShowSettings((value) => !value); return }
      if (key === 'ArrowRight' || key === ' ' || key === 'PageDown') {
        event.preventDefault()
        nextPage()
        return
      }
      if (key === 'ArrowLeft' || key === 'PageUp') {
        event.preventDefault()
        prevPage()
        return
      }
      if (key === 'ArrowDown' || key === 'j' || key === 'J') {
        event.preventDefault()
        const el = getScrollContainer()
        const vh = el ? el.clientHeight : window.innerHeight
        if (el) el.scrollBy({ top: Math.floor(vh * 0.86), behavior: 'smooth' })
        else window.scrollBy({ top: Math.floor(vh * 0.86), behavior: 'smooth' })
        userScrollPauseRef.current = Date.now()
        return
      }
      if (key === 'ArrowUp' || key === 'k' || key === 'K') {
        event.preventDefault()
        const el = getScrollContainer()
        const vh = el ? el.clientHeight : window.innerHeight
        if (el) el.scrollBy({ top: -Math.floor(vh * 0.86), behavior: 'smooth' })
        else window.scrollBy({ top: -Math.floor(vh * 0.86), behavior: 'smooth' })
        userScrollPauseRef.current = Date.now()
        return
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [goBackToDetail, nextPage, prevPage, showToc, showSettings, showBookmarks, setShowToc, setShowSettings, setShowBookmarks])

  const filteredChapters = useMemo(() => {
    const kw = tocKeyword.trim().toLowerCase()
    if (!kw) return chapters
    return chapters.filter((chapter) => chapter.title.toLowerCase().includes(kw))
  }, [chapters, tocKeyword])

  // 目录虚拟滚动：长篇小说（可达数千章）避免一次性渲染全部 DOM，仅渲染可视区域。
  const tocVirtualizer = useVirtualizer({
    count: filteredChapters.length,
    getScrollElement: () => tocScrollRef.current,
    estimateSize: () => 46,
    overscan: 12,
  })

  useEffect(() => {
    if (showToc) tocVirtualizer.measure()
  }, [showToc, tocVirtualizer])

  // 目录里的「上次读到」标记：取本书 readAt 最新的一条历史。
  const lastReadChapterId = useMemo(() => {
    if (!detail) return null
    const matched = novelHistory.filter((item) => item.novel.id === detail.id && item.chapter?.id)
    if (!matched.length) return null
    return matched.reduce((latest, item) => (item.readAt > latest.readAt ? item : latest)).chapter?.id || null
  }, [detail, novelHistory])

  const readChapterCount = currentIndex >= 0 ? currentIndex + 1 : 0
  const readProgressPercent = chapters.length ? Math.round((readChapterCount / chapters.length) * 100) : 0

  // 本书的书签：按「章节顺序 → 章节内位置」排序，导航时比按创建时间更直观。
  const bookBookmarks = useMemo(() => {
    if (!detail) return []
    const order = new Map(detail.chapters.map((chapter, index) => [chapter.id, index]))
    return bookmarks
      .filter((bookmark) => bookmark.bookId === detail.id)
      .sort((a, b) => {
        const ai = order.get(a.chapterId) ?? Number.MAX_SAFE_INTEGER
        const bi = order.get(b.chapterId) ?? Number.MAX_SAFE_INTEGER
        if (ai !== bi) return ai - bi
        const ap = a.scrollRatio ?? (a.readerPage ?? 0)
        const bp = b.scrollRatio ?? (b.readerPage ?? 0)
        return ap - bp
      })
  }, [bookmarks, detail])

  // 在当前阅读位置插入书签：分页模式记页码，滚动模式记滚动比例；附带正文摘录与（可选）批注。
  const addBookmarkAtCurrent = useCallback(() => {
    if (!detail || !chapterId) return
    let readerPage: number | undefined
    let scrollRatio: number | undefined
    let snippet = ''
    if (mode === 'paged') {
      readerPage = currentReaderPage
      snippet = (pages[currentReaderPage - 1] || '').replace(/\s+/g, ' ').trim().slice(0, 42)
    } else {
      const ratio = getScrollRatio()
      scrollRatio = ratio
      const total = normalizedContent.length
      const start = Math.floor(ratio * total)
      snippet = normalizedContent.slice(start, start + 42).replace(/\s+/g, ' ').trim()
    }
    addBookmark({
      bookId: detail.id,
      chapterId,
      chapterTitle: title,
      readerPage,
      scrollRatio,
      snippet: snippet || undefined,
      note: noteDraft.trim() || undefined,
    })
    setNoteDraft('')
    setShowAddNote(false)
  }, [addBookmark, chapterId, currentReaderPage, detail, mode, noteDraft, normalizedContent, pages, title])

  // 跳转到书签：同章直接恢复位置（不触发重挂载），跨章则写入模块级 pending 并在新章节渲染后恢复。
  const jumpToBookmark = useCallback((bm: { chapterId: string; readerPage?: number; scrollRatio?: number }) => {
    setShowBookmarks(false)
    if (bm.chapterId === chapterId) {
      if (mode === 'scroll') {
        const el = getScrollContainer()
        if (el) el.scrollTop = (bm.scrollRatio ?? 0) * Math.max(0, el.scrollHeight - el.clientHeight)
      } else {
        setReaderPage(bm.readerPage ?? 1)
        const el = getScrollContainer()
        if (el) el.scrollTo({ top: 0 })
        else if (typeof window !== 'undefined') window.scrollTo({ top: 0 })
      }
      return
    }
    pendingJump = { readerPage: bm.readerPage, scrollRatio: bm.scrollRatio }
    goChapter(bm.chapterId)
  }, [chapterId, goChapter, mode])

  // 防抖保存当前章内阅读位置（续读用）：分页模式记页码，滚动模式记滚动比例。
  const scheduleSavePosition = useCallback(() => {
    if (!detail || !chapterId) return
    const pos = mode === 'paged'
      ? { readerPage: currentReaderPage }
      : { scrollRatio: getScrollRatio() }
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      saveReadingPosition(detail.id, chapterId, pos)
    }, 600)
  }, [chapterId, currentReaderPage, detail, mode, saveReadingPosition])

  // 续读位置保存：分页模式翻页即记录页码（防抖）。
  useEffect(() => {
    if (mode === 'paged' && detail && chapterId) scheduleSavePosition()
  }, [mode, detail, chapterId, currentReaderPage, scheduleSavePosition])

  // 续读位置保存：滚动模式监听容器 scroll 事件记录比例（防抖）。
  useEffect(() => {
    if (typeof window === 'undefined' || mode !== 'scroll') return
    const target: HTMLElement | Window = getScrollContainer() ?? window
    const onScroll = () => scheduleSavePosition()
    target.addEventListener('scroll', onScroll, { passive: true })
    return () => target.removeEventListener('scroll', onScroll)
  }, [mode, scheduleSavePosition])

  const jumpToChapterNumber = useCallback(() => {
    const value = Number.parseInt(tocJump, 10)
    if (!Number.isFinite(value)) return
    const target = chapters[value - 1]
    if (!target) return
    setTocJump('')
    goChapter(target.id)
  }, [chapters, goChapter, tocJump])

  const themeStyle = READER_THEMES[theme]

  if (loading) {
    return (
      <div className="grid h-[calc(100vh-200px)] place-items-center">
        <StatusState variant="loading" />
      </div>
    )
  }

  if (error || !detail) {
    return (
      <div className="pb-8">
        <button onClick={goBackToDetail} className="mb-6 flex items-center gap-2 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"><ArrowLeft className="h-5 w-5" />返回</button>
        <StatusState
          variant="error"
          title="加载失败"
          description={error || '未找到章节'}
          actionLabel="重试"
          onAction={loadChapter}
        />
      </div>
    )
  }

  const canGoPrev = Boolean(prevChapter) || currentReaderPage > 1
  const canGoNext = Boolean(nextChapter) || currentReaderPage < pages.length || mode === 'scroll'

  return (
    <div className="pb-10 max-w-5xl mx-auto">
      <div className="sticky top-0 z-20 -mx-2 mb-4 rounded-b-3xl border-x border-b border-black/5 bg-[var(--bg-primary)]/88 px-2 py-3 backdrop-blur-xl dark:border-white/10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button onClick={goBackToDetail} className="flex items-center gap-2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">
            <ArrowLeft className="h-5 w-5" />返回目录
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setShowToc((value) => !value)} className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold', showToc ? 'border-amber-500 bg-amber-500 text-white' : 'border-black/10 dark:border-white/10')}>
              <List className="h-4 w-4" /> 目录
            </button>
            <button onClick={() => setMode((value) => value === 'paged' ? 'scroll' : 'paged')} className="rounded-full border border-black/10 px-3 py-1.5 text-sm font-semibold dark:border-white/10">
              {mode === 'paged' ? '整页阅读' : '连续滚动'}
            </button>
            <button onClick={() => setAutoContinue((value) => !value)} className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold', autoContinue ? 'border-amber-500 bg-amber-500 text-white' : 'border-black/10 dark:border-white/10')}>
              {autoContinue ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              自动续读
            </button>
            <button onClick={() => setShowBookmarks((value) => !value)} className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold', showBookmarks ? 'border-amber-500 bg-amber-500 text-white' : 'border-black/10 dark:border-white/10')}>
              <Bookmark className="h-4 w-4" /> 书签
              {bookBookmarks.length > 0 && (
                <span className={cn('ml-0.5 min-w-5 rounded-full px-1.5 py-0.5 text-center text-xs font-bold', showBookmarks ? 'bg-white text-amber-600' : 'bg-amber-500 text-white')}>
                  {bookBookmarks.length}
                </span>
              )}
            </button>
            <button onClick={() => setShowSettings((value) => !value)} className="rounded-full border border-black/10 px-3 py-1.5 text-sm font-semibold dark:border-white/10">
              <Settings2 className="inline h-4 w-4" /> 设置
            </button>
          </div>
        </div>
        {showSettings && (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl bg-black/5 p-3 text-sm dark:bg-white/5">
            <div className="flex items-center gap-2">
              <span className="text-[var(--text-muted)]">字号</span>
              <button onClick={() => setFontSize((value) => Math.max(15, value - 1))} className="rounded-full border border-black/10 px-3 py-1 dark:border-white/10">A-</button>
              <span className="min-w-8 text-center font-semibold">{fontSize}</span>
              <button onClick={() => setFontSize((value) => Math.min(24, value + 1))} className="rounded-full border border-black/10 px-3 py-1 dark:border-white/10">A+</button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[var(--text-muted)]">行距</span>
              {[1.6, 1.95, 2.2].map((value) => (
                <button key={value} onClick={() => setLineHeight(value)} className={cn('rounded-full border px-3 py-1', lineHeight === value ? 'border-amber-500 bg-amber-500 text-white' : 'border-black/10 dark:border-white/10')}>{value}</button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[var(--text-muted)]">版心</span>
              {([['narrow', '窄'], ['normal', '标准'], ['wide', '宽']] as const).map(([value, label]) => (
                <button key={value} onClick={() => setContentWidth(value)} className={cn('rounded-full border px-3 py-1', contentWidth === value ? 'border-amber-500 bg-amber-500 text-white' : 'border-black/10 dark:border-white/10')}>{label}</button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[var(--text-muted)]">主题</span>
              {([['paper', '纸白'], ['sepia', '米黄'], ['green', '护眼'], ['dark', '夜间']] as const).map(([value, label]) => (
                <button key={value} onClick={() => setTheme(value)} className={cn('rounded-full border px-3 py-1', theme === value ? 'border-amber-500 bg-amber-500 text-white' : 'border-black/10 dark:border-white/10')}>{label}</button>
              ))}
            </div>
            <span className="text-[var(--text-muted)]">快捷键：←/→、PageUp/PageDown、空格翻页，Esc 返回目录</span>
          </div>
        )}
      </div>

      <section className="overflow-hidden rounded-[1.75rem] border border-black/5 shadow-sm dark:border-white/10" style={{ backgroundColor: themeStyle.bg }}>
        <div className="border-b border-black/5 px-6 py-5 dark:border-white/10" style={{ color: themeStyle.sub }}>
          <p className="text-sm">{detail.name} · {detail.author || detail.sourceName}</p>
          <h1 className="mt-1 text-2xl font-black" style={{ color: themeStyle.text }}>{title || '正文'}</h1>
          <p className="mt-2 text-xs">
            第 {currentIndex >= 0 ? currentIndex + 1 : '-'} / {chapters.length || '-'} 章
            {mode === 'paged' ? ` · 第 ${currentReaderPage} / ${pages.length} 页` : ' · 连续滚动'}
            {autoContinue && <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-700 dark:text-amber-300">自动续读中</span>}
          </p>
        </div>

        <div className="relative">
          {mode === 'paged' && <button aria-label="上一页" onClick={prevPage} disabled={!canGoPrev} className="absolute inset-y-0 left-0 z-10 w-1/5 disabled:pointer-events-none" />}
          {mode === 'paged' && <button aria-label="下一页" onClick={nextPage} disabled={!canGoNext} className="absolute inset-y-0 right-0 z-10 w-1/5 disabled:pointer-events-none" />}
          <article
            className={cn('mx-auto min-h-[58vh] px-6 py-8 font-serif sm:px-10', WIDTH_CLASS[contentWidth])}
            style={{ fontSize, lineHeight, color: themeStyle.text, whiteSpace: 'pre-wrap' }}
          >
            {mode === 'paged' ? (pages[currentReaderPage - 1] || '暂无内容') : normalizedContent}
          </article>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-black/5 px-6 py-5 dark:border-white/10">
          <button onClick={prevPage} disabled={!canGoPrev} className="inline-flex items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-sm font-semibold disabled:opacity-40 dark:border-white/10" style={{ color: themeStyle.text }}>
            <ChevronLeft className="h-4 w-4" /> 上一页/章
          </button>
          <div className="text-center text-sm" style={{ color: themeStyle.sub }}>
            {mode === 'paged' ? `${currentReaderPage} / ${pages.length}` : '连续滚动模式'}
          </div>
          <button onClick={nextPage} disabled={!canGoNext} className="inline-flex items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-sm font-semibold disabled:opacity-40 dark:border-white/10" style={{ color: themeStyle.text }}>
            下一页/章 <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </section>

      <AnimatePresence>
        {showToc && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowToc(false)}
              className="fixed inset-0 z-30 bg-black/50"
            />
            <motion.aside
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'tween', duration: 0.25 }}
              className="fixed inset-y-0 right-0 z-40 flex w-[88%] max-w-sm flex-col border-l border-black/10 bg-[var(--bg-primary)] shadow-2xl dark:border-white/10"
            >
              <div className="flex items-center justify-between gap-2 border-b border-black/10 px-4 py-3 dark:border-white/10">
                <h2 className="text-lg font-black text-[var(--text-primary)]">目录</h2>
                <span className="text-sm text-[var(--text-muted)]">共 {chapters.length} 章</span>
                <button onClick={() => setShowToc(false)} className="rounded-full p-1.5 text-[var(--text-muted)] hover:bg-black/5 dark:hover:bg-white/10">
                  <ArrowLeft className="h-5 w-5" />
                </button>
              </div>
              <div className="space-y-3 px-4 py-3">
                <div>
                  <p className="text-xs text-[var(--text-muted)]">
                    已读 {readChapterCount} / {chapters.length || '-'} 章 · {readProgressPercent}%
                  </p>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                    <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${readProgressPercent}%` }} />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={chapters.length || 1}
                    value={tocJump}
                    onChange={(event) => setTocJump(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') return
                      event.preventDefault()
                      jumpToChapterNumber()
                    }}
                    placeholder={`跳转到第 N 章（1-${chapters.length || 1}）`}
                    className="min-w-0 flex-1 rounded-xl bg-black/5 px-3 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] dark:bg-white/5"
                  />
                  <button
                    onClick={jumpToChapterNumber}
                    className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-amber-500 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-600"
                  >
                    <CornerDownLeft className="h-4 w-4" /> 前往
                  </button>
                </div>
                <div className="flex items-center gap-2 rounded-xl bg-black/5 px-3 py-2 dark:bg-white/5">
                  <Search className="h-4 w-4 text-[var(--text-muted)]" />
                  <input
                    value={tocKeyword}
                    onChange={(event) => setTocKeyword(event.target.value)}
                    placeholder="搜索章节名"
                    className="min-w-0 flex-1 bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
                  />
                </div>
              </div>
              <div ref={tocScrollRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-4 scrollbar-thin">
                {filteredChapters.length === 0 ? (
                  <StatusState variant="empty" icon={SearchX} title="没有匹配的章节" description="换个关键词再搜搜" compact />
                ) : (
                  <div style={{ height: tocVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
                    {tocVirtualizer.getVirtualItems().map((virtualRow) => {
                      const chapter = filteredChapters[virtualRow.index]
                      const active = chapter.id === chapterId
                      const lastRead = chapter.id === lastReadChapterId
                      return (
                        <div
                          key={chapter.id}
                          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: virtualRow.size, transform: `translateY(${virtualRow.start}px)` }}
                        >
                          <button
                            onClick={() => goChapter(chapter.id)}
                            title={lastRead ? `${chapter.title} · 上次读到` : chapter.title}
                            className={cn(
                              'flex h-full w-full items-center gap-2 rounded-xl px-3 text-left text-sm transition-all',
                              active ? 'bg-amber-500 text-white' : 'text-[var(--text-secondary)] hover:bg-black/5 dark:hover:bg-white/10',
                            )}
                          >
                            <ReadStateBadge state={lastRead ? 'last' : 'none'} tone="amber" inverted={active} />
                            <span className="line-clamp-1">{chapter.title}</span>
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showBookmarks && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowBookmarks(false)}
              className="fixed inset-0 z-30 bg-black/50"
            />
            <motion.aside
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'tween', duration: 0.25 }}
              className="fixed inset-y-0 right-0 z-40 flex w-[88%] max-w-sm flex-col border-l border-black/10 bg-[var(--bg-primary)] shadow-2xl dark:border-white/10"
            >
              <div className="flex items-center justify-between gap-2 border-b border-black/10 px-4 py-3 dark:border-white/10">
                <h2 className="text-lg font-black text-[var(--text-primary)]">书签 / 笔记</h2>
                <span className="text-sm text-[var(--text-muted)]">共 {bookBookmarks.length} 条</span>
                <button onClick={() => setShowBookmarks(false)} className="rounded-full p-1.5 text-[var(--text-muted)] hover:bg-black/5 dark:hover:bg-white/10">
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="border-b border-black/10 px-4 py-3 dark:border-white/10">
                <button
                  onClick={() => { setShowAddNote((value) => !value); setNoteDraft('') }}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-amber-500 px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-600"
                >
                  <BookmarkPlus className="h-4 w-4" /> 在「{title || '当前位置'}」添加书签
                </button>
                {showAddNote && (
                  <div className="mt-3 rounded-2xl bg-black/5 p-3 dark:bg-white/5">
                    <p className="text-xs text-[var(--text-muted)]">
                      位置：{mode === 'paged' ? `第 ${currentReaderPage} 页` : `约 ${Math.round(getScrollRatio() * 100)}%`}
                      {mode === 'paged' ? ` · ${pages.length} 页` : ''}
                    </p>
                    <textarea
                      value={noteDraft}
                      onChange={(event) => setNoteDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); addBookmarkAtCurrent() }
                      }}
                      placeholder="写点笔记（可选）…  Ctrl/⌘+Enter 保存"
                      rows={3}
                      className="mt-2 w-full resize-none rounded-xl bg-black/5 px-3 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] dark:bg-white/5"
                    />
                    <div className="mt-2 flex justify-end gap-2">
                      <button onClick={() => { setShowAddNote(false); setNoteDraft('') }} className="rounded-full px-3 py-1.5 text-sm text-[var(--text-muted)] hover:bg-black/5 dark:hover:bg-white/10">取消</button>
                      <button onClick={addBookmarkAtCurrent} className="inline-flex items-center gap-1 rounded-full bg-amber-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-600"><Check className="h-4 w-4" /> 保存</button>
                    </div>
                  </div>
                )}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 scrollbar-thin">
                {bookBookmarks.length === 0 ? (
                  <StatusState variant="empty" icon={Bookmark} title="还没有书签" description="点击上方按钮，在想记住的地方插个书签吧" compact />
                ) : (
                  <ul className="space-y-2 py-3">
                    {bookBookmarks.map((bm) => {
                      const editing = editingNoteId === bm.id
                      return (
                        <li key={bm.id} className="rounded-2xl border border-black/5 bg-black/[0.03] p-3 dark:border-white/10 dark:bg-white/[0.03]">
                          <button onClick={() => jumpToBookmark(bm)} className="block w-full text-left">
                            <div className="flex items-center gap-2">
                              <span className="line-clamp-1 text-sm font-semibold text-[var(--text-primary)]">{bm.chapterTitle}</span>
                              <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">{bookmarkPositionLabel(bm)}</span>
                            </div>
                            {bm.snippet && <p className="mt-1 line-clamp-2 text-xs text-[var(--text-muted)]">“{bm.snippet}”</p>}
                            {bm.note && !editing && <p className="mt-1 line-clamp-3 rounded-lg bg-amber-500/10 px-2 py-1 text-xs text-[var(--text-secondary)]">📝 {bm.note}</p>}
                            <p className="mt-1 flex items-center gap-1 text-[11px] text-[var(--text-muted)]"><Clock className="h-3 w-3" />{formatBookmarkTime(bm.createdAt)}</p>
                          </button>
                          {editing ? (
                            <div className="mt-2">
                              <textarea
                                value={editNoteDraft}
                                onChange={(event) => setEditNoteDraft(event.target.value)}
                                onKeyDown={(event) => {
                                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); updateBookmarkNote(bm.id, editNoteDraft.trim() || ''); setEditingNoteId(null) }
                                }}
                                rows={2}
                                placeholder="编辑笔记…"
                                className="w-full resize-none rounded-xl bg-black/5 px-3 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] dark:bg-white/5"
                              />
                              <div className="mt-2 flex justify-end gap-2">
                                <button onClick={() => setEditingNoteId(null)} className="rounded-full px-3 py-1.5 text-sm text-[var(--text-muted)] hover:bg-black/5 dark:hover:bg-white/10">取消</button>
                                <button onClick={() => { updateBookmarkNote(bm.id, editNoteDraft.trim() || ''); setEditingNoteId(null) }} className="inline-flex items-center gap-1 rounded-full bg-amber-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-600"><Check className="h-4 w-4" /> 保存</button>
                              </div>
                            </div>
                          ) : (
                            <div className="mt-2 flex items-center gap-2">
                              <button onClick={() => { setEditingNoteId(bm.id); setEditNoteDraft(bm.note ?? '') }} className="inline-flex items-center gap-1 rounded-full border border-black/10 px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"><Pencil className="h-3.5 w-3.5" /> 笔记</button>
                              <button onClick={() => jumpToBookmark(bm)} className="inline-flex items-center gap-1 rounded-full border border-black/10 px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"><Bookmark className="h-3.5 w-3.5" /> 跳转</button>
                              <button onClick={() => removeBookmark(bm.id)} className="ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs text-red-500 hover:bg-red-500/10"><Trash2 className="h-3.5 w-3.5" /> 删除</button>
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
