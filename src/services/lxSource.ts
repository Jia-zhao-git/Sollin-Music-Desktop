import type { AudioQuality, Song, SongPlatform } from '@/types'
import { isAudioQuality } from '@/constants/audio'
import { formatTime } from '@/utils/format'
import type { LxBackupState } from '@/types/backup'
import { webLxSourceRuntime, type LxWebRequestPayload } from './lxSourceWeb/webLxSourceRuntime'

export interface LxSourceScriptInfo {
  name: string
  description: string
  author: string
  homepage: string
  version: string
}

export interface LxSourceScriptSourceInfo {
  type: string
  actions: string[]
  qualitys: string[]
}

export interface LxManagedSource {
  id: string
  type: 'local' | 'url'
  path: string
  url: string | null
  importedAt: number
  allowShowUpdateAlert: boolean
  exists: boolean
  isActive: boolean
  scriptInfo: LxSourceScriptInfo
}

export interface LxSourceUpdateAlert {
  sourceId: string | null
  name: string
  description: string
  version: string
  scriptUrl: string | null
  updateUrl?: string
  log: string
}

export interface LxSourceStatus {
  available: boolean
  activeSourceId: string | null
  configuredPath: string | null
  autoDetectedPath: string | null
  scriptPath: string | null
  scriptUrl: string | null
  scriptExists: boolean
  runtimeReady: boolean
  scriptLoaded: boolean
  allowShowUpdateAlert: boolean
  scriptInfo: LxSourceScriptInfo | null
  managedSources: LxManagedSource[]
  supportedSources: Record<string, LxSourceScriptSourceInfo>
  lastError: string | null
}

const createUnavailableStatus = (): LxSourceStatus => ({
  available: false,
  activeSourceId: null,
  configuredPath: null,
  autoDetectedPath: null,
  scriptPath: null,
  scriptUrl: null,
  scriptExists: false,
  runtimeReady: false,
  scriptLoaded: false,
  allowShowUpdateAlert: true,
  scriptInfo: null,
  managedSources: [],
  supportedSources: {},
  lastError: null,
})

const mapPlatformToLx = (platform: SongPlatform): 'wy' | 'tx' | 'kw' | 'kg' | 'mg' => {
  switch (platform) {
    case 'netease':
      return 'wy'
    case 'qq':
      return 'tx'
    case 'kuwo':
      return 'kw'
    case 'kugou':
      return 'kg'
    case 'migu':
      return 'mg'
    default:
      throw new Error(`Unsupported LX source platform: ${platform}`)
  }
}

const normalizeResultUrl = (result: any): string | null => {
  const url = result?.data?.url || result?.url || result?.body?.data?.url
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) return url
  return null
}

const normalizeResultQuality = (result: any, fallback: AudioQuality): AudioQuality => {
  const type = result?.data?.type || result?.type || result?.body?.data?.type
  return isAudioQuality(type) ? type : fallback
}

const normalizeManagedSource = (raw: Partial<LxManagedSource> | null | undefined): LxManagedSource | null => {
  if (!raw?.id || !raw?.path || !raw?.scriptInfo) return null
  return {
    id: raw.id,
    type: raw.type === 'url' ? 'url' : 'local',
    path: raw.path,
    url: typeof raw.url === 'string' && raw.url.trim() ? raw.url.trim() : null,
    importedAt: typeof raw.importedAt === 'number' ? raw.importedAt : Date.now(),
    allowShowUpdateAlert: typeof raw.allowShowUpdateAlert === 'boolean' ? raw.allowShowUpdateAlert : true,
    exists: Boolean(raw.exists),
    isActive: Boolean(raw.isActive),
    scriptInfo: {
      name: raw.scriptInfo.name || '未知脚本',
      description: raw.scriptInfo.description || '',
      author: raw.scriptInfo.author || '',
      homepage: raw.scriptInfo.homepage || '',
      version: raw.scriptInfo.version || '',
    },
  }
}

const normalizeUpdateAlert = (raw: Partial<LxSourceUpdateAlert> | null | undefined): LxSourceUpdateAlert | null => {
  if (!raw || typeof raw.log !== 'string' || !raw.log.trim()) return null
  return {
    sourceId: typeof raw.sourceId === 'string' && raw.sourceId.trim() ? raw.sourceId.trim() : null,
    name: typeof raw.name === 'string' ? raw.name : 'LX 音源',
    description: typeof raw.description === 'string' ? raw.description : '',
    version: typeof raw.version === 'string' ? raw.version : '',
    scriptUrl: typeof raw.scriptUrl === 'string' && raw.scriptUrl.trim() ? raw.scriptUrl.trim() : null,
    updateUrl: typeof raw.updateUrl === 'string' && raw.updateUrl.trim() ? raw.updateUrl.trim() : undefined,
    log: raw.log.trim(),
  }
}

