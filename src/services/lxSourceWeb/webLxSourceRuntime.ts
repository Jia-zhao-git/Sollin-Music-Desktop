/**
 * Web LX source runtime (mobile / browser builds).
 *
 * Mirrors the Electron-backed LX source service entirely in the renderer:
 *  - sources are persisted in IndexedDB (via localforage) instead of the
 *    filesystem,
 *  - scripts run inside a Web Worker sandbox (lxSandbox.worker.ts) instead of
 *    a hidden Electron BrowserWindow,
 *  - HTTP is bridged through httpClient (CapacitorHttp on native, dev proxy in
 *    browser dev) to bypass CORS.
 */

import localforage from 'localforage'
import httpClient from '@/services/httpClient'
import type { LxBackupState, BackupLxSource } from '@/types/backup'
import type { LxManagedSource, LxSourceScriptInfo, LxSourceStatus, LxSourceUpdateAlert } from '@/services/lxSource'
import type { LxSandboxScriptInfo } from './sandboxEnv'

export type LxWebSourceName = 'wy' | 'tx' | 'kw' | 'kg' | 'mg'

export type LxWebRequestPayload = {
  source: LxWebSourceName
  action: 'musicUrl'
  info: {
    type: string
    musicInfo: any
  }
}

type WebSourceRecord = {
  id: string
  type: 'local' | 'url'
  url: string | null
  importedAt: number
  allowShowUpdateAlert: boolean
  scriptInfo: LxSourceScriptInfo
}

type WebConfig = {
  activeSourceId: string | null
  sources: WebSourceRecord[]
  allowShowUpdateAlert: boolean
}

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

type UpdateAlertListener = (alert: LxSourceUpdateAlert) => void

const MAX_SCRIPT_BYTES = 9_000_000
const INIT_TIMEOUT_MS = 15000
const REQUEST_TIMEOUT_MS = 20000

const store = localforage.createInstance({
  name: 'Sollin',
  storeName: 'Sollin_lx_source_web',
  description: 'Web LX source scripts and config',
})

const CONFIG_KEY = 'config'
const scriptKey = (sourceId: string) => `script:${sourceId}`

const sanitizeErrorMessage = (error: unknown) => {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  return String(error)
}

const parseScriptInfo = (script: string, fallbackName?: string): LxSourceScriptInfo => {
  const commentBlock = /^\/\*[\s\S]+?\*\//.exec(script)
  if (!commentBlock) {
    throw new Error('无效的 LX 音源脚本')
  }

  const info: LxSourceScriptInfo = {
    name: '',
    description: '',
    author: '',
    homepage: '',
    version: '',
  }

  const lines = commentBlock[0].split(/\r?\n/)
  const matcher = /^\s?\*\s?@(\w+)\s(.+)$/
  for (const line of lines) {
    const result = matcher.exec(line)
    if (!result) continue
    const key = result[1] as keyof LxSourceScriptInfo
    if (!(key in info)) continue
    const nextValue = result[2].trim()
    if (nextValue.length > 200) info[key] = `${nextValue.slice(0, 200)}...`
    else info[key] = nextValue
  }

  if (!info.name) {
    info.name = fallbackName || 'lx-source.js'
  }

  return info
}

