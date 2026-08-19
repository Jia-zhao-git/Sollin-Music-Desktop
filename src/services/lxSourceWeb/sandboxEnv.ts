/**
 * Web LX source sandbox environment.
 *
 * Replicates the `lx` API surface that the Electron runtime exposes to LX
 * source scripts (see electron/lxSourcePreload.ts), implemented with pure-JS
 * crypto (crypto-js / node-forge), zlib (pako) and a Buffer polyfill so it can
 * run inside a Web Worker on mobile / browser builds.
 *
 * The environment is transport-agnostic: it talks to the host through a
 * `SandboxTransport` (the worker wrapper posts messages; tests can use a mock).
 */

import CryptoJS from 'crypto-js'
import forge from 'node-forge'
import pako from 'pako'
import { Buffer } from 'buffer'

export interface LxSandboxScriptInfo {
  name: string
  description: string
  author: string
  homepage: string
  version: string
}

export type LxSandboxHttpOptions = {
  method?: string
  headers?: Record<string, string>
  body?: string
  timeout?: number
  follow_max?: number
}

export type LxSandboxOutboundMessage =
  | { type: 'inited'; sources: unknown }
  | { type: 'updateAlert'; data: unknown }
  | { type: 'http'; httpId: number; url: string; options: LxSandboxHttpOptions }
  | { type: 'requestResult'; requestId: string; ok: boolean; result?: unknown; error?: string }
  | { type: 'scriptError'; message: string }

export type LxSandboxInboundMessage =
  | { type: 'httpResult'; httpId: number; ok: boolean; status?: number; statusText?: string; headers?: Record<string, string>; bodyText?: string; error?: string }

export interface LxSandboxTransport {
  postMessage(message: LxSandboxOutboundMessage): void
}

export type LxSandboxRequestPayload = {
  source: string
  action: string
  info: {
    type: string
    musicInfo: any
  }
}

const EVENT_NAMES = {
  request: 'request',
  inited: 'inited',
  updateAlert: 'updateAlert',
} as const

const sanitizeErrorMessage = (error: unknown) => {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  return String(error)
}

const parseResponseBody = (bodyText: string) => {
  try {
    return JSON.parse(bodyText)
  } catch {
    return bodyText
  }
}

const toUint8Array = (input: any): Uint8Array => {
  if (input == null) return new Uint8Array(0)
  if (input instanceof Uint8Array) return input
  if (typeof input === 'string') return Buffer.from(input, 'utf8')
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
  }
  if (Array.isArray(input)) return Uint8Array.from(input)
  return Buffer.from(String(input), 'utf8')
}

const bytesToHexString = (bytes: Uint8Array): string => {
  let hex = ''
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i].toString(16).padStart(2, '0')
  }
  return hex
}

const toWordArray = (input: any): CryptoJS.lib.WordArray => {
  if (input == null) return CryptoJS.lib.WordArray.create([])
  if (typeof input === 'string') return CryptoJS.enc.Utf8.parse(input)
  if (input instanceof ArrayBuffer) return CryptoJS.enc.Hex.parse(bytesToHexString(new Uint8Array(input)))
  if (ArrayBuffer.isView(input)) return CryptoJS.enc.Hex.parse(bytesToHexString(input as Uint8Array))
  if (Array.isArray(input)) return CryptoJS.enc.Hex.parse(bytesToHexString(Uint8Array.from(input.map(Number))))
  return CryptoJS.enc.Utf8.parse(String(input))
}

const wordArrayToBytes = (words: CryptoJS.lib.WordArray): Uint8Array => {
  const hex = words.toString(CryptoJS.enc.Hex)
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16)
  }
  return bytes
}

const createCryptoUtils = () => {
  const aesEncrypt = (input: any, mode: string, key: any, iv: any): Buffer => {
    const modeName = String(mode || 'cbc').toUpperCase()
    const cipher = CryptoJS.AES.encrypt(toWordArray(input), toWordArray(key), {
      iv: toWordArray(iv),
      mode: (CryptoJS.mode as any)[modeName] || CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    })
    return Buffer.from(wordArrayToBytes(cipher.ciphertext))
  }

  const rsaEncrypt = (input: any, key: string): Buffer => {
    const publicKey = forge.pki.publicKeyFromPem(String(key))
    const modulusBytes = Math.ceil(publicKey.n.bitLength() / 8)
    const bytes = toUint8Array(input)
    if (bytes.length > modulusBytes) {
      throw new Error('RSA input too long')
    }
    // Zero-pad to modulus length, matching Node's RSA_NO_PADDING behaviour.
    const padded = new Uint8Array(modulusBytes)
    padded.set(bytes, modulusBytes - bytes.length)
    const encrypted = publicKey.encrypt(forge.util.createBuffer(padded), 'NONE')
    return Buffer.from(encrypted, 'binary')
  }

  const randomBytes = (size: number): Buffer => {
    const bytes = new Uint8Array(Math.max(0, Math.floor(size)))
    globalThis.crypto.getRandomValues(bytes)
    return Buffer.from(bytes)
  }

  const md5 = (value: any): string => {
    return CryptoJS.MD5(String(value)).toString(CryptoJS.enc.Hex)
  }

  return {
    aesEncrypt,
    rsaEncrypt,
    randomBytes,
    md5,
  }
}

