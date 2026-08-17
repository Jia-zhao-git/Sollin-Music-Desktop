import { useEffect, useMemo, useRef, useState, startTransition } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronRight, Clock3, Download, Filter, FolderOpen, Heart, LayoutGrid, Loader2, Play, RefreshCw, Search, SearchX, Sparkles, Trash2 } from 'lucide-react'
import Poster from '@/components/ui/Poster'
import StatusState from '@/components/StatusState'
import videoApi from '@/services/videoApi'
import { getDefaultVideoSourceId, getGroupedVideoSources, VIDEO_SOURCES, VIDEO_SOURCE_STORAGE_KEY } from '@/services/videoSources'
import { useVideoStore } from '@/stores/videoStore'
import type { VideoCacheItem, VideoCategory, VideoListItem, VideoListResult } from '@/types/video'
import { cn } from '@/utils/cn'

const FEATURED_SECTIONS = [
  { title: '最新推荐', subtitle: '当前资源 · 最近更新' },
]

const FALLBACK_CATEGORY_OPTIONS = [
  { id: '6', name: '动作片' },
  { id: '7', name: '喜剧片' },
  { id: '8', name: '爱情片' },
  { id: '9', name: '科幻片' },
  { id: '11', name: '剧情片' },
  { id: '13', name: '国产剧' },
  { id: '14', name: '香港剧' },
  { id: '15', name: '韩国剧' },
  { id: '16', name: '欧美剧' },
  { id: '29', name: '国产动漫' },
  { id: '30', name: '日韩动漫' },
]

const AREA_OPTIONS = ['全部', '大陆', '香港', '台湾', '美国', '日本', '韩国', '英国', '法国', '德国', '泰国', '印度']
const YEAR_OPTIONS = ['全部', '2026', '2025', '2024', '2023', '2022', '2021', '2020', '2019', '2018']
const SORT_OPTIONS = [
  { id: 'time', name: '最新' },
  { id: 'hits', name: '热度' },
  { id: 'score', name: '评分' },
]

const getCategoryOptions = (categories: VideoCategory[] | undefined) => {
  const raw = categories?.length
    ? categories
    : FALLBACK_CATEGORY_OPTIONS.map((item) => ({ type_id: item.id, type_name: item.name }))
  // 直接展示当前源接口返回的原始分类，不做电影/电视剧/动漫/综艺四类归并
  return raw
    .filter((category) => !['1', '2', '3', '4'].includes(String(category.type_id)))
    .map((category) => ({ id: String(category.type_id), name: category.type_name }))
    .slice(0, 24)
}

function VideoCard({ item, compact = false, priority = false, favorite = false, watchedSeconds = 0 }: { item: VideoListItem; compact?: boolean; priority?: boolean; favorite?: boolean; watchedSeconds?: number }) {
  const navigate = useNavigate()

  return (
    <button
      onClick={() => navigate(`/video/${item.id}`)}
      className={cn(
        'group shrink-0 text-left rounded-2xl overflow-hidden bg-white/75 dark:bg-gray-900/60 border border-black/5 dark:border-white/10 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all',
        compact ? 'w-36 sm:w-40' : 'w-full',
      )}
      title={item.name}
    >
      <div className="relative aspect-[3/4] bg-gradient-to-br from-slate-800 via-zinc-900 to-black overflow-hidden">
        <Poster src={item.cover} title={item.name} priority={priority} />
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent opacity-80" />

        {favorite && (
          <span className="absolute left-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-red-500 text-white shadow-lg" title="已收藏">
            <Heart className="h-4 w-4" fill="currentColor" />
          </span>
        )}

        {watchedSeconds > 0 && (
          <span className="absolute right-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] text-white backdrop-blur">
            已看 {formatWatchTime(watchedSeconds)}
          </span>
        )}

        <div className="absolute left-2 right-2 bottom-2 flex items-end justify-between gap-2">
          <span className="min-w-0 rounded-full bg-black/55 px-2 py-1 text-xs text-white backdrop-blur truncate">{item.remarks || item.typeName}</span>
          <span className="grid h-8 w-8 place-items-center rounded-full bg-white text-black opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
            <Play className="h-4 w-4" fill="currentColor" />
          </span>
        </div>
      </div>
      <div className="p-3">
        <h3 className="font-semibold text-[var(--text-primary)] line-clamp-2 min-h-[2.7rem]">{item.name}</h3>
        <p className="mt-1 text-xs text-[var(--text-muted)] truncate">
          {[item.typeName, item.year, item.area].filter(Boolean).join(' · ') || '未知分类'}
        </p>
        {item.sourceName && (
          <p className="mt-1 text-[10px] text-[var(--text-muted)]/70 truncate">{item.sourceName}</p>
        )}
      </div>
    </button>
  )
}

