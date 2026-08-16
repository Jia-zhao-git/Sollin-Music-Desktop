import CryptoJS from 'crypto-js'
import httpClient from './httpClient'
import { getNovelSource, NOVEL_SOURCES } from './novelSources'
import type { NovelChapter, NovelDetail, NovelDownloadedBook, NovelListItem, NovelListResult, NovelReaderResult, NovelSourceId } from '@/types/novel'

const CACHE_TTL = 5 * 60 * 1000
const RESPONSE_CACHE = new Map<string, { expiresAt: number; value: unknown }>()
const INFLIGHT = new Map<string, Promise<unknown>>()

const getCached = async <T,>(key: string, loader: () => Promise<T>, ttl = CACHE_TTL): Promise<T> => {
  const now = Date.now()
  const cached = RESPONSE_CACHE.get(key)
  if (cached && cached.expiresAt > now) return cached.value as T
  const pending = INFLIGHT.get(key)
  if (pending) return pending as Promise<T>
  const request = loader()
    .then((value) => {
      RESPONSE_CACHE.set(key, { value, expiresAt: Date.now() + ttl })
      return value
    })
    .finally(() => INFLIGHT.delete(key))
  INFLIGHT.set(key, request)
  return request
}

const stableKey = (params: Record<string, unknown>) => JSON.stringify(
  Object.keys(params).sort().reduce<Record<string, unknown>>((next, key) => {
    const value = params[key]
    if (value !== undefined && value !== '') next[key] = value
    return next
  }, {}),
)

const toStr = (value: unknown) => value == null ? '' : String(value).trim()

const parseJson = <T,>(text: string, label: string): T => {
  const normalized = text.replace(/^\uFEFF/, '').trim()
  if (!normalized) throw new Error(`${label}返回为空`)
  return JSON.parse(normalized) as T
}

const qimaoSignKey = 'd3dGiJc651gSQ8w1'
const qimaoContentKey = '242ccb8230d709e1'

const md5 = (value: string) => CryptoJS.MD5(value).toString(CryptoJS.enc.Hex)

const signObject = (params: Record<string, string | number>) => md5(
  Object.keys(params).sort().reduce((text, key) => `${text}${key}=${params[key]}`, '') + qimaoSignKey,
)

const withSign = <T extends Record<string, string | number>>(params: T) => ({ ...params, sign: signObject(params) })

const qs = (params: Record<string, string | number>) => Object.entries(params)
  .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
  .join('&')

const qimaoHeaders = (appId = 'com.kmxs.reader', channel = 'qm-xiaomi_If') => {
  const headers: Record<string, string | number> = {
    'app-version': '80400',
    platform: 'android',
    reg: '0',
    AUTHORIZATION: '',
    'application-id': appId,
    'net-env': '1',
    channel,
    'qm-params': '',
  }
  return {
    ...Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, String(value)])),
    sign: signObject(headers),
    Accept: 'application/json, text/plain, */*',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  }
}

const kuwoHeaders = () => ({
  Accept: 'application/json, text/plain, */*',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
})

const decodeQimaoContent = (content: string) => {
  const encrypted = CryptoJS.enc.Base64.parse(content)
  const words = encrypted.words
  const iv = CryptoJS.lib.WordArray.create(words.slice(0, 4), 16)
  const ciphertext = CryptoJS.lib.WordArray.create(words.slice(4), encrypted.sigBytes - 16)
  const decrypted = CryptoJS.AES.decrypt(
    CryptoJS.lib.CipherParams.create({ ciphertext }),
    CryptoJS.enc.Utf8.parse(qimaoContentKey),
    { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 },
  )
  return decrypted.toString(CryptoJS.enc.Utf8)
}

const splitTags = (value?: string) => toStr(value).split(/[,，]/).map((item) => item.trim()).filter(Boolean)

const dedupeList = <T,>(items: T[], keyOf: (item: T) => string) => Array.from(new Map(items.map((item) => [keyOf(item), item])).values())

