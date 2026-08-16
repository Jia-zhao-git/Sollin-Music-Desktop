/**
 * 缓存服务 - 用于缓存 API 数据减少加载时间
 *
 * Data entries live in memory only (avoids localStorage quota fights with settings).
 * Settings are small and still persisted via app store / localStorage fallback.
 */

import { readAppDoc, writeAppDoc } from '@/services/persistentStorage'

interface CacheItem<T> {
  data: T
  timestamp: number
  expiry: number // 过期时间（毫秒）
}

export interface DataCacheSettings {
  enabled: boolean
  maxSizeMB: number
}

const CACHE_SETTINGS_DOC = 'cache-settings'
const DEFAULT_DATA_CACHE_SETTINGS: DataCacheSettings = {
  enabled: true,
  maxSizeMB: 32,
}

// 默认过期时间
const DEFAULT_EXPIRY = {
  toplists: 2 * 60 * 60 * 1000,         // 排行榜列表: 2小时
  toplistsV2: 2 * 60 * 60 * 1000,       // 排行榜列表 v2: 2小时
  toplistSongs: 2 * 60 * 60 * 1000,     // 排行榜歌曲: 2小时
  toplistSongsV2: 2 * 60 * 60 * 1000,   // 排行榜歌曲 v2: 2小时
  recommendPlaylists: 2 * 60 * 60 * 1000, // 推荐歌单: 2小时
  playlistTags: 24 * 60 * 60 * 1000,    // 歌单分类: 24小时
  playlistDetail: 2 * 60 * 60 * 1000,   // 歌单详情: 2小时
  albumDetail: 2 * 60 * 60 * 1000,      // 专辑详情: 2小时
  search: 5 * 60 * 1000,                // 搜索结果: 5分钟
  songUrl: 60 * 60 * 1000,              // 歌曲URL: 1小时
  lyrics: 24 * 60 * 60 * 1000,          // 歌词: 24小时
  lyricData: 24 * 60 * 60 * 1000,       // 多通道歌词: 24小时
  songComments: 10 * 60 * 1000,         // 歌曲评论: 10分钟
  songHotComments: 10 * 60 * 1000,      // 热门评论: 10分钟
}

function normalizeSettings(raw: Partial<DataCacheSettings> | null | undefined): DataCacheSettings {
  return {
    enabled: raw?.enabled !== false,
    maxSizeMB: Number.isFinite(raw?.maxSizeMB) && Number(raw?.maxSizeMB) > 0
      ? Number(raw?.maxSizeMB)
      : DEFAULT_DATA_CACHE_SETTINGS.maxSizeMB,
  }
}

class CacheService {
  private memoryCache: Map<string, CacheItem<any>> = new Map()
  private settings: DataCacheSettings = { ...DEFAULT_DATA_CACHE_SETTINGS }
  private settingsLoaded = false

  constructor() {
    void this.loadSettingsAsync()
  }

  private async loadSettingsAsync() {
    try {
      const fromStore = await readAppDoc<Partial<DataCacheSettings>>(CACHE_SETTINGS_DOC)
      if (fromStore) {
        this.settings = normalizeSettings(fromStore)
        this.settingsLoaded = true
        return
      }

      // One-shot legacy localStorage settings
      if (typeof window !== 'undefined' && window.localStorage) {
        const legacy = window.localStorage.getItem('sollin-cache-settings-v1')
        if (legacy) {
          try {
            this.settings = normalizeSettings(JSON.parse(legacy))
            await writeAppDoc(CACHE_SETTINGS_DOC, this.settings)
            window.localStorage.removeItem('sollin-cache-settings-v1')
          } catch {
            // ignore bad legacy payload
          }
        }
      }
    } catch (error) {
      console.error('[cache] load settings failed:', error)
    } finally {
      this.settingsLoaded = true
    }
  }

  private persistSettings(): void {
    void writeAppDoc(CACHE_SETTINGS_DOC, this.settings)
  }

  getSettings(): DataCacheSettings {
    return { ...this.settings }
  }

