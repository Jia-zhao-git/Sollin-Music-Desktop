/**
 * 本地音乐 —— Web / 手机端实现。
 *
 * 桌面端：Electron 主进程扫描文件夹 + ID3 标签读取，播放 file:// 路径。
 * 手机端：文件选择器导入音频文件，文件内容存 IndexedDB，播放时读取为 blob URL。
 * 本地歌曲的 Song.localPath 使用 `web://<id>` 前缀区分，桌面端路径逻辑不受影响。
 */

import localforage from 'localforage'
import type { Song } from '@/types'

const WEB_LOCAL_PREFIX = 'web://'

const store = localforage.createInstance({
  name: 'Sollin',
  storeName: 'Sollin_local_music_web',
  description: 'Web local music files',
})

const audioKey = (songId: string) => `audio:${songId}`

export const isWebLocalSong = (song: Song | null | undefined) => Boolean(song?.platform === 'local' && song.localPath?.startsWith(WEB_LOCAL_PREFIX))

export const getWebLocalSongId = (song: Song | null | undefined) => {
  if (!song?.localPath?.startsWith(WEB_LOCAL_PREFIX)) return null
  return song.localPath.slice(WEB_LOCAL_PREFIX.length)
}

export async function saveWebAudioFile(songId: string, blob: Blob): Promise<void> {
  await store.setItem(audioKey(songId), blob)
}

export async function loadWebAudioFile(songId: string): Promise<Blob | null> {
  const blob = await store.getItem<Blob>(audioKey(songId))
  return blob instanceof Blob ? blob : null
}

export async function removeWebAudioFile(songId: string): Promise<void> {
  try {
    await store.removeItem(audioKey(songId))
  } catch {
    // ignore
  }
}

export async function clearWebAudioFiles(songIds: string[]): Promise<void> {
  await Promise.all(songIds.map((id) => removeWebAudioFile(id).catch(() => undefined)))
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

const probeAudioDuration = (file: File): Promise<number> => {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const audio = document.createElement('audio')
    const timer = setTimeout(() => {
      URL.revokeObjectURL(url)
      resolve(0)
    }, 6000)
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => {
      clearTimeout(timer)
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0
      URL.revokeObjectURL(url)
      resolve(duration)
    }
    audio.onerror = () => {
      clearTimeout(timer)
      URL.revokeObjectURL(url)
      resolve(0)
    }
    audio.src = url
  })
}

const parseNameAndArtist = (fileName: string) => {
  const base = fileName.replace(/\.[^.]+$/, '').trim() || '未命名歌曲'
  const match = /^(.+?)\s*-\s*(.+)$/.exec(base)
  if (match) {
    return { artist: match[1].trim(), name: match[2].trim() }
  }
  return { artist: '', name: base }
}

export async function buildWebLocalSong(file: File): Promise<Song> {
  const songId = `web_local_${await hashString(`${file.name}:${file.size}:${file.lastModified}`)}`
  const { artist, name } = parseNameAndArtist(file.name)
  const duration = await probeAudioDuration(file)
  return {
    id: songId,
    name,
    artist,
    album: '',
    duration,
    platform: 'local',
    localPath: `${WEB_LOCAL_PREFIX}${songId}`,
    localFileSize: file.size,
    localModifiedAt: new Date(file.lastModified).toISOString(),
  }
}

export async function importWebAudioFiles(files: FileList | File[]): Promise<Song[]> {
  const songs: Song[] = []
  for (const file of Array.from(files)) {
    try {
      const song = await buildWebLocalSong(file)
      await saveWebAudioFile(song.id, file)
      songs.push(song)
    } catch (error) {
      console.warn('[webLocalMusic] import failed:', file.name, error)
    }
  }
  return songs
}

export async function createWebLocalSongUrl(song: Song): Promise<string | null> {
  const songId = getWebLocalSongId(song)
  if (!songId) return null
  const blob = await loadWebAudioFile(songId)
  if (!blob) return null
  return URL.createObjectURL(blob)
}