const dedupeNovelItems = (items: NovelListItem[]) => {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = `${item.sourceId}:${item.rawId || item.name}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}


const stripBookIdPrefix = (id: string, sourceId: NovelSourceId) => id.startsWith(`${sourceId}:`) ? id.slice(sourceId.length + 1) : id

const qimaoCategories = [
  { id: 'kind:202', name: '全部', sourceId: 'qimao' as const, group: '类型' },
  { id: 'kind:37', name: '东方玄幻', sourceId: 'qimao' as const, group: '类型' },
  { id: 'kind:39', name: '异世大陆', sourceId: 'qimao' as const, group: '类型' },
  { id: 'kind:35', name: '都市高手', sourceId: 'qimao' as const, group: '类型' },
  { id: 'kind:34', name: '历史架空', sourceId: 'qimao' as const, group: '类型' },
  { id: 'kind:40', name: '仙侠修真', sourceId: 'qimao' as const, group: '类型' },
  { id: 'kind:46', name: '科幻末世', sourceId: 'qimao' as const, group: '类型' },
  { id: 'kind:47', name: '游戏竞技', sourceId: 'qimao' as const, group: '类型' },
  { id: 'words:-99', name: '不限字数', sourceId: 'qimao' as const, group: '字数' },
  { id: 'words:1', name: '30万以下', sourceId: 'qimao' as const, group: '字数' },
  { id: 'words:2', name: '30-50万', sourceId: 'qimao' as const, group: '字数' },
  { id: 'words:3', name: '50-100万', sourceId: 'qimao' as const, group: '字数' },
  { id: 'words:4', name: '100万以上', sourceId: 'qimao' as const, group: '字数' },
  { id: 'over:-99', name: '不限状态', sourceId: 'qimao' as const, group: '完结' },
  { id: 'over:0', name: '连载', sourceId: 'qimao' as const, group: '完结' },
  { id: 'over:1', name: '完结', sourceId: 'qimao' as const, group: '完结' },
  { id: 'sort:0', name: '按热度', sourceId: 'qimao' as const, group: '排序' },
  { id: 'sort:1', name: '按更新', sourceId: 'qimao' as const, group: '排序' },
  { id: 'sort:2', name: '按评分', sourceId: 'qimao' as const, group: '排序' },
  { id: 'sort:3', name: '新书', sourceId: 'qimao' as const, group: '排序' },
]

const stoCategories = [
  { id: 'search', name: '搜索', sourceId: 'sto66' as const, group: '类型' },
  { id: '4H6C2Vfu5Xh6mzbnS6oK3W', name: '玄幻', sourceId: 'sto66' as const, group: '类型' },
  { id: 'yanqing', name: '言情', sourceId: 'sto66' as const, group: '类型' },
  { id: 'dushi', name: '都市', sourceId: 'sto66' as const, group: '类型' },
  { id: 'lishi', name: '历史', sourceId: 'sto66' as const, group: '类型' },
  { id: 'kehuan', name: '科幻', sourceId: 'sto66' as const, group: '类型' },
]

const shu52Categories = [
  { id: 'all', name: '全部', sourceId: 'shu52' as const, group: '类型' },
  { id: 'gl', name: '百合/GL', sourceId: 'shu52' as const, group: '类型' },
  { id: 'xianxia', name: '仙侠', sourceId: 'shu52' as const, group: '类型' },
  { id: 'xiandai', name: '现代', sourceId: 'shu52' as const, group: '类型' },
]

const youshuCategories = [
  { id: 'xuanhuan', name: '玄幻', sourceId: 'youshu95590' as const, group: '类型' },
  { id: 'dushi', name: '都市', sourceId: 'youshu95590' as const, group: '类型' },
  { id: 'lishi', name: '历史', sourceId: 'youshu95590' as const, group: '类型' },
  { id: 'wenxue', name: '文学', sourceId: 'youshu95590' as const, group: '类型' },
  { id: 'zhichang', name: '职场', sourceId: 'youshu95590' as const, group: '类型' },
]

const shuhuangCategories = [
  { id: '1', name: '玄幻', sourceId: 'shuhuangw' as const, group: '类型' },
  { id: '2', name: '仙侠', sourceId: 'shuhuangw' as const, group: '类型' },
  { id: '3', name: '都市', sourceId: 'shuhuangw' as const, group: '类型' },
  { id: '13', name: '历史', sourceId: 'shuhuangw' as const, group: '类型' },
  { id: '7', name: '言情', sourceId: 'shuhuangw' as const, group: '类型' },
  { id: '8', name: '科幻', sourceId: 'shuhuangw' as const, group: '类型' },
  { id: '9', name: '悬疑', sourceId: 'shuhuangw' as const, group: '类型' },
]

const jiujiuCategories = [
  { id: 'qj', name: '全本', sourceId: 'jiujiu9191' as const, group: '类型' },
  { id: 'zx', name: '最新', sourceId: 'jiujiu9191' as const, group: '类型' },
  { id: 'dsqc', name: '都市青春', sourceId: 'jiujiu9191' as const, group: '类型' },
  { id: 'xhqh', name: '玄幻奇幻', sourceId: 'jiujiu9191' as const, group: '类型' },
  { id: 'lsjs', name: '穿越架空', sourceId: 'jiujiu9191' as const, group: '类型' },
  { id: 'jsyx', name: '军事竞技', sourceId: 'jiujiu9191' as const, group: '类型' },
  { id: 'khly', name: '科幻灵异', sourceId: 'jiujiu9191' as const, group: '类型' },
  { id: 'wxjp', name: '文学精品', sourceId: 'jiujiu9191' as const, group: '类型' },
]

const jiujiuCategorySearchKeywords: Record<string, string> = {
  dsqc: '都市青春',
  xhqh: '玄幻奇幻',
  lsjs: '穿越架空',
  jsyx: '军事竞技',
  khly: '科幻灵异',
  wxjp: '文学精品',
}

const normalizeQimaoListItem = (item: any, sourceId: NovelSourceId): NovelListItem => ({
  id: `${sourceId}:${toStr(item.id)}`,
  rawId: toStr(item.id),
  sourceId,
  sourceName: getNovelSource(sourceId).name,
  name: toStr(item.title) || '未命名小说',
  author: toStr(item.author) || undefined,
  cover: toStr(item.image_link) || undefined,
  intro: toStr(item.intro) || undefined,
  category: splitTags(item.ptags).join(' · ') || undefined,
  status: toStr(item.is_over) === '1' ? '完结' : '连载',
  latestChapter: toStr(item.latest_chapter_title) || undefined,
  wordCount: toStr(item.words_num) || undefined,
  score: toStr(item.score) || undefined,
  tags: splitTags(item.ptags),
})

const normalizeKuwoListItem = (item: any): NovelListItem => ({
  id: `kuwo:${toStr(item.book_id)}`,
  rawId: toStr(item.book_id),
  sourceId: 'kuwo',
  sourceName: getNovelSource('kuwo').name,
  name: toStr(item.title) || '未命名小说',
  author: toStr(item.author_name) || undefined,
  cover: toStr(item.cover_url) || undefined,
  intro: toStr(item.intro) || undefined,
  category: [toStr(item.category_name), toStr(item.sub_category_name)].filter(Boolean).join(' · ') || undefined,
  status: toStr(item.status) === '50' ? '完结' : '连载',
  latestChapter: toStr(item.new_chapter_name) || undefined,
  wordCount: toStr(item.all_words) || undefined,
  score: undefined,
  tags: splitTags([toStr(item.category_name), toStr(item.sub_category_name)].filter(Boolean).join(',')),
})

const cleanHtml = (html: string) => html
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<style[\s\S]*?<\/style>/gi, '')

const htmlToText = (html: string) => cleanHtml(html)
  .replace(/<br\s*\/?>(\s*)/gi, '\n')
  .replace(/<\/p>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/\n{3,}/g, '\n\n')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .join('\n')

const resolveUrl = (base: string, href?: string) => {
  if (!href) return ''
  try { return new URL(href, base).toString() } catch { return href }
}

const parseQimaoCategories = (filters: any) => {
  if (!Array.isArray(filters)) return qimaoCategories
  const categories = filters.flatMap((group: any) => {
    const filterKey = toStr(group?.filter_key)
    const groupName = toStr(group?.name || group?.title)
    const key = filterKey === 'category_id' ? 'kind'
      : filterKey === 'over' ? 'over'
        : filterKey === 'words' ? 'words'
          : filterKey === 'sort' ? 'sort'
            : groupName.includes('字') ? 'words'
              : groupName.includes('完') || groupName.includes('状态') ? 'over'
                : groupName.includes('排序') || groupName.includes('热度') ? 'sort'
                  : 'kind'
    return (Array.isArray(group?.items) ? group.items : []).map((item: any) => ({
      id: `${key}:${toStr(item.id)}`,
      name: toStr(item.title || item.name),
      sourceId: 'qimao' as const,
      group: key === 'words' ? '字数' : key === 'over' ? '完结' : key === 'sort' ? '排序' : '类型',
    }))
  }).filter((item: any) => item.id && item.name)
  return categories.length ? categories : qimaoCategories
}

const fetchQimaoList = async (params: { page?: number; keyword?: string; categoryId?: string; tag?: string }): Promise<NovelListResult> => {
  const page = params.page || 1
  const categoryId = params.categoryId || params.tag || '202'
  const parts = categoryId.split('|').map((item) => item.replace(/^[^:|]+:(?=kind:|words:|over:)/, ''))
  const kindPart = parts.find((item) => item.startsWith('kind:'))
  const wordsPart = parts.find((item) => item.startsWith('words:'))
  const overPart = parts.find((item) => item.startsWith('over:'))
  const sortPart = parts.find((item) => item.startsWith('sort:'))
  const plainKind = parts.find((item) => /^\d+$/.test(item))
  const qimaoCategoryId = kindPart ? kindPart.slice(5) : plainKind || '202'
  const words = wordsPart ? wordsPart.slice(6) : '-99'
  const over = overPart ? overPart.slice(5) : '-99'
  const sort = sortPart ? sortPart.slice(5) : '0'
  const loadPage = async (sourcePage: number) => {
    const url = params.keyword
      ? `https://api-bc.wtzw.com/search/v1/words?${qs(withSign({ gender: '3', imei_ip: '2937357107', page: sourcePage, wd: params.keyword }))}`
      : `https://api-bc.wtzw.com/api/v4/category/get-list?${qs(withSign({ gender: '3', category_id: qimaoCategoryId, need_filters: '1', page: sourcePage, need_category: '1', words, sort, over }))}`
    const text = await httpClient.getText(url, qimaoHeaders())
    return parseJson<any>(text, '七猫列表接口')
  }
  const firstSourcePage = params.keyword ? page : ((page - 1) * 3) + 1
  const responses = params.keyword ? [await loadPage(page)] : await Promise.all([loadPage(firstSourcePage), loadPage(firstSourcePage + 1), loadPage(firstSourcePage + 2)])
  const response = responses[0]
  const books = responses.flatMap((item) => Array.isArray(item?.data?.books) ? item.data.books : [])
  const list = dedupeNovelItems(books.map((item: any) => normalizeQimaoListItem(item, 'qimao')))
  const totalSourcePages = Number(response?.data?.meta?.total_pages || (response?.data?.meta?.next_page ? page + 1 : page))
  return {
    page,
    pageCount: params.keyword ? totalSourcePages : Math.max(1, Math.ceil(totalSourcePages / 3)),
    total: Number(response?.data?.meta?.total_count || list.length || 0),
    list,
    categories: parseQimaoCategories(response?.data?.filters),
    sourceId: 'qimao',
    sourceName: getNovelSource('qimao').name,
  }
}

