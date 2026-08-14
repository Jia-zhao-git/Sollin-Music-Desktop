import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2, Pause, Play, Settings2 } from 'lucide-react'
import novelApi from '@/services/novelApi'
import type { NovelDetail } from '@/types/novel'
import { useNovelStore } from '@/stores/novelStore'
import { cn } from '@/utils/cn'

const CHARS_PER_PAGE = 1800
const READER_MODE_STORAGE_KEY = 'novel-reader-mode'
const READER_FONT_SIZE_STORAGE_KEY = 'novel-reader-font-size'

type ReaderMode = 'paged' | 'scroll'

const readReaderMode = (): ReaderMode => {
  if (typeof window === 'undefined') return 'paged'
  return window.localStorage.getItem(READER_MODE_STORAGE_KEY) === 'scroll' ? 'scroll' : 'paged'
}

const readReaderFontSize = () => {
  if (typeof window === 'undefined') return 18
  const value = Number(window.localStorage.getItem(READER_FONT_SIZE_STORAGE_KEY) || '18')
  return Number.isFinite(value) ? Math.min(24, Math.max(15, value)) : 18
}

export default function NovelReaderPage() {
  const { id, chapterId } = useParams<{ id: string; chapterId: string }>()
  const navigate = useNavigate()
  const setCurrentNovel = useNovelStore((state) => state.setCurrentNovel)
  const setCurrentChapter = useNovelStore((state) => state.setCurrentChapter)
  const [detail, setDetail] = useState<NovelDetail | null>(null)
  const [content, setContent] = useState<string>('')
  const [title, setTitle] = useState('')
  const [readerPage, setReaderPage] = useState(1)
  const [mode, setMode] = useState<ReaderMode>(() => readReaderMode())
  const [fontSize, setFontSize] = useState(() => readReaderFontSize())
  const [autoPaging, setAutoPaging] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id || !chapterId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setAutoPaging(false)
    let loadedDetail: NovelDetail | null = null

    novelApi.getDetail(id)
      .then((data) => {
        if (cancelled) return
        loadedDetail = data
        setDetail(data)
        return novelApi.getChapter(id, chapterId, data?.sourceId)
      })
      .then((chapter) => {
        if (cancelled || !chapter) return
        setTitle(chapter.title)
        setContent(chapter.content)
        setReaderPage(1)
        window.scrollTo({ top: 0, behavior: 'smooth' })
        if (loadedDetail) {
          const matchedChapter = loadedDetail.chapters.find((item) => item.id === chapterId) || { id: chapterId, title: chapter.title }
          setCurrentNovel(loadedDetail, matchedChapter)
        }
      })
      .catch((err) => {
        console.error('Load novel chapter failed:', err)
        if (!cancelled) setError(err instanceof Error ? err.message : '加载章节失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [chapterId, id, setCurrentNovel])

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

  const goChapter = useCallback((chapterIdValue: string) => {
    if (!detail) return
    navigate(`/novel/${detail.id}/chapter/${chapterIdValue}`, { replace: true })
  }, [detail, navigate])

  const goBackToDetail = useCallback(() => {
    navigate(id ? `/novel/${id}` : '/novel', { replace: true })
  }, [id, navigate])

  const prevPage = useCallback(() => {
    if (currentReaderPage > 1) {
      setReaderPage((value) => Math.max(1, value - 1))
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } else if (prevChapter) {
      goChapter(prevChapter.id)
    }
  }, [currentReaderPage, goChapter, prevChapter])

  const nextPage = useCallback(() => {
    if (mode === 'scroll') {
      const nearBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 120
      if (!nearBottom) {
        window.scrollBy({ top: Math.floor(window.innerHeight * 0.86), behavior: 'smooth' })
        return
      }
    }

    if (currentReaderPage < pages.length) {
      setReaderPage((value) => Math.min(pages.length, value + 1))
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } else if (nextChapter) {
      goChapter(nextChapter.id)
    } else {
      setAutoPaging(false)
    }
  }, [currentReaderPage, goChapter, mode, nextChapter, pages.length])

  useEffect(() => {
    if (!autoPaging || loading || error) return
    const timer = window.setInterval(() => nextPage(), 6500)
    return () => window.clearInterval(timer)
  }, [autoPaging, error, loading, nextPage])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return
      if (event.key === 'ArrowRight' || event.key === ' ' || event.key === 'PageDown') {
        event.preventDefault()
        nextPage()
      }
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault()
        prevPage()
      }
      if (event.key === 'Escape') goBackToDetail()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [goBackToDetail, nextPage, prevPage])

  if (loading) {
    return <div className="grid h-[calc(100vh-200px)] place-items-center"><Loader2 className="h-8 w-8 animate-spin text-amber-500" /></div>
  }

  if (error || !detail) {
    return (
      <div className="pb-8">
        <button onClick={goBackToDetail} className="mb-6 flex items-center gap-2 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"><ArrowLeft className="h-5 w-5" />返回</button>
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-6 text-red-600 dark:text-red-300">{error || '未找到章节'}</div>
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
            <button onClick={() => setMode((value) => value === 'paged' ? 'scroll' : 'paged')} className="rounded-full border border-black/10 px-3 py-1.5 text-sm font-semibold dark:border-white/10">
              {mode === 'paged' ? '整页阅读' : '连续滚动'}
            </button>
            <button onClick={() => setAutoPaging((value) => !value)} className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold', autoPaging ? 'border-amber-500 bg-amber-500 text-white' : 'border-black/10 dark:border-white/10')}>
              {autoPaging ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              自动翻页
            </button>
            <button onClick={() => setShowSettings((value) => !value)} className="rounded-full border border-black/10 px-3 py-1.5 text-sm font-semibold dark:border-white/10">
              <Settings2 className="inline h-4 w-4" /> 设置
            </button>
          </div>
        </div>
        {showSettings && (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl bg-black/5 p-3 text-sm dark:bg-white/5">
            <span className="text-[var(--text-muted)]">字号</span>
            <button onClick={() => setFontSize((value) => Math.max(15, value - 1))} className="rounded-full border border-black/10 px-3 py-1 dark:border-white/10">A-</button>
            <span className="min-w-8 text-center font-semibold">{fontSize}</span>
            <button onClick={() => setFontSize((value) => Math.min(24, value + 1))} className="rounded-full border border-black/10 px-3 py-1 dark:border-white/10">A+</button>
            <span className="text-[var(--text-muted)]">快捷键：←/→、PageUp/PageDown、空格翻页，Esc 返回目录</span>
          </div>
        )}
      </div>

      <section className="overflow-hidden rounded-[1.75rem] border border-black/5 bg-[#fff8ee] shadow-sm dark:border-white/10 dark:bg-stone-950/55">
        <div className="border-b border-black/5 px-6 py-5 dark:border-white/10">
          <p className="text-sm text-[var(--text-muted)]">{detail.name} · {detail.author || detail.sourceName}</p>
          <h1 className="mt-1 text-2xl font-black text-[var(--text-primary)]">{title || '正文'}</h1>
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            第 {currentIndex >= 0 ? currentIndex + 1 : '-'} / {chapters.length || '-'} 章
            {mode === 'paged' ? ` · 第 ${currentReaderPage} / ${pages.length} 页` : ' · 连续滚动'}
          </p>
        </div>

        <div className="relative">
          {mode === 'paged' && <button aria-label="上一页" onClick={prevPage} disabled={!canGoPrev} className="absolute inset-y-0 left-0 z-10 w-1/5 disabled:pointer-events-none" />}
          {mode === 'paged' && <button aria-label="下一页" onClick={nextPage} disabled={!canGoNext} className="absolute inset-y-0 right-0 z-10 w-1/5 disabled:pointer-events-none" />}
          <article
            className={cn('mx-auto min-h-[58vh] max-w-3xl whitespace-pre-wrap px-6 py-8 font-serif text-[var(--text-primary)] sm:px-10', mode === 'scroll' && 'max-w-4xl')}
            style={{ fontSize, lineHeight: 1.95 }}
          >
            {mode === 'paged' ? (pages[currentReaderPage - 1] || '暂无内容') : normalizedContent}
          </article>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-black/5 px-6 py-5 dark:border-white/10">
          <button onClick={prevPage} disabled={!canGoPrev} className="inline-flex items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-sm font-semibold disabled:opacity-40 dark:border-white/10">
            <ChevronLeft className="h-4 w-4" /> 上一页/章
          </button>
          <div className="text-center text-sm text-[var(--text-muted)]">
            {mode === 'paged' ? `${currentReaderPage} / ${pages.length}` : '连续滚动模式'}
          </div>
          <button onClick={nextPage} disabled={!canGoNext} className="inline-flex items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-sm font-semibold disabled:opacity-40 dark:border-white/10">
            下一页/章 <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </section>
    </div>
  )
}
