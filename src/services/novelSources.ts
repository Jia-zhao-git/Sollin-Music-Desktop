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
    id: 'jiujiu9191',
    name: '久久小说下载',
    url: 'http://m.9191net.com',
    group: '推荐',
    note: '下载源，支持 TXT 下载地址提取，兼容在线阅读入口',
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
  {
    id: 'shuhuangw',
    name: '书荒网',
    url: 'https://shuhuangw.com',
    group: '网页源',
    note: '优书网风格，搜索/详情/目录/正文可用，分类较全',
  },
  {
    id: 'shu52',
    name: '52书库',
    url: 'https://www.52shuku.net',
    group: '网页源',
    note: '可用，但更偏同人/言情/完结内容',
  },
  {
    id: 'boluomao',
    name: '菠萝猫',
    url: 'https://www.boluomao.com',
    group: '网页源',
    note: '网页源，列表/详情/目录/正文可用；关键词搜索依赖站点入口，可能不稳定',
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
