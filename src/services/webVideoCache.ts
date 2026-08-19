/**
 * 视频缓存 —— Web / 手机端实现。
 *
 * 桌面端：Electron 主进程下载到磁盘目录（支持 m3u8 分片拼接与 mp4 直链），缓存项 filePath 为磁盘路径。
 * 手机端：仅支持 mp4 等直链视频，用 httpClient（CapacitorHttp 原生）整段下载后存入 IndexedDB，
 * 缓存项 filePath 存为 `web://<id>`；播放时读取为 blob URL。m3u8 分片拼接体积过大，暂不支持。
 */

import localforage from 'localforage'
import httpClient from '@/services/httpClient'

const WEB_CACHE_PREFIX = 'web://'
const MAX_WEB_VIDEO_BYTES = 600 * 1024 * 1024

const store = localforage.createInstance({
  name: 'Sollin',
  storeName: 'Sollin_video_cache_web',
  description: 'Web video cache files',
})

const videoKey = (id: string) => `video:${id}`

export const isWebCachedPath = (filePath: string | null | undefined) => Boolean(filePath?.startsWith(WEB_CACHE_PREFIX))

export const getWebCacheId = (filePath: string | null | undefined) => {
  if (!filePath?.startsWith(WEB_CACHE_PREFIX)) return null
  return filePath.slice(WEB_CACHE_PREFIX.length)
}

export async function saveWebVideoFile(id: string, blob: Blob): Promise<void> {
  await store.setItem(videoKey(id), blob)
}

export async function loadWebVideoFile(id: string): Promise<Blob | null> {
  const blob = await store.getItem<Blob>(videoKey(id))
  return blob instanceof Blob ? blob : null
}

export async function removeWebVideoFile(id: string): Promise<void> {
  try {
    await store.removeItem(videoKey(id))
  } catch {
    // ignore
  }
}

export async function clearWebVideoFiles(ids: string[]): Promise<void> {
  await Promise.all(ids.map((id) => removeWebVideoFile(id).catch(() => undefined)))
}

const hashString = async (value: string): Promise<string> => {
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
    return Array.from(new Uint8Array(digest))
      .slice(0, 8)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  } catch {
    return Math.random().toString(36).slice(2, 12)
  }
}

/**
 * 下载直链视频到 IndexedDB。
 * 返回缓存 id（用于 filePath = `web://<id>`）与文件大小。
 */
export async function downloadWebVideo(url: string): Promise<{ id: string; size: number }> {
  if (/\.m3u8(?:$|[?#])/i.test(url)) {
    throw new Error('手机端暂不支持缓存 HLS 视频，请使用在线播放或切换到桌面端')
  }

  const response = await httpClient.requestBuffer({
    url,
    method: 'GET',
    timeoutMs: 30000,
  })

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`视频下载失败（HTTP ${response.status}）`)
  }
  if (response.data.byteLength > MAX_WEB_VIDEO_BYTES) {
    throw new Error('视频体积过大，手机端缓存上限为 600MB')
  }
  if (response.data.byteLength === 0) {
    throw new Error('下载的视频内容为空')
  }

  const id = await hashString(url)
  const buffer = response.data.buffer.slice(
    response.data.byteOffset,
    response.data.byteOffset + response.data.byteLength,
  ) as ArrayBuffer
  await saveWebVideoFile(id, new Blob([buffer], { type: 'video/mp4' }))
  return { id, size: response.data.byteLength }
}
