import httpClient from './httpClient'
import { getDefaultVideoSourceId, getVideoSource, VIDEO_SOURCES } from './videoSources'
import type {
  VideoApiRawDetailResponse,
  VideoApiRawItem,
  VideoApiRawListResponse,
  VideoCategory,
  VideoDetail,
  VideoEpisode,
  VideoListItem,
  VideoListResult,
  VideoSource,
  VideoSourceHealth,
} from '@/types/video'

const DEFAULT_LIMIT = 20
const CACHE_TTL = 5 * 60 * 1000
const REQUEST_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Referer: 'http://api.ffzyapi.com/',
}

const responseCache = new Map<string, { expiresAt: number; value: unknown }>()
const inflightRequests = new Map<string, Promise<unknown>>()
const sourceHealthCache = new Map<string, VideoSourceHealth>()

const getCached = async <T,>(key: string, loader: () => Promise<T>, ttl = CACHE_TTL): Promise<T> => {
  const now = Date.now()
  const cached = responseCache.get(key)
  if (cached && cached.expiresAt > now) return cached.value as T

  const pending = inflightRequests.get(key)
  if (pending) return pending as Promise<T>

  const request = loader()
    .then((value) => {
      responseCache.set(key, { value, expiresAt: Date.now() + ttl })
      return value
    })
    .finally(() => {
      inflightRequests.delete(key)
    })

  inflightRequests.set(key, request)
  return request
}

const stableParamsKey = (params: Record<string, unknown>) => JSON.stringify(
  Object.keys(params)
    .sort()
    .reduce<Record<string, unknown>>((next, key) => {
      const value = params[key]
      if (value !== undefined && value !== '') next[key] = value
      return next
    }, {}),
)

const toStringValue = (value: unknown) => value == null ? '' : String(value).trim()

const toNumberValue = (value: unknown) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

const splitSourceNames = (value?: string) => toStringValue(value)
  .split('$$$')
  .flatMap((group) => group.split(','))
  .map((item) => item.trim())
  .filter(Boolean)

const parseEpisodeGroups = (playFrom?: string, playUrl?: string) => {
  const sourceNames = toStringValue(playFrom).split('$$$').map((item) => item.trim()).filter(Boolean)
  const urlGroups = toStringValue(playUrl).split('$$$')

  return urlGroups.map((group, sourceIndex) => {
    const source = sourceNames[sourceIndex] || `播放源 ${sourceIndex + 1}`
    const episodes = group
      .split('#')
      .map((entry): VideoEpisode | null => {
        const separatorIndex = entry.indexOf('$')
        if (separatorIndex < 0 && /^https?:\/\//i.test(entry.trim())) {
          return { title: '播放', url: entry.trim(), source, sourceIndex }
        }
        if (separatorIndex <= 0) return null
        const title = entry.slice(0, separatorIndex).trim()
        const url = entry.slice(separatorIndex + 1).trim()
        if (!title || !url) return null
        return { title, url, source, sourceIndex }
      })
      .filter((episode): episode is VideoEpisode => Boolean(episode))

    return { name: source, episodes }
  }).filter((source) => source.episodes.length > 0)
}

const getSourcePriority = (name: string) => {
  const normalized = name.trim().toLowerCase()
  if (!normalized) return 50
  if (normalized.includes('ffm3u8')) return 0
  if (normalized.includes('m3u8')) return 1
  if (normalized.includes('高清') || normalized.includes('超清')) return 2
  if (normalized.includes('feifan')) return 20
  return 10
}

const prioritizePlaySources = (sources: Array<{ name: string; episodes: VideoEpisode[] }>) => [...sources]
  .sort((a, b) => {
    const scoreDiff = getSourcePriority(a.name) - getSourcePriority(b.name)
    if (scoreDiff !== 0) return scoreDiff
    return b.episodes.length - a.episodes.length
  })

const normalizeListItem = (item: VideoApiRawItem, source = getVideoSource()): VideoListItem => ({
  id: `${source.id}:${toStringValue(item.vod_id)}`,
  rawId: toStringValue(item.vod_id),
  name: toStringValue(item.vod_name) || '未命名影片',
  typeId: toStringValue(item.type_id),
  typeName: toStringValue(item.type_name) || '未分类',
  slug: toStringValue(item.vod_en),
  updatedAt: toStringValue(item.vod_time),
  remarks: toStringValue(item.vod_remarks),
  playFrom: splitSourceNames(item.vod_play_from),
  score: toStringValue(item.vod_score) || undefined,
  hits: toNumberValue(item.vod_hits),
  cover: toStringValue(item.vod_pic) || undefined,
  year: toStringValue(item.vod_year) || undefined,
  area: toStringValue(item.vod_area) || undefined,
  actors: toStringValue(item.vod_actor) || undefined,
  sourceId: source.id,
  sourceName: source.name,
})