const buildMusicInfo = (song: Song) => {
  const meta = song.lx
  return {
    name: song.name,
    singer: song.artist,
    source: mapPlatformToLx(song.platform),
    songmid: meta?.songmid || song.id,
    songId: meta?.songId,
    interval: meta?.interval || formatTime(song.duration),
    albumName: meta?.albumName || song.album,
    albumId: meta?.albumId || song.albumId || '',
    albumMid: meta?.albumMid,
    strMediaMid: meta?.strMediaMid,
    hash: meta?.hash,
    copyrightId: meta?.copyrightId,
    img: meta?.img || song.cover || '',
    lrcUrl: meta?.lrcUrl,
    mrcUrl: meta?.mrcUrl,
    trcUrl: meta?.trcUrl,
    types: meta?.types || [],
    _types: meta?._types || {},
    typeUrl: {},
  }
}

class LxSourceService {
  private getElectronApi() {
    return typeof window !== 'undefined' ? window.electronAPI : undefined
  }

  /**
   * Mobile / browser builds have no Electron IPC — delegate to the in-renderer
   * LX source runtime (Web Worker sandbox + IndexedDB persistence).
   */
  private getWebRuntime() {
    if (typeof window === 'undefined') return null
    if (this.getElectronApi()?.getLxSourceStatus) return null
    return webLxSourceRuntime
  }

  private normalizeStatus(raw: Partial<Omit<LxSourceStatus, 'available'>> | null | undefined): LxSourceStatus {
    return {
      ...createUnavailableStatus(),
      ...raw,
      available: true,
      activeSourceId: typeof raw?.activeSourceId === 'string' ? raw.activeSourceId : null,
      scriptUrl: raw?.scriptUrl || null,
      allowShowUpdateAlert: typeof raw?.allowShowUpdateAlert === 'boolean' ? raw.allowShowUpdateAlert : true,
      managedSources: Array.isArray(raw?.managedSources)
        ? raw.managedSources.map((item) => normalizeManagedSource(item)).filter((item): item is LxManagedSource => Boolean(item))
        : [],
      supportedSources: raw?.supportedSources || {},
      scriptInfo: raw?.scriptInfo || null,
      lastError: raw?.lastError || null,
    }
  }

  async getStatus(): Promise<LxSourceStatus> {
    const web = this.getWebRuntime()
    if (web) return web.getStatus()
    const electronApi = this.getElectronApi()
    if (!electronApi?.getLxSourceStatus) return createUnavailableStatus()
    return this.normalizeStatus(await electronApi.getLxSourceStatus())
  }

  async setScriptPath(path: string): Promise<LxSourceStatus> {
    const web = this.getWebRuntime()
    if (web) return web.setScriptPath(path)
    const electronApi = this.getElectronApi()
    if (!electronApi?.setLxSourceScriptPath) throw new Error('LX_SOURCE_UNAVAILABLE')
    return this.normalizeStatus(await electronApi.setLxSourceScriptPath(path))
  }

  async clearScriptPath(): Promise<LxSourceStatus> {
    const web = this.getWebRuntime()
    if (web) return web.clearScriptPath()
    return this.setScriptPath('')
  }

  async pickScriptPath(): Promise<string | null> {
    const web = this.getWebRuntime()
    if (web) return web.pickScriptPath()
    const electronApi = this.getElectronApi()
    if (!electronApi?.pickLxSourceScriptPath) throw new Error('LX_SOURCE_UNAVAILABLE')
    return electronApi.pickLxSourceScriptPath()
  }

  async importScriptFolder(path: string): Promise<LxSourceStatus> {
    const web = this.getWebRuntime()
    if (web) return web.importScriptFolder(path)
    const electronApi = this.getElectronApi()
    if (!electronApi?.importLxSourceScriptFolder) throw new Error('LX_SOURCE_UNAVAILABLE')
    return this.normalizeStatus(await electronApi.importLxSourceScriptFolder(path))
  }

  async importScriptFile(name: string, script: string): Promise<LxSourceStatus> {
    const web = this.getWebRuntime()
    if (web) return web.importScriptFile(name, script)
    throw new Error('LX_SOURCE_UNAVAILABLE')
  }

  async testSource(sourceId?: string | null): Promise<LxSourceStatus> {
    const web = this.getWebRuntime()
    if (web) return web.testSource(sourceId)
    const electronApi = this.getElectronApi()
    if (!electronApi?.testLxSource) throw new Error('LX_SOURCE_UNAVAILABLE')
    return this.normalizeStatus(await electronApi.testLxSource(sourceId ?? null))
  }

  async importScriptUrl(url: string): Promise<LxSourceStatus> {
    const web = this.getWebRuntime()
    if (web) return web.importScriptUrl(url)
    const electronApi = this.getElectronApi()
    if (!electronApi?.importLxSourceScriptUrl) throw new Error('LX_SOURCE_UNAVAILABLE')
    return this.normalizeStatus(await electronApi.importLxSourceScriptUrl(url))
  }