  updateSettings(next: Partial<DataCacheSettings>): DataCacheSettings {
    this.settings = {
      enabled: typeof next.enabled === 'boolean' ? next.enabled : this.settings.enabled,
      maxSizeMB: Number.isFinite(next.maxSizeMB) && Number(next.maxSizeMB) > 0
        ? Number(next.maxSizeMB)
        : this.settings.maxSizeMB,
    }
    this.persistSettings()
    if (!this.settings.enabled) {
      this.clearAll()
    } else {
      this.enforceLimits()
    }
    return this.getSettings()
  }

  isEnabled(): boolean {
    return this.settings.enabled
  }

  /**
   * 生成缓存键
   */
  private getKey(type: string, ...args: (string | number)[]): string {
    return `${type}-${args.join('-')}`
  }

  /**
   * 从缓存获取数据（仅内存）
   */
  get<T>(type: string, ...args: (string | number)[]): T | null {
    if (!this.settings.enabled) return null
    const key = this.getKey(type, ...args)

    const memoryItem = this.memoryCache.get(key)
    if (memoryItem && Date.now() < memoryItem.timestamp + memoryItem.expiry) {
      return memoryItem.data as T
    }
    if (memoryItem) {
      this.memoryCache.delete(key)
    }

    return null
  }

  /**
   * 设置缓存（仅内存）
   */
  set<T>(type: string, data: T, expiry?: number, ...args: (string | number)[]): void {
    if (!this.settings.enabled) return
    const key = this.getKey(type, ...args)
    const defaultExpiry = DEFAULT_EXPIRY[type as keyof typeof DEFAULT_EXPIRY] || 5 * 60 * 1000

    const item: CacheItem<T> = {
      data,
      timestamp: Date.now(),
      expiry: expiry || defaultExpiry,
    }

    this.memoryCache.set(key, item)
    this.enforceLimits()
  }

  /**
   * 删除特定缓存
   */
  remove(type: string, ...args: (string | number)[]): void {
    const key = this.getKey(type, ...args)
    this.memoryCache.delete(key)
  }

  /**
   * 清理过期缓存
   */
  cleanup(): void {
    const now = Date.now()
    for (const [key, item] of this.memoryCache.entries()) {
      if (now >= item.timestamp + item.expiry) {
        this.memoryCache.delete(key)
      }
    }
  }

  private estimateEntrySize(item: CacheItem<any>): number {
    try {
      return JSON.stringify(item.data).length
    } catch {
      return 1024
    }
  }

  enforceLimits(): void {
    if (!this.settings.enabled) {
      this.clearAll()
      return
    }

    this.cleanup()
    const maxBytes = this.settings.maxSizeMB * 1024 * 1024
    type Entry = { key: string; size: number; timestamp: number }
    const entries: Entry[] = []
    let totalSize = 0
    for (const [key, item] of this.memoryCache.entries()) {
      const size = this.estimateEntrySize(item)
      totalSize += size
      entries.push({ key, size, timestamp: item.timestamp || 0 })
    }
    if (totalSize <= maxBytes) return

    entries.sort((left, right) => left.timestamp - right.timestamp)
    for (const entry of entries) {
      this.memoryCache.delete(entry.key)
      totalSize -= entry.size
      if (totalSize <= maxBytes) break
    }
  }

  /**
   * 清除所有缓存
   */
  clearAll(): void {
    this.memoryCache.clear()
    // Best-effort: drop any leftover legacy localStorage cache keys from older builds
    try {
      if (typeof window === 'undefined' || !window.localStorage) return
      const keysToRemove: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key?.startsWith('sollin-cache-')) keysToRemove.push(key)
      }
      keysToRemove.forEach((key) => localStorage.removeItem(key))
    } catch {
      // ignore
    }
  }

  /**
   * 获取缓存大小（大约）
   */
  getCacheSize(): string {
    return this.formatSize(this.getCacheSizeBytes())
  }

  getCacheSizeBytes(): number {
    let total = 0
    for (const item of this.memoryCache.values()) {
      total += this.estimateEntrySize(item)
    }
    return total
  }

  formatSize(size: number): string {
    if (size < 1024) return `${size} B`
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
    return `${(size / (1024 * 1024)).toFixed(2)} MB`
  }

  /** @internal diagnostics */
  isSettingsLoaded(): boolean {
    return this.settingsLoaded
  }
}

export const cache = new CacheService()
export default cache
