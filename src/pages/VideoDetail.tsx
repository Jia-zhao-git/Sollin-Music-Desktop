import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type Hls from 'hls.js'
import { ArrowLeft, Clapperboard, Heart, Loader2, Play, RotateCcw, Star } from 'lucide-react'
import videoApi from '@/services/videoApi'
import { useVideoStore } from '@/stores/videoStore'
import { usePlayerStore } from '@/stores/playerStore'
import type { VideoDetail, VideoEpisode } from '@/types/video'
import { cn } from '@/utils/cn'

const isM3u8 = (url: string) => /\.m3u8(?:$|[?#])/i.test(url)

function VideoPlayer({ video, episode }: { video: VideoDetail; episode: VideoEpisode }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const lastHistoryAtRef = useRef(0)
  const [error, setError] = useState<string | null>(null)
  const { history, upsertHistory } = useVideoStore()

  const historyItem = useMemo(
    () => history.find((item) => item.video.id === video.id && item.episode?.url === episode.url),
    [episode.url, history, video.id],
  )

  useEffect(() => {
    const element = videoRef.current
    if (!element) return

    setError(null)
    usePlayerStore.getState().pause()

    let disposed = false
    let hls: Hls | null = null
    const src = episode.url

    if (isM3u8(src) && !element.canPlayType('application/vnd.apple.mpegurl')) {
      void import('hls.js')
        .then(({ default: Hls }) => {
          if (disposed) return
          if (!Hls.isSupported()) {
            setError('当前环境不支持播放该 m3u8 视频')
            return
          }

          hls = new Hls({ enableWorker: true, lowLatencyMode: false })
          hls.loadSource(src)
          hls.attachMedia(element)
          hls.on(Hls.Events.ERROR, (_event: unknown, data: { fatal: boolean; details?: string }) => {
            if (data.fatal) setError(data.details || '视频流加载失败')
          })
        })
        .catch(() => setError('视频播放组件加载失败'))
    } else {
      element.src = src
    }

    const onLoaded = () => {
      if (historyItem?.currentTime && historyItem.currentTime > 5 && Number.isFinite(element.duration) && historyItem.currentTime < element.duration - 5) {
        element.currentTime = historyItem.currentTime
      }
      void element.play().catch(() => {
        // Autoplay may be blocked, user can click play.
      })
    }
    const onError = () => setError('视频播放失败，请尝试切换播放源或其他集数')
    const onTimeUpdate = () => {
      if (element.currentTime < 2) return
      const now = Date.now()
      if (now - lastHistoryAtRef.current < 5000) return
      lastHistoryAtRef.current = now
      upsertHistory({
        video,
        episode,
        playedAt: Date.now(),
        currentTime: element.currentTime,
      })
    }

    element.addEventListener('loadedmetadata', onLoaded)
    element.addEventListener('error', onError)
    element.addEventListener('timeupdate', onTimeUpdate)

    return () => {
      disposed = true
      element.removeEventListener('loadedmetadata', onLoaded)
      element.removeEventListener('error', onError)
      element.removeEventListener('timeupdate', onTimeUpdate)
      hls?.destroy()
      element.removeAttribute('src')
      element.load()
    }
  }, [episode, historyItem?.currentTime, upsertHistory, video])

  return (
    <div className="overflow-hidden rounded-[1.75rem] bg-black shadow-2xl border border-white/10">
      <div className="relative aspect-video bg-black">
        <video ref={videoRef} controls playsInline className="h-full w-full bg-black" poster={video.cover} />
        {error && (
          <div className="absolute inset-0 grid place-items-center bg-black/80 p-6 text-center text-white">
            <div>
              <Clapperboard className="mx-auto mb-3 h-10 w-10 text-red-300" />
              <p>{error}</p>
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-5 py-4 text-white">
        <div className="min-w-0">
          <p className="text-sm text-white/55">正在播放</p>
          <h2 className="truncate text-lg font-bold">{video.name} · {episode.title}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {historyItem?.currentTime && historyItem.currentTime > 5 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-500/20 px-3 py-1 text-sm text-red-100">
              <RotateCcw className="h-3.5 w-3.5" /> 已续播
            </span>
          )}
          <span className="rounded-full bg-white/10 px-3 py-1 text-sm text-white/75">{episode.source}</span>
        </div>
      </div>
    </div>
  )
}

export default function VideoDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<VideoDetail | null>(null)
  const [selectedEpisode, setSelectedEpisode] = useState<VideoEpisode | null>(null)
  const [activeSourceIndex, setActiveSourceIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { toggleFavorite, isFavorite, setCurrentVideo, setCurrentEpisode } = useVideoStore()

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoading(true)
    setError(null)

    videoApi.getDetail(id)
      .then((data) => {
        if (cancelled) return
        setDetail(data)
        const videoHistory = useVideoStore.getState().history
        const latestHistory = data
          ? videoHistory.find((item) => item.video.id === data.id && item.episode && data.episodes.some((episode) => episode.url === item.episode?.url))
          : null
        const resumeEpisode = latestHistory?.episode || data?.episodes[0] || null
        setSelectedEpisode(resumeEpisode)
        setActiveSourceIndex(resumeEpisode?.sourceIndex || 0)
        setCurrentVideo(data, resumeEpisode)
      })
      .catch((err) => {
        console.error('Load video detail failed:', err)
        if (!cancelled) setError(err instanceof Error ? err.message : '加载影视详情失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [id, setCurrentVideo])

  const activeSource = useMemo(() => {
    if (!detail) return null
    return detail.sources[activeSourceIndex] || detail.sources[0] || null
  }, [activeSourceIndex, detail])

  const favorite = detail ? isFavorite(detail.id) : false

  const selectEpisode = (episode: VideoEpisode) => {
    setSelectedEpisode(episode)
    setActiveSourceIndex(episode.sourceIndex)
    setCurrentEpisode(episode)
  }

  if (loading) {
    return (
      <div className="grid h-[calc(100vh-200px)] place-items-center">
        <Loader2 className="h-8 w-8 animate-spin text-red-500" />
      </div>
    )
  }

  if (error || !detail) {
    return (
      <div className="pb-8">
        <button onClick={() => navigate(-1)} className="mb-6 flex items-center gap-2 text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
          <ArrowLeft className="h-5 w-5" />返回
        </button>
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-6 text-red-600 dark:text-red-300">{error || '未找到影片'}</div>
      </div>
    )
  }

  return (
    <div className="pb-10">
      <button onClick={() => navigate(-1)} className="mb-6 flex items-center gap-2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">
        <ArrowLeft className="h-5 w-5" />返回
      </button>

      {selectedEpisode && <VideoPlayer video={detail} episode={selectedEpisode} />}

      <section className="mt-6 grid gap-6 lg:grid-cols-[260px,1fr]">
        <div className="overflow-hidden rounded-[1.5rem] bg-white/70 dark:bg-gray-900/55 border border-black/5 dark:border-white/10 shadow-sm">
          <div className="aspect-[3/4] bg-slate-900">
            {detail.cover ? (
              <img src={detail.cover} alt={detail.name} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <div className="grid h-full place-items-center"><Clapperboard className="h-12 w-12 text-white/30" /></div>
            )}
          </div>
          <button
            onClick={() => toggleFavorite(detail)}
            className={cn('flex w-full items-center justify-center gap-2 px-4 py-3 font-semibold transition-colors', favorite ? 'text-red-500' : 'text-[var(--text-secondary)] hover:text-red-500')}
          >
            <Heart className="h-5 w-5" fill={favorite ? 'currentColor' : 'none'} />
            {favorite ? '已收藏' : '收藏影片'}
          </button>
        </div>

        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-[var(--text-muted)]">
            <span>{detail.sourceName}</span>
            <span>· {detail.typeName}</span>
            {detail.year && <span>· {detail.year}</span>}
            {detail.area && <span>· {detail.area}</span>}
            {detail.score && <span className="inline-flex items-center gap-1 text-amber-500"><Star className="h-4 w-4" fill="currentColor" />{detail.score}</span>}
          </div>
          <h1 className="text-3xl font-black text-[var(--text-primary)]">{detail.name}</h1>
          <p className="mt-2 text-red-500 font-medium">{detail.remarks}</p>
          <div className="mt-4 space-y-2 text-sm text-[var(--text-secondary)]">
            {detail.actors && <p><span className="text-[var(--text-muted)]">主演：</span>{detail.actors}</p>}
            {detail.director && <p><span className="text-[var(--text-muted)]">导演：</span>{detail.director}</p>}
            {detail.category && <p><span className="text-[var(--text-muted)]">类型：</span>{detail.category}</p>}
            {detail.content && <p className="leading-7"><span className="text-[var(--text-muted)]">简介：</span>{detail.content}</p>}
          </div>

          <div className="mt-7">
            <div className="mb-4 flex flex-wrap gap-2">
              {detail.sources.map((source, index) => (
                <button
                  key={`${source.name}-${index}`}
                  onClick={() => setActiveSourceIndex(index)}
                  className={cn(
                    'rounded-full px-4 py-2 text-sm font-semibold transition-all',
                    activeSourceIndex === index
                      ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950'
                      : 'bg-white/70 dark:bg-gray-900/60 text-[var(--text-secondary)] border border-black/5 dark:border-white/10',
                  )}
                >
                  {source.name} · {source.episodes.length}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8 gap-2">
              {(activeSource?.episodes || []).map((episode) => (
                <button
                  key={`${episode.sourceIndex}-${episode.title}-${episode.url}`}
                  onClick={() => selectEpisode(episode)}
                  className={cn(
                    'inline-flex items-center justify-center gap-1 rounded-xl px-3 py-2 text-sm transition-all border truncate',
                    selectedEpisode?.url === episode.url
                      ? 'border-red-500 bg-red-500 text-white shadow-md shadow-red-500/20'
                      : 'border-black/5 dark:border-white/10 bg-white/70 dark:bg-gray-900/60 text-[var(--text-secondary)] hover:bg-white dark:hover:bg-gray-800',
                  )}
                  title={episode.title}
                >
                  <Play className="h-3.5 w-3.5" fill="currentColor" />
                  <span className="truncate">{episode.title}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