const fetchStoList = async (params: { page?: number; keyword?: string; categoryId?: string }): Promise<NovelListResult> => {
  const page = params.page || 1
  const url = params.keyword
    ? `https://www.sto66.com/search/${encodeURIComponent(params.keyword)}${page > 1 ? `/${page}` : ''}.html`
    : `https://www.sto66.com/library/${params.categoryId || '4H6C2Vfu5Xh6mzbnS6oK3W'}${page > 1 ? `/${page}` : ''}.html`
  const html = await httpClient.getText(url, qimaoHeaders())
  const blocks = Array.from(html.matchAll(/<div[^>]*class="[^"]*bookbox[^"]*"[\s\S]*?<\/div>\s*<\/div>/gi)).map((item) => item[0])
  const list = blocks.map((block): NovelListItem => {
    const href = block.match(/<a[^>]+href="(\/book\/[^"]+)"/i)?.[1] || ''
    const rawId = href.match(/\/book\/([^/.]+)\.html/)?.[1] || href
    const name = block.match(/class="[^"]*bookname[^"]*"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)?.[1]?.replace(/<[^>]+>/g, '').trim() || '未命名小说'
    return {
      id: `sto66:${rawId}`,
      rawId,
      sourceId: 'sto66',
      sourceName: getNovelSource('sto66').name,
      name,
      author: block.match(/作者[：:]\s*([^<\s]+)/)?.[1] || undefined,
      cover: block.match(/<img[^>]+(?:data-src|src)="([^"]+)"/i)?.[1] || undefined,
      intro: htmlToText(block.match(/class="[^"]*update[^"]*"[\s\S]*?>([\s\S]*?)<\/div>/i)?.[1] || ''),
      category: block.match(/class="[^"]*cat[^"]*"[\s\S]*?<a[^>]*>([^<]+)<\/a>/i)?.[1] || undefined,
      status: undefined,
      latestChapter: block.match(/class="[^"]*cat[^"]*"[\s\S]*?<a[^>]*>([^<]+)<\/a>/i)?.[1] || undefined,
      wordCount: block.match(/字数[：:]\s*([^<\s]+)/)?.[1] || undefined,
      score: undefined,
      tags: [],
    }
  }).filter((item) => item.rawId)
  return {
    page,
    pageCount: html.includes('linkNext') || list.length >= 10 ? page + 1 : page,
    total: list.length,
    list,
    categories: stoCategories,
    sourceId: 'sto66',
    sourceName: getNovelSource('sto66').name,
  }
}

const fetchYoushuList = async (params: { page?: number; keyword?: string; categoryId?: string }): Promise<NovelListResult> => {
  const page = params.page || 1
  const categoryId = params.categoryId || 'xuanhuan'
  // 95590 站点的 ?s= 搜索入口已失效：对任意关键词都返回首页固定推荐（官场小说），
  // 会把无关结果混进聚合搜索。这里在关键词模式下直接返回空，避免污染结果。
  if (params.keyword) {
    return { page, pageCount: page, total: 0, list: [], categories: [], sourceId: 'youshu95590', sourceName: getNovelSource('youshu95590').name }
  }
  const url = `https://www.95590.org/${categoryId === 'xuanhuan' ? 'xuanhuan' : categoryId}/?p=${page}`
  const html = await httpClient.getText(url, qimaoHeaders())
  const items = Array.from(html.matchAll(/<article[^>]*class="hentry"[\s\S]*?<h2[^>]*class="entry-title"[\s\S]*?<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)).map((m) => ({ href: m[1], title: m[2] }))
  const list = items.map((item): NovelListItem => ({
    id: `youshu95590:${encodeURIComponent(item.href)}`,
    rawId: item.href,
    sourceId: 'youshu95590',
    sourceName: getNovelSource('youshu95590').name,
    name: item.title.replace(/<[^>]+>/g, '').trim(),
    intro: undefined,
    tags: [],
  }))
  return { page, pageCount: items.length >= 10 ? page + 1 : page, total: list.length, list, categories: youshuCategories, sourceId: 'youshu95590', sourceName: getNovelSource('youshu95590').name }
}

const fetchShuhuangList = async (params: { page?: number; keyword?: string; categoryId?: string }): Promise<NovelListResult> => {
  const page = params.page || 1
  const categoryId = params.categoryId || '1'
  const url = params.keyword
    ? `https://shuhuangw.com/search?q=${encodeURIComponent(params.keyword)}&type=novel`
    : `https://shuhuangw.com/library?category=${categoryId}&order_by=updated_at&page=${page}`
  const html = await httpClient.getText(url, qimaoHeaders())
  const items = Array.from(html.matchAll(/<a href="\/novel\/(\d+)"[^>]*>[\s\S]*?<div[^>]*class="novel-title"[^>]*>([\s\S]*?)<\/div>/gi)).map((m) => ({ id: m[1], title: m[2] }))
  const list = items.map((item): NovelListItem => ({
    id: `shuhuangw:${item.id}`,
    rawId: item.id,
    sourceId: 'shuhuangw',
    sourceName: getNovelSource('shuhuangw').name,
    name: item.title.replace(/<[^>]+>/g, '').trim(),
    tags: [],
  }))
  return { page, pageCount: items.length >= 10 ? page + 1 : page, total: list.length, list, categories: shuhuangCategories, sourceId: 'shuhuangw', sourceName: getNovelSource('shuhuangw').name }
}

const fetchShu52List = async (params: { page?: number; keyword?: string; categoryId?: string }): Promise<NovelListResult> => {
  const page = params.page || 1
  const categoryId = params.categoryId || 'all'
  const url = params.keyword
    ? `https://www.52shuku.net/so/search.php?q=${encodeURIComponent(params.keyword)}`
    : `https://www.52shuku.net/${categoryId === 'all' ? '' : categoryId + '/'}${categoryId === 'all' ? '' : ''}`
  const html = await httpClient.getText(url, qimaoHeaders())
  const items = Array.from(html.matchAll(/<h2><a href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>/gi)).map((m) => ({ href: m[1], title: m[2] }))
  const list = items.map((item): NovelListItem => ({
    id: `shu52:${encodeURIComponent(item.href)}`,
    rawId: item.href,
    sourceId: 'shu52',
    sourceName: getNovelSource('shu52').name,
    name: item.title.replace(/<[^>]+>/g, '').trim(),
    tags: [],
  }))
  return { page, pageCount: items.length >= 10 ? page + 1 : page, total: list.length, list, categories: shu52Categories, sourceId: 'shu52', sourceName: getNovelSource('shu52').name }
}

