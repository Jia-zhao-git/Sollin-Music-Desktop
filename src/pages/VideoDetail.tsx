import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type Hls from 'hls.js'
import * as Slider from '@radix-ui/react-slider'
import { ArrowLeft, Clapperboard, Clock3, Download, Film, FolderOpen, Heart, Loader2, Maximize, Minimize, Pause, PictureInPicture2, Play, RotateCcw, Search, SearchX, Star, Trash2, Volume2, VolumeX } from 'lucide-react'
import StatusState from '@/components/StatusState'
import ReadStateBadge from '@/components/ReadStateBadge'
import Poster from '@/components/ui/Poster'
import videoApi from '@/services/videoApi'
import { useVideoStore } from '@/stores/videoStore'
import { usePlayerStore } from '@/stores/playerStore'
import { videoDownloadManager } from '@/services/videoDownloadManager'
import type { VideoCacheItem, VideoDetail, VideoEpisode, VideoListItem } from '@/types/video'
import { cn } from '@/utils/cn'
import { formatTime } from '@/utils/format'

const isM3u8 = (url: string) => /\.m3u8(?:$|[?#])/i.test(url)
const toFileUrl = (filePath: string) => {
  const normalized = filePath.replace(/\\/g, '/')
  return normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`
}
const SEEK_STEP = 10
const WATCHED_MIN_SECONDS = 30

// vod_duration 形如 "45" / "45分钟"，解析为秒用于「看过 10%」判断；解析不出则视为时长未知。
const parseDurationSeconds = (raw?: string) => {
  const minutes = Number.parseInt(raw || '', 10)
  return Number.isFinite(minutes) && minutes > 0 ? minutes * 60 : undefined
}

// 已观看判定：进度超过 30 秒，或（已知时长时）超过本集时长的 10%。
const isWatchedProgress = (currentTime?: number, durationSeconds?: number) => {
  if (!currentTime || currentTime <= 0) return false
  if (currentTime > WATCHED_MIN_SECONDS) return true
  return durationSeconds ? currentTime > durationSeconds * 0.1 : false
}

export function VideoPlayer({ video, episode, onEnded }: { video: VideoDetail; episode: VideoEpisode; onEnded?: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const lastHistoryAtRef = useRef(0)
  const hideTimerRef = useRef<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(0.8)
  const [muted, setMuted] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [showControls, setShowControls] = useState(true)
  const [buffering, setBuffering] = useState(false)
  const [resumePrompt, setResumePrompt] = useState<number | null>(null)
  // 拖拽/点击进度条 seek 期间置 true，屏蔽 timeupdate 把显示进度拉回旧位置（修复「点击进度条会跳、要点一两次才成功」）。
  const seekingRef = useRef(false)
  const { history, upsertHistory } = useVideoStore()

  const historyItem = useMemo(
    () => history.find((item) => item.video.id === video.id && item.episode?.url === episode.url),
    [episode.url, history, video.id],
  )

  const pokeControls = useCallback(() => {
    setShowControls(true)
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current)
    hideTimerRef.current = window.setTimeout(() => {
      const element = videoRef.current
      if (element && !element.paused) setShowControls(false)
    }, 3000)
  }, [])

  useEffect(() => {
    const element = videoRef.current
    if (!element) return

    setError(null)
    setBuffering(false)
    usePlayerStore.getState().pause()

    let disposed = false
    let hls: Hls | null = null
    const src = episode.url
    // 仅在挂载/切换集数时读取一次续播点，不能放进依赖数组：
    // 播放中 onTimeUpdate 每 5 秒写入 history 会让 currentTime 持续变化，
    // 若作为依赖会导致 effect 重跑 -> 销毁播放器 -> 从头重播（2-4 秒循环重播的根因）。
    const resumeAt = historyItem?.currentTime

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
      if (resumeAt && resumeAt > 5 && Number.isFinite(element.duration) && resumeAt < element.duration - 5) {
        element.currentTime = resumeAt
        setCurrentTime(resumeAt)
        setResumePrompt(resumeAt)
        // 有续播点时暂停，等用户选择「从头播放」或「继续播放」。
        element.pause()
        return
      }
      void element.play().catch(() => {
        // Autoplay may be blocked, user can click play.
      })
    }
    const onError = () => setError('视频播放失败，请尝试切换播放源或其他集数')
    const handleEnded = () => onEnded?.()
    const onTimeUpdate = () => {
      // seek 未完成前不覆盖显示进度，否则会跳回旧位置
      if (seekingRef.current) return
      setCurrentTime(element.currentTime)
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
    const onDurationChange = () => setDuration(Number.isFinite(element.duration) ? element.duration : 0)
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onVolumeChange = () => {
      setVolume(element.volume)
      setMuted(element.muted)
    }
    const onWaiting = () => setBuffering(true)
    const onPlaying = () => setBuffering(false)
    const onSeeked = () => {
      setBuffering(false)
      // seek 完成：释放屏蔽并把显示进度同步到真实位置，避免停在旧值
      seekingRef.current = false
      setCurrentTime(Number.isFinite(element.currentTime) ? element.currentTime : 0)
    }

    element.addEventListener('loadedmetadata', onLoaded)
    element.addEventListener('error', onError)
    element.addEventListener('ended', handleEnded)
    element.addEventListener('timeupdate', onTimeUpdate)
    element.addEventListener('durationchange', onDurationChange)
    element.addEventListener('play', onPlay)
    element.addEventListener('pause', onPause)
    element.addEventListener('volumechange', onVolumeChange)
    element.addEventListener('waiting', onWaiting)
    element.addEventListener('playing', onPlaying)
    element.addEventListener('seeked', onSeeked)

    return () => {
      disposed = true
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current)
      element.removeEventListener('loadedmetadata', onLoaded)
      element.removeEventListener('error', onError)
      element.removeEventListener('ended', handleEnded)
      element.removeEventListener('timeupdate', onTimeUpdate)
      element.removeEventListener('durationchange', onDurationChange)
      element.removeEventListener('play', onPlay)
      element.removeEventListener('pause', onPause)
      element.removeEventListener('volumechange', onVolumeChange)
      element.removeEventListener('waiting', onWaiting)
      element.removeEventListener('playing', onPlaying)
      element.removeEventListener('seeked', onSeeked)
      hls?.destroy()
      element.removeAttribute('src')
      element.load()
    }
  }, [episode.url, video.id])

  const seekTo = useCallback((time: number) => {
    const element = videoRef.current
    if (!element) return
    const max = Number.isFinite(element.duration) ? element.duration : 0
    const clamped = Math.max(0, Math.min(time, max > 0 ? max : time))
    // 进入 seek 状态：屏蔽 timeupdate 覆盖，直到 seeked 或兜底超时
    seekingRef.current = true
    element.currentTime = clamped
    setCurrentTime(clamped)
    // 兜底：跳到与当前相同的位置等场景浏览器未必触发 seeked，超时后释放避免进度显示被冻结
    window.setTimeout(() => { seekingRef.current = false }, 400)
  }, [])

  const togglePlay = useCallback(() => {
    const element = videoRef.current
    if (!element) return
    if (element.paused) void element.play().catch(() => {})
    else element.pause()
  }, [])

  const resumeFromPrompt = useCallback(() => {
    const element = videoRef.current
    if (element && resumePrompt != null) {
      element.currentTime = resumePrompt
      setCurrentTime(resumePrompt)
    }
    setResumePrompt(null)
    if (element) void element.play().catch(() => {})
  }, [resumePrompt])

  const restartFromBeginning = useCallback(() => {
    const element = videoRef.current
    if (element) {
      element.currentTime = 0
      setCurrentTime(0)
    }
    setResumePrompt(null)
    if (element) void element.play().catch(() => {})
  }, [])

  const toggleMute = useCallback(() => {
    const element = videoRef.current
    if (!element) return
    element.muted = !element.muted
    setMuted(element.muted)
  }, [])

  const changeVolume = useCallback((value: number) => {
    const element = videoRef.current
    if (!element) return
    const next = Math.max(0, Math.min(1, value))
    element.volume = next
    element.muted = next === 0
    setVolume(next)
    setMuted(element.muted)
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {})
    } else {
      void containerRef.current?.requestFullscreen().catch(() => {})
    }
  }, [])

  const togglePip = useCallback(() => {
    const element = videoRef.current
    if (!element) return
    if (document.pictureInPictureElement) {
      void document.exitPictureInPicture().catch(() => {})
    } else if (document.pictureInPictureEnabled && typeof element.requestPictureInPicture === 'function') {
      void element.requestPictureInPicture().catch(() => {})
    }
  }, [])

  const cyclePlaybackRate = useCallback(() => {
    const element = videoRef.current
    if (!element) return
    const rates = [1, 1.25, 1.5, 2, 0.5]
    const index = rates.indexOf(element.playbackRate)
    const next = rates[(index + 1) % rates.length]
    element.playbackRate = next
    setPlaybackRate(next)
  }, [])

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const element = videoRef.current
      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault()
          if (element) seekTo((element.currentTime || 0) - SEEK_STEP)
          break
        case 'ArrowRight':
          event.preventDefault()
          if (element) seekTo((element.currentTime || 0) + SEEK_STEP)
          break
        case ' ':
          event.preventDefault()
          togglePlay()
          break
        case 'ArrowUp':
          event.preventDefault()
          if (element) changeVolume(element.volume + 0.1)
          break
        case 'ArrowDown':
          event.preventDefault()
          if (element) changeVolume(element.volume - 0.1)
          break
      }
      pokeControls()
    },
    [changeVolume, pokeControls, seekTo, togglePlay],
  )

  return (
    <div className="overflow-hidden rounded-[1.75rem] bg-black shadow-2xl border border-white/10">
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onMouseMove={pokeControls}
        onMouseLeave={() => {
          const element = videoRef.current
          if (element && !element.paused) setShowControls(false)
        }}
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
        className="group relative aspect-video bg-black outline-none"
      >
        <video ref={videoRef} playsInline className="h-full w-full bg-black" poster={video.cover} />

        {resumePrompt != null && !error && (
          <div className="absolute inset-0 grid place-items-center bg-black/70 p-6">
            <div className="rounded-2xl bg-slate-900 border border-white/10 p-6 text-center text-white shadow-2xl">
              <RotateCcw className="mx-auto mb-3 h-8 w-8 text-red-400" />
              <p className="text-sm text-white/80">上次观看到 {formatTime(resumePrompt)}</p>
              <p className="mb-4 mt-1 text-xs text-white/50">是否继续播放？</p>
              <div className="flex gap-3">
                <button onClick={restartFromBeginning} className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/20">从头播放</button>
                <button onClick={resumeFromPrompt} className="rounded-full bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600">继续播放</button>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 grid place-items-center bg-black/80 p-6 text-center text-white">
            <div>
              <Clapperboard className="mx-auto mb-3 h-10 w-10 text-red-300" />
              <p>{error}</p>
            </div>
          </div>
        )}

        {buffering && !error && (
          <div className="absolute inset-0 grid place-items-center bg-black/40">
            <Loader2 className="h-10 w-10 animate-spin text-white/90" />
          </div>
        )}

        {!error && !playing && (
          <button
            onClick={(event) => { event.stopPropagation(); togglePlay() }}
            className="absolute inset-0 grid place-items-center"
            aria-label="播放"
          >
            <span className="grid h-16 w-16 place-items-center rounded-full bg-white/20 backdrop-blur transition-transform hover:scale-105">
              <Play className="h-7 w-7 translate-x-0.5 text-white" fill="currentColor" />
            </span>
          </button>
        )}

        <div
          onClick={(event) => event.stopPropagation()}
          className={cn(
            'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-4 pb-3 pt-8 transition-opacity duration-200',
            showControls ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
        >
          <Slider.Root
            className="relative flex h-5 w-full items-center"
            value={[currentTime]}
            max={duration || 1}
            step={1}
            onValueChange={([value]) => setCurrentTime(value)}
            onValueCommit={([value]) => seekTo(value)}
          >
            <Slider.Track className="relative h-1 flex-1 rounded-full bg-white/25">
              <Slider.Range className="absolute h-full rounded-full bg-red-500" />
            </Slider.Track>
            <Slider.Thumb className="block h-3.5 w-3.5 rounded-full bg-red-500 shadow-md outline-none transition-transform hover:scale-110" />
          </Slider.Root>

          <div className="mt-1 flex items-center gap-3 text-white">
            <button onClick={togglePlay} className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/15" aria-label={playing ? '暂停' : '播放'}>
              {playing ? <Pause className="h-5 w-5" fill="currentColor" /> : <Play className="h-5 w-5" fill="currentColor" />}
            </button>

            <span className="text-xs tabular-nums text-white/90">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>

            <button onClick={cyclePlaybackRate} className="rounded px-2 py-1 text-xs font-semibold text-white/90 hover:bg-white/15" aria-label="倍速">
              {playbackRate}x
            </button>

            <div className="ml-auto flex items-center gap-3">
              <div className="flex items-center gap-2">
                <button onClick={toggleMute} className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/15" aria-label={muted ? '取消静音' : '静音'}>
                  {muted || volume === 0 ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
                </button>
                <Slider.Root
                  className="relative flex h-5 w-24 items-center"
                  value={[muted ? 0 : volume]}
                  max={1}
                  step={0.05}
                  onValueChange={([value]) => changeVolume(value)}
                >
                  <Slider.Track className="relative h-1 flex-1 rounded-full bg-white/25">
                    <Slider.Range className="absolute h-full rounded-full bg-white/80" />
                  </Slider.Track>
                  <Slider.Thumb className="block h-3 w-3 rounded-full bg-white shadow-md outline-none" />
                </Slider.Root>
              </div>

              <button onClick={togglePip} className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/15" aria-label="画中画" title="画中画">
                <PictureInPicture2 className="h-5 w-5" />
              </button>
              <button onClick={toggleFullscreen} className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/15" aria-label="全屏">
                {isFullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
              </button>
            </div>
          </div>
        </div>
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

function RelatedVideoCard({ item }: { item: VideoListItem }) {
  const navigate = useNavigate()
  return (
    <button
      onClick={() => navigate(`/video/${item.id}`)}
      className="group shrink-0 w-40 text-left rounded-2xl overflow-hidden bg-white/75 dark:bg-gray-900/60 border border-black/5 dark:border-white/10 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all"
    >
      <div className="relative aspect-[3/4] bg-gradient-to-br from-slate-800 via-zinc-900 to-black overflow-hidden">
        <Poster src={item.cover} title={item.name} iconClassName="h-10 w-10" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent opacity-80" />
        <div className="absolute left-2 right-2 bottom-2">
          <span className="block truncate rounded-full bg-black/55 px-2 py-1 text-[10px] text-white backdrop-blur">{item.remarks || item.typeName}</span>
        </div>
      </div>
      <div className="p-2.5">
        <h3 className="font-semibold text-sm text-[var(--text-primary)] line-clamp-2 min-h-[2.4rem]">{item.name}</h3>
        <p className="mt-1 text-[11px] text-[var(--text-muted)] truncate">
          {[item.typeName, item.year, item.area].filter(Boolean).join(' · ') || '未知分类'}
        </p>
      </div>
    </button>
  )
}

export default function VideoDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<VideoDetail | null>(null)
  const [selectedEpisode, setSelectedEpisode] = useState<VideoEpisode | null>(null)
  const [activeSourceIndex, setActiveSourceIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [related, setRelated] = useState<VideoListItem[]>([])
  const [episodeQuery, setEpisodeQuery] = useState('')
  const { history, toggleFavorite, isFavorite, setCurrentVideo, setCurrentEpisode, downloads, activeDownloads, removeDownload, cacheDirectory, setCacheDirectory, scanCache, addWatchLater, removeWatchLater } = useVideoStore()
  const watchLater = useVideoStore((state) => state.watchLater)
  const inWatchLater = watchLater.some((item) => item.id === detail?.id)

  // 进入详情页即扫描磁盘，让「本片离线缓存」与全局离线列表保持一致（含缓存目录外的孤儿文件）。
  useEffect(() => {
    scanCache().catch(() => {})
  }, [scanCache])

  // 离线播放：把选中集切换为「本地文件路径合成集」，复用主播放器直接播放已缓存文件（无需联网）。
  // onlineEpisodeRef 记住切换前的在线集，便于「返回在线版」。
  const onlineEpisodeRef = useRef<VideoEpisode | null>(null)
  const handlePlayOffline = useCallback((item: VideoCacheItem) => {
    setSelectedEpisode((prev) => {
      if (prev && !prev.url.startsWith('file://')) onlineEpisodeRef.current = prev
      return {
        ...(prev ?? { title: item.episodeTitle || item.videoName, url: '', source: '', sourceIndex: 0 }),
        url: toFileUrl(item.filePath),
        title: item.episodeTitle || prev?.title || item.videoName,
      }
    })
  }, [])
  const resumeOnlinePlayback = useCallback(() => {
    if (onlineEpisodeRef.current) setSelectedEpisode(onlineEpisodeRef.current)
  }, [])

  // 离线文件播放：按文件名推断的集数标题匹配在线集并切换为本地下载文件（无需联网）。
  // 找不到匹配集时退化为一个仅含标题的合成集，保证本地文件也能播放。
  const playOfflineFile = useCallback((filePath: string, fallbackTitle: string) => {
    const base = filePath.replace(/\\/g, '/').split('/').pop() || ''
    const nameWithoutExt = base.replace(/\.[^.]+$/, '')
    const dashIndex = nameWithoutExt.lastIndexOf('-')
    const title = dashIndex > 0 ? nameWithoutExt.slice(dashIndex + 1).trim() : fallbackTitle
    const matched = detail
      ? detail.episodes.find((episode) => episode.title === title && episode.sourceIndex === activeSourceIndex)
        || detail.episodes.find((episode) => episode.title === title)
      : undefined
    setSelectedEpisode((prev) => {
      if (prev && !prev.url.startsWith('file://')) onlineEpisodeRef.current = prev
      return {
        ...(matched ?? prev ?? { title: fallbackTitle, url: '', source: '', sourceIndex: 0 }),
        url: toFileUrl(filePath),
        title: matched?.title ?? fallbackTitle,
      }
    })
  }, [activeSourceIndex, detail])
  // 删除缓存：先删磁盘文件，再清 store 记录（即使删文件失败也清理失效条目）。
  const handleDeleteCache = useCallback(async (item: VideoCacheItem) => {
    try {
      await window.electronAPI?.deleteVideoCacheItem(item.filePath)
    } catch {
      // 文件可能已被外部移除，忽略错误，继续清理记录
    }
    removeDownload(item.id)
  }, [removeDownload])

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

  // 深度链接：从「离线缓存」首页点「播放」携带 ?offline=filePath 进入，加载完成后自动离线播放该集。
  const playedOfflineRef = useRef(false)
  useEffect(() => {
    if (playedOfflineRef.current) return
    const offlineFile = searchParams.get('offline')
    if (!offlineFile || !detail) return
    playedOfflineRef.current = true
    playOfflineFile(decodeURIComponent(offlineFile), detail.name)
  }, [detail, searchParams, playOfflineFile])

  useEffect(() => {
    if (!detail?.typeId) {
      setRelated([])
      return
    }
    let cancelled = false
    setRelated([])
    videoApi.getList({ typeId: detail.typeId, page: 1, sourceId: detail.sourceId })
      .then((data) => {
        if (cancelled) return
        setRelated(data.list.filter((item) => item.id !== detail.id).slice(0, 12))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [detail])

  const activeSource = useMemo(() => {
    if (!detail) return null
    return detail.sources[activeSourceIndex] || detail.sources[0] || null
  }, [activeSourceIndex, detail])

  // 集数搜索/筛选：按标题或序号（如 "3" / "第3集"）匹配，长剧可快速定位。
  const filteredEpisodes = useMemo(() => {
    const episodes = activeSource?.episodes || []
    const q = episodeQuery.trim().toLowerCase()
    if (!q) return episodes
    return episodes.filter((episode, index) => {
      if (episode.title.toLowerCase().includes(q)) return true
      const n = String(index + 1)
      return n === q || `第${n}集`.includes(q) || `第${n}话`.includes(q)
    })
  }, [activeSource, episodeQuery])

  const favorite = detail ? isFavorite(detail.id) : false

  const episodeDurationSeconds = useMemo(() => parseDurationSeconds(detail?.duration), [detail?.duration])

  // 已观看的集数（按 episode.url 去重），用于在集数网格上打对勾。
  const watchedEpisodeUrls = useMemo(() => {
    const urls = new Set<string>()
    if (!detail) return urls
    for (const item of history) {
      if (item.video.id !== detail.id) continue
      const url = item.episode?.url
      if (url && isWatchedProgress(item.currentTime, episodeDurationSeconds)) urls.add(url)
    }
    return urls
  }, [detail, episodeDurationSeconds, history])

  // 上次观看的集：history 已按时间倒序写入，这里仍显式取 playedAt 最大值，避免持久化顺序不可靠。
  const lastWatchedEpisodeUrl = useMemo(() => {
    if (!detail) return null
    const matched = history.filter((item) => item.video.id === detail.id && item.episode?.url)
    if (!matched.length) return null
    return matched.reduce((latest, item) => (item.playedAt > latest.playedAt ? item : latest)).episode?.url || null
  }, [detail, history])

  const selectEpisode = (episode: VideoEpisode) => {
    setSelectedEpisode(episode)
    setActiveSourceIndex(episode.sourceIndex)
    setCurrentEpisode(episode)
  }

  // 自动连播：当前源播放结束后切到下一集，到最后一集则停止。
  const playNextEpisode = useCallback(() => {
    if (!detail || !selectedEpisode) return
    const episodes = detail.sources[activeSourceIndex]?.episodes || []
    const index = episodes.findIndex((episode) => episode.url === selectedEpisode.url)
    if (index >= 0 && index < episodes.length - 1) {
      const next = episodes[index + 1]
      setSelectedEpisode(next)
      setCurrentEpisode(next)
    }
  }, [activeSourceIndex, detail, selectedEpisode, setCurrentEpisode])

  // ---- 离线缓存 / 下载 ----
  // 进行中的缓存状态统一走全局 videoStore.activeDownloads（由 videoDownloadManager 在应用级监听主进程事件写入），
  // 因此切换页面不会导致进度/完成事件丢失：即便离开本页，主进程仍在下载，回来后进度与「已缓存」状态都正确。

  // 启动时把缓存目录同步为真实生效路径（主进程默认值或用户设置）。
  useEffect(() => {
    const api = window.electronAPI
    if (!api?.getVideoCacheDirectory) return
    api.getVideoCacheDirectory().then((dir) => { if (dir) setCacheDirectory(dir) }).catch(() => {})
  }, [setCacheDirectory])

  const startDownload = useCallback(async (episode: VideoEpisode) => {
    if (!detail) return
    await videoDownloadManager.startDownload(detail, episode, cacheDirectory || undefined)
  }, [cacheDirectory, detail])

  const cachedByUrl = useMemo(() => {
    const map = new Map<string, VideoCacheItem>()
    for (const item of downloads) map.set(item.url, item)
    return map
  }, [downloads])

  const offlineForThisVideo = useMemo(
    () => downloads.filter((item) => item.videoName === detail?.name),
    [downloads, detail],
  )

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
        <button onClick={() => navigate(-1)} className="mb-6 flex items-center gap-2 text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
          <ArrowLeft className="h-5 w-5" />返回
        </button>
        <StatusState
          variant="error"
          title="加载失败"
          description={error || '未找到影片'}
          actionLabel="返回"
          onAction={() => navigate(-1)}
        />
      </div>
    )
  }

  return (
    <div className="pb-10">
      <button onClick={() => navigate(-1)} className="mb-6 flex items-center gap-2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">
        <ArrowLeft className="h-5 w-5" />返回
      </button>

      {selectedEpisode && <VideoPlayer video={detail} episode={selectedEpisode} onEnded={playNextEpisode} />}

      {selectedEpisode && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-black/5 dark:border-white/10 bg-white/60 dark:bg-gray-900/50 p-3 shadow-sm">
          <span className="text-sm text-[var(--text-muted)]">当前集缓存</span>
          {(() => {
            const url = selectedEpisode.url
            if (url.startsWith('file://')) {
              return (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-3 py-1 text-sm font-semibold text-blue-600 dark:text-blue-300"><Play className="h-3.5 w-3.5" /> 正在离线播放（本地文件）</span>
                  {onlineEpisodeRef.current && (
                    <button onClick={resumeOnlinePlayback} className="inline-flex items-center gap-1 rounded-full border border-black/10 dark:border-white/10 px-3 py-1 text-sm hover:bg-black/5 dark:hover:bg-white/10">返回在线版</button>
                  )}
                </div>
              )
            }
            const cachedItem = cachedByUrl.get(url)
            const dl = activeDownloads[url]
            if (cachedItem) {
              return (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-3 py-1 text-sm font-semibold text-emerald-600 dark:text-emerald-300"><Download className="h-3.5 w-3.5" /> 已缓存</span>
                  <button onClick={() => handlePlayOffline(cachedItem)} className="inline-flex items-center gap-1 rounded-full bg-blue-500 px-3 py-1 text-sm font-semibold text-white hover:bg-blue-600"><Play className="h-3.5 w-3.5" /> 播放</button>
                  <button onClick={() => window.electronAPI?.openVideoCacheItem(cachedItem.filePath)} className="inline-flex items-center gap-1 rounded-full border border-black/10 dark:border-white/10 px-3 py-1 text-sm hover:bg-black/5 dark:hover:bg-white/10"><FolderOpen className="h-3.5 w-3.5" /> 打开</button>
                  <button onClick={() => window.electronAPI?.showVideoCacheItemInFolder(cachedItem.filePath)} className="inline-flex items-center gap-1 rounded-full border border-black/10 dark:border-white/10 px-3 py-1 text-sm hover:bg-black/5 dark:hover:bg-white/10">打开所在文件夹</button>
                  <button onClick={() => handleDeleteCache(cachedItem)} className="inline-flex items-center gap-1 rounded-full border border-red-500/20 px-3 py-1 text-sm text-red-500 hover:bg-red-500/10"><Trash2 className="h-3.5 w-3.5" /> 删除</button>
                </div>
              )
            }
            if (dl && (dl.status === 'downloading' || dl.status === 'pending')) {
              return (
                <div className="flex min-w-[min(100%,220px)] flex-1 items-center gap-3">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                    <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${dl.progress}%` }} />
                  </div>
                  <span className="text-sm tabular-nums text-[var(--text-muted)]">{dl.progress}%</span>
                  <button onClick={() => videoDownloadManager.cancelDownload(url)} className="rounded-full border border-black/10 px-3 py-1 text-sm hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10">取消</button>
                </div>
              )
            }
            return (
              <button onClick={() => startDownload(selectedEpisode)} className="inline-flex items-center gap-1.5 rounded-full bg-blue-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-600">
                <Download className="h-4 w-4" /> 缓存当前集
              </button>
            )
          })()}
        </div>
      )}

      <section className="mt-6 grid gap-4 lg:grid-cols-[260px,1fr] lg:gap-6">
        <div className="overflow-hidden rounded-[1.5rem] bg-white/70 dark:bg-gray-900/55 border border-black/5 dark:border-white/10 shadow-sm">
          <div className="aspect-[3/4] bg-gradient-to-br from-slate-800 via-zinc-900 to-black">
            <Poster src={detail.cover} title={detail.name} priority />
          </div>
          <button
            onClick={() => toggleFavorite(detail)}
            className={cn('flex w-full items-center justify-center gap-2 px-4 py-3 font-semibold transition-colors', favorite ? 'text-red-500' : 'text-[var(--text-secondary)] hover:text-red-500')}
          >
            <Heart className="h-5 w-5" fill={favorite ? 'currentColor' : 'none'} />
            {favorite ? '已收藏' : '收藏影片'}
          </button>
          <button
            onClick={() => (inWatchLater ? removeWatchLater(detail.id) : addWatchLater(detail))}
            className={cn('flex w-full items-center justify-center gap-2 px-4 py-3 font-semibold transition-colors', inWatchLater ? 'text-amber-500' : 'text-[var(--text-secondary)] hover:text-amber-500')}
          >
            <Clock3 className="h-5 w-5" fill={inWatchLater ? 'currentColor' : 'none'} />
            {inWatchLater ? '已加入稍后再看' : '稍后再看'}
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
          <h1 className="text-2xl font-black text-[var(--text-primary)] sm:text-3xl">{detail.name}</h1>
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

            <div className="mb-3 flex w-full items-center gap-2 rounded-xl bg-black/5 px-3 py-2 dark:bg-white/5 sm:max-w-xs">
              <Search className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
              <input
                value={episodeQuery}
                onChange={(event) => setEpisodeQuery(event.target.value)}
                placeholder="筛选集数（如 3 / 第3集）"
                className="min-w-0 flex-1 bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
              />
              {episodeQuery && (
                <button onClick={() => setEpisodeQuery('')} className="shrink-0 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]">清除</button>
              )}
            </div>

            {filteredEpisodes.length === 0 ? (
              <StatusState variant="empty" icon={SearchX} title="没有匹配的集数" description="试试调整搜索关键词或筛选条件" compact />
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8">
                {filteredEpisodes.map((episode) => {
                  const playing = selectedEpisode?.url === episode.url
                  const watched = watchedEpisodeUrls.has(episode.url)
                  const lastWatched = !playing && episode.url === lastWatchedEpisodeUrl
                  return (
                    <button
                      key={`${episode.sourceIndex}-${episode.title}-${episode.url}`}
                      onClick={() => selectEpisode(episode)}
                      className={cn(
                        'group relative inline-flex items-center justify-center gap-1 rounded-xl px-3 py-2 text-sm transition-all border',
                        playing
                          ? 'border-red-500 bg-red-500 text-white shadow-md shadow-red-500/20'
                          : lastWatched
                            ? 'border-red-500/40 bg-red-500/10 text-[var(--text-primary)] ring-1 ring-red-500/30 hover:bg-red-500/15'
                            : 'border-black/5 dark:border-white/10 bg-white/70 dark:bg-gray-900/60 text-[var(--text-secondary)] hover:bg-white dark:hover:bg-gray-800',
                      )}
                      title={[episode.title, watched ? '已观看' : null, lastWatched ? '上次观看' : null].filter(Boolean).join(' · ')}
                    >
                      <Play className="h-3.5 w-3.5" fill="currentColor" />
                      <span className="truncate">{episode.title}</span>
                      <ReadStateBadge state={watched ? 'read' : 'none'} tone="red" inverted={playing} />
                      {!playing && (() => {
                        const url = episode.url
                        const cachedItem = cachedByUrl.get(url)
                        const dl = activeDownloads[url]
                        if (cachedItem) {
                          return (
                            <span className="absolute right-1 top-1 inline-flex items-center gap-0.5 rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-sm" title={`已缓存 · ${cachedItem.filePath}`}>
                              <Download className="h-3 w-3" strokeWidth={2.5} /> 已存
                            </span>
                          )
                        }
                        if (dl && (dl.status === 'downloading' || dl.status === 'pending')) {
                          return (
                            <span className="absolute right-1 top-1 rounded-full bg-blue-500 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-sm">{dl.progress}%</span>
                          )
                        }
                        if (dl?.status === 'failed') {
                          return (
                            <button onClick={(event) => { event.stopPropagation(); startDownload(episode) }} className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-red-500 text-white shadow-sm" title={dl.error || '下载失败，点击重试'}>
                              <RotateCcw className="h-3 w-3" />
                            </button>
                          )
                        }
                        return (
                          <button onClick={(event) => { event.stopPropagation(); startDownload(episode) }} className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/60 text-white opacity-0 shadow-sm transition-opacity hover:bg-amber-500 group-hover:opacity-100" title="下载 / 缓存本集">
                            <Download className="h-3 w-3" />
                          </button>
                        )
                      })()}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </section>

      {offlineForThisVideo.length > 0 && (
        <section className="mt-8 rounded-[1.75rem] border border-black/5 dark:border-white/10 bg-white/65 dark:bg-gray-950/35 p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Download className="h-5 w-5 text-blue-500" />
              <h2 className="text-xl font-black text-[var(--text-primary)]">本片离线缓存</h2>
              <span className="text-sm text-[var(--text-muted)]">{offlineForThisVideo.length} 集已缓存</span>
            </div>
            <button
              onClick={async () => {
                const dir = await window.electronAPI?.pickVideoCacheDirectory()
                if (dir) setCacheDirectory(dir)
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-black/10 dark:border-white/10 px-3 py-1.5 text-sm font-semibold hover:bg-black/5 dark:hover:bg-white/10"
              title={cacheDirectory ? `保存位置：${cacheDirectory}` : '未设置，使用默认位置'}
            >
              <FolderOpen className="h-4 w-4" /> 更改保存位置
            </button>
          </div>
          <div className="space-y-2">
            {offlineForThisVideo.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-black/5 dark:border-white/10 bg-white/70 dark:bg-gray-900/60 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-secondary)]">{item.episodeTitle}</span>
                <div className="flex shrink-0 items-center gap-2">
                  <button onClick={() => handlePlayOffline(item)} className="inline-flex items-center gap-1 rounded-full bg-blue-500 px-3 py-1 text-sm font-semibold text-white hover:bg-blue-600"><Play className="h-3.5 w-3.5" /> 播放</button>
                  <button onClick={() => window.electronAPI?.openVideoCacheItem(item.filePath)} className="rounded-full border border-black/10 dark:border-white/10 px-3 py-1 text-sm hover:bg-black/5 dark:hover:bg-white/10">打开</button>
                  <button onClick={() => window.electronAPI?.showVideoCacheItemInFolder(item.filePath)} className="rounded-full border border-black/10 dark:border-white/10 px-3 py-1 text-sm hover:bg-black/5 dark:hover:bg-white/10">文件夹</button>
                  <button onClick={() => handleDeleteCache(item)} className="inline-flex items-center gap-1 rounded-full border border-red-500/20 px-3 py-1 text-sm text-red-500 hover:bg-red-500/10"><Trash2 className="h-3.5 w-3.5" /> 删除</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {related.length > 0 && (
        <section className="mt-8 rounded-[1.75rem] border border-black/5 dark:border-white/10 bg-white/65 dark:bg-gray-950/35 p-4 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <Film className="h-5 w-5 text-red-500" />
            <h2 className="text-xl font-black text-[var(--text-primary)]">相关推荐</h2>
            <span className="text-sm text-[var(--text-muted)]">同类型你可能也喜欢</span>
          </div>
          <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin">
            {related.map((item) => <RelatedVideoCard key={item.id} item={item} />)}
          </div>
        </section>
      )}
    </div>
  )
}