  async exportBackupState(): Promise<LxBackupState> {
    const web = this.getWebRuntime()
    if (web) return web.exportBackupState()
    const electronApi = this.getElectronApi()
    if (!electronApi?.exportLxSourceBackupState) {
      return { sources: [], activeSourceId: null }
    }
    const payload = await electronApi.exportLxSourceBackupState()
    return {
      sources: Array.isArray(payload?.sources) ? payload.sources : [],
      activeSourceId: typeof payload?.activeSourceId === 'string' ? payload.activeSourceId : null,
    }
  }

  async restoreBackupState(payload: LxBackupState): Promise<LxSourceStatus> {
    const web = this.getWebRuntime()
    if (web) return web.restoreBackupState(payload)
    const electronApi = this.getElectronApi()
    if (!electronApi?.restoreLxSourceBackupState) throw new Error('LX_SOURCE_UNAVAILABLE')
    return this.normalizeStatus(await electronApi.restoreLxSourceBackupState(payload))
  }

  async setAllowShowUpdateAlert(enable: boolean): Promise<LxSourceStatus> {
    const web = this.getWebRuntime()
    if (web) return web.setAllowShowUpdateAlert(enable)
    const electronApi = this.getElectronApi()
    if (!electronApi?.setLxSourceAllowUpdateAlert) throw new Error('LX_SOURCE_UNAVAILABLE')
    return this.normalizeStatus(await electronApi.setLxSourceAllowUpdateAlert(enable))
  }

  async setSourceAllowUpdateAlert(sourceId: string, enable: boolean): Promise<LxSourceStatus> {
    const web = this.getWebRuntime()
    if (web) return web.setSourceAllowUpdateAlert(sourceId, enable)
    const electronApi = this.getElectronApi()
    if (!electronApi?.setLxSourceItemAllowUpdateAlert) throw new Error('LX_SOURCE_UNAVAILABLE')
    return this.normalizeStatus(await electronApi.setLxSourceItemAllowUpdateAlert(sourceId, enable))
  }

  async setActiveSource(sourceId: string | null): Promise<LxSourceStatus> {
    const web = this.getWebRuntime()
    if (web) return web.setActiveSource(sourceId)
    const electronApi = this.getElectronApi()
    if (!electronApi?.setLxSourceActiveSource) throw new Error('LX_SOURCE_UNAVAILABLE')
    return this.normalizeStatus(await electronApi.setLxSourceActiveSource(sourceId))
  }

  async removeSource(sourceId: string): Promise<LxSourceStatus> {
    const web = this.getWebRuntime()
    if (web) return web.removeSource(sourceId)
    const electronApi = this.getElectronApi()
    if (!electronApi?.removeLxSourceItem) throw new Error('LX_SOURCE_UNAVAILABLE')
    return this.normalizeStatus(await electronApi.removeLxSourceItem(sourceId))
  }

  async consumeUpdateAlerts(): Promise<LxSourceUpdateAlert[]> {
    const web = this.getWebRuntime()
    if (web) return web.consumeUpdateAlerts()
    const electronApi = this.getElectronApi()
    if (!electronApi?.consumeLxSourceUpdateAlerts) return []
    const alerts = await electronApi.consumeLxSourceUpdateAlerts()
    return Array.isArray(alerts)
      ? alerts.map((item) => normalizeUpdateAlert(item)).filter((item): item is LxSourceUpdateAlert => Boolean(item))
      : []
  }

  onUpdateAlert(callback: (alert: LxSourceUpdateAlert) => void): () => void {
    const web = this.getWebRuntime()
    if (web) return web.onUpdateAlert(callback)
    const electronApi = this.getElectronApi()
    if (!electronApi?.onLxSourceUpdateAlert) return () => undefined
    return electronApi.onLxSourceUpdateAlert((payload) => {
      const alert = normalizeUpdateAlert(payload as Partial<LxSourceUpdateAlert> | null | undefined)
      if (alert) callback(alert)
    })
  }

  async getSongUrl(song: Song, quality: AudioQuality, options?: { sourceId?: string | null }) {
    if (song.platform === 'local') throw new Error('LX_SOURCE_UNSUPPORTED_PLATFORM')

    const requestPayload: LxWebRequestPayload = {
      source: mapPlatformToLx(song.platform),
      action: 'musicUrl',
      info: {
        type: quality,
        musicInfo: buildMusicInfo(song),
      },
    }

    const web = this.getWebRuntime()
    if (web) {
      const result = await web.request(requestPayload, options?.sourceId ?? null)
      const url = normalizeResultUrl(result)
      if (!url) return null
      return {
        url,
        quality: normalizeResultQuality(result, quality),
      }
    }

    const electronApi = this.getElectronApi()
    if (!electronApi?.requestLxSource) throw new Error('LX_SOURCE_UNAVAILABLE')

    const result = await electronApi.requestLxSource({
      sourceId: options?.sourceId ?? undefined,
      ...requestPayload,
    })

    const url = normalizeResultUrl(result)
    if (!url) return null

    return {
      url,
      quality: normalizeResultQuality(result, quality),
    }
  }
}

export const lxSourceApi = new LxSourceService()
export default lxSourceApi