const fetchJiujiuList = async (params: { page?: number; keyword?: string; categoryId?: string }): Promise<NovelListResult> => {
  const page = params.page || 1
  const categoryId = params.categoryId || 'qj'
  const categoryKeyword = !params.keyword && jiujiuCategorySearchKeywords[categoryId]
  const buildUrl = (sourcePage: number) => params.keyword
    ? `http://m.9191net.com/article/search.html?keywords=${encodeURIComponent(params.keyword)}&submit=&p=${sourcePage}`
    : categoryKeyword
      ? `http://m.9191net.com/article/search.html?keywords=${encodeURIComponent(categoryKeyword)}&submit=&p=${sourcePage}`
    : categoryId === 'qj' || categoryId === 'zx'
      ? `http://m.9191net.com/m/cat/${categoryId}/${sourcePage === 1 ? 'index' : sourcePage}.html`
      : `http://m.9191net.com/article/index/category/${categoryId}${sourcePage > 1 ? `/p/${sourcePage}` : ''}.html`
  const firstSourcePage = ((page - 1) * 3) + 1
  const pages = await Promise.all(Array.from({ length: 3 }, (_, index) => firstSourcePage + index).map((sourcePage) => httpClient.getText(buildUrl(sourcePage), qimaoHeaders())))
  const blocks = pages.flatMap((html) => Array.from(html.matchAll(/<div class="block">([\s\S]*?)(?=<div class="block">|<div id="pages"|<\/div>\s*<script)/gi)).map((m) => m[1]))
  const list = dedupeList(blocks.map((block): NovelListItem => {
    const href = block.match(/<a href="([^"]+)"/i)?.[1] || ''
    const name = block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1]?.replace(/<[^>]+>/g, '').trim() || '未命名小说'
    return {
      id: `jiujiu9191:${encodeURIComponent(resolveUrl('http://m.9191net.com', href))}`,
      rawId: resolveUrl('http://m.9191net.com', href),
      sourceId: 'jiujiu9191',
      sourceName: getNovelSource('jiujiu9191').name,
      name,
      author: block.match(/作者[：:]\s*([^<\n]+)/)?.[1]?.trim() || undefined,
      cover: resolveUrl('http://m.9191net.com', block.match(/<img[^>]+src="([^"]+)"/i)?.[1]),
      intro: htmlToText(block.match(/<p>\s*<a[^>]*>([\s\S]*?)<\/a>\s*<\/p>/i)?.[1] || ''),
      status: '可下载',
      tags: ['TXT下载'],
    }
  }).filter((item) => item.rawId), (item) => item.rawId)
  const hasNext = pages.some((pageHtml) => /class="next"[^>]+href="[^"]+"/.test(pageHtml))
  return { page, pageCount: hasNext || list.length >= 30 ? page + 1 : page, total: list.length, list, categories: jiujiuCategories, sourceId: 'jiujiu9191', sourceName: getNovelSource('jiujiu9191').name }
}

const kuwoCategories = [
  { id: 'all', name: '全部', sourceId: 'kuwo' as const, group: '类型' },
  { id: '轻小说', name: '轻小说', sourceId: 'kuwo' as const, group: '类型' },
  { id: '都市', name: '都市', sourceId: 'kuwo' as const, group: '类型' },
  { id: '玄幻', name: '玄幻', sourceId: 'kuwo' as const, group: '类型' },
  { id: '仙侠', name: '仙侠', sourceId: 'kuwo' as const, group: '类型' },
  { id: '历史', name: '历史', sourceId: 'kuwo' as const, group: '类型' },
  { id: '科幻', name: '科幻', sourceId: 'kuwo' as const, group: '类型' },
  { id: '完结', name: '完结', sourceId: 'kuwo' as const, group: '完结' },
  { id: '连载', name: '连载', sourceId: 'kuwo' as const, group: '完结' },
]

const fetchKuwoList = async (params: { page?: number; keyword?: string; categoryId?: string }): Promise<NovelListResult> => {
  const page = params.page || 1
  const categoryParts = (params.categoryId || 'all').split('|').filter(Boolean)
  const typeFilter = categoryParts.find((item) => item !== 'all' && item !== '完结' && item !== '连载') || 'all'
  const statusFilter = categoryParts.find((item) => item === '完结' || item === '连载') || ''
  // 酷我搜索接口对分类词比较挑，分类页改用宽泛关键词兜底，再在本地做筛选。
  const query = params.keyword || '一'
  const url = `http://appi.kuwo.cn/novels/api/book/search?keyword=${encodeURIComponent(query)}&pi=${page}&ps=30`
  const text = await httpClient.getText(url, kuwoHeaders())
  const response = parseJson<any>(text, '酷我小说列表接口')
  const books = Array.isArray(response?.data) ? response.data : []
  const filtered = books.filter((item: any) => {
    if (statusFilter && (statusFilter === '完结' ? String(item.status) !== '50' : String(item.status) === '50')) return false
    if (!params.keyword && typeFilter !== 'all' && ![toStr(item.category_name), toStr(item.sub_category_name)].some((value) => value.includes(typeFilter))) return false
    return true
  })
  return {
    page,
    pageCount: books.length >= 30 ? page + 1 : page,
    total: Number(response?.total || response?.count || filtered.length || 0),
    list: dedupeNovelItems(filtered.map(normalizeKuwoListItem)),
    categories: kuwoCategories,
    sourceId: 'kuwo',
    sourceName: getNovelSource('kuwo').name,
  }
}

const fetchKuwoDetail = async (id: string): Promise<NovelDetail | null> => {
  const rawId = decodeURIComponent(stripBookIdPrefix(id, 'kuwo'))
  const info = parseJson<any>(await httpClient.getText(`http://appi.kuwo.cn/novels/api/book/${rawId}`, kuwoHeaders()), '酷我小说详情接口')
  const data = info?.data
  if (!data) return null
  const chaptersRes = parseJson<any>(await httpClient.getText(`http://appi.kuwo.cn/novels/api/book/${rawId}/chapters?paging=0`, kuwoHeaders()), '酷我小说目录接口')
  const chapters = Array.isArray(chaptersRes?.data)
    ? chaptersRes.data.map((chapter: any): NovelChapter => ({
      id: toStr(chapter.chapter_id),
      title: toStr(chapter.chapter_title),
      index: Number(chapter.chapter_index) || undefined,
      words: toStr(chapter.original_words) || undefined,
    }))
    : []
  return {
    id: `kuwo:${rawId}`,
    rawId,
    sourceId: 'kuwo',
    sourceName: getNovelSource('kuwo').name,
    name: toStr(data.title) || '未命名小说',
    author: toStr(data.author_name) || undefined,
    cover: toStr(data.cover_url) || undefined,
    intro: toStr(data.intro) || undefined,
    category: [toStr(data.category_name), toStr(data.sub_category_name)].filter(Boolean).join(' · ') || undefined,
    status: toStr(data.status) === '50' ? '完结' : '连载',
    latestChapter: toStr(data.new_chapter_name) || undefined,
    wordCount: toStr(data.all_words) || undefined,
    score: undefined,
    tags: [],
    updateTime: toStr(data.update_time) || undefined,
    chapters,
  }
}

const fetchKuwoChapter = async (bookId: string, chapterId: string): Promise<NovelReaderResult> => {
  const rawBookId = stripBookIdPrefix(bookId, 'kuwo')
  const rawChapterId = stripBookIdPrefix(chapterId, 'kuwo')
  const text = await httpClient.getText(`http://appi.kuwo.cn/novels/api/book/${rawBookId}/chapters/${rawChapterId}`, kuwoHeaders())
  const response = parseJson<any>(text, '酷我小说正文接口')
  const data = response?.data
  return {
    bookId: rawBookId,
    sourceId: 'kuwo',
    chapterId: rawChapterId,
    title: toStr(data?.chapter_name) || '章节',
    content: toStr(data?.content) || '暂无正文',
  }
}

