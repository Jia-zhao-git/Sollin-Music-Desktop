import { Capacitor, CapacitorHttp } from '@capacitor/core'

export interface HttpRequestOptions {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PROPFIND' | 'MKCOL' | 'HEAD' | string
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
}

export interface HttpResponse {
  status: number
  headers: Record<string, string>
  bodyText: string
  bodyBase64?: string
}

export interface HttpBufferResponse {
  status: number
  headers: Record<string, string>
  data: Uint8Array
}

const normalizeHeaders = (headers: Headers): Record<string, string> => {
  const result: Record<string, string> = {}
  headers.forEach((value, key) => {
    result[key] = value
  })
  return result
}

const canUseDevProxy = () => {
  if (typeof window === 'undefined') return false
  if (!import.meta.env.DEV) return false
  return window.location.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(window.location.hostname)
}

const toDevProxyUrl = (url: string) => `/__dev_http_proxy?url=${encodeURIComponent(url)}`

const fetchInBrowser = async (options: HttpRequestOptions, useDevProxy = false): Promise<HttpResponse> => {
  const response = await fetch(useDevProxy ? toDevProxyUrl(options.url) : options.url, {
    method: options.method || 'GET',
    headers: options.headers,
    body: options.body,
    signal: options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined,
  })

  return {
    status: response.status,
    headers: normalizeHeaders(response.headers),
    bodyText: await response.text(),
  }
}

const canUseCapacitorHttp = () => {
  try {
    return Capacitor.isNativePlatform?.() === true
  } catch {
    return false
  }
}

/**
 * Custom native bridge (NativeHttpPlugin) that returns byte-exact base64 for EVERY
 * content type, bypassing CapacitorHttp's JSON auto-parse. Registered from MainActivity.
 */
const getNativeHttp = (): ((options: HttpRequestOptions) => Promise<{
  status: number
  headers: Record<string, string>
  data: string
}>) | null => {
  if (typeof window === 'undefined') return null
  try {
    if (Capacitor.isNativePlatform?.() !== true) return null
    const plugin = (Capacitor as any).registerPlugin?.('NativeHttp')
    if (!plugin?.request) return null
    return (options: HttpRequestOptions) => plugin.request({
      url: options.url,
      method: options.method || 'GET',
      headers: options.headers,
      body: options.body,
      timeoutMs: options.timeoutMs ?? 20000,
    })
  } catch {
    return null
  }
}

const fetchInCapacitor = async (options: HttpRequestOptions): Promise<HttpResponse> => {
  const response = await CapacitorHttp.request({
    url: options.url,
    method: options.method || 'GET',
    headers: options.headers,
    data: options.body,
    responseType: 'text',
    readTimeout: options.timeoutMs,
    connectTimeout: options.timeoutMs,
  })

  return {
    status: response.status,
    headers: response.headers || {},
    bodyText: typeof response.data === 'string' ? response.data : JSON.stringify(response.data ?? ''),
  }
}

const base64ToBytes = (base64: string): Uint8Array => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

const fetchBufferInCapacitor = async (options: HttpRequestOptions): Promise<HttpBufferResponse> => {
  const response = await CapacitorHttp.request({
    url: options.url,
    method: options.method || 'GET',
    headers: options.headers,
    data: options.body,
    responseType: 'arraybuffer',
    readTimeout: options.timeoutMs,
    connectTimeout: options.timeoutMs,
  })

  let data: Uint8Array
  if (typeof response.data === 'string') {
    // Capacitor native returns base64 for arraybuffer responses.
    data = base64ToBytes(response.data)
  } else if (response.data instanceof ArrayBuffer) {
    data = new Uint8Array(response.data)
  } else if (response.data != null) {
    // Capacitor Android: when the response Content-Type is application/json it parses the
    // body into a JS object and ignores responseType entirely (HttpRequestHandler.readData).
    // Re-serialize so the caller still receives the raw JSON bytes.
    const raw = typeof response.data === 'string' ? response.data : JSON.stringify(response.data)
    data = new TextEncoder().encode(raw)
  } else {
    data = new Uint8Array(0)
  }

  return {
    status: response.status,
    headers: response.headers || {},
    data,
  }
}