function formatWatchTime(seconds: number): string {
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function MiniRail({ title, icon, items, favoriteIds, watchedMap, onClear }: { title: string; icon: ReactNode; items: VideoListItem[]; favoriteIds?: Set<string>; watchedMap?: Map<string, number>; onClear?: () => void }) {
  if (!items.length) return null

  return (
    <section className="rounded-[1.75rem] border border-black/5 dark:border-white/10 bg-white/55 dark:bg-gray-950/35 p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="text-xl font-black text-[var(--text-primary)]">{title}</h2>
        </div>
        {onClear && (
          <button
            onClick={() => {
              if (window.confirm(`确定清空「${title}」吗？`)) onClear()
            }}
            className="rounded-full px-3 py-1 text-xs font-semibold text-[var(--text-muted)] hover:bg-red-500/10 hover:text-red-500 transition-colors"
          >
            清空
          </button>
        )}
      </div>
      <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin">
        {items.slice(0, 12).map((item) => (
          <VideoCard
            key={item.id}
            item={item}
            compact
            favorite={favoriteIds?.has(item.id)}
            watchedSeconds={watchedMap?.get(item.id) ?? 0}
          />
        ))}
      </div>
    </section>
  )
}

function OfflineSection({
  items,
  cacheDirectory,
  onPlay,
  onOpen,
  onOpenFolder,
  onRemove,
  onChangeDir,
}: {
  items: VideoCacheItem[]
  cacheDirectory: string
  onPlay: (item: VideoCacheItem) => void
  onOpen: (filePath: string) => void
  onOpenFolder: (filePath: string) => void
  onRemove: (id: string) => void
  onChangeDir: () => void
}) {
  return (
    <section className="rounded-[1.75rem] border border-black/5 dark:border-white/10 bg-white/55 dark:bg-gray-950/35 p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Download className="h-5 w-5 text-blue-500" />
          <h2 className="text-xl font-black text-[var(--text-primary)]">离线缓存</h2>
          <span className="text-sm text-[var(--text-muted)]">{items.length} 个视频</span>
        </div>
        <button
          onClick={onChangeDir}
          className="inline-flex items-center gap-1.5 rounded-full border border-black/10 dark:border-white/10 px-3 py-1.5 text-sm font-semibold hover:bg-black/5 dark:hover:bg-white/10"
          title={cacheDirectory ? `当前保存位置：${cacheDirectory}` : '未设置，使用默认位置'}
        >
          <FolderOpen className="h-4 w-4" /> 更改保存位置
        </button>
      </div>
      {cacheDirectory && (
        <p className="mb-3 truncate rounded-xl bg-black/5 px-3 py-1.5 text-xs text-[var(--text-muted)] dark:bg-white/5" title={cacheDirectory}>保存位置：{cacheDirectory}</p>
      )}
      {items.length === 0 ? (
        <StatusState variant="empty" icon={FolderOpen} title="还没有缓存的视频" description="在影片详情页点「缓存当前集」即可离线观看。" compact />
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-black/5 dark:border-white/10 bg-white/70 dark:bg-gray-900/60 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{item.videoName}</p>
                <p className="truncate text-xs text-[var(--text-muted)]">{item.episodeTitle}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button onClick={() => onPlay(item)} className="inline-flex items-center gap-1 rounded-full bg-blue-500 px-3 py-1 text-sm font-semibold text-white hover:bg-blue-600"><Play className="h-3.5 w-3.5" /> 播放</button>
                <button onClick={() => onOpen(item.filePath)} className="rounded-full border border-black/10 dark:border-white/10 px-3 py-1 text-sm hover:bg-black/5 dark:hover:bg-white/10">打开</button>
                <button onClick={() => onOpenFolder(item.filePath)} className="rounded-full border border-black/10 dark:border-white/10 px-3 py-1 text-sm hover:bg-black/5 dark:hover:bg-white/10">文件夹</button>
                <button onClick={() => onRemove(item.id)} className="inline-flex items-center gap-1 rounded-full border border-red-500/20 px-3 py-1 text-sm text-red-500 hover:bg-red-500/10"><Trash2 className="h-3.5 w-3.5" /> 删除</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function SourceSwitcher({ sourceId, onChange }: { sourceId: string; onChange: (sourceId: string) => void }) {
  const [hiddenUnlocked, setHiddenUnlocked] = useState(false)
  const [ffzyClickCount, setFfzyClickCount] = useState(0)
  const [showPasswordDialog, setShowPasswordDialog] = useState(false)
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const groups = useMemo(() => getGroupedVideoSources(hiddenUnlocked), [hiddenUnlocked])
  const active = Object.values(groups).flat().find((source) => source.id === sourceId)

  const openPasswordDialog = () => {
    setPassword('')
    setPasswordError('')
    setShowPasswordDialog(true)
  }

  const handlePasswordSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (password === '112212') {
      setHiddenUnlocked(true)
      setShowPasswordDialog(false)
      setPassword('')
      setPasswordError('')
      return
    }
    setHiddenUnlocked(false)
    setPasswordError('密码错误')
    setPassword('')
  }

  const handleSourceClick = (nextSourceId: string) => {
    if (nextSourceId === 'ffzy' && !hiddenUnlocked) {
      const nextCount = ffzyClickCount + 1
      setFfzyClickCount(nextCount)
      if (nextCount >= 5) {
        setFfzyClickCount(0)
        openPasswordDialog()
      }
    } else if (nextSourceId !== 'ffzy' && ffzyClickCount > 0) {
      setFfzyClickCount(0)
    }
    onChange(nextSourceId)
  }

  return (
    <>
      <details className="group mt-4 max-w-5xl rounded-2xl border border-white/10 bg-white/10 p-3 backdrop-blur">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm text-white/75">
        <span>当前资源：<b className="text-white">{active?.name || '默认资源'}</b></span>
        <span className="rounded-full bg-white/10 px-3 py-1 group-open:bg-white group-open:text-slate-950">切换资源</span>
      </summary>
      <div className="mt-4 space-y-4">
        {Object.entries(groups).map(([group, sources]) => (
          <div key={group}>
            <div className="mb-2 text-xs font-bold text-white/45">{group}</div>
            <div className="flex flex-wrap gap-2">
              {sources.map((source) => (
                <button
                  key={source.id}
                  type="button"
                  onClick={() => handleSourceClick(source.id)}
                  className={cn(
                    'rounded-full px-3 py-1.5 text-sm font-semibold transition-all',
                    sourceId === source.id
                      ? 'bg-white text-slate-950'
                      : 'bg-white/10 text-white/75 hover:bg-white/18',
                  )}
                  title={`${source.name}\n${source.url}${source.note ? `\n${source.note}` : ''}`}
                >
                  {source.name}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      </details>

      {showPasswordDialog && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm" onClick={() => setShowPasswordDialog(false)}>
          <form
            onSubmit={handlePasswordSubmit}
            className="w-full max-w-sm rounded-2xl border border-white/10 bg-white p-5 shadow-2xl dark:bg-gray-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4">
              <h3 className="text-lg font-black text-[var(--text-primary)]">输入访问密码</h3>
              <p className="mt-1 text-sm text-[var(--text-muted)]">密码正确后，本次打开页面会临时显示隐藏视频源。</p>
            </div>
            <input
              autoFocus
              type="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value)
                if (passwordError) setPasswordError('')
              }}
              placeholder="请输入密码"
              className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-[var(--text-primary)] outline-none focus:border-red-500 dark:border-white/10 dark:bg-gray-950"
            />
            {passwordError && <p className="mt-2 text-sm text-red-500">{passwordError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowPasswordDialog(false)}
                className="rounded-xl px-4 py-2 text-sm font-bold text-[var(--text-muted)] hover:bg-black/5 dark:hover:bg-white/10"
              >
                取消
              </button>
              <button type="submit" className="rounded-xl bg-red-500 px-4 py-2 text-sm font-bold text-white hover:bg-red-600">
                确认
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}

function FeaturedSection({
  title,
  subtitle,
  items,
  loading,
  favoriteIds,
  onMore,
}: {
  title: string
  subtitle: string
  items: VideoListItem[]
  loading: boolean
  favoriteIds?: Set<string>
  onMore: () => void
}) {
  return (
    <section className="rounded-[1.75rem] border border-black/5 dark:border-white/10 bg-white/55 dark:bg-gray-950/35 p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-black text-[var(--text-primary)]">{title}</h2>
          <p className="text-sm text-[var(--text-muted)]">{subtitle}</p>
        </div>
        <button onClick={onMore} className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-black/5 dark:hover:bg-white/10">
          更多 <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {loading ? (
        <div className="grid h-52 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-red-500" /></div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin">
          {items.map((item, index) => (
            <VideoCard key={item.id} item={item} compact priority={index < 6} favorite={favoriteIds?.has(item.id)} />
          ))}
        </div>
      )}
    </section>
  )
}

export default function VideoHome() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialKeyword = searchParams.get('wd') || ''
  const initialType = searchParams.get('type') || ''
  const initialArea = searchParams.get('area') || ''
  const initialYear = searchParams.get('year') || ''
  const initialSort = searchParams.get('sort') || 'time'
  const visibleSourceIds = useMemo(() => new Set(VIDEO_SOURCES.map((source) => source.id)), [])
  const requestedSourceId = searchParams.get('source') || ''
  const storedSourceId = typeof window !== 'undefined' ? window.localStorage.getItem(VIDEO_SOURCE_STORAGE_KEY) : ''
  const initialSourceId = visibleSourceIds.has(requestedSourceId)
    ? requestedSourceId
    : storedSourceId && visibleSourceIds.has(storedSourceId)
      ? storedSourceId
      : getDefaultVideoSourceId()
  const initialPage = Number(searchParams.get('page') || '1') || 1

  const [keywordInput, setKeywordInput] = useState(initialKeyword)
  const [keyword, setKeyword] = useState(initialKeyword)
  const [typeId, setTypeId] = useState(initialType)
  const [area, setArea] = useState(initialArea)
  const [year, setYear] = useState(initialYear)
  const [sort, setSort] = useState(initialSort)
  const [sourceId, setSourceId] = useState(initialSourceId)
  const [page, setPage] = useState(initialPage)
  const resultsRef = useRef<HTMLDivElement>(null)
  const [result, setResult] = useState<VideoListResult | null>(null)
  const [featured, setFeatured] = useState<Record<string, VideoListItem[]>>({})
  const [featuredLoading, setFeaturedLoading] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const history = useVideoStore((state) => state.history)
  const favorites = useVideoStore((state) => state.favorites)
  const watchLater = useVideoStore((state) => state.watchLater)
  const navigate = useNavigate()
  const removeWatchLater = useVideoStore((state) => state.removeWatchLater)
  const downloads = useVideoStore((state) => state.downloads)
  const cacheDirectory = useVideoStore((state) => state.cacheDirectory)
  const setCacheDirectory = useVideoStore((state) => state.setCacheDirectory)
  const removeDownload = useVideoStore((state) => state.removeDownload)
  const scanCache = useVideoStore((state) => state.scanCache)
  const clearHistory = useVideoStore((state) => state.clearHistory)
  const clearFavorites = useVideoStore((state) => state.clearFavorites)
  const hasFilterMode = Boolean(keyword || typeId || area || year || sort !== 'time')

  // 把缓存目录同步为真实生效路径（主进程默认值或用户设置），便于展示与修改。
  useEffect(() => {
    const api = window.electronAPI
    if (!api?.getVideoCacheDirectory) return
    api.getVideoCacheDirectory().then((dir) => { if (dir) setCacheDirectory(dir) }).catch(() => {})
  }, [setCacheDirectory])

  // 进入页面 / 缓存目录变化后，扫描磁盘把「已缓存视频」补全并清理失效条目。
  useEffect(() => {
    scanCache().catch(() => {})
  }, [scanCache, cacheDirectory])

  const changeCacheDir = async () => {
    const dir = await window.electronAPI?.pickVideoCacheDirectory()
    if (dir) setCacheDirectory(dir)
  }

  // 删除离线缓存：先删磁盘文件（若支持），再清 store 记录。
  const handleRemoveOffline = async (id: string) => {
    const api = window.electronAPI
    const item = useVideoStore.getState().downloads.find((entry) => entry.id === id)
    if (api?.deleteVideoCacheItem && item) {
      try {
        await api.deleteVideoCacheItem(item.filePath)
      } catch {
        // 文件可能已不存在，忽略后继续清理记录
      }
    }
    removeDownload(id)
  }

  // 离线缓存「播放」：有影片 id 则跳详情页并携带 ?offline= 自动离线播放；
  // 孤儿文件（无 videoId）走应用内离线播放页，复用主播放器，不再丢给系统外部播放器。
  const handlePlayOfflineItem = (item: VideoCacheItem) => {
    if (item.videoId) {
      navigate(`/video/${item.videoId}?offline=${encodeURIComponent(item.filePath)}`)
    } else {
      const params = new URLSearchParams({ file: item.filePath })
      if (item.videoName) params.set('name', item.videoName)
      if (item.episodeTitle) params.set('title', item.episodeTitle)
      navigate(`/video/offline?${params.toString()}`)
    }
  }

  useEffect(() => {
    const nextParams: Record<string, string> = {}
    if (keyword) nextParams.wd = keyword
    if (typeId) nextParams.type = typeId
    if (area) nextParams.area = area
    if (year) nextParams.year = year
    if (sort && sort !== 'time') nextParams.sort = sort
    if (sourceId && sourceId !== getDefaultVideoSourceId()) nextParams.source = sourceId
    if (page > 1) nextParams.page = String(page)
    setSearchParams(nextParams, { replace: true })
  }, [area, keyword, page, setSearchParams, sort, sourceId, typeId, year])

  useEffect(() => {
    if (!visibleSourceIds.has(sourceId)) {
      window.localStorage.removeItem(VIDEO_SOURCE_STORAGE_KEY)
      return
    }
    window.localStorage.setItem(VIDEO_SOURCE_STORAGE_KEY, sourceId)
  }, [sourceId, visibleSourceIds])

  // 搜索输入防抖：停止输入 300ms 后才触发搜索，避免每次键入都并发打多源。
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setKeyword(keywordInput.trim())
      setPage(1)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [keywordInput])

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      if (cancelled) return
      setFeaturedLoading(true)

      Promise.all(FEATURED_SECTIONS.map(async (section) => {
        const data = await videoApi.getList({ page: 1, sort: 'time', sourceId })
        return [section.title, data.list.slice(0, 12)] as const
      }))
        .then((entries) => {
          if (!cancelled) setFeatured(Object.fromEntries(entries))
        })
        .catch((err) => console.error('Load featured videos failed:', err))
        .finally(() => {
          if (!cancelled) setFeaturedLoading(false)
        })
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [sourceId])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    const trimmedKeyword = keyword.trim()
    const request = trimmedKeyword
      ? videoApi.searchAll({ keyword: trimmedKeyword, page, area, year, sort })
      : videoApi.getList({ page, typeId, keyword, area, year, sort, sourceId })

    request
      .then((data) => {
        if (!cancelled) {
          startTransition(() => setResult(data))
        }
      })
      .catch((err) => {
        console.error('Load video list failed:', err)
        if (!cancelled) setError(err instanceof Error ? err.message : '加载影视列表失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [area, keyword, page, sort, sourceId, typeId, year])

  const categoryOptions = useMemo(() => getCategoryOptions(result?.categories), [result?.categories])
  const pageSummary = useMemo(() => {
    if (!result) return '正在连接影视源...'
    return `第 ${result.page} / ${result.pageCount} 页 · 共 ${result.total.toLocaleString()} 条`
  }, [result])

  // 收藏 id 集合
  const favoriteIds = useMemo(() => new Set(favorites.map((item) => item.id)), [favorites])

  // 影片 id -> 最近观看时长（秒），用于「继续观看」与列表卡片的「已看」角标。
  const watchedMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const item of history) {
      const id = item.video.id
      if (!map.has(id) && item.currentTime != null && item.currentTime > 0) {
        map.set(id, item.currentTime)
      }
    }
    return map
  }, [history])

  const setFilter = (patch: Partial<{ typeId: string; area: string; year: string; sort: string; sourceId: string }>) => {
    if (patch.sourceId !== undefined) {
      setSourceId(patch.sourceId)
      setTypeId('')
      setArea('')
      setYear('')
      setResult(null)
      setFeatured({})
    }
    if (patch.typeId !== undefined) setTypeId(patch.typeId)
    if (patch.area !== undefined) setArea(patch.area)
    if (patch.year !== undefined) setYear(patch.year)
    if (patch.sort !== undefined) setSort(patch.sort)
    setPage(1)
  }

  const submitSearch = (event: FormEvent) => {
    event.preventDefault()
    setKeyword(keywordInput.trim())
    setPage(1)
  }

  return (
    <div className="pb-10">
      <section className="relative overflow-hidden rounded-[2rem] border border-white/15 bg-slate-950 px-6 py-8 text-white shadow-2xl mb-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(248,113,113,.34),transparent_34%),radial-gradient(circle_at_85%_5%,rgba(59,130,246,.28),transparent_28%),linear-gradient(135deg,rgba(15,23,42,.96),rgba(24,24,27,.98))]" />
        <div className="relative z-10 max-w-3xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-sm backdrop-blur">
            <Sparkles className="h-4 w-4 text-red-300" />
            在线影视 · 今日更新
          </div>
          <h1 className="text-3xl md:text-5xl font-black tracking-tight">发现电影、剧集、动漫与综艺</h1>
          <p className="mt-3 text-white/70 max-w-2xl">按分区浏览推荐内容，也可以进入电影、电视剧等分类，用国家、年份、热度筛选片源。</p>
          <form onSubmit={submitSearch} className="mt-6 flex max-w-xl items-center gap-2 rounded-2xl bg-white/12 p-2 backdrop-blur-xl border border-white/10">
            <Search className="ml-2 h-5 w-5 text-white/55" />
            <input
              value={keywordInput}
              onChange={(event) => setKeywordInput(event.target.value)}
              placeholder="搜索电影、剧集、动漫..."
              className="min-w-0 flex-1 bg-transparent px-2 py-2 text-white placeholder:text-white/45 outline-none"
            />
            <button className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-slate-950 hover:bg-red-100 transition-colors">搜索</button>
          </form>
        </div>
        <div className="relative z-10">
          <SourceSwitcher sourceId={sourceId} onChange={(nextSourceId) => setFilter({ sourceId: nextSourceId })} />
        </div>
      </section>

      {!hasFilterMode && (
        <div className="mb-9 space-y-6">
          <MiniRail title="继续观看" icon={<Clock3 className="h-5 w-5 text-red-500" />} items={history.map((item) => item.video)} favoriteIds={favoriteIds} watchedMap={watchedMap} onClear={clearHistory} />
          <MiniRail title="我的收藏" icon={<Heart className="h-5 w-5 text-red-500" fill="currentColor" />} items={favorites} favoriteIds={favoriteIds} watchedMap={watchedMap} onClear={clearFavorites} />
          <MiniRail title="稍后再看" icon={<Clock3 className="h-5 w-5 text-amber-500" />} items={watchLater} favoriteIds={favoriteIds} watchedMap={watchedMap} onClear={() => watchLater.forEach((item) => removeWatchLater(item.id))} />
          {FEATURED_SECTIONS.map((section) => (
            <FeaturedSection
              key={section.title}
              title={section.title}
              subtitle={section.subtitle}
              items={featured[section.title] || []}
              loading={featuredLoading}
              favoriteIds={favoriteIds}
              onMore={() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            />
          ))}
          <OfflineSection
            items={downloads}
            cacheDirectory={cacheDirectory}
            onPlay={handlePlayOfflineItem}
            onOpen={(filePath) => window.electronAPI?.openVideoCacheItem(filePath)}
            onOpenFolder={(filePath) => window.electronAPI?.showVideoCacheItemInFolder(filePath)}
            onRemove={handleRemoveOffline}
            onChangeDir={changeCacheDir}
          />
        </div>
      )}

      {!keyword && categoryOptions.length > 0 && (
        <section className="mb-8 rounded-[1.75rem] border border-black/5 dark:border-white/10 bg-white/65 dark:bg-gray-950/35 p-4 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <LayoutGrid className="h-5 w-5 text-red-500" />
            <h2 className="text-xl font-black text-[var(--text-primary)]">分类浏览</h2>
            <span className="text-sm text-[var(--text-muted)]">按类型快速筛选片源</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {categoryOptions.map((category) => (
              <button
                key={category.id}
                onClick={() => {
                  setFilter({ typeId: category.id })
                  resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }}
                className={cn(
                  'rounded-full border px-4 py-2 text-sm font-semibold transition-all',
                  typeId === category.id
                    ? 'border-red-500 bg-red-500 text-white shadow-sm shadow-red-500/20'
                    : 'border-black/5 dark:border-white/10 bg-white/70 dark:bg-gray-900/60 text-[var(--text-secondary)] hover:bg-white dark:hover:bg-gray-800',
                )}
              >
                {category.name}
              </button>
            ))}
          </div>
        </section>
      )}

      <section ref={resultsRef} className="rounded-[1.75rem] border border-black/5 dark:border-white/10 bg-white/65 dark:bg-gray-950/35 p-4 shadow-sm">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Filter className="h-5 w-5 text-red-500" />
            <h2 className="text-xl font-black text-[var(--text-primary)]">分区筛选</h2>
          </div>
          <div className="text-sm text-[var(--text-muted)]">{pageSummary}</div>
        </div>

        <div className="space-y-3">
          <FilterRow label="分类" value={typeId} options={[{ id: '', name: '全部' }, ...categoryOptions]} onChange={(value) => setFilter({ typeId: value })} />
          <FilterRow label="国家" value={area} options={AREA_OPTIONS.map((item) => ({ id: item === '全部' ? '' : item, name: item }))} onChange={(value) => setFilter({ area: value })} />
          <FilterRow label="年份" value={year} options={YEAR_OPTIONS.map((item) => ({ id: item === '全部' ? '' : item, name: item }))} onChange={(value) => setFilter({ year: value })} />
          <FilterRow label="排序" value={sort} options={SORT_OPTIONS} onChange={(value) => setFilter({ sort: value || 'time' })} />
        </div>
      </section>

      {error && (
        <div className="mt-6 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-red-600 dark:text-red-300">
          {error}
        </div>
      )}

      {loading && !result ? (
        <div className="grid h-[40vh] place-items-center">
          <Loader2 className="h-8 w-8 animate-spin text-red-500" />
        </div>
      ) : (
        <section className="mt-6">
          <div className={cn('grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-4', loading && 'opacity-60 pointer-events-none')}>
            {(result?.list || []).map((item, index) => (
              <VideoCard
                key={item.id}
                item={item}
                priority={index < 8}
                favorite={favoriteIds.has(item.id)}
                watchedSeconds={watchedMap.get(item.id) ?? 0}
              />
            ))}
          </div>

          {result && result.list.length === 0 && !loading && (
            <StatusState variant="empty" icon={SearchX} title="没有找到相关影片" description="换个关键词或筛选条件再试试" />
          )}

          {result && result.pageCount > 1 && (
            <div className="mt-8 flex items-center justify-center gap-3">
              <button
                disabled={page <= 1 || loading}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                className="rounded-full border border-black/10 dark:border-white/10 px-5 py-2 disabled:opacity-40 hover:bg-white/70 dark:hover:bg-gray-800"
              >
                上一页
              </button>
              <button
                disabled={loading}
                onClick={() => setPage((current) => current + 1)}
                className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-5 py-2 text-white dark:bg-white dark:text-slate-950 disabled:opacity-40"
              >
                {loading && <RefreshCw className="h-4 w-4 animate-spin" />}
                下一页
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  )
}

function FilterRow({ label, value, options, onChange }: {
  label: string
  value: string
  options: Array<{ id: string; name: string }>
  onChange: (value: string) => void
}) {
  return (
    <div className="flex gap-3 text-sm">
      <div className="w-10 shrink-0 py-1.5 font-semibold text-[var(--text-muted)]">{label}</div>
      <div className="flex flex-1 flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={`${label}-${option.id || 'all'}`}
            onClick={() => onChange(option.id)}
            className={cn(
              'rounded-full px-3 py-1.5 transition-all',
              value === option.id
                ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950'
                : 'text-[var(--text-secondary)] hover:bg-black/5 dark:hover:bg-white/10',
            )}
          >
            {option.name}
          </button>
        ))}
      </div>
    </div>
  )
}