const fetchBoluoList = async (params: { page?: number; keyword?: string }): Promise<NovelListResult> => {
  const page = params.page || 1
  const url = params.keyword
    ? `https://www.boluomao.com/search?q=${encodeURIComponent(params.keyword)}&page=${page}`
    : `https://www.boluomao.com/gender/boy/page/${page}/`
  const text = await httpClient.getText(url, qimaoHeaders())
  const isListPage = text.includes('picList')
  const items: any[] = []
  const regex = /<a[^>]*href="(\/book\/\d+\.html)"[^>]*>([^<]+)<\/a>/gi
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    items.push({ href: match[1], title: match[2] })
  }
  const deduped = Array.from(new Map(items.map((item) => [item.href, item])).values())
  const list = deduped.map((item: any) => ({
    id: `boluomao:${item.href.match(/(\d+)\.html/)?.[1] || item.href}`,
    rawId: item.href.match(/(\d+)\.html/)?.[1] || item.href,
    sourceId: 'boluomao' as const,
    sourceName: getNovelSource('boluomao').name,
    name: toStr(item.title).replace(/全文免费阅读.*$/, ''),
    author: undefined,
    cover: undefined,
    intro: undefined,
    category: undefined,
    status: undefined,
    latestChapter: undefined,
    wordCount: undefined,
    score: undefined,
    tags: [],
  }))
  return {
    page,
    pageCount: isListPage ? page + 1 : page,
    total: list.length,
    list,
    categories: [],
    sourceId: 'boluomao',
    sourceName: getNovelSource('boluomao').name,
  }
}

const fetchQimaoDetail = async (id: string): Promise<NovelDetail | null> => {
  const detailUrl = `https://api-bc.wtzw.com/api/v4/book/detail?${qs(withSign({ id, imei_ip: '2937357107', teeny_mode: '0' }))}`
  const detailText = await httpClient.getText(detailUrl, qimaoHeaders())
  const detail = parseJson<any>(detailText, '七猫详情接口')
  const book = detail?.data?.book
  if (!book) return null
  const tocUrl = `https://api-ks.wtzw.com/api/v1/chapter/chapter-list?${qs(withSign({ id }))}`
  const tocText = await httpClient.getText(tocUrl, qimaoHeaders())
  const toc = parseJson<any>(tocText, '七猫目录接口')
  const chapters = Array.isArray(toc?.data?.chapter_lists)
    ? toc.data.chapter_lists.map((chapter: any): NovelChapter => ({
      id: toStr(chapter.id),
      title: toStr(chapter.title),
      words: toStr(chapter.words) || undefined,
      index: Number(chapter.chapter_sort) || undefined,
    }))
    : []
  return {
    ...normalizeQimaoListItem(book, 'qimao'),
    updateTime: toStr(book.update_time) || undefined,
    chapters,
  }
}

const fetchBoluoDetail = async (id: string): Promise<NovelDetail | null> => {
  const url = `https://www.boluomao.com/book/${id}.html`
  const html = await httpClient.getText(url, qimaoHeaders())
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim()
  const name = title.replace(/全文免费阅读.*|- 菠萝猫$/g, '').trim()
  const author = html.match(/作者[：:](.*?)<\/div>/)?.[1]?.replace(/<[^>]+>/g, '').trim()
  const introMatch = html.match(/id="bookIntro"[\s\S]*?<div class="content">([\s\S]*?)<\/div>/i)
  const intro = introMatch ? htmlToText(introMatch[1]) : undefined
  const chapters: NovelChapter[] = []
  const chapterRegex = /<a href="(\/read\/\d+\/\d+\.html)">([^<]+)<\/a>/gi
  let match: RegExpExecArray | null
  while ((match = chapterRegex.exec(html)) !== null) {
    chapters.push({
      id: match[1].match(/(\d+)\.html/)?.[1] || match[1],
      title: match[2].trim(),
      url: resolveUrl(url, match[1]),
    })
  }
  return {
    id: `boluomao:${id}`,
    rawId: id,
    sourceId: 'boluomao',
    sourceName: getNovelSource('boluomao').name,
    name: name || '未命名小说',
    author: author || undefined,
    cover: html.match(/<meta property="og:image" content="([^"]+)"/)?.[1] || undefined,
    intro,
    category: html.match(/分类[：:](.*?)<\/div>/)?.[1]?.replace(/<[^>]+>/g, '').trim() || undefined,
    status: html.includes('完结') ? '完结' : '连载',
    latestChapter: html.match(/最新章节[：:](.*?)<\/a>/)?.[1]?.replace(/<[^>]+>/g, '').trim() || undefined,
    wordCount: html.match(/字数[：:](\d+)/)?.[1] || undefined,
    score: undefined,
    tags: [],
    updateTime: undefined,
    chapters,
  }
}

const fetchStoDetail = async (id: string): Promise<NovelDetail | null> => {
  const rawId = stripBookIdPrefix(id, 'sto66')
  const url = `https://www.sto66.com/book/${rawId}.html`
  const html = await httpClient.getText(url, qimaoHeaders())
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || ''
  const name = html.match(/class="[^"]*booktitle[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i)?.[1]?.replace(/<[^>]+>/g, '').trim()
    || title.replace(/\(.*?\).*$/, '').replace(/-思兔阅读.*$/, '').trim()
  const tocHref = html.match(/id=['"]allchapter['"][\s\S]*?<a[^>]+href="([^"]+)"[^>]*>[^<]*查看全部章节/i)?.[1]
  const tocUrl = tocHref ? resolveUrl(url, tocHref) : `https://www.sto66.com/chapter/${rawId}.html`
  const tocHtml = await httpClient.getText(tocUrl, qimaoHeaders())
  const chapters = Array.from(tocHtml.matchAll(/<dd[^>]*data-num="(\d+)"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*title="([^"]+)"[^>]*>[\s\S]*?<\/a>/gi))
    .map((match): NovelChapter => ({
      id: match[2].match(/\/chapter\/[^/]+\/([^/.]+)\.html/)?.[1] || match[2],
      title: match[3].trim(),
      url: resolveUrl(tocUrl, match[2]),
      index: Number(match[1]) || undefined,
    }))
  return {
    id: `sto66:${rawId}`,
    rawId,
    sourceId: 'sto66',
    sourceName: getNovelSource('sto66').name,
    name: name || '未命名小说',
    author: html.match(/class="[^"]*booktag[^"]*"[\s\S]*?<a[^>]*class="[^"]*red[^"]*"[^>]*>([^<]+)<\/a>/i)?.[1] || undefined,
    cover: html.match(/class="[^"]*bookcover[^"]*"[\s\S]*?<img[^>]+(?:data-src|src)="([^"]+)"/i)?.[1] || undefined,
    intro: htmlToText(html.match(/class="[^"]*bookintro[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1] || ''),
    category: html.match(/class="[^"]*booktag[^"]*"[\s\S]*?<a[^>]*class="[^"]*blue[^"]*"[^>]*>([^<]+)<\/a>/i)?.[1] || undefined,
    status: html.includes('完结') ? '完结' : undefined,
    latestChapter: html.match(/class="[^"]*bookchapter[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i)?.[1]?.replace(/<[^>]+>/g, '').trim() || undefined,
    wordCount: html.match(/字数[：:]?\s*([^<\s]+)/)?.[1] || undefined,
    score: undefined,
    tags: [],
    updateTime: undefined,
    chapters,
  }
}

const fetchYoushuDetail = async (id: string): Promise<NovelDetail | null> => {
  const rawId = decodeURIComponent(stripBookIdPrefix(id, 'youshu95590'))
  const url = rawId.startsWith('http') ? rawId : `https://www.95590.org${rawId}`
  const html = await httpClient.getText(url, qimaoHeaders())
  const name = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/_.*$/, '').trim() || '未命名小说'
  const chapters = Array.from(html.matchAll(/<li[^>]*>\s*<a href="([^"]+)"[^>]*>([^<]+)<\/a>\s*<\/li>/gi)).map((match): NovelChapter => ({
    id: encodeURIComponent(match[1]),
    title: match[2].trim(),
    url: resolveUrl(url, match[1]),
  }))
  return {
    id: `youshu95590:${encodeURIComponent(rawId)}`,
    rawId,
    sourceId: 'youshu95590',
    sourceName: getNovelSource('youshu95590').name,
    name,
    author: html.match(/作者[：:]\s*([^<\n]+)/)?.[1]?.trim() || undefined,
    cover: html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)?.[1] || undefined,
    intro: htmlToText(html.match(/meta name="description" content="([^"]+)"/i)?.[1] || ''),
    category: html.match(/分类[：:]\s*([^<\n]+)/)?.[1]?.trim() || undefined,
    status: html.includes('完结') ? '完结' : undefined,
    latestChapter: chapters[chapters.length - 1]?.title,
    wordCount: html.match(/字数[：:]\s*([^<\s]+)/)?.[1] || undefined,
    score: undefined,
    tags: [],
    updateTime: undefined,
    chapters,
  }
}