const createBufferUtils = () => {
  return {
    from(value: any, encodingOrOffset?: any, length?: any) {
      return Buffer.from(value, encodingOrOffset, length)
    },
    bufToString(buf: any, format?: BufferEncoding) {
      return Buffer.from(buf as any).toString(format)
    },
  }
}

const createZlibUtils = () => {
  const inflate = (buf: any): Promise<Buffer> => {
    try {
      return Promise.resolve(Buffer.from(pako.inflate(toUint8Array(buf))))
    } catch (error) {
      return Promise.reject(new Error(sanitizeErrorMessage(error)))
    }
  }

  const deflate = (data: any): Promise<Buffer> => {
    try {
      return Promise.resolve(Buffer.from(pako.deflate(toUint8Array(data))))
    } catch (error) {
      return Promise.reject(new Error(sanitizeErrorMessage(error)))
    }
  }

  return { inflate, deflate }
}

type PendingHttp = {
  resolve: (response: { statusCode: number; statusMessage: string; headers: Record<string, string>; bytes: number; raw?: any; body: any }) => void
  reject: (error: Error) => void
}

const normalizeMusicUrlResult = (response: unknown, payload: LxSandboxRequestPayload) => {
  if (typeof response === 'string' && /^https?:/i.test(response)) {
    return {
      source: payload.source,
      action: payload.action,
      data: {
        type: payload.info.type,
        url: response,
      },
    }
  }

  if (response && typeof response === 'object') {
    const record = response as { url?: unknown; type?: unknown }
    const url = typeof record.url === 'string' ? record.url : ''
    const type = typeof record.type === 'string' ? record.type : payload.info.type
    if (url && /^https?:/i.test(url)) {
      return {
        source: payload.source,
        action: payload.action,
        data: {
          type,
          url,
        },
      }
    }
  }

  throw new Error('failed')
}

export class LxScriptSandbox {
  private readonly transport: LxSandboxTransport
  private requestHandler: ((payload: LxSandboxRequestPayload) => unknown | Promise<unknown>) | null = null
  private readonly pendingHttp = new Map<number, PendingHttp>()
  private nextHttpId = 1
  private readonly startWaiters: Array<{ resolve: (sources: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }> = []
  private startResolved = false

  constructor(transport: LxSandboxTransport) {
    this.transport = transport
  }

  /** Runs the LX script and resolves once the script reports `inited`. */
  start(script: string, scriptInfo: LxSandboxScriptInfo): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve: (sources: unknown) => {
          clearTimeout(waiter.timer)
          this.startWaiters.splice(this.startWaiters.indexOf(waiter), 1)
          resolve(sources)
        },
        reject: (error: Error) => {
          clearTimeout(waiter.timer)
          this.startWaiters.splice(this.startWaiters.indexOf(waiter), 1)
          reject(error)
        },
        timer: setTimeout(() => {
          this.startWaiters.splice(this.startWaiters.indexOf(waiter), 1)
          reject(new Error('LX 音源脚本初始化超时'))
        }, 15000),
      }
      this.startWaiters.push(waiter)

