import type { NovelSource } from '@/types/novel'

export const NOVEL_SOURCE_STORAGE_KEY = 'sollin-novel-source-v1'

export const NOVEL_SOURCES: NovelSource[] = [
  {
    id: 'qimao',
    name: '七猫官方',
    url: 'https://api-bc.wtzw.com',
    group: '推荐',
    note: '官方 API，支持搜索、详情、目录、正文 AES 解密',
  },
  {
    id: 'kuwo',
    name: '酷我小说',
    url: 'http://appi.kuwo.cn',
    group: '推荐',
    note: 'API 源，搜索、详情、目录、正文直接可用',
  },
  {
    id: 'suixkan',
    name: '阅友小说',
    url: 'http://m.suixkan.com',
    group: '推荐',
    note: '网页源，搜索、详情、目录、正文已验证可用',
  },
  {
    id: 'aitbooks',
    name: '艾途小说',
    url: 'https://m.aitbooks.cc',
    group: '推荐',
    note: '网页源，首页推荐/搜索/目录/正文可用',
  },
  {
    id: 'txtdd',
    name: '瀚海书阁',
    url: 'https://www.txtdd.top',
    group: '推荐',
    note: '来自书源 1226，搜索、详情、目录、正文已验证可用',
  },
  {
    id: 'sudugu',
    name: '速读谷',
    url: 'https://www.sudugu.org',
    group: '推荐',
    note: '来自书源 1226，搜索、详情、目录、正文已验证可用',
  },
  {
    id: 'shukuge',
    name: '365小说网',
    url: 'http://wap.shukuge.com',
    group: '推荐',
    note: '来自书源 1226，搜索、详情、目录、正文已验证可用',
  },
  {
    id: 'jiujiu9191',
    name: '久久小说下载',
    url: 'http://m.9191net.com',
    group: '推荐',
    note: '下载源，仅用于发现 TXT/RAR/ZIP 资源，不直接进入在线阅读器',
  },
  {
    id: 'sto66',
    name: '思兔阅读',
    url: 'https://www.sto66.com',
    group: '网页源',
    note: '来自书源合集 1220，搜索/详情/全目录/正文已验证可用',
  },
  {
    id: 'youshu95590',
    name: '95590小说',
    url: 'https://www.95590.org',
    group: '网页源',
    note: '搜索/详情/目录/正文已验证可用',
  },
]

export const getDefaultNovelSourceId = () => NOVEL_SOURCES[0]?.id || 'qimao'

export const getNovelSource = (sourceId?: string) => NOVEL_SOURCES.find((item) => item.id === sourceId) || NOVEL_SOURCES[0]

export const getGroupedNovelSources = () => NOVEL_SOURCES.reduce<Record<string, NovelSource[]>>((groups, source) => {
  const group = source.group || '集合'
  groups[group] = groups[group] || []
  groups[group].push(source)
  return groups
}, {})
