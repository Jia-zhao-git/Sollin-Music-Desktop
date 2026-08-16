export type NovelSourceId = 'qimao' | 'kuwo' | 'jiujiu9191' | 'boluomao' | 'sto66' | 'youshu95590' | 'shuhuangw' | 'shu52' | 'local'

export type NovelSource = {
  id: NovelSourceId
  name: string
  url: string
  group?: string
  note?: string
}

export type NovelCategory = {
  id: string
  name: string
  sourceId?: NovelSourceId
  group?: string
}

export type NovelListItem = {
  id: string
  rawId: string
  sourceId: NovelSourceId
  sourceName: string
  name: string
  author?: string
  cover?: string
  intro?: string
  category?: string
  status?: string
  latestChapter?: string
  wordCount?: string
  score?: string
  tags?: string[]
}

export type NovelChapter = {
  id: string
  title: string
  url?: string
  words?: string
  index?: number
}

export type NovelDetail = NovelListItem & {
  updateTime?: string
  downloadUrl?: string
  chapters: NovelChapter[]
}

export type NovelDownloadedBook = {
  id: string
  title: string
  sourceName: string
  content: string
  downloadedAt: number
}

/** 本地导入书籍的单章内容（含正文）。 */
export type LocalChapter = {
  id: string
  title: string
  content: string
}

/** 本地导入的书籍（TXT），整体随书架持久化在本地。 */
export type LocalBook = {
  id: string
  name: string
  author?: string
  cover?: string
  sourceName: '本地导入'
  chapters: LocalChapter[]
  importedAt: number
  format: 'txt'
}

export type NovelListResult = {
  page: number
  pageCount: number
  total: number
  list: NovelListItem[]
  categories: NovelCategory[]
  sourceId: NovelSourceId
  sourceName: string
}

export type NovelReaderResult = {
  bookId: string
  sourceId: NovelSourceId
  chapterId: string
  title: string
  content: string
  prevChapterId?: string
  nextChapterId?: string
}