const normalizeCategories = (categories?: VideoCategory[]) => {
  if (!Array.isArray(categories)) return []
  return categories
    .filter((item): item is VideoCategory => Boolean(item?.type_id != null && item?.type_name))
    .map((item) => ({
      type_id: item.type_id,
      type_name: String(item.type_name).trim(),
    }))
}

const normalizeDetail = (item: VideoApiRawItem, source = getVideoSource()): VideoDetail => {
  const sources = prioritizePlaySources(parseEpisodeGroups(item.vod_play_from, item.vod_play_url))
  const base = normalizeListItem(item, source)

  return {
    ...base,
    director: toStringValue(item.vod_director) || undefined,
    category: toStringValue(item.vod_class) || undefined,
    language: toStringValue(item.vod_lang) || undefined,
    content: toStringValue(item.vod_content || item.vod_blurb).replace(/&nbsp;/g, ' ') || undefined,
    score: toStringValue(item.vod_score) || undefined,
    duration: toStringValue(item.vod_duration) || undefined,
    pubdate: toStringValue(item.vod_pubdate) || undefined,
    sources,
    episodes: sources.flatMap((source) => source.episodes),
  }
}

const appendParams = (url: URL, params: Record<string, string | number | undefined>) => {
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
  })
}

const buildUrl = (baseUrl: string, params: Record<string, string | number | undefined>) => {
  const url = new URL(baseUrl)
  appendParams(url, params)
  return url.toString()
}

const buildCategoryUrl = (sourceId?: string) => {
  const source = getVideoSource(sourceId)
  const url = new URL(source.url)
  appendParams(url, Object.fromEntries(new URLSearchParams(source.categoryAc || 'ac=list')))
  return url.toString()
}

const getResponseList = (response: VideoApiRawListResponse) => Array.isArray(response.list)
  ? response.list
  : Array.isArray(response.data?.list)
    ? response.data.list
    : []

const getResponseCategories = (response: VideoApiRawListResponse) => Array.isArray(response.class)
  ? response.class
  : Array.isArray(response.data?.class)
    ? response.data.class
    : []

const getResponseMeta = (response: VideoApiRawListResponse) => ({
  page: response.page ?? response.data?.page,
  pagecount: response.pagecount ?? response.data?.pagecount,
  limit: response.limit ?? response.data?.limit,
  total: response.total ?? response.data?.total,
})

const isUsableResponse = (response: VideoApiRawListResponse) => getResponseList(response).length > 0 || getResponseCategories(response).length > 0

const markSourceHealth = (sourceId: string, health: Omit<VideoSourceHealth, 'sourceId' | 'checkedAt'>) => {
  sourceHealthCache.set(sourceId, { sourceId, checkedAt: Date.now(), ...health })
}

const getHealthyFallbackSourceIds = (currentId: string) => [
  ...VIDEO_SOURCES.filter((source) => source.id !== currentId && sourceHealthCache.get(source.id)?.ok).map((source) => source.id),
  ...VIDEO_SOURCES.filter((source) => source.id !== currentId && source.id === getDefaultVideoSourceId()).map((source) => source.id),
  ...VIDEO_SOURCES.filter((source) => source.id !== currentId && source.group === '推荐').map((source) => source.id),
].filter((sourceId, index, list) => list.indexOf(sourceId) === index)

const parseJsonText = <T,>(text: string, label: string): T => {
  const normalized = text.replace(/^\uFEFF/, '').trim()
  if (!normalized) {
    throw new Error(`${label}返回为空`)
  }

  try {
    return JSON.parse(normalized) as T
  } catch (error) {
    const preview = normalized.slice(0, 180).replace(/\s+/g, ' ')
    throw new Error(`${label}不是有效JSON：${preview}`)
  }
}

const sortList = (list: VideoListItem[], sort?: string) => {
  const next = [...list]
  if (sort === 'score') {
    return next.sort((a, b) => toNumberValue(b.score) - toNumberValue(a.score))
  }
  if (sort === 'hits') {
    return next.sort((a, b) => (b.hits || 0) - (a.hits || 0))
  }
  return next.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
}

