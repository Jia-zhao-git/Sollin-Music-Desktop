import { useCallback, useEffect, useMemo, useState, startTransition } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { BookOpen, ChevronLeft, ChevronRight, Clock3, Heart, LibraryBig, Loader2, Plus, Search, SearchX, Sparkles, X } from 'lucide-react'
import StatusState from '@/components/StatusState'
import novelApi from '@/services/novelApi'
import { getDefaultNovelSourceId, getGroupedNovelSources, NOVEL_SOURCE_STORAGE_KEY } from '@/services/novelSources'
import { useNovelStore } from '@/stores/novelStore'
import type { LocalBook, NovelDownloadedBook, NovelListItem, NovelListResult, NovelSourceId } from '@/types/novel'
import { cn } from '@/utils/cn'

const FALLBACK_COVER = 'data:image/svg+xml;utf8,%3Csvg xmlns="http://www.w3.org/2000/svg" width="360" height="480" viewBox="0 0 360 480"%3E%3Cdefs%3E%3ClinearGradient id="g" x1="0" x2="1" y1="0" y2="1"%3E%3Cstop stop-color="%23171310"/%3E%3Cstop offset=".55" stop-color="%23422b17"/%3E%3Cstop offset="1" stop-color="%23080705"/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width="360" height="480" rx="28" fill="url(%23g)"/%3E%3Cpath d="M94 94h132a40 40 0 0 1 40 40v252H112a34 34 0 0 1-34-34V110a16 16 0 0 1 16-16z" fill="%23fff" opacity=".12"/%3E%3Cpath d="M116 144h108M116 182h92M116 220h118" stroke="%23fff" stroke-width="12" stroke-linecap="round" opacity=".35"/%3E%3Ctext x="180" y="352" fill="%23ffffff" opacity=".58" font-family="serif" font-size="28" text-anchor="middle"%3ENovel%3C/text%3E%3C/svg%3E'

const routePart = (value: string) => encodeURIComponent(value)

