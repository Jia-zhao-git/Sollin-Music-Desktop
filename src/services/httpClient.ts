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

export const httpClient = {
  async request(options: HttpRequestOptions): Promise<HttpResponse> {
    const electronApi = typeof window !== 'undefined' ? (window.electronAPI as any) : undefined
    if (electronApi?.httpRequest) {
      return electronApi.httpRequest(options)
    }

    if (canUseCapacitorHttp()) {
      return fetchInCapacitor(options)
    }

    try {
      return await fetchInBrowser(options)
    } catch (error) {
      if (!canUseDevProxy()) throw error
      return fetchInBrowser(options, true)
    }
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