const fetchShuhuangDetail = async (id: string): Promise<NovelDetail | null> => {
  const rawId = stripBookIdPrefix(id, 'shuhuangw')
  const url = rawId.startsWith('http') ? rawId : `https://shuhuangw.com/novel/${rawId}`
  const html = await httpClient.getText(url, qimaoHeaders())
  const title = html.match(/<h1[^>]*class="detail-info"[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, '').trim() || '未命名小说'
  const chapters = Array.from(html.matchAll(/<a href="(\/read\/[^"]+)"[^>]*class="chapter-title-info"[^>]*>([\s\S]*?)<\/a>/gi)).map((match): NovelChapter => ({
    id: encodeURIComponent(match[1]),
    title: match[2].replace(/<[^>]+>/g, '').trim(),
    url: resolveUrl(url, match[1]),
  }))
  return {
    id: `shuhuangw:${rawId}`,
    rawId,
    sourceId: 'shuhuangw',
    sourceName: getNovelSource('shuhuangw').name,
    name: title,
    author: html.match(/<span>作者：?<\/span>\s*([^<]+)/)?.[1]?.trim() || undefined,
    cover: html.match(/class="detail-cover"[^>]*img[^>]+(?:data-src|src)="([^"]+)"/i)?.[1] || undefined,
    intro: htmlToText(html.match(/class="description-content"[^>]*>([\s\S]*?)<\/div>/i)?.[1] || ''),
    category: html.match(/id="categoryName"[^>]*>([^<]+)</i)?.[1]?.trim() || undefined,
    status: undefined,
    latestChapter: html.match(/class="stats-row"[\s\S]*?<span>([^<]+)<\/span>[\s\S]*?<span>([^<]+)<\/span>[\s\S]*?<span>([^<]+)<\/span>[\s\S]*?<span>([^<]+)<\/span>/i)?.[4]?.trim() || undefined,
    wordCount: html.match(/字数[：:]\s*([^<\s]+)/)?.[1] || undefined,
    score: undefined,
    tags: [],
    updateTime: undefined,
    chapters,
  }
}

const fetchShu52Detail = async (id: string): Promise<NovelDetail | null> => {
  const rawId = decodeURIComponent(stripBookIdPrefix(id, 'shu52'))
  const url = rawId.startsWith('http') ? rawId : `https://www.52shuku.net${rawId}`
  const html = await httpClient.getText(url, qimaoHeaders())
  const name = html.match(/<h1[^>]*class="article-title"[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, '').trim() || '未命名小说'
  const chapters = Array.from(html.matchAll(/<a href="([^"]+_\d+\.html)"[^>]*>([^<]+)<\/a>/gi)).map((match): NovelChapter => ({
    id: encodeURIComponent(match[1]),
    title: match[2].trim(),
    url: resolveUrl(url, match[1]),
  }))
  return {
    id: `shu52:${encodeURIComponent(rawId)}`,
    rawId,
    sourceId: 'shu52',
    sourceName: getNovelSource('shu52').name,
    name,
    author: html.match(/作者[：:]\s*([^<\n]+)/)?.[1]?.trim() || undefined,
    cover: html.match(/<img[^>]+(?:data-src|src)="([^"]+)"/i)?.[1] || undefined,
    intro: htmlToText(html.match(/class="article-content"[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] || ''),
    category: html.match(/class="muted"[\s\S]*?<a[^>]*>([^<]+)<\/a>/i)?.[1] || undefined,
    status: html.includes('完结') ? '完结' : undefined,
    latestChapter: chapters[chapters.length - 1]?.title,
    wordCount: undefined,
    score: undefined,
    tags: [],
    updateTime: undefined,
    chapters,
  }
}

const fetchJiujiuDetail = async (id: string): Promise<NovelDetail | null> => {
  const rawId = decodeURIComponent(stripBookIdPrefix(id, 'jiujiu9191'))
  const url = rawId.startsWith('http') ? rawId : `http://m.9191net.com${rawId}`
  const html = await httpClient.getText(url, qimaoHeaders())
  const name = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1]?.replace(/<[^>]+>/g, '').trim()
    || html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, '').trim()
    || '未命名小说'
  const downloadHref = html.match(/class="downButton"[^>]*href="([^"]+)"/i)?.[1]
  const downloadUrl = resolveUrl(url, downloadHref)
  const chapters: NovelChapter[] = downloadUrl ? [{ id: encodeURIComponent(downloadUrl), title: 'TXT/RAR/ZIP 下载', url: downloadUrl, index: 1 }] : []
  return {
    id: `jiujiu9191:${encodeURIComponent(rawId)}`,
    rawId,
    sourceId: 'jiujiu9191',
    sourceName: getNovelSource('jiujiu9191').name,
    name,
    author: html.match(/作者[：:]\s*(?:<a[^>]*>)?([^<\n]+)/i)?.[1]?.trim() || undefined,
    cover: resolveUrl(url, html.match(/<img[^>]+src="([^"]+)"/i)?.[1]),
    intro: htmlToText(html.match(/《[^》]+》小说简介[\s\S]*?<div class="intro_info">([\s\S]*?)<\/div>/i)?.[1] || ''),
    category: html.match(/分类[：:]\s*(?:<a[^>]*>)?([^<\n]+)/i)?.[1]?.trim() || undefined,
    status: html.match(/状态[：:]\s*([^<\n]+)/i)?.[1]?.trim() || '可下载',
    latestChapter: downloadUrl ? 'TXT下载' : undefined,
    wordCount: html.match(/大小[：:]\s*([^<\n]+)/i)?.[1]?.trim() || undefined,
    score: undefined,
    tags: ['TXT下载'],
    updateTime: html.match(/更新[：:]\s*([^<\n]+)/i)?.[1]?.trim() || undefined,
    downloadUrl,
    chapters,
  }
}

const fetchQimaoChapter = async (bookId: string, chapterId: string): Promise<NovelReaderResult> => {
  const url = `https://api-ks.wtzw.com/api/v1/chapter/content?${qs(withSign({ id: bookId, chapterId }))}`
  const text = await httpClient.getText(url, qimaoHeaders())
  const response = parseJson<any>(text, '七猫正文接口')
  if (!response?.data?.content) {
    throw new Error(response?.errors?.details || '七猫正文为空')
  }
  return {
    bookId,
    sourceId: 'qimao',
    chapterId,
    title: toStr(response.data.title) || `章节 ${chapterId}`,
    content: decodeQimaoContent(response.data.content),
  }
}

const fetchBoluoChapter = async (bookId: string, chapterId: string): Promise<NovelReaderResult> => {
  const url = `https://www.boluomao.com/read/${bookId}/${chapterId}.html`
  const html = await httpClient.getText(url, qimaoHeaders())
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim()
  const contentMatch = html.match(/<div class="content">([\s\S]*?)<\/div>/i)
  const content = htmlToText(contentMatch?.[1] || '')
  const prevChapterId = html.match(/<a[^>]*href="\/read\/\d+\/(\d+)\.html"[^>]*>上一章<\/a>/)?.[1]
  const nextChapterId = html.match(/<a[^>]*href="\/read\/\d+\/(\d+)\.html"[^>]*>下一章<\/a>/)?.[1]
  return {
    bookId,
    sourceId: 'boluomao',
    chapterId,
    title,
    content,
    prevChapterId,
    nextChapterId,
  }
}