const normalizeFilterText = (value: string) => value.trim().toLowerCase()

const filterList = (list: VideoListItem[], params: {
  typeId?: string
  keyword?: string
  area?: string
  year?: string
}) => {
  const keyword = normalizeFilterText(params.keyword || '')
  const area = normalizeFilterText(params.area || '')
  const year = normalizeFilterText(params.year || '')
  const typeId = toStringValue(params.typeId)

  return list.filter((item) => {
    if (typeId && item.typeId !== typeId) return false
    if (keyword) {
      const haystack = [item.name, item.typeName, item.remarks, item.actors, item.year, item.area, item.slug]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      if (!haystack.includes(keyword)) return false
    }
    if (area && !normalizeFilterText(item.area || '').includes(area)) return false
    if (year && !normalizeFilterText(item.year || '').includes(year)) return false
    return true
  })
}

const getCategoryList = async (sourceId?: string) => {
  const source = getVideoSource(sourceId)
  return getCached(`video:categories:${source.id}`, async () => {
    const text = await httpClient.getText(buildCategoryUrl(source.id), REQUEST_HEADERS)
    const response = parseJsonText<VideoApiRawListResponse>(text, `${source.name}分类接口`)
    const categories = normalizeCategories(getResponseCategories(response))
    markSourceHealth(source.id, { ok: categories.length > 0, total: categories.length, message: categories.length > 0 ? '分类可用' : '分类为空' })
    return categories
  }, 30 * 60 * 1000)
}

const acValue = (value?: string, fallback = 'detail') => new URLSearchParams(value || `ac=${fallback}`).get('ac') || fallback

const buildSourceCandidates = (sourceId?: string) => {
  const primary = getVideoSource(sourceId)
  const fallbacks = getHealthyFallbackSourceIds(primary.id)
  return [primary.id, ...fallbacks]
    .filter((id, index, list) => list.indexOf(id) === index)
    .map((id) => getVideoSource(id))
}

const fetchSourceList = async (source: VideoSource, params: {
  page?: number
  typeId?: string
  keyword?: string
  area?: string
  year?: string
  sort?: string
  limit?: number
  timeoutMs?: number
}): Promise<VideoListResult> => {
  const fetchList = async (typeId?: string) => {
    const pageParam = source.pageParam || 'pg'
    const url = buildUrl(source.url, {
      ac: acValue(source.listAc, 'detail'),
      [pageParam]: params.page || 1,
      t: typeId,
      wd: params.keyword,
      area: params.area,
      year: params.year,
      by: params.sort,
    })
    const text = await getCached(`video:text:${url}`, () => httpClient.getText(url, REQUEST_HEADERS, params.timeoutMs))
    return parseJsonText<VideoApiRawListResponse>(text, `${source.name}列表接口`)
  }

  const response = await fetchList(params.typeId)
  const list = getResponseList(response).map((raw) => normalizeListItem(raw, source))
  const filteredList = filterList(list, params)
  const categories = getResponseCategories(response).length ? normalizeCategories(getResponseCategories(response)) : await getCategoryList(source.id).catch(() => [])
  const meta = getResponseMeta(response)
  const limit = Number(meta.limit || params.limit || DEFAULT_LIMIT)
  const pageCount = Number(meta.pagecount || 1)
  const result = {
    page: Number(meta.page || params.page || 1),
    pageCount: Number.isFinite(pageCount) && pageCount > 0 ? pageCount : 1,
    limit: Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_LIMIT,
    total: Number(meta.total || 0),
    list: sortList(filteredList, params.sort),
    categories,
    sourceId: source.id,
    sourceName: source.name,
  }
  markSourceHealth(source.id, { ok: isUsableResponse(response), total: result.total, message: result.list.length > 0 ? '列表可用' : '列表为空' })
  return result
}

