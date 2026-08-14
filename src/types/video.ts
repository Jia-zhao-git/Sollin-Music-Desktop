export type VideoApiRawListResponse = {
  code?: number
  msg?: string
  page?: number
  pagecount?: number
  limit?: string | number
  total?: number
  list?: VideoApiRawItem[]
  class?: VideoCategory[]
  data?: {
    list?: VideoApiRawItem[]
    class?: VideoCategory[]
    page?: number
    pagecount?: number
    limit?: string | number
    total?: number
  }
}

export type VideoApiRawDetailResponse = VideoApiRawListResponse

export type VideoApiRawItem = {
  vod_id?: number | string
  vod_name?: string
  type_id?: number | string
  type_name?: string
  vod_en?: string
  vod_time?: string
  vod_remarks?: string
  vod_play_from?: string
  vod_play_url?: string
  vod_pic?: string
  vod_actor?: string
  vod_director?: string
  vod_class?: string
  vod_area?: string
  vod_lang?: string
  vod_year?: string
  vod_content?: string
  vod_blurb?: string
  vod_score?: string
  vod_hits?: number | string
  vod_duration?: string
  vod_pubdate?: string
}

export type VideoSource = {
  id: string
  name: string
  url: string
  group?: '推荐' | '集合' | '特殊'
  pageParam?: string
  categoryAc?: string
  listAc?: string
  detailAc?: string
  note?: string
}

export type VideoSourceHealth = {
  sourceId: string
  ok: boolean
  checkedAt: number
  message?: string
  total?: number
}

export type VideoCategory = {
  type_id: number | string
  type_name: string
}

export type VideoListItem = {
  id: string
  rawId: string
  name: string
  typeId: string
  typeName: string
  slug: string
  updatedAt: string
  remarks: string
  playFrom: string[]
  score?: string
  hits?: number
  cover?: string
  year?: string
  area?: string
  actors?: string
  sourceId: string
  sourceName: string
}

export type VideoEpisode = {
  title: string
  url: string
  source: string
  sourceIndex: number
}

export type VideoDetail = VideoListItem & {
  director?: string
  category?: string
  language?: string
  content?: string
  score?: string
  duration?: string
  pubdate?: string
  episodes: VideoEpisode[]
  sources: Array<{
    name: string
    episodes: VideoEpisode[]
  }>
}

export type VideoListResult = {
  page: number
  pageCount: number
  limit: number
  total: number
  list: VideoListItem[]
  categories: VideoCategory[]
  sourceId: string
  sourceName: string
  fallbackFrom?: string
}