const fetchStoChapter = async (bookId: string, chapterId: string): Promise<NovelReaderResult> => {
  const rawBookId = stripBookIdPrefix(bookId, 'sto66')
  const rawChapterId = stripBookIdPrefix(chapterId, 'sto66')
  const url = `https://www.sto66.com/chapter/${rawBookId}/${rawChapterId}.html`
  const html = await httpClient.getText(url, qimaoHeaders())
  const title = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, '').trim()
    || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/-思兔阅读.*$/, '').trim()
    || `章节 ${chapterId}`
  const content = htmlToText(html.match(/id="content"[^>]*>([\s\S]*?)<\/div>/i)?.[1] || '')
  return {
    bookId: rawBookId,
    sourceId: 'sto66',
    chapterId: rawChapterId,
    title,
    content,
    prevChapterId: html.match(/href="\/chapter\/[^/]+\/([^/.]+)\.html"[^>]*>上一章/i)?.[1],
    nextChapterId: html.match(/href="\/chapter\/[^/]+\/([^/.]+)\.html"[^>]*>下一章/i)?.[1],
  }
}

const fetchYoushuChapter = async (bookId: string, chapterId: string): Promise<NovelReaderResult> => {
  const rawBookId = stripBookIdPrefix(bookId, 'youshu95590')
  const rawChapterId = decodeURIComponent(stripBookIdPrefix(chapterId, 'youshu95590'))
  const url = rawChapterId.startsWith('http') ? rawChapterId : resolveUrl(`https://www.95590.org${rawBookId}`, rawChapterId)
  const html = await httpClient.getText(url, qimaoHeaders())
  const title = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, '').trim() || '章节'
  return {
    bookId: rawBookId,
    sourceId: 'youshu95590',
    chapterId: rawChapterId,
    title,
    content: htmlToText(html.match(/class="entry-content"[^>]*>([\s\S]*?)<\/div>/i)?.[1] || ''),
    nextChapterId: html.match(/rel="next"[^>]+href="([^"]+)"/i)?.[1],
  }
}

const fetchShuhuangChapter = async (bookId: string, chapterId: string): Promise<NovelReaderResult> => {
  const rawBookId = stripBookIdPrefix(bookId, 'shuhuangw')
  const rawChapterId = decodeURIComponent(stripBookIdPrefix(chapterId, 'shuhuangw'))
  const url = rawChapterId.startsWith('http') ? rawChapterId : resolveUrl(`https://shuhuangw.com/novel/${rawBookId}`, rawChapterId)
  const html = await httpClient.getText(url, qimaoHeaders())
  const title = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, '').trim() || '章节'
  return {
    bookId: rawBookId,
    sourceId: 'shuhuangw',
    chapterId: rawChapterId,
    title,
    content: htmlToText(html.match(/class="content-body"[^>]*>([\s\S]*?)<\/div>/i)?.[1] || ''),
    nextChapterId: html.match(/rel="next"[^>]+href="([^"]+)"/i)?.[1],
  }
}

const fetchShu52Chapter = async (bookId: string, chapterId: string): Promise<NovelReaderResult> => {
  const rawBookId = stripBookIdPrefix(bookId, 'shu52')
  const rawChapterId = decodeURIComponent(stripBookIdPrefix(chapterId, 'shu52'))
  const url = rawChapterId.startsWith('http') ? rawChapterId : resolveUrl(`https://www.52shuku.net${rawBookId}`, rawChapterId)
  const html = await httpClient.getText(url, qimaoHeaders())
  const title = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, '').trim() || '章节'
  return {
    bookId: rawBookId,
    sourceId: 'shu52',
    chapterId: rawChapterId,
    title,
    content: htmlToText(html.match(/id="nr1"[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] || html.match(/id="nr1"[^>]*>([\s\S]*?)<\/div>/i)?.[1] || ''),
    nextChapterId: html.match(/text\.下一页@href|rel="next"[^>]+href="([^"]+)"/i)?.[1],
  }
}

const fetchJiujiuChapter = async (bookId: string, chapterId: string): Promise<NovelReaderResult> => {
  const rawBookId = decodeURIComponent(stripBookIdPrefix(bookId, 'jiujiu9191'))
  const rawChapterId = decodeURIComponent(stripBookIdPrefix(chapterId, 'jiujiu9191'))
  const downloadUrl = rawChapterId.startsWith('http') ? rawChapterId : resolveUrl(rawBookId, rawChapterId)
  const content = normalizeDownloadedContent(await getDecodedText(downloadUrl, qimaoHeaders()))
  return {
    bookId: rawBookId,
    sourceId: 'jiujiu9191',
    chapterId: rawChapterId,
    title: '下载阅读',
    content: content || `下载内容为空：${downloadUrl}`,
  }
}

const normalizeDownloadedContent = (content: string) => content
  .replace(/\r\n/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim()

const decodeBase64Bytes = (base64: string) => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

const decodeBytes = (bytes: Uint8Array, encoding: string) => {
  try {
    return new TextDecoder(encoding).decode(bytes)
  } catch {
    return new TextDecoder().decode(bytes)
  }
}

const brokenTextScore = (text: string) => (text.match(/�/g)?.length || 0) + (text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g)?.length || 0)

const getDecodedText = async (url: string, headers?: Record<string, string>) => {
  const response = await httpClient.request({ url, method: 'GET', headers })
  if (!response.bodyBase64) return response.bodyText
  const bytes = decodeBase64Bytes(response.bodyBase64)
  const candidates = ['utf-8', 'gb18030', 'gbk'].map((encoding) => decodeBytes(bytes, encoding))
  return candidates.sort((left, right) => brokenTextScore(left) - brokenTextScore(right))[0] || response.bodyText
}

const storageGet = async <T,>(key: string): Promise<T | null> => {
  if (typeof window === 'undefined' || !window.electronAPI?.storeGet) return null
  return window.electronAPI.storeGet(key) as Promise<T | null>
}

const storageSet = async (key: string, value: unknown) => {
  if (typeof window === 'undefined' || !window.electronAPI?.storeSet) return
  await window.electronAPI.storeSet(key, value)
}

const DOWNLOAD_STORE_KEY = 'novel:downloaded-books:v1'

const readDownloadedBooks = async (): Promise<NovelDownloadedBook[]> => {
  const value = await storageGet<NovelDownloadedBook[]>(DOWNLOAD_STORE_KEY)
  return Array.isArray(value) ? value : []
}

const writeDownloadedBooks = async (books: NovelDownloadedBook[]) => {
  await storageSet(DOWNLOAD_STORE_KEY, books)
}

const buildCandidates = (sourceId?: string) => {
  const primary = getNovelSource(sourceId)
  return [primary.id, ...NOVEL_SOURCES.map((item) => item.id).filter((id) => id !== primary.id)]
    .map((id) => getNovelSource(id))
}