export const videoApi = {
  async getList(params: {
    page?: number
    typeId?: string
    keyword?: string
    area?: string
    year?: string
    sort?: string
    limit?: number
    sourceId?: string
  } = {}): Promise<VideoListResult> {
    const primarySource = getVideoSource(params.sourceId)
    const cacheKey = `video:list:${primarySource.id}:${stableParamsKey(params)}`

    return getCached(cacheKey, async () => {
      let lastError: unknown = null

      for (const source of buildSourceCandidates(primarySource.id)) {
        try {
          const data = await fetchSourceList(source, params)
          if (data.list.length > 0 || data.categories.length > 0 || source.id === primarySource.id) {
            return source.id === primarySource.id ? data : { ...data, fallbackFrom: primarySource.name }
          }
        } catch (error) {
          lastError = error
          markSourceHealth(source.id, { ok: false, message: error instanceof Error ? error.message : '资源请求失败' })
        }
      }

      throw lastError instanceof Error ? lastError : new Error(`${primarySource.name}资源不可用`)
    })
  },

  // 聚合搜索：健康源优先、限并发、短超时，凑够目标数量即停止，按片名+年份去重合并。
  // 不再依赖「当前源」，任何源命中都会被纳入结果。
  async searchAll(params: {
    keyword: string
    page?: number
    sort?: string
    area?: string
    year?: string
    limit?: number
  }): Promise<VideoListResult> {
    const keyword = (params.keyword || '').trim()
    if (!keyword) {
      return {
        page: 1, pageCount: 0, limit: DEFAULT_LIMIT, total: 0, list: [], categories: [],
        sourceId: 'aggregate', sourceName: '聚合搜索',
      }
    }

    const SEARCH_TIMEOUT_MS = 6000
    const SEARCH_CONCURRENCY = 6
    const SEARCH_MIN_RESULTS = 20

    const page = params.page || 1
    const limit = params.limit || DEFAULT_LIMIT
    const sort = params.sort || 'time'
    const area = params.area
    const year = params.year

    // 候选源排序：已确认健康的源优先，其次「推荐」组，其余殿后。
    const ranked = [...VIDEO_SOURCES].sort((a, b) => {
      const aHealthy = sourceHealthCache.get(a.id)?.ok ? 0 : 1
      const bHealthy = sourceHealthCache.get(b.id)?.ok ? 0 : 1
      if (aHealthy !== bHealthy) return aHealthy - bHealthy
      const aRec = a.group === '推荐' ? 0 : 1
      const bRec = b.group === '推荐' ? 0 : 1
      if (aRec !== bRec) return aRec - bRec
      return 0
    })

    const seen = new Map<string, VideoListItem>()
    let reachedMin = false
    let cursor = 0

    const mergeItem = (item: VideoListItem) => {
      const key = `${item.name.replace(/\s+/g, '').toLowerCase()}__${item.year || ''}`
      if (!seen.has(key)) seen.set(key, item)
    }

    // 有界并发池：每个源带短超时，凑够目标数量即停止派发新的源请求。
    const workers = Array.from({ length: Math.min(SEARCH_CONCURRENCY, ranked.length) }, async () => {
      while (cursor < ranked.length && !reachedMin) {
        const source = ranked[cursor]
        cursor += 1
        try {
          const data = await fetchSourceList(source, { page, keyword, sort, area, year, limit, timeoutMs: SEARCH_TIMEOUT_MS })
          for (const item of data.list) mergeItem(item)
          if (seen.size >= SEARCH_MIN_RESULTS) reachedMin = true
        } catch {
          // 单源失败忽略，继续其它源
        }
      }
    })
    await Promise.all(workers)

    const merged = [...seen.values()]
    const total = merged.length

    return {
      page,
      pageCount: Math.max(1, Math.ceil(total / limit)),
      limit,
      total,
      list: sortList(merged, sort),
      categories: [],
      sourceId: 'aggregate',
      sourceName: '聚合搜索',
    }
  },

  async getDetail(id: string, sourceId?: string): Promise<VideoDetail | null> {
    const source = getVideoSource(sourceId || (id.includes(':') ? id.split(':')[0] : undefined))
    const rawId = id.includes(':') ? id.split(':').slice(1).join(':') : id

    return getCached(`video:detail:${source.id}:${rawId}`, async () => {
      let lastError: unknown = null

      for (const candidate of buildSourceCandidates(source.id)) {
        try {
          const text = await httpClient.getText(buildUrl(candidate.url, {
            ac: acValue(candidate.detailAc, 'detail'),
            ids: rawId,
          }), REQUEST_HEADERS)
          const response = parseJsonText<VideoApiRawDetailResponse>(text, `${candidate.name}详情接口`)
          const first = getResponseList(response)[0] || null
          if (first) {
            markSourceHealth(candidate.id, { ok: true, total: 1, message: '详情可用' })
            return normalizeDetail(first, candidate)
          }
        } catch (error) {
          lastError = error
          markSourceHealth(candidate.id, { ok: false, message: error instanceof Error ? error.message : '详情请求失败' })
        }
      }

      if (lastError instanceof Error) throw lastError
      return null
    })
  },
}

export default videoApi