const createSourceId = () => `lx_web_source_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

const normalizeImportedUrl = (rawUrl: string) => {
  const value = rawUrl.trim()
  if (!/^https?:\/\//i.test(value)) {
    throw new Error('请输入有效的音源 URL')
  }
  return new URL(value).toString()
}

const getScriptByteLength = (script: string) => new TextEncoder().encode(script).length

const fallbackNameFromUrl = (url: string) => {
  const pathname = new URL(url).pathname
  return pathname.split('/').pop() || 'lx-source.js'
}

const sanitizeBackupSource = (raw: unknown): BackupLxSource | null => {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Partial<BackupLxSource>
  const info = source.info && typeof source.info === 'object' ? source.info : null
  const rawScript = typeof info?.rawScript === 'string' ? info.rawScript.trim() : ''
  if (!rawScript) return null

  return {
    id: typeof source.id === 'string' && source.id.trim() ? source.id.trim() : createSourceId(),
    info: {
      name: typeof info?.name === 'string' ? info.name : '',
      description: typeof info?.description === 'string' ? info.description : undefined,
      version: typeof info?.version === 'string' ? info.version : undefined,
      author: typeof info?.author === 'string' ? info.author : undefined,
      homepage: typeof info?.homepage === 'string' ? info.homepage : undefined,
      rawScript,
    },
    addedAt: typeof source.addedAt === 'string' && Number.isFinite(Date.parse(source.addedAt))
      ? source.addedAt
      : new Date().toISOString(),
    isActive: Boolean(source.isActive),
    allowShowUpdateAlert: typeof source.allowShowUpdateAlert === 'boolean' ? source.allowShowUpdateAlert : true,
  }
}

class WebLxSourceRuntime {
  private sources: WebSourceRecord[] = []
  private activeSourceId: string | null = null
  private allowShowUpdateAlert = true
  private storedScriptIds = new Set<string>()
  private loadedPromise: Promise<void> | null = null

  private worker: Worker | null = null
  private sandboxSourceId: string | null = null
  private sandboxReady = false
  private supportedSources: LxSourceStatus['supportedSources'] = {}
  private lastError: string | null = null

  private operationQueue: Promise<unknown> = Promise.resolve()
  private pendingRequests = new Map<string, PendingRequest>()
  private nextRequestId = 1
  private pendingUpdateAlerts: LxSourceUpdateAlert[] = []
  private readonly updateAlertListeners = new Set<UpdateAlertListener>()

  /* ---------- persistence ---------- */

  private async ensureLoaded(): Promise<void> {
    if (!this.loadedPromise) {
      this.loadedPromise = this.loadFromStore()
    }
    return this.loadedPromise
  }

  private async loadFromStore(): Promise<void> {
    try {
      const config = await store.getItem<WebConfig>(CONFIG_KEY)
      const nextSources = Array.isArray(config?.sources)
        ? config.sources
          .map((raw) => this.normalizeSourceRecord(raw))
          .filter((source): source is WebSourceRecord => Boolean(source))
        : []
      this.sources = [...nextSources].sort((left, right) => right.importedAt - left.importedAt)
      this.activeSourceId = typeof config?.activeSourceId === 'string' && nextSources.some((item) => item.id === config.activeSourceId)
        ? config.activeSourceId
        : nextSources[0]?.id || null
      this.allowShowUpdateAlert = typeof config?.allowShowUpdateAlert === 'boolean' ? config.allowShowUpdateAlert : true
      this.storedScriptIds = new Set(await this.collectStoredScriptIds())
    } catch (error) {
      console.warn('[lxSourceWeb] load config failed:', error)
    }
  }

  private async collectStoredScriptIds(): Promise<string[]> {
    try {
      const keys = await store.keys()
      return keys.filter((key) => key.startsWith('script:')).map((key) => key.slice('script:'.length))
    } catch {
      return []
    }
  }

  private normalizeSourceRecord(raw: Partial<WebSourceRecord> | null | undefined): WebSourceRecord | null {
    if (!raw?.id || !raw?.scriptInfo) return null
    return {
      id: raw.id,
      type: raw.type === 'url' ? 'url' : 'local',
      url: typeof raw.url === 'string' && raw.url.trim() ? raw.url.trim() : null,
      importedAt: typeof raw.importedAt === 'number' ? raw.importedAt : Date.now(),
      allowShowUpdateAlert: typeof raw.allowShowUpdateAlert === 'boolean' ? raw.allowShowUpdateAlert : true,
      scriptInfo: {
        name: raw.scriptInfo.name || '未知脚本',
        description: raw.scriptInfo.description || '',
        author: raw.scriptInfo.author || '',
        homepage: raw.scriptInfo.homepage || '',
        version: raw.scriptInfo.version || '',
      },
    }
  }

  private async persistConfig(): Promise<void> {
    try {
      await store.setItem<WebConfig>(CONFIG_KEY, {
        activeSourceId: this.activeSourceId,
        sources: this.sources,
        allowShowUpdateAlert: this.allowShowUpdateAlert,
      })
    } catch (error) {
      console.warn('[lxSourceWeb] persist config failed:', error)
    }
  }

  private async saveScript(sourceId: string, script: string): Promise<void> {
    await store.setItem(scriptKey(sourceId), script)
    this.storedScriptIds.add(sourceId)
  }

  private async readScript(sourceId: string): Promise<string | null> {
    const script = await store.getItem<string>(scriptKey(sourceId))
    return typeof script === 'string' && script.trim() ? script : null
  }

  private async removeScript(sourceId: string): Promise<void> {
    try {
      await store.removeItem(scriptKey(sourceId))
    } catch {
      // ignore
    }
    this.storedScriptIds.delete(sourceId)
  }

  /* ---------- helpers ---------- */

  private runInQueue<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.operationQueue.catch(() => undefined)
    const current = previous.then(task, task)
    this.operationQueue = current.then(() => undefined, () => undefined)
    return current
  }

  private getSourceById(sourceId: string | null | undefined): WebSourceRecord | null {
    if (!sourceId) return null
    return this.sources.find((source) => source.id === sourceId) || null
  }

  private setSources(nextSources: WebSourceRecord[]) {
    this.sources = [...nextSources].sort((left, right) => right.importedAt - left.importedAt)
  }

  private upsertSource(nextSource: WebSourceRecord) {
    this.setSources([
      nextSource,
      ...this.sources.filter((source) => source.id !== nextSource.id),
    ])
  }

  private createPseudoPath(sourceId: string) {
    return `web://source/${sourceId}`
  }

  private buildStatus(overrides?: Partial<LxSourceStatus>): LxSourceStatus {
    const activeSource = this.getSourceById(this.activeSourceId)
    const activeExists = Boolean(activeSource && this.storedScriptIds.has(activeSource.id))
    const status: LxSourceStatus = {
      available: true,
      activeSourceId: this.activeSourceId,
      configuredPath: null,
      autoDetectedPath: null,
      scriptPath: activeSource ? this.createPseudoPath(activeSource.id) : null,
      scriptUrl: activeSource?.url || null,
      scriptExists: activeExists,
      runtimeReady: this.sandboxReady && this.sandboxSourceId === this.activeSourceId,
      scriptLoaded: this.sandboxReady && this.sandboxSourceId === this.activeSourceId,
      allowShowUpdateAlert: activeSource ? activeSource.allowShowUpdateAlert : this.allowShowUpdateAlert,
      scriptInfo: activeSource ? { ...activeSource.scriptInfo } : null,
      managedSources: this.sources.map((source) => {
        const managed: LxManagedSource = {
          id: source.id,
          type: source.type,
          path: this.createPseudoPath(source.id),
          url: source.url,
          importedAt: source.importedAt,
          allowShowUpdateAlert: source.allowShowUpdateAlert,
          exists: this.storedScriptIds.has(source.id),
          isActive: source.id === this.activeSourceId,
          scriptInfo: { ...source.scriptInfo },
        }
        return managed
      }),
      supportedSources: Object.fromEntries(
        Object.entries(this.supportedSources).map(([key, value]) => [key, {
          type: value.type,
          actions: [...value.actions],
          qualitys: [...value.qualitys],
        }]),
      ),
      lastError: this.lastError,
    }
    return { ...status, ...(overrides || {}) }
  }

  /* ---------- worker / sandbox ---------- */

  private createWorker(): Worker {
    const worker = new Worker(new URL('./lxSandbox.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent) => {
      const message = event.data as Record<string, any>
      if (!message || typeof message.type !== 'string') return
      switch (message.type) {
        case 'inited':
          this.handleInited(message)
          return
        case 'requestResult':
          this.handleRequestResult(message)
          return
        case 'updateAlert':
          this.handleUpdateAlert(message.data)
          return
        case 'http':
          void this.handleWorkerHttp(message)
          return
        case 'scriptError':
          console.warn('[lxSourceWeb] sandbox script error:', message.message)
          return
      }
    }
    worker.onerror = (event) => {
      console.warn('[lxSourceWeb] sandbox worker error:', event.message)
      this.rejectAllPending(new Error(event.message || 'LX 音源沙箱错误'))
    }
    return worker
  }

  private handleInited(message: Record<string, any>) {
    const initId = message.initId as number
    const pending = this.pendingRequests.get(`init:${initId}`)
    if (!pending) return
    this.pendingRequests.delete(`init:${initId}`)
    clearTimeout(pending.timer)

    if (message.ok) {
      this.sandboxReady = true
      this.lastError = null
      this.supportedSources = this.normalizeSupportedSources(message.sources)
      pending.resolve(undefined)
    } else {
      this.sandboxReady = false
      const errorMessage = String(message.error || 'LX 音源脚本初始化失败')
      this.lastError = errorMessage
      pending.reject(new Error(errorMessage))
    }
  }

  private handleRequestResult(message: Record<string, any>) {
    const requestId = message.requestId as string
    const pending = this.pendingRequests.get(requestId)
    if (!pending) return
    this.pendingRequests.delete(requestId)
    clearTimeout(pending.timer)

    if (message.ok) {
      pending.resolve(message.result)
    } else {
      pending.reject(new Error(String(message.error || 'LX 音源请求失败')))
    }
  }

  private handleUpdateAlert(data: unknown) {
    if (!this.allowShowUpdateAlert) return
    const raw = (data || {}) as Record<string, unknown>
    const log = typeof raw.log === 'string' ? raw.log.trim() : ''
    if (!log) return

    const activeSource = this.getSourceById(this.activeSourceId)
    const alert: LxSourceUpdateAlert = {
      sourceId: this.activeSourceId,
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : activeSource?.scriptInfo.name || 'LX 音源',
      description: typeof raw.description === 'string' ? raw.description : activeSource?.scriptInfo.description || '',
      version: typeof raw.version === 'string' ? raw.version : activeSource?.scriptInfo.version || '',
      scriptUrl: activeSource?.url || null,
      log,
    }
    if (typeof raw.updateUrl === 'string' && raw.updateUrl.trim()) {
      alert.updateUrl = raw.updateUrl.trim()
    }
    this.pendingUpdateAlerts.push(alert)
    for (const listener of this.updateAlertListeners) {
      try {
        listener(alert)
      } catch {
        // ignore listener errors
      }
    }
  }

  private normalizeSupportedSources(raw: unknown): LxSourceStatus['supportedSources'] {
    const result: LxSourceStatus['supportedSources'] = {}
    const candidate = raw && typeof raw === 'object' ? raw as Record<string, any> : {}
    const record = candidate.sources && typeof candidate.sources === 'object'
      ? candidate.sources as Record<string, any>
      : candidate
    for (const [key, value] of Object.entries(record)) {
      if (!value || typeof value !== 'object') continue
      const entry = value as Record<string, any>
      result[key] = {
        type: typeof entry.type === 'string' ? entry.type : 'music',
        actions: Array.isArray(entry.actions) ? entry.actions.map(String) : [],
        qualitys: Array.isArray(entry.qualitys) ? entry.qualitys.map(String) : [],
      }
    }
    return result
  }

  private async handleWorkerHttp(message: Record<string, any>) {
    const httpId = message.httpId as number
    try {
      const response = await httpClient.request({
        url: String(message.url),
        method: message.options?.method,
        headers: message.options?.headers,
        body: message.options?.body,
        timeoutMs: typeof message.options?.timeout === 'number' ? message.options.timeout : 20000,
      })
      this.worker?.postMessage({
        type: 'httpResult',
        httpId,
        ok: true,
        status: response.status,
        statusText: undefined,
        headers: response.headers,
        bodyText: response.bodyText,
      })
    } catch (error) {
      this.worker?.postMessage({
        type: 'httpResult',
        httpId,
        ok: false,
        error: sanitizeErrorMessage(error),
      })
    }
  }

  private postToWorker(message: Record<string, any>) {
    if (!this.worker) throw new Error('LX 音源沙箱不可用')
    this.worker.postMessage(message)
  }

  private waitForMessage(key: string, timeoutMs: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(key)
        reject(new Error('LX 音源请求超时'))
      }, timeoutMs)
      this.pendingRequests.set(key, { resolve, reject, timer })
    })
  }

  private rejectAllPending(error: Error) {
    for (const [key, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timer)
      pending.reject(error)
      this.pendingRequests.delete(key)
    }
  }

  private destroySandbox() {
    this.rejectAllPending(new Error('LX 音源沙箱已重置'))
    if (this.worker) {
      try {
        this.worker.terminate()
      } catch {
        // ignore
      }
      this.worker = null
    }
    this.sandboxSourceId = null
    this.sandboxReady = false
  }

  /**
   * Loads `sourceId`'s script into the sandbox worker and waits for `inited`.
   */
  private async ensureSandbox(sourceId: string | null): Promise<void> {
    if (!sourceId) {
      throw new Error('未找到 LX 音源脚本，请先导入音源')
    }

    if (
      this.worker &&
      this.sandboxReady &&
      this.sandboxSourceId === sourceId
    ) {
      return
    }

    const source = this.getSourceById(sourceId)
    if (!source) {
      throw new Error('未找到目标音源')
    }

    const script = await this.readScript(sourceId)
    if (!script) {
      this.sandboxReady = false
      this.lastError = '音源脚本内容缺失，请重新导入'
      throw new Error(this.lastError)
    }

    this.destroySandbox()
    this.sandboxSourceId = sourceId
    this.sandboxReady = false

    const worker = this.createWorker()
    this.worker = worker

    const initId = this.nextRequestId
    this.nextRequestId += 1
    const initWaiter = this.waitForMessage(`init:${initId}`, INIT_TIMEOUT_MS)

    this.postToWorker({
      type: 'init',
      initId,
      script,
      scriptInfo: source.scriptInfo as LxSandboxScriptInfo,
    })

    try {
      await initWaiter
    } catch (error) {
      this.sandboxReady = false
      this.lastError = sanitizeErrorMessage(error)
      throw error
    }
  }

  private async dispatchRequest(payload: LxWebRequestPayload): Promise<unknown> {
    if (!this.worker || !this.sandboxReady) {
      throw new Error('LX 音源运行时不可用')
    }
    const requestId = `req:${this.nextRequestId}`
    this.nextRequestId += 1
    const waiter = this.waitForMessage(requestId, REQUEST_TIMEOUT_MS)
    this.postToWorker({
      type: 'request',
      requestId,
      data: payload,
    })
    return waiter
  }

  /* ---------- public API (mirrors Electron-backed lxSourceApi) ---------- */

  getStatus(): Promise<LxSourceStatus> {
    return this.runInQueue(async () => {
      await this.ensureLoaded()
      // Mirror the Electron runtime: auto-load the persisted active source.
      if (this.activeSourceId && !(this.sandboxReady && this.sandboxSourceId === this.activeSourceId)) {
        try {
          await this.ensureSandbox(this.activeSourceId)
        } catch (error) {
          this.lastError = sanitizeErrorMessage(error)
        }
      }
      return this.buildStatus()
    })
  }

  setScriptPath(_path: string): Promise<LxSourceStatus> {
    return this.runInQueue(async () => {
      throw new Error('LX_SOURCE_UNAVAILABLE')
    })
  }

  clearScriptPath(): Promise<LxSourceStatus> {
    return this.runInQueue(async () => {
      await this.ensureLoaded()
      this.activeSourceId = null
      this.destroySandbox()
      this.lastError = null
      await this.persistConfig()
      return this.buildStatus()
    })
  }

  pickScriptPath(): Promise<string | null> {
    return Promise.resolve(null)
  }

  importScriptFolder(_path: string): Promise<LxSourceStatus> {
    return this.runInQueue(async () => {
      throw new Error('LX_SOURCE_UNAVAILABLE')
    })
  }

  importScriptUrl(rawUrl: string): Promise<LxSourceStatus> {
    return this.runInQueue(async () => {
      await this.ensureLoaded()
      const sourceUrl = normalizeImportedUrl(rawUrl)
      const script = await httpClient.getText(sourceUrl, {
        'user-agent': 'ZJ-Music LXSourceImporter',
        accept: 'application/javascript,text/javascript,text/plain,*/*',
      }, 30000)

      if (!script.trim()) {
        throw new Error('下载的音源内容为空')
      }
      if (getScriptByteLength(script) > MAX_SCRIPT_BYTES) {
        throw new Error('音源脚本体积过大')
      }

      const scriptInfo = parseScriptInfo(script, fallbackNameFromUrl(sourceUrl))
      const existingSource = this.sources.find((source) => source.url === sourceUrl) || null
      const sourceId = existingSource?.id || createSourceId()

      const nextSource: WebSourceRecord = {
        id: sourceId,
        type: 'url',
        url: sourceUrl,
        importedAt: existingSource?.importedAt || Date.now(),
        allowShowUpdateAlert: existingSource?.allowShowUpdateAlert ?? true,
        scriptInfo,
      }

      await this.saveScript(sourceId, script)
      this.upsertSource(nextSource)
      this.activeSourceId = sourceId
      await this.persistConfig()

      try {
        await this.ensureSandbox(sourceId)
      } catch (error) {
        this.lastError = sanitizeErrorMessage(error)
      }
      return this.buildStatus()
    })
  }

  /** Imports a script from a local file (mobile file picker). */
  importScriptFile(name: string, script: string): Promise<LxSourceStatus> {
    return this.runInQueue(async () => {
      await this.ensureLoaded()
      if (!script.trim()) {
        throw new Error('音源文件内容为空')
      }
      if (getScriptByteLength(script) > MAX_SCRIPT_BYTES) {
        throw new Error('音源脚本体积过大')
      }

      const fallbackName = name.trim() || 'lx-source.js'
      const scriptInfo = parseScriptInfo(script, fallbackName)
      const sourceId = createSourceId()

      const nextSource: WebSourceRecord = {
        id: sourceId,
        type: 'local',
        url: null,
        importedAt: Date.now(),
        allowShowUpdateAlert: true,
        scriptInfo,
      }

      await this.saveScript(sourceId, script)
      this.upsertSource(nextSource)
      this.activeSourceId = sourceId
      await this.persistConfig()

      try {
        await this.ensureSandbox(sourceId)
      } catch (error) {
        this.lastError = sanitizeErrorMessage(error)
      }
      return this.buildStatus()
    })
  }

  testSource(sourceId?: string | null): Promise<LxSourceStatus> {
    return this.runInQueue(async () => {
      await this.ensureLoaded()
      if (!sourceId) return this.buildStatus()
      const source = this.getSourceById(sourceId)
      if (!source) throw new Error('未找到目标音源')

      const previousActive = this.activeSourceId
      this.activeSourceId = sourceId
      try {
        await this.ensureSandbox(sourceId)
        return this.buildStatus()
      } catch (error) {
        this.lastError = sanitizeErrorMessage(error)
        return this.buildStatus()
      } finally {
        this.activeSourceId = previousActive
        this.destroySandbox()
        if (previousActive) {
          try {
            await this.ensureSandbox(previousActive)
          } catch (error) {
            this.lastError = sanitizeErrorMessage(error)
          }
        }
      }
    })
  }

  setActiveSource(sourceId: string | null): Promise<LxSourceStatus> {
    return this.runInQueue(async () => {
      await this.ensureLoaded()
      if (!sourceId) {
        this.activeSourceId = null
        this.destroySandbox()
        this.lastError = null
        await this.persistConfig()
        return this.buildStatus()
      }
      if (!this.getSourceById(sourceId)) {
        throw new Error('未找到目标音源')
      }
      this.activeSourceId = sourceId
      await this.persistConfig()
      try {
        await this.ensureSandbox(sourceId)
      } catch (error) {
        this.lastError = sanitizeErrorMessage(error)
      }
      return this.buildStatus()
    })
  }

  removeSource(sourceId: string): Promise<LxSourceStatus> {
    return this.runInQueue(async () => {
      await this.ensureLoaded()
      const targetSource = this.getSourceById(sourceId)
      if (!targetSource) {
        throw new Error('未找到目标音源')
      }

      this.setSources(this.sources.filter((source) => source.id !== sourceId))
      if (this.activeSourceId === sourceId) {
        this.activeSourceId = null
      }
      await this.removeScript(sourceId)
      if (this.sandboxSourceId === sourceId) {
        this.destroySandbox()
      }
      await this.persistConfig()
      return this.buildStatus()
    })
  }

  exportBackupState(): Promise<LxBackupState> {
    return this.runInQueue(async () => {
      await this.ensureLoaded()
      const sources: BackupLxSource[] = []
      for (const source of this.sources) {
        const script = await this.readScript(source.id)
        if (!script) continue
        sources.push({
          id: source.id,
          info: {
            name: source.scriptInfo.name,
            description: source.scriptInfo.description,
            version: source.scriptInfo.version,
            author: source.scriptInfo.author,
            homepage: source.scriptInfo.homepage,
            rawScript: script,
          },
          addedAt: new Date(source.importedAt).toISOString(),
          isActive: source.id === this.activeSourceId,
          allowShowUpdateAlert: source.allowShowUpdateAlert,
        })
      }
      return {
        sources,
        activeSourceId: this.activeSourceId,
      }
    })
  }

  restoreBackupState(payload: LxBackupState): Promise<LxSourceStatus> {
    return this.runInQueue(async () => {
      await this.ensureLoaded()
      const inputSources = Array.isArray(payload?.sources)
        ? payload.sources.map((item) => sanitizeBackupSource(item)).filter((item): item is BackupLxSource => Boolean(item))
        : []

      // Drop previously stored scripts.
      for (const source of this.sources) {
        await this.removeScript(source.id)
      }
      this.destroySandbox()

      const nextSources: WebSourceRecord[] = []
      for (const input of inputSources) {
        const parsedInfo = parseScriptInfo(input.info.rawScript, input.info.name || undefined)
        const scriptInfo: LxSourceScriptInfo = {
          ...parsedInfo,
          name: input.info.name || parsedInfo.name,
          description: input.info.description || parsedInfo.description,
          version: input.info.version || parsedInfo.version,
          author: input.info.author || parsedInfo.author,
          homepage: input.info.homepage || parsedInfo.homepage,
        }
        const sourceId = input.id
        await this.saveScript(sourceId, input.info.rawScript)
        nextSources.push({
          id: sourceId,
          type: 'url',
          url: null,
          importedAt: Number.isFinite(Date.parse(input.addedAt)) ? Date.parse(input.addedAt) : Date.now(),
          allowShowUpdateAlert: input.allowShowUpdateAlert,
          scriptInfo,
        })
      }

      this.setSources(nextSources)
      const requestedActive = typeof payload?.activeSourceId === 'string' && payload.activeSourceId.trim()
        ? payload.activeSourceId.trim()
        : null
      const fallbackActive = inputSources.find((item) => item.isActive)?.id || null
      this.activeSourceId = requestedActive && nextSources.some((source) => source.id === requestedActive)
        ? requestedActive
        : fallbackActive && nextSources.some((source) => source.id === fallbackActive)
          ? fallbackActive
          : nextSources[0]?.id || null
      this.allowShowUpdateAlert = this.activeSourceId
        ? nextSources.find((source) => source.id === this.activeSourceId)?.allowShowUpdateAlert ?? true
        : true

      await this.persistConfig()
      if (this.activeSourceId) {
        try {
          await this.ensureSandbox(this.activeSourceId)
        } catch (error) {
          this.lastError = sanitizeErrorMessage(error)
        }
      }
      return this.buildStatus()
    })
  }

  setAllowShowUpdateAlert(enable: boolean): Promise<LxSourceStatus> {
    return this.runInQueue(async () => {
      await this.ensureLoaded()
      const activeSource = this.getSourceById(this.activeSourceId)
      if (activeSource) {
        this.setSources(this.sources.map((source) => source.id === activeSource.id
          ? { ...source, allowShowUpdateAlert: Boolean(enable) }
          : source))
      } else {
        this.allowShowUpdateAlert = Boolean(enable)
      }
      if (!enable) this.pendingUpdateAlerts.splice(0, this.pendingUpdateAlerts.length)
      await this.persistConfig()
      return this.buildStatus()
    })
  }

  setSourceAllowUpdateAlert(sourceId: string, enable: boolean): Promise<LxSourceStatus> {
    return this.runInQueue(async () => {
      await this.ensureLoaded()
      const targetSource = this.getSourceById(sourceId)
      if (!targetSource) {
        throw new Error('未找到目标音源')
      }
      this.setSources(this.sources.map((source) => source.id === sourceId
        ? { ...source, allowShowUpdateAlert: Boolean(enable) }
        : source))
      if (sourceId === this.activeSourceId) this.allowShowUpdateAlert = Boolean(enable)
      if (!enable && sourceId === this.activeSourceId) this.pendingUpdateAlerts.splice(0, this.pendingUpdateAlerts.length)
      await this.persistConfig()
      return this.buildStatus()
    })
  }

  consumeUpdateAlerts(): Promise<LxSourceUpdateAlert[]> {
    const alerts = [...this.pendingUpdateAlerts]
    this.pendingUpdateAlerts.splice(0, this.pendingUpdateAlerts.length)
    return Promise.resolve(alerts)
  }

  onUpdateAlert(callback: UpdateAlertListener): () => void {
    this.updateAlertListeners.add(callback)
    return () => {
      this.updateAlertListeners.delete(callback)
    }
  }

  /** Dispatches a `musicUrl` request to the (active or explicit) source. */
  request(payload: LxWebRequestPayload, sourceId?: string | null): Promise<unknown> {
    return this.runInQueue(async () => {
      await this.ensureLoaded()
      const targetSourceId = sourceId || this.activeSourceId
      const needsTemporarySource = Boolean(sourceId && sourceId !== this.activeSourceId)
      try {
        await this.ensureSandbox(targetSourceId)
        return await this.dispatchRequest(payload)
      } finally {
        if (needsTemporarySource) {
          // Restore the active source sandbox, mirroring the Electron runtime.
          try {
            await this.ensureSandbox(this.activeSourceId)
          } catch (error) {
            this.destroySandbox()
            this.supportedSources = {}
            this.lastError = this.activeSourceId ? sanitizeErrorMessage(error) : null
          }
        }
      }
    })
  }
}

export const webLxSourceRuntime = new WebLxSourceRuntime()
export default webLxSourceRuntime
