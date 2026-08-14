import { useEffect, useMemo, useState, startTransition } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Clapperboard, Clock3, Filter, Heart, Loader2, Play, RefreshCw, Search, Sparkles } from 'lucide-react'
import videoApi from '@/services/videoApi'
import { getDefaultVideoSourceId, getGroupedVideoSources, VIDEO_SOURCE_STORAGE_KEY } from '@/services/videoSources'
import { useVideoStore } from '@/stores/videoStore'
import type { VideoCategory, VideoListItem, VideoListResult } from '@/types/video'
import { cn } from '@/utils/cn'

const ROOT_TABS = [
  { id: '', name: '全部', children: [] },
  { id: 'movie', name: '电影', children: ['6', '7', '8', '9', '10', '11', '12', '20', '34'] },
  { id: 'series', name: '电视剧', children: ['13', '14', '15', '16', '21', '22', '23', '24', '36'] },
  { id: 'variety', name: '综艺', children: ['25', '26', '27', '28'] },
  { id: 'anime', name: '动漫', children: ['29', '30', '31', '32', '33'] },
]

const FEATURED_SECTIONS = [
  { title: '电影推荐', typeId: '6', subtitle: '高能电影 · 最新片源' },
  { title: '电视剧热播', typeId: '13', subtitle: '正在更新 · 连续追剧' },
  { title: '动漫新番', typeId: '29', subtitle: '国漫日漫 · 每日更新' },
  { title: '综艺精选', typeId: '25', subtitle: '轻松下饭 · 热门综艺' },
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

const FALLBACK_COVER = 'data:image/svg+xml;utf8,%3Csvg xmlns="http://www.w3.org/2000/svg" width="360" height="480" viewBox="0 0 360 480"%3E%3Cdefs%3E%3ClinearGradient id="g" x1="0" x2="1" y1="0" y2="1"%3E%3Cstop stop-color="%23111827"/%3E%3Cstop offset=".55" stop-color="%233f1d2a"/%3E%3Cstop offset="1" stop-color="%23060a13"/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width="360" height="480" fill="url(%23g)"/%3E%3Ccircle cx="180" cy="210" r="58" fill="%23ffffff" opacity=".1"/%3E%3Cpath d="M162 178v64l54-32z" fill="%23ffffff" opacity=".45"/%3E%3Ctext x="180" y="320" fill="%23ffffff" opacity=".52" font-family="Arial" font-size="24" text-anchor="middle"%3ESollin Video%3C/text%3E%3C/svg%3E'

const getCategoriesForRoot = (categories: VideoCategory[] | undefined, rootId: string) => {
  const root = ROOT_TABS.find((tab) => tab.id === rootId)
  const normalized = (categories?.length ? categories : FALLBACK_CATEGORY_OPTIONS.map((item) => ({ type_id: item.id, type_name: item.name })))
    .filter((category) => !['1', '2', '3', '4'].includes(String(category.type_id)))
    .map((category) => ({ id: String(category.type_id), name: category.type_name }))

  if (!rootId || !root?.children.length) return normalized.slice(0, 24)
  return normalized.filter((category) => root.children.includes(category.id))
}

function VideoCard({ item, compact = false, priority = false }: { item: VideoListItem; compact?: boolean; priority?: boolean }) {
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
        {item.cover ? (
          <img
            src={item.cover}
            alt={item.name}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
            referrerPolicy="no-referrer"
            onError={(event) => {
              event.currentTarget.src = FALLBACK_COVER
            }}
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center">
            <Clapperboard className="h-12 w-12 text-white/35" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent opacity-80" />
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
      </div>
    </button>
  )
}

function MiniRail({ title, icon, items }: { title: string; icon: ReactNode; items: VideoListItem[] }) {
  if (!items.length) return null

  return (
    <section className="rounded-[1.75rem] border border-black/5 dark:border-white/10 bg-white/55 dark:bg-gray-950/35 p-4 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        {icon}
        <h2 className="text-xl font-black text-[var(--text-primary)]">{title}</h2>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin">
        {items.slice(0, 12).map((item) => <VideoCard key={item.id} item={item} compact />)}
      </div>
    </section>
  )
}

function SourceSwitcher({ sourceId, onChange }: { sourceId: string; onChange: (sourceId: string) => void }) {
  const groups = useMemo(() => getGroupedVideoSources(), [])
  const active = Object.values(groups).flat().find((source) => source.id === sourceId)

  return (
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
                  onClick={() => onChange(source.id)}
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
  )
}

function FeaturedCarousel({
  sections,
  activeIndex,
  featured,
  loading,
  onChange,
  onMore,
}: {
  sections: typeof FEATURED_SECTIONS
  activeIndex: number
  featured: Record<string, VideoListItem[]>
  loading: boolean
  onChange: (index: number) => void
  onMore: (section: typeof FEATURED_SECTIONS[number]) => void
}) {
  const activeSection = sections[activeIndex] || sections[0]
  const items = featured[activeSection.title] || []
  const prev = () => onChange((activeIndex - 1 + sections.length) % sections.length)
  const next = () => onChange((activeIndex + 1) % sections.length)

  return (
    <section className="rounded-[1.75rem] border border-black/5 dark:border-white/10 bg-white/55 dark:bg-gray-950/35 p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-black text-[var(--text-primary)]">推荐片库</h2>
          <p className="text-sm text-[var(--text-muted)]">
            {activeSection.title} · {activeSection.subtitle}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={prev} className="grid h-9 w-9 place-items-center rounded-full bg-black/5 text-[var(--text-secondary)] hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button onClick={next} className="grid h-9 w-9 place-items-center rounded-full bg-black/5 text-[var(--text-secondary)] hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15">
            <ChevronRight className="h-4 w-4" />
          </button>
          <button onClick={() => onMore(activeSection)} className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-black/5 dark:hover:bg-white/10">
            更多 <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {sections.map((section, index) => (
          <button
            key={section.title}
            onClick={() => onChange(index)}
            className={cn(
              'rounded-full px-3 py-1.5 text-sm font-semibold transition-all',
              activeIndex === index
                ? 'bg-red-500 text-white shadow-md shadow-red-500/20'
                : 'bg-black/5 text-[var(--text-secondary)] hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15',
            )}
          >
            {section.title.replace('推荐', '').replace('热播', '').replace('新番', '').replace('精选', '')}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid h-52 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-red-500" /></div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin">
          {items.map((item, index) => <VideoCard key={item.id} item={item} compact priority={index < 6} />)}
        </div>
      )}

      <div className="mt-4 flex justify-center gap-2">
        {sections.map((section, index) => (
          <button
            key={`${section.title}-dot`}
            aria-label={`切换到${section.title}`}
            onClick={() => onChange(index)}
            className={cn('h-1.5 rounded-full transition-all', activeIndex === index ? 'w-8 bg-red-500' : 'w-2 bg-black/15 dark:bg-white/20')}
          />
        ))}
      </div>
    </section>
  )
}

export default function VideoHome() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialKeyword = searchParams.get('wd') || ''
  const initialRoot = searchParams.get('root') || ''
  const initialType = searchParams.get('type') || ''
  const initialArea = searchParams.get('area') || ''
  const initialYear = searchParams.get('year') || ''
  const initialSort = searchParams.get('sort') || 'time'
  const initialSourceId = searchParams.get('source') || (typeof window !== 'undefined' ? window.localStorage.getItem(VIDEO_SOURCE_STORAGE_KEY) : '') || getDefaultVideoSourceId()
  const initialPage = Number(searchParams.get('page') || '1') || 1

  const [keywordInput, setKeywordInput] = useState(initialKeyword)
  const [keyword, setKeyword] = useState(initialKeyword)
  const [rootType, setRootType] = useState(initialRoot)
  const [typeId, setTypeId] = useState(initialType)
  const [area, setArea] = useState(initialArea)
  const [year, setYear] = useState(initialYear)
  const [sort, setSort] = useState(initialSort)
  const [sourceId, setSourceId] = useState(initialSourceId)
  const [page, setPage] = useState(initialPage)
  const [result, setResult] = useState<VideoListResult | null>(null)
  const [featured, setFeatured] = useState<Record<string, VideoListItem[]>>({})
  const [featuredIndex, setFeaturedIndex] = useState(0)
  const [featuredLoading, setFeaturedLoading] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const history = useVideoStore((state) => state.history)
  const favorites = useVideoStore((state) => state.favorites)
  const hasFilterMode = Boolean(keyword || rootType || typeId || area || year || sort !== 'time')

  useEffect(() => {
    const nextParams: Record<string, string> = {}
    if (keyword) nextParams.wd = keyword
    if (rootType) nextParams.root = rootType
    if (typeId) nextParams.type = typeId
    if (area) nextParams.area = area
    if (year) nextParams.year = year
    if (sort && sort !== 'time') nextParams.sort = sort
    if (sourceId && sourceId !== getDefaultVideoSourceId()) nextParams.source = sourceId
    if (page > 1) nextParams.page = String(page)
    setSearchParams(nextParams, { replace: true })
  }, [area, keyword, page, rootType, setSearchParams, sort, sourceId, typeId, year])

  useEffect(() => {
    window.localStorage.setItem(VIDEO_SOURCE_STORAGE_KEY, sourceId)
  }, [sourceId])

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      if (cancelled) return
      setFeaturedLoading(true)

      Promise.all(FEATURED_SECTIONS.map(async (section) => {
        const data = await videoApi.getList({ page: 1, typeId: section.typeId, sort: 'time', sourceId })
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
    if (hasFilterMode) return undefined
    const timer = window.setInterval(() => {
      setFeaturedIndex((current) => (current + 1) % FEATURED_SECTIONS.length)
    }, 6000)
    return () => window.clearInterval(timer)
  }, [hasFilterMode])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    videoApi.getList({ page, rootType, typeId, keyword, area, year, sort, sourceId })
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
  }, [area, keyword, page, rootType, sort, sourceId, typeId, year])

  const categoryOptions = useMemo(() => getCategoriesForRoot(result?.categories, rootType), [result?.categories, rootType])
  const pageSummary = useMemo(() => {
    if (!result) return '正在连接影视源...'
    return `第 ${result.page} / ${result.pageCount} 页 · 共 ${result.total.toLocaleString()} 条`
  }, [result])

  const setFilter = (patch: Partial<{ rootType: string; typeId: string; area: string; year: string; sort: string; sourceId: string }>) => {
    if (patch.sourceId !== undefined) {
      setSourceId(patch.sourceId)
      setRootType('')
      setTypeId('')
      setArea('')
      setYear('')
      setResult(null)
      setFeatured({})
    }
    if (patch.rootType !== undefined) {
      setRootType(patch.rootType)
      setTypeId('')
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
          <MiniRail title="继续观看" icon={<Clock3 className="h-5 w-5 text-red-500" />} items={history.map((item) => item.video)} />
          <MiniRail title="我的收藏" icon={<Heart className="h-5 w-5 text-red-500" fill="currentColor" />} items={favorites} />
          <FeaturedCarousel
            sections={FEATURED_SECTIONS}
            activeIndex={featuredIndex}
            featured={featured}
            loading={featuredLoading}
            onChange={setFeaturedIndex}
            onMore={(section) => setFilter({ rootType: ROOT_TABS.find((tab) => tab.children.includes(section.typeId))?.id || '', typeId: section.typeId })}
          />
        </div>
      )}

      <section className="rounded-[1.75rem] border border-black/5 dark:border-white/10 bg-white/65 dark:bg-gray-950/35 p-4 shadow-sm">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Filter className="h-5 w-5 text-red-500" />
            <h2 className="text-xl font-black text-[var(--text-primary)]">分区筛选</h2>
          </div>
          <div className="text-sm text-[var(--text-muted)]">{pageSummary}</div>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {ROOT_TABS.map((tab) => (
              <button
                key={tab.id || 'all'}
                onClick={() => setFilter({ rootType: tab.id })}
                className={cn('rounded-full px-4 py-2 text-sm font-semibold transition-all', rootType === tab.id ? 'bg-red-500 text-white shadow-md shadow-red-500/25' : 'bg-black/5 dark:bg-white/10 text-[var(--text-secondary)] hover:bg-black/10 dark:hover:bg-white/15')}
              >
                {tab.name}
              </button>
            ))}
          </div>

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
            {(result?.list || []).map((item, index) => <VideoCard key={item.id} item={item} priority={index < 8} />)}
          </div>

          {result && result.list.length === 0 && !loading && (
            <div className="grid h-56 place-items-center rounded-3xl border border-dashed border-black/10 dark:border-white/10 text-[var(--text-muted)]">
              没有找到相关影片
            </div>
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