const fetchBufferInNative = async (options: HttpRequestOptions): Promise<HttpBufferResponse> => {
  const nativeHttp = getNativeHttp()
  if (!nativeHttp) throw new Error('NativeHttp unavailable')
  const response = await nativeHttp(options)
  return {
    status: typeof response?.status === 'number' ? response.status : 0,
    headers: response?.headers || {},
    data: typeof response?.data === 'string' && response.data
      ? base64ToBytes(response.data)
      : new Uint8Array(0),
  }
}

const fetchBufferInBrowser = async (options: HttpRequestOptions, useDevProxy = false): Promise<HttpBufferResponse> => {
  const response = await fetch(useDevProxy ? toDevProxyUrl(options.url) : options.url, {
    method: options.method || 'GET',
    headers: options.headers,
    body: options.body,
    signal: options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined,
  })
  const buffer = await response.arrayBuffer()
  return {
    status: response.status,
    headers: normalizeHeaders(response.headers),
    data: new Uint8Array(buffer),
  }
}

const fetchBufferInElectron = async (options: HttpRequestOptions): Promise<HttpBufferResponse> => {
  const electronApi = typeof window !== 'undefined' ? (window.electronAPI as any) : undefined
  const response = await electronApi.httpRequest({
    url: options.url,
    method: options.method || 'GET',
    headers: options.headers,
    body: options.body,
    timeoutMs: options.timeoutMs,
  })
  const bodyBase64 = typeof response?.bodyBase64 === 'string' ? response.bodyBase64 : ''
  return {
    status: typeof response?.status === 'number' ? response.status : 0,
    headers: response?.headers || {},
    data: bodyBase64 ? base64ToBytes(bodyBase64) : new Uint8Array(0),
  }
}

export const httpClient = {
  async request(options: HttpRequestOptions): Promise<HttpResponse> {
    const electronApi = typeof window !== 'undefined' ? (window.electronAPI as any) : undefined
    if (electronApi?.httpRequest) {
      return electronApi.httpRequest(options)
    }

    if (canUseCapacitorHttp()) {
      return fetchInCapacitor(options)
    }

    // 浏览器 dev：直接走本地代理，避免每次请求先直连触发 CORS 报错刷屏。
    if (canUseDevProxy()) {
      return fetchInBrowser(options, true)
    }

    return fetchInBrowser(options)
  },

  async requestBuffer(options: HttpRequestOptions): Promise<HttpBufferResponse> {
    const electronApi = typeof window !== 'undefined' ? (window.electronAPI as any) : undefined
    if (electronApi?.httpRequest) {
      return fetchBufferInElectron(options)
    }

    if (canUseCapacitorHttp()) {
      try {
        // Prefer the custom native bridge — it preserves raw bytes for every content
        // type (CapacitorHttp rejects application/json responses whose body is not
        // valid JSON, e.g. kuwo wbd API / netease eapi encrypted payloads).
        return await fetchBufferInNative(options)
      } catch (error) {
        console.warn('[httpClient] NativeHttp failed, falling back to CapacitorHttp:', error)
      }
      return fetchBufferInCapacitor(options)
    }

    // 浏览器 dev：直接走本地代理，避免 CORS 报错刷屏。
    if (canUseDevProxy()) {
      return fetchBufferInBrowser(options, true)
    }

    return fetchBufferInBrowser(options)
  },

  async getJson<T = any>(url: string, headers?: Record<string, string>): Promise<T> {
    const response = await this.request({ url, method: 'GET', headers })
    return JSON.parse(response.bodyText) as T
  },

  async getText(url: string, headers?: Record<string, string>, timeoutMs?: number): Promise<string> {
    const response = await this.request({ url, method: 'GET', headers, timeoutMs })
    return response.bodyText
  },

  async postJson<T = any>(url: string, body: any, headers?: Record<string, string>): Promise<T> {
    const response = await this.request({
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(headers || {}),
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
    return JSON.parse(response.bodyText) as T
  },

  async postForm<T = any>(url: string, body: URLSearchParams | string, headers?: Record<string, string>): Promise<T> {
    const response = await this.request({
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(headers || {}),
      },
      body: typeof body === 'string' ? body : body.toString(),
    })
    return JSON.parse(response.bodyText) as T
  },
}

export default httpClient