function NovelCard({ item, compact = false, priority = false }: { item: NovelListItem; compact?: boolean; priority?: boolean }) {
  const navigate = useNavigate()

  return (
    <button
      onClick={() => navigate(item.sourceId === 'local' ? `/novel/${routePart(item.id)}/chapter/ch-1` : `/novel/${routePart(item.id)}`)}
      className={cn(
        'group shrink-0 text-left rounded-2xl overflow-hidden bg-white/75 dark:bg-stone-950/55 border border-black/5 dark:border-white/10 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all',
        compact ? 'w-36 sm:w-40' : 'w-full',
      )}
      title={item.name}
    >
      <div className="relative aspect-[3/4] bg-gradient-to-br from-stone-950 via-amber-950 to-black overflow-hidden">
        <img
          src={item.cover || FALLBACK_COVER}
          alt={item.name}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={(event) => { event.currentTarget.src = FALLBACK_COVER }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
        <div className="absolute left-2 right-2 bottom-2 flex items-end justify-between gap-2">
          <span className="min-w-0 rounded-full bg-black/55 px-2 py-1 text-xs text-white backdrop-blur truncate">{item.status || item.category || item.sourceName}</span>
          <span className="grid h-8 w-8 place-items-center rounded-full bg-amber-100 text-stone-950 opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
            <BookOpen className="h-4 w-4" />
          </span>
        </div>
      </div>
      <div className="p-3">
        <h3 className="font-semibold text-[var(--text-primary)] line-clamp-2 min-h-[2.7rem]">{item.name}</h3>
        <p className="mt-1 text-xs text-[var(--text-muted)] truncate">
          {[item.author, item.score ? `${item.score}分` : '', item.sourceName].filter(Boolean).join(' · ') || '未知作者'}
        </p>
      </div>
    </button>
  )
}

function MiniRail({ title, icon, items }: { title: string; icon: ReactNode; items: NovelListItem[] }) {
  if (!items.length) return null

  return (
    <section className="rounded-[1.75rem] border border-black/5 dark:border-white/10 bg-white/55 dark:bg-stone-950/35 p-4 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        {icon}
        <h2 className="text-xl font-black text-[var(--text-primary)]">{title}</h2>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin">
        {items.slice(0, 12).map((item) => <NovelCard key={item.id} item={item} compact />)}
      </div>
    </section>
  )
}

function LocalBookCard({ book, onOpen, onRemove }: { book: LocalBook; onOpen: () => void; onRemove: () => void }) {
  return (
    <div className="group relative shrink-0 w-36 sm:w-40 text-left rounded-2xl overflow-hidden bg-white/75 dark:bg-stone-950/55 border border-black/5 dark:border-white/10 shadow-sm">
      <button onClick={onOpen} className="block w-full text-left">
        <div className="relative aspect-[3/4] bg-gradient-to-br from-stone-800 via-amber-900 to-black overflow-hidden">
          {book.cover ? (
            <img src={book.cover} alt={book.name} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <div className="h-full w-full flex items-center justify-center">
              <BookOpen className="h-10 w-10 text-white/35" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
          <span className="absolute left-2 top-2 rounded-full bg-amber-500/90 px-2 py-0.5 text-[10px] font-semibold text-white">本地</span>
          <div className="absolute left-2 right-2 bottom-2">
            <span className="block truncate rounded-full bg-black/55 px-2 py-1 text-[11px] text-white backdrop-blur">{book.chapters.length} 章</span>
          </div>
        </div>
        <div className="p-3">
          <h3 className="font-semibold text-[var(--text-primary)] line-clamp-2 min-h-[2.7rem]">{book.name}</h3>
          <p className="mt-1 text-xs text-[var(--text-muted)] truncate">{book.author || book.sourceName}</p>
        </div>
      </button>
      <button
        onClick={onRemove}
        title="从本地书架移除"
        className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full bg-black/55 text-white opacity-0 transition-opacity hover:bg-red-500 group-hover:opacity-100"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

function DownloadedBookCard({ book, onOpen, onRemove }: { book: NovelDownloadedBook; onOpen: () => void; onRemove: () => void }) {
  return (
    <div className="group relative shrink-0 w-36 sm:w-40 text-left rounded-2xl overflow-hidden bg-white/75 dark:bg-stone-950/55 border border-black/5 dark:border-white/10 shadow-sm">
      <button onClick={onOpen} className="block w-full text-left">
        <div className="relative aspect-[3/4] bg-gradient-to-br from-stone-800 via-amber-900 to-black overflow-hidden">
          <div className="h-full w-full flex items-center justify-center">
            <BookOpen className="h-10 w-10 text-white/35" />
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
          <span className="absolute left-2 top-2 rounded-full bg-blue-500/90 px-2 py-0.5 text-[10px] font-semibold text-white">离线</span>
          <div className="absolute left-2 right-2 bottom-2">
            <span className="block truncate rounded-full bg-black/55 px-2 py-1 text-[11px] text-white backdrop-blur">全本已下载</span>
          </div>
        </div>
        <div className="p-3">
          <h3 className="font-semibold text-[var(--text-primary)] line-clamp-2 min-h-[2.7rem]">{book.title}</h3>
          <p className="mt-1 text-xs text-[var(--text-muted)] truncate">{book.sourceName}</p>
        </div>
      </button>
      <button
        onClick={onRemove}
        title="从离线书架移除"
        className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full bg-black/55 text-white opacity-0 transition-opacity hover:bg-red-500 group-hover:opacity-100"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

function SourceSwitcher({ sourceId, onChange }: { sourceId: NovelSourceId; onChange: (sourceId: NovelSourceId) => void }) {
  const groups = useMemo(() => getGroupedNovelSources(), [])
  const active = Object.values(groups).flat().find((source) => source.id === sourceId)

  return (
    <details className="group mt-4 max-w-5xl rounded-2xl border border-white/10 bg-white/10 p-3 backdrop-blur">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm text-white/75">
        <span>当前书源：<b className="text-white">{active?.name || '默认书源'}</b></span>
        <span className="rounded-full bg-white/10 px-3 py-1 group-open:bg-white group-open:text-stone-950">切换书源</span>
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
                    sourceId === source.id ? 'bg-white text-stone-950' : 'bg-white/10 text-white/75 hover:bg-white/18',
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

export default function NovelHome() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const initialKeyword = searchParams.get('wd') || ''
  const initialSourceId = (searchParams.get('source') || (typeof window !== 'undefined' ? window.localStorage.getItem(NOVEL_SOURCE_STORAGE_KEY) : '') || getDefaultNovelSourceId()) as NovelSourceId
  const initialPage = Number(searchParams.get('page') || '1') || 1
  const initialCategoryId = searchParams.get('category') || ''

  const decodeFilterValue = (value: string) => value.replace(/^[^:|]+:(?=kind:|words:|over:|sort:)/, '')
  const filterKey = (value: string) => value.startsWith('kind:') ? '类型'
    : value.startsWith('words:') ? '字数'
      : value.startsWith('over:') ? '完结'
        : value.startsWith('sort:') ? '排序'
          : '类型'

  const [keywordInput, setKeywordInput] = useState(initialKeyword)
  const [keyword, setKeyword] = useState(initialKeyword)
  const [sourceId, setSourceId] = useState<NovelSourceId>(initialSourceId)
  const [aggregateSearch, setAggregateSearch] = useState(true)
  const [categoryId, setCategoryId] = useState(initialCategoryId)
  const [filters, setFilters] = useState<Record<string, string>>(() => {
    if (!initialCategoryId) return {}
    return Object.fromEntries(initialCategoryId.split('|').map((part) => {
      const value = decodeFilterValue(part)
      return [filterKey(value), value]
    }))
  })
  const [page, setPage] = useState(initialPage)
  const [result, setResult] = useState<NovelListResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const history = useNovelStore((state) => state.history)
  const favorites = useNovelStore((state) => state.favorites)
  const localBooks = useNovelStore((state) => state.localBooks)
  const addLocalBooks = useNovelStore((state) => state.addLocalBooks)
  const removeLocalBook = useNovelStore((state) => state.removeLocalBook)
  // 「下载全书」的离线书（与本地导入并列展示在书架中，之前它只存在于详情页下载后的临时跳转里，没有持久入口）。
  const [downloadedBooks, setDownloadedBooks] = useState<NovelDownloadedBook[]>([])
  const removeDownloadedBook = useCallback(async (bookId: string) => {
    try {
      await novelApi.removeDownloadedBook(bookId)
    } catch {
      // 忽略存储错误，仍清理本地列表
    }
    setDownloadedBooks((prev) => prev.filter((book) => book.id !== bookId))
  }, [])

  useEffect(() => {
    novelApi.listDownloadedBooks().then(setDownloadedBooks).catch(() => {})
  }, [])

  const handleImportLocal = async () => {
    try {
      const api = window.electronAPI
      if (!api?.importLocalNovelFiles) return
      const books = await api.importLocalNovelFiles()
      if (books && books.length) {
        addLocalBooks(books)
      }
    } catch (err) {
      console.error('Import local novels failed:', err)
    }
  }

  useEffect(() => {
    const nextParams: Record<string, string> = {}
    if (keyword) nextParams.wd = keyword
    if (sourceId && sourceId !== getDefaultNovelSourceId()) nextParams.source = sourceId
    if (categoryId) nextParams.category = categoryId
    if (page > 1) nextParams.page = String(page)
    setSearchParams(nextParams, { replace: true })
  }, [categoryId, keyword, page, setSearchParams, sourceId])

  useEffect(() => {
    window.localStorage.setItem(NOVEL_SOURCE_STORAGE_KEY, sourceId)
  }, [sourceId])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    const request = keyword && aggregateSearch
      ? novelApi.searchAll({ page, keyword })
      : novelApi.getList({ page, keyword, sourceId, categoryId })

    request
      .then((data) => {
        if (!cancelled) startTransition(() => setResult(data))
      })
      .catch((err) => {
        console.error('Load novel list failed:', err)
        if (!cancelled) setError(err instanceof Error ? err.message : '加载小说列表失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [aggregateSearch, categoryId, keyword, page, sourceId])

  const submitSearch = (event: FormEvent) => {
    event.preventDefault()
    setKeyword(keywordInput.trim())
    setPage(1)
  }

  const switchSource = (nextSourceId: NovelSourceId) => {
    setSourceId(nextSourceId)
    setCategoryId('')
    setFilters({})
    setResult(null)
    setPage(1)
  }

  const switchCategory = (group: string, nextCategoryId: string) => {
    const nextFilters = { ...filters, [group]: nextCategoryId }
    setFilters(nextFilters)
    setCategoryId(Object.values(nextFilters).filter(Boolean).join('|'))
    setPage(1)
  }

  const groupedCategories = useMemo(() => {
    const categories = result?.categories || []
    return categories.reduce<Record<string, typeof categories>>((groups, category) => {
      const group = category.group || '类型'
      groups[group] = groups[group] || []
      groups[group].push(category)
      return groups
    }, {})
  }, [result?.categories])

  const activeCategory = (group: string, categoryIdValue: string) => {
    if (filters[group]) return filters[group] === categoryIdValue
    return categoryIdValue === (result?.categories.find((item) => (item.group || '类型') === group)?.id || '')
  }

  const pageSummary = result ? `第 ${result.page} 页 · ${result.sourceName} · 本页 ${result.list.length} 本${result.total ? ` · 共约 ${result.total} 本` : ''}` : '正在连接小说源...'

  return (
    <div className="pb-10">
      <section className="relative overflow-hidden rounded-[1.5rem] border border-white/15 bg-stone-950 px-4 py-6 text-white shadow-2xl mb-6 sm:rounded-[2rem] sm:px-6 sm:py-8 sm:mb-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_5%,rgba(245,158,11,.34),transparent_32%),radial-gradient(circle_at_90%_10%,rgba(120,53,15,.38),transparent_30%),linear-gradient(135deg,rgba(28,25,23,.98),rgba(12,10,9,.99))]" />
        <div className="relative z-10 max-w-3xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-sm backdrop-blur">
            <Sparkles className="h-4 w-4 text-amber-300" />
            在线小说 · 七猫 / 菠萝猫
          </div>
          <h1 className="text-3xl md:text-5xl font-black tracking-tight">翻开一座随身书库</h1>
          <p className="mt-3 text-sm leading-6 text-white/70 max-w-2xl sm:text-base">独立小说模块，支持书源切换、搜索、详情目录和章节阅读。默认优先使用七猫官方 API。</p>
          <form onSubmit={submitSearch} className="mt-6 flex max-w-xl items-center gap-2 rounded-2xl bg-white/12 p-2 backdrop-blur-xl border border-white/10">
            <Search className="ml-2 h-5 w-5 text-white/55" />
            <input
              value={keywordInput}
              onChange={(event) => setKeywordInput(event.target.value)}
              placeholder="搜索书名、作者..."
              className="min-w-0 flex-1 bg-transparent px-2 py-2 text-white placeholder:text-white/45 outline-none"
            />
            <button className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-stone-950 hover:bg-amber-100 transition-colors">搜索</button>
          </form>
          <label className="mt-3 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-sm text-white/75">
            <input type="checkbox" checked={aggregateSearch} onChange={(event) => setAggregateSearch(event.target.checked)} />
            搜索全部书源
          </label>
        </div>
        <div className={cn('relative z-10', keyword && aggregateSearch && 'opacity-60')}>
          <SourceSwitcher sourceId={sourceId} onChange={switchSource} />
        </div>
      </section>

      {!keyword && (
        <div className="mb-9 space-y-6">
          <MiniRail title="继续阅读" icon={<Clock3 className="h-5 w-5 text-amber-500" />} items={history.map((item) => item.novel)} />
          <MiniRail title="我的书架" icon={<Heart className="h-5 w-5 text-amber-500" fill="currentColor" />} items={favorites} />

          <section className="rounded-[1.5rem] border border-black/5 dark:border-white/10 bg-white/55 dark:bg-stone-950/35 p-3 shadow-sm sm:rounded-[1.75rem] sm:p-4">
            <div className="mb-4 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <LibraryBig className="h-5 w-5 text-amber-500" />
                <h2 className="text-xl font-black text-[var(--text-primary)]">本地书架</h2>
                <span className="text-sm text-[var(--text-muted)]">导入的 TXT 与离线下载</span>
              </div>
              <button
                onClick={handleImportLocal}
                className="inline-flex items-center gap-1.5 rounded-full bg-amber-500 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-amber-600"
              >
                <Plus className="h-4 w-4" /> 导入 TXT
              </button>
            </div>
            {localBooks.length === 0 && downloadedBooks.length === 0 ? (
              <button
                onClick={handleImportLocal}
                className="flex w-full flex-col items-center gap-2 rounded-2xl border border-dashed border-black/10 dark:border-white/10 py-10 text-[var(--text-muted)] transition-colors hover:border-amber-400 hover:text-amber-500"
              >
                <Plus className="h-7 w-7" />
                <span className="text-sm">导入本地 TXT 小说，或到详情页「下载全书」离线阅读</span>
              </button>
            ) : (
              <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin">
                {localBooks.map((book) => (
                  <LocalBookCard
                    key={book.id}
                    book={book}
                    onOpen={() => navigate(`/novel/${routePart(book.id)}/chapter/${routePart(book.chapters[0]?.id || 'ch-1')}`)}
                    onRemove={() => {
                      if (window.confirm(`从本地书架移除「${book.name}」？\n（仅移除书架记录，不会删除原文件）`)) removeLocalBook(book.id)
                    }}
                  />
                ))}
                {downloadedBooks.map((book) => (
                  <DownloadedBookCard
                    key={book.id}
                    book={book}
                    onOpen={() => navigate(`/novel/${routePart(book.id)}/chapter/__downloaded__`)}
                    onRemove={() => {
                      if (window.confirm(`从离线书架移除「${book.title}」？\n（仅移除记录，需要时可在详情页重新下载）`)) removeDownloadedBook(book.id)
                    }}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      <section className="rounded-[1.5rem] border border-black/5 dark:border-white/10 bg-white/65 dark:bg-stone-950/35 p-3 shadow-sm sm:rounded-[1.75rem] sm:p-4">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <LibraryBig className="h-5 w-5 text-amber-500" />
            <h2 className="text-xl font-black text-[var(--text-primary)]">{keyword ? '搜索结果' : '推荐书库'}</h2>
          </div>
          <div className="text-sm text-[var(--text-muted)]">{pageSummary}</div>
        </div>

        {error && <div className="mb-6 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-red-600 dark:text-red-300">{error}</div>}

        {!!result?.categories.length && !keyword && (
          <div className="mb-5 space-y-3 rounded-2xl border border-black/5 bg-white/55 p-3 dark:border-white/10 dark:bg-stone-950/30">
            {Object.entries(groupedCategories).map(([group, categories]) => (
              <div key={group} className="grid gap-2 md:grid-cols-[72px,1fr] md:items-start">
                <div className="pt-1 text-sm font-bold text-[var(--text-muted)]">{group}</div>
                <div className="flex flex-wrap gap-2">
                  {categories.map((category) => (
                    <button
                      key={`${category.sourceId}:${category.id}`}
                      type="button"
                      onClick={() => switchCategory(group, category.id)}
                      className={cn(
                        'rounded-full border px-3 py-1.5 text-sm font-semibold transition-all',
                        activeCategory(group, category.id)
                          ? 'border-amber-500 bg-amber-500 text-white shadow-sm shadow-amber-500/25'
                          : 'border-black/5 dark:border-white/10 bg-white/70 dark:bg-stone-950/55 text-[var(--text-secondary)] hover:bg-white dark:hover:bg-stone-900',
                      )}
                    >
                      {category.name}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {loading && !result ? (
          <div className="grid h-[40vh] place-items-center"><Loader2 className="h-8 w-8 animate-spin text-amber-500" /></div>
        ) : (
          <>
            <div className={cn('grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 sm:gap-4', loading && 'opacity-60 pointer-events-none')}>
              {(result?.list || []).map((item, index) => <NovelCard key={item.id} item={item} priority={index < 8} />)}
            </div>

            {result && result.list.length === 0 && !loading && (
              <StatusState variant="empty" icon={SearchX} title="没有找到相关小说" description="换个关键词或筛选条件再试试" />
            )}

            {result && result.pageCount > 1 && (
              <div className="mt-8 flex items-center justify-center gap-3">
                <button disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))} className="rounded-full border border-black/10 dark:border-white/10 px-5 py-2 disabled:opacity-40 hover:bg-white/70 dark:hover:bg-stone-800">
                  <ChevronLeft className="inline h-4 w-4" /> 上一页
                </button>
                <span className="text-sm text-[var(--text-muted)]">第 {page} 页</span>
                <button disabled={loading || (result?.list.length || 0) === 0} onClick={() => setPage((current) => current + 1)} className="rounded-full border border-black/10 dark:border-white/10 px-5 py-2 disabled:opacity-40 hover:bg-white/70 dark:hover:bg-stone-800">
                  下一页 <ChevronRight className="inline h-4 w-4" />
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}