      try {
        this.installGlobalShims()
        this.installLxApi(script, scriptInfo)
        // Indirect eval runs the script in the global scope (like the desktop
        // runtime's executeJavaScript), so top-level declarations become globals.
        // eslint-disable-next-line no-eval
        ;(0, eval)(script)
      } catch (error) {
        this.rejectStart(new Error(sanitizeErrorMessage(error)))
      }
    })
  }

  /** Routes an inbound `musicUrl`-style request to the script's handler. */
  async handleRequest(payload: LxSandboxRequestPayload): Promise<unknown> {
    if (!this.requestHandler) {
      throw new Error('Request event is not defined')
    }
    const result = await this.requestHandler(payload)
    return normalizeMusicUrlResult(result, payload)
  }

  /** Resolves a pending HTTP call bridged through the host. */
  handleHttpResult(message: LxSandboxInboundMessage) {
    if (message.type !== 'httpResult') return
    const pending = this.pendingHttp.get(message.httpId)
    if (!pending) return
    this.pendingHttp.delete(message.httpId)

    if (!message.ok) {
      pending.reject(new Error(message.error || 'HTTP request failed'))
      return
    }

    const bodyText = message.bodyText ?? ''
    const parsedBody = parseResponseBody(bodyText)
    pending.resolve({
      statusCode: typeof message.status === 'number' ? message.status : 0,
      statusMessage: message.statusText || '',
      headers: message.headers || {},
      bytes: new TextEncoder().encode(bodyText).length,
      body: parsedBody,
    })
  }

  /** Reports an uncaught script error (only relevant before `inited`). */
  reportUncaughtError(message: string) {
    if (this.startResolved) return
    this.rejectStart(new Error(message))
  }

  private rejectStart(error: Error) {
    if (this.startResolved) return
    this.startResolved = true
    for (const waiter of [...this.startWaiters]) {
      waiter.reject(error)
    }
    this.startWaiters.splice(0, this.startWaiters.length)
  }

  private resolveStart(sources: unknown) {
    if (this.startResolved) return
    this.startResolved = true
    for (const waiter of [...this.startWaiters]) {
      waiter.resolve(sources)
    }
    this.startWaiters.splice(0, this.startWaiters.length)
  }

  private installGlobalShims() {
    const scope = globalThis as Record<string, unknown>
    if (!scope.window) scope.window = scope
    if (!scope.global) scope.global = scope
    if (!scope.Buffer) scope.Buffer = Buffer
  }

  private installLxApi(script: string, scriptInfo: LxSandboxScriptInfo) {
    const scope = globalThis as Record<string, unknown>

    const lx = {
      EVENT_NAMES,
      request: (
        url: string,
        options: any = {},
        callback: (error: Error | null, response: any, body: any) => void,
      ) => {
        const headers = { ...(options?.headers || {}) } as Record<string, string>
        let body: unknown = options?.body

        if (options?.form && !headers['content-type'] && !headers['Content-Type']) {
          headers['content-type'] = 'application/x-www-form-urlencoded;charset=UTF-8'
          body = options.form
        } else if (options?.formData && body == null) {
          body = options.formData
        }

        let cancelled = false
        const httpId = this.nextHttpId
        this.nextHttpId += 1

        this.pendingHttp.set(httpId, {
          resolve: (response) => {
            if (cancelled) return
            callback.call(undefined, null, response, response.body)
          },
          reject: (error) => {
            if (cancelled) return
            callback.call(undefined, error, null, null)
          },
        })

        this.transport.postMessage({
          type: 'http',
          httpId,
          url: String(url),
          options: {
            method: options?.method,
            headers,
            body: typeof body === 'string' ? body : body == null ? undefined : JSON.stringify(body),
            timeout: typeof options?.timeout === 'number' ? options.timeout : 20000,
            follow_max: typeof options?.follow_max === 'number' ? options.follow_max : 5,
          },
        })

        return () => {
          cancelled = true
        }
      },
      send: (eventName: string, data: unknown) => {
        return new Promise<void>((resolve, reject) => {
          switch (eventName) {
            case EVENT_NAMES.inited:
              if (this.startResolved) {
                reject(new Error('Script is inited'))
                return
              }
              this.resolveStart(data)
              this.transport.postMessage({ type: 'inited', sources: data })
              resolve()
              return
            case EVENT_NAMES.updateAlert:
              this.transport.postMessage({ type: 'updateAlert', data })
              resolve()
              return
            default:
              reject(new Error(`Unsupported event: ${eventName}`))
          }
        })
      },
      on: (eventName: string, handler: ((payload: LxSandboxRequestPayload) => unknown | Promise<unknown>) | null) => {
        if (eventName !== EVENT_NAMES.request) {
          return Promise.reject(new Error(`Unsupported event: ${eventName}`))
        }
        this.requestHandler = handler
        return Promise.resolve()
      },
      utils: {
        crypto: createCryptoUtils(),
        buffer: createBufferUtils(),
        zlib: createZlibUtils(),
      },
      currentScriptInfo: {
        ...scriptInfo,
        rawScript: script,
      },
      version: '2.0.0',
      env: 'web',
    }

    scope.lx = lx
  }
}
