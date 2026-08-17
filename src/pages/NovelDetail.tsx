import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, BookOpen, Download, Heart, Loader2, Star } from 'lucide-react'
import novelApi from '@/services/novelApi'
import { useNovelStore } from '@/stores/novelStore'
import type { NovelChapter, NovelDetail } from '@/types/novel'
import { cn } from '@/utils/cn'

const FALLBACK_COVER = 'data:image/svg+xml;utf8,%3Csvg xmlns="http://www.w3.org/2000/svg" width="360" height="480" viewBox="0 0 360 480"%3E%3Crect width="360" height="480" rx="28" fill="%231c1917"/%3E%3Cpath d="M96 96h142a34 34 0 0 1 34 34v254H116a36 36 0 0 1-36-36V112a16 16 0 0 1 16-16z" fill="%23fff" opacity=".12"/%3E%3Ctext x="180" y="256" fill="%23fff" opacity=".55" font-family="serif" font-size="34" text-anchor="middle"%3EBook%3C/text%3E%3C/svg%3E'

const routePart = (value: string) => encodeURIComponent(value)

export default function NovelDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<NovelDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { history, toggleFavorite, isFavorite, setCurrentNovel, upsertHistory } = useNovelStore()

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoading(true)
    setError(null)

    novelApi.getDetail(id)
      .then((data) => {
        if (cancelled) return
        setDetail(data)
        if (data) {
          const latestHistory = history.find((item) => item.novel.id === data.id && item.chapter && data.chapters.some((chapter) => chapter.id === item.chapter?.id))
          setCurrentNovel(data, latestHistory?.chapter || data.chapters[0] || null)
        }
      })
      .catch((err) => {
        console.error('Load novel detail failed:', err)
        if (!cancelled) setError(err instanceof Error ? err.message : '加载小说详情失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [history, id, setCurrentNovel])

  const favorite = detail ? isFavorite(detail.id) : false
  const lastChapter = useMemo(() => detail ? history.find((item) => item.novel.id === detail.id)?.chapter : null, [detail, history])

  const readChapter = (chapter: NovelChapter) => {
    if (!detail) return
    upsertHistory({ novel: detail, chapter, readAt: Date.now() })
    navigate(`/novel/${routePart(detail.id)}/chapter/${routePart(chapter.id)}`)
  }

  const handleDownloadAndRead = async () => {
    if (!detail) return
    setDownloading(true)
    try {
      await novelApi.downloadBook(detail.id, detail.sourceId)
      navigate(`/novel/${routePart(detail.id)}/chapter/__downloaded__`)
    } catch (err) {
      console.error('Download novel failed:', err)
      setError(err instanceof Error ? err.message : '下载小说失败')
    } finally {
      setDownloading(false)
    }
  }

  if (loading) {
    return <div className="grid h-[calc(100vh-200px)] place-items-center"><Loader2 className="h-8 w-8 animate-spin text-amber-500" /></div>
  }

  if (error || !detail) {
    return (
      <div className="pb-8">
        <button onClick={() => navigate('/novel', { replace: true })} className="mb-6 flex items-center gap-2 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"><ArrowLeft className="h-5 w-5" />返回</button>
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-6 text-red-600 dark:text-red-300">{error || '未找到小说'}</div>
      </div>
    )
  }

  return (
    <div className="pb-10">
      <button onClick={() => navigate('/novel', { replace: true })} className="mb-6 flex items-center gap-2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">
        <ArrowLeft className="h-5 w-5" />返回
      </button>

      <section className="grid gap-6 lg:grid-cols-[260px,1fr]">
        <div className="overflow-hidden rounded-[1.5rem] bg-white/70 dark:bg-stone-950/55 border border-black/5 dark:border-white/10 shadow-sm">
          <div className="aspect-[3/4] bg-stone-950">
            <img src={detail.cover || FALLBACK_COVER} alt={detail.name} className="h-full w-full object-cover" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.src = FALLBACK_COVER }} />
          </div>
          <button onClick={() => toggleFavorite(detail)} className={cn('flex w-full items-center justify-center gap-2 px-4 py-3 font-semibold transition-colors', favorite ? 'text-amber-500' : 'text-[var(--text-secondary)] hover:text-amber-500')}>
            <Heart className="h-5 w-5" fill={favorite ? 'currentColor' : 'none'} />
            {favorite ? '已加入书架' : '加入书架'}
          </button>
        </div>

        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-[var(--text-muted)]">
            <span>{detail.sourceName}</span>
            {detail.category && <span>· {detail.category}</span>}
            {detail.status && <span>· {detail.status}</span>}
            {detail.score && <span className="inline-flex items-center gap-1 text-amber-500"><Star className="h-4 w-4" fill="currentColor" />{detail.score}</span>}
          </div>
          <h1 className="text-3xl font-black text-[var(--text-primary)]">{detail.name}</h1>
          <div className="mt-4 space-y-2 text-sm text-[var(--text-secondary)]">
            {detail.author && <p><span className="text-[var(--text-muted)]">作者：</span>{detail.author}</p>}
            {detail.wordCount && <p><span className="text-[var(--text-muted)]">字数：</span>{Number(detail.wordCount).toLocaleString()} 字</p>}
            {detail.latestChapter && <p><span className="text-[var(--text-muted)]">最新：</span>{detail.latestChapter}</p>}
            {detail.intro && <p className="leading-7 whitespace-pre-line"><span className="text-[var(--text-muted)]">简介：</span>{detail.intro}</p>}
          </div>

          <div className="mt-7 flex flex-wrap gap-3">
            <button onClick={() => readChapter(lastChapter || detail.chapters[0])} disabled={detail.chapters.length === 0} className="inline-flex items-center gap-2 rounded-full bg-amber-500 px-5 py-2.5 font-bold text-white shadow-lg shadow-amber-500/25 disabled:opacity-50">
              <BookOpen className="h-4 w-4" /> {lastChapter ? '继续阅读' : '开始阅读'}
            </button>
            {detail.downloadUrl && (
              <button onClick={() => void handleDownloadAndRead()} disabled={downloading} className="inline-flex items-center gap-2 rounded-full border border-amber-500/35 bg-amber-500/10 px-5 py-2.5 font-bold text-amber-600 dark:text-amber-300 hover:bg-amber-500 hover:text-white transition-colors disabled:opacity-60">
                {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} {downloading ? '下载中...' : '下载并阅读'}
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="mt-8 rounded-[1.75rem] border border-black/5 dark:border-white/10 bg-white/65 dark:bg-stone-950/35 p-4 shadow-sm">
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 className="text-xl font-black text-[var(--text-primary)]">章节目录</h2>
          <span className="text-sm text-[var(--text-muted)]">共 {detail.chapters.length.toLocaleString()} 章</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2 max-h-[520px] overflow-y-auto pr-1 scrollbar-thin">
          {detail.chapters.map((chapter) => (
            <button key={chapter.id} onClick={() => readChapter(chapter)} className={cn('rounded-xl border px-3 py-2 text-left text-sm transition-all', lastChapter?.id === chapter.id ? 'border-amber-500 bg-amber-500 text-white' : 'border-black/5 dark:border-white/10 bg-white/70 dark:bg-stone-950/55 text-[var(--text-secondary)] hover:bg-white dark:hover:bg-stone-900')} title={chapter.title}>
              <span className="line-clamp-1">{chapter.title}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
