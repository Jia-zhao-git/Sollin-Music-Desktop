/**
 * Web (mobile / browser) video playback loaders for hls.js.
 *
 * Desktop Electron disables webSecurity on the main window, so hls.js can fetch
 * cross-origin ts segments directly. Capacitor WebViews enforce CORS, and most
 * video CDNs only send `Access-Control-Allow-Origin` on the m3u8 playlists —
 * not on the ts segments — so hls.js's default XHR/fetch loader fails with
 * "视频播放失败". These loaders bridge every hls.js request through httpClient
 * (CapacitorHttp on native platforms), which bypasses CORS entirely.
 */

import type {
  FragmentLoaderContext,
  HlsProgressivePerformanceTiming,
  HlsPerformanceTiming,
  Loader,
  LoaderCallbacks,
  LoaderConfiguration,
  LoaderContext,
  LoaderResponse,
  LoaderStats,
  PlaylistLoaderContext,
} from 'hls.js'
import httpClient from '@/services/httpClient'

const createStats = (): LoaderStats => {
  const now = performance.now()
  const loading: HlsProgressivePerformanceTiming = { start: now, end: 0, first: 0 }
  const parsing: HlsPerformanceTiming = { start: 0, end: 0 }
  const buffering: HlsProgressivePerformanceTiming = { start: 0, end: 0, first: 0 }
  return {
    aborted: false,
    loaded: 0,
    retry: 0,
    total: 0,
    chunkCount: 0,
    bwEstimate: 0,
    loading,
    parsing,
    buffering,
  }
}

const withRangeHeaders = (context: LoaderContext, headers: Record<string, string>) => {
  const next = { ...headers }
  if (typeof context.rangeStart === 'number' && typeof context.rangeEnd === 'number') {
    next.Range = `bytes=${context.rangeStart}-${context.rangeEnd}`
  }
  return next
}

/** Playlist loader: returns m3u8 text via httpClient (CORS-free). */
export class WebPlaylistLoader implements Loader<PlaylistLoaderContext> {
  private callbacks: LoaderCallbacks<PlaylistLoaderContext> | null = null
  private aborted = false
  context: PlaylistLoaderContext | null = null
  stats: LoaderStats = createStats()

  load(context: PlaylistLoaderContext, _config: LoaderConfiguration, callbacks: LoaderCallbacks<PlaylistLoaderContext>): void {
    this.callbacks = callbacks
    this.context = context
    this.stats = createStats()
    const stats = this.stats

    void httpClient
      .getText(context.url, withRangeHeaders(context, {}), 20000)
      .then((text) => {
        if (this.aborted) return
        stats.loading.end = performance.now()
        stats.loading.first = stats.loading.end
        stats.loaded = stats.total = new TextEncoder().encode(text).length
        const response: LoaderResponse = { url: context.url, data: text }
        callbacks.onSuccess(response, stats, context, null)
      })
      .catch((error) => {
        if (this.aborted) return
        const message = error instanceof Error ? error.message : String(error)
        callbacks.onError({ code: 1, text: message }, context, null, stats)
      })
  }

  abort(): void {
    this.aborted = true
    this.callbacks?.onAbort?.(this.stats, this.context!, null)
  }

  destroy(): void {
    this.aborted = true
    this.callbacks = null
    this.context = null
  }
}

/** Fragment / key loader: returns ArrayBuffer via httpClient (CORS-free). */
export class WebFragmentLoader implements Loader<FragmentLoaderContext> {
  private callbacks: LoaderCallbacks<FragmentLoaderContext> | null = null
  private aborted = false
  context: FragmentLoaderContext | null = null
  stats: LoaderStats = createStats()

  load(context: FragmentLoaderContext, _config: LoaderConfiguration, callbacks: LoaderCallbacks<FragmentLoaderContext>): void {
    this.callbacks = callbacks
    this.context = context
    this.stats = createStats()
    const stats = this.stats

    void httpClient
      .requestBuffer({
        url: context.url,
        method: 'GET',
        headers: withRangeHeaders(context, {}),
        timeoutMs: 20000,
      })
      .then((response) => {
        if (this.aborted) return
        stats.loading.end = performance.now()
        stats.loading.first = stats.loading.end
        stats.loaded = stats.total = response.data.byteLength
        const data = response.data.buffer.slice(
          response.data.byteOffset,
          response.data.byteOffset + response.data.byteLength,
        ) as ArrayBuffer
        callbacks.onSuccess({ url: context.url, data }, stats, context, null)
      })
      .catch((error) => {
        if (this.aborted) return
        const message = error instanceof Error ? error.message : String(error)
        callbacks.onError({ code: 1, text: message }, context, null, stats)
      })
  }

  abort(): void {
    this.aborted = true
    this.callbacks?.onAbort?.(this.stats, this.context!, null)
  }

  destroy(): void {
    this.aborted = true
    this.callbacks = null
    this.context = null
  }
}