export const novelApi = {
  async searchAll(params: { page?: number; keyword: string }): Promise<NovelListResult> {
    const keyword = params.keyword.trim()
    if (!keyword) return this.getList({ page: params.page })
    return getCached(`novel:search-all:${stableKey(params)}`, async () => {
      const settled = await Promise.allSettled(NOVEL_SOURCES.map(async (source) => {
        if (source.id === 'qimao') return fetchQimaoList({ page: params.page, keyword })
        if (source.id === 'kuwo') return fetchKuwoList({ page: params.page, keyword })
        if (source.id === 'sto66') return fetchStoList({ page: params.page, keyword })
        if (source.id === 'youshu95590') return fetchYoushuList({ page: params.page, keyword })
        if (source.id === 'shuhuangw') return fetchShuhuangList({ page: params.page, keyword })
        if (source.id === 'shu52') return fetchShu52List({ page: params.page, keyword })
        if (source.id === 'jiujiu9191') return fetchJiujiuList({ page: params.page, keyword })
        return fetchBoluoList({ page: params.page, keyword })
      }))
      const results = settled
        .filter((item): item is PromiseFulfilledResult<NovelListResult> => item.status === 'fulfilled')
        .map((item) => item.value)
      const list = dedupeNovelItems(results.flatMap((item) => item.list))
      // 相关性排序：书名/作者命中关键词的排前，避免个别失效源返回的固定推荐污染结果。
      const kw = keyword.toLowerCase()
      const score = (item: NovelListItem) => {
        const name = (item.name || '').toLowerCase()
        const author = (item.author || '').toLowerCase()
        if (name === kw) return 0
        if (name.startsWith(kw)) return 1
        if (name.includes(kw)) return 2
        if (author.includes(kw)) return 3
        return 4
      }
      list.sort((left, right) => score(left) - score(right))
      return {
        page: params.page || 1,
        pageCount: results.some((item) => item.pageCount > item.page) ? (params.page || 1) + 1 : (params.page || 1),
        total: list.length,
        list,
        categories: [],
        sourceId: 'qimao',
        sourceName: `聚合搜索 · ${results.length}/${NOVEL_SOURCES.length} 个书源`,
      }
    })
  },

  async getList(params: { page?: number; keyword?: string; sourceId?: NovelSourceId; categoryId?: string } = {}): Promise<NovelListResult> {
    const source = getNovelSource(params.sourceId)
    return getCached(`novel:list:${source.id}:${stableKey(params)}`, async () => {
      let lastError: unknown = null
      for (const candidate of buildCandidates(source.id)) {
        try {
          if (candidate.id === 'qimao') return await fetchQimaoList(params)
          if (candidate.id === 'kuwo') return await fetchKuwoList(params)
          if (candidate.id === 'sto66') return await fetchStoList(params)
          if (candidate.id === 'youshu95590') return await fetchYoushuList(params)
          if (candidate.id === 'shuhuangw') return await fetchShuhuangList(params)
          if (candidate.id === 'shu52') return await fetchShu52List(params)
          if (candidate.id === 'jiujiu9191') return await fetchJiujiuList(params)
          if (candidate.id === 'boluomao') return await fetchBoluoList(params)
        } catch (error) {
          lastError = error
        }
      }
      throw lastError instanceof Error ? lastError : new Error('小说列表加载失败')
    })
  },

  async getDetail(id: string, sourceId?: NovelSourceId): Promise<NovelDetail | null> {
    const source = getNovelSource(sourceId || (id.includes(':') ? id.split(':')[0] as NovelSourceId : undefined))
    const rawId = id.includes(':') ? id.split(':').slice(1).join(':') : id
    return getCached(`novel:detail:${source.id}:${rawId}`, async () => {
      let lastError: unknown = null
      for (const candidate of buildCandidates(source.id)) {
        try {
          if (candidate.id === 'qimao') return await fetchQimaoDetail(rawId)
          if (candidate.id === 'kuwo') return await fetchKuwoDetail(rawId)
          if (candidate.id === 'sto66') return await fetchStoDetail(rawId)
          if (candidate.id === 'youshu95590') return await fetchYoushuDetail(rawId)
          if (candidate.id === 'shuhuangw') return await fetchShuhuangDetail(rawId)
          if (candidate.id === 'shu52') return await fetchShu52Detail(rawId)
          if (candidate.id === 'jiujiu9191') return await fetchJiujiuDetail(rawId)
          if (candidate.id === 'boluomao') return await fetchBoluoDetail(rawId)
        } catch (error) {
          lastError = error
        }
      }
      if (lastError instanceof Error) throw lastError
      return null
    })
  },

  async getChapter(bookId: string, chapterId: string, sourceId?: NovelSourceId): Promise<NovelReaderResult> {
    if (chapterId === '__downloaded__') {
      const downloaded = await this.getDownloadedBook(bookId)
      if (!downloaded) throw new Error('未找到已下载小说')
      return {
        bookId,
        sourceId: sourceId || (bookId.includes(':') ? bookId.split(':')[0] as NovelSourceId : 'jiujiu9191'),
        chapterId,
        title: `${downloaded.title} · 本地下载版`,
        content: downloaded.content,
      }
    }
    const source = getNovelSource(sourceId || (bookId.includes(':') ? bookId.split(':')[0] as NovelSourceId : undefined))
    const rawBookId = bookId.includes(':') ? bookId.split(':').slice(1).join(':') : bookId
    if (source.id === 'qimao') {
      return fetchQimaoChapter(rawBookId, chapterId)
    }
    if (source.id === 'kuwo') {
      return fetchKuwoChapter(rawBookId, chapterId)
    }
    if (source.id === 'sto66') {
      return fetchStoChapter(rawBookId, chapterId)
    }
    if (source.id === 'youshu95590') {
      return fetchYoushuChapter(rawBookId, chapterId)
    }
    if (source.id === 'shuhuangw') {
      return fetchShuhuangChapter(rawBookId, chapterId)
    }
    if (source.id === 'shu52') {
      return fetchShu52Chapter(rawBookId, chapterId)
    }
    if (source.id === 'jiujiu9191') {
      return fetchJiujiuChapter(rawBookId, chapterId)
    }
    return fetchBoluoChapter(rawBookId, chapterId)
  },

  async downloadBook(id: string, sourceId?: NovelSourceId): Promise<NovelDownloadedBook> {
    const detail = await this.getDetail(id, sourceId)
    if (!detail) throw new Error('未找到小说详情')
    if (!detail.downloadUrl && !detail.chapters.length) throw new Error('该书源不支持下载')

    let content = ''
    if (detail.downloadUrl) {
      const text = await getDecodedText(detail.downloadUrl, qimaoHeaders())
      content = normalizeDownloadedContent(text)
    } else {
      // 全本下载：遍历全部章节（不再截断前 30 章），用有界并发池避免一次性打爆书源。
      const chapters = detail.chapters
      const parts = new Array<string>(chapters.length).fill('')
      const CONCURRENCY = 5
      let cursor = 0
      const workers = Array.from({ length: Math.min(CONCURRENCY, chapters.length) }, async () => {
        while (cursor < chapters.length) {
          const index = cursor
          cursor += 1
          try {
            const chapterResult = await this.getChapter(detail.id, chapters[index].id, detail.sourceId)
            parts[index] = `## ${chapterResult.title}\n\n${chapterResult.content}`
          } catch (error) {
            console.error(`下载章节失败 ${chapters[index].title}:`, error)
            parts[index] = `## ${chapters[index].title}\n\n（章节加载失败）`
          }
        }
      })
      await Promise.all(workers)
      content = normalizeDownloadedContent(parts.join('\n\n'))
    }

    const downloadedBook: NovelDownloadedBook = {
      id: detail.id,
      title: detail.name,
      sourceName: detail.sourceName,
      content,
      downloadedAt: Date.now(),
    }

    const current = await readDownloadedBooks()
    const next = [downloadedBook, ...current.filter((item) => item.id !== downloadedBook.id)].slice(0, 200)
    await writeDownloadedBooks(next)
    return downloadedBook
  },

  async getDownloadedBook(id: string): Promise<NovelDownloadedBook | null> {
    const books = await readDownloadedBooks()
    return books.find((item) => item.id === id) || null
  },

  async listDownloadedBooks(): Promise<NovelDownloadedBook[]> {
    return readDownloadedBooks()
  },
}

export default novelApi
