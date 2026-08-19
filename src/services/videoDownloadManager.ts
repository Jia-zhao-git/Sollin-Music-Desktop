import { useVideoStore } from '@/stores/videoStore'
import type { VideoDetail, VideoEpisode } from '@/types/video'
import { downloadWebVideo } from '@/services/webVideoCache'

type VideoDownloadEventPayload = {
  taskId: string
  status: 'pending' | 'downloading' | 'completed' | 'failed'
  progress: number
  filePath?: string
  error?: string
  warning?: string
}

type PendingMeta = {
  videoName: string
  episodeTitle: string
  url: string
  videoId?: string
}

/**
 * 视频缓存后台下载管理器（全局单例）。
 *
 * 与音频 downloadManager 同理：把「onVideoDownloadEvent 监听」与「taskId↔url↔元数据」映射
 * 提升到应用生命周期级别，而不是挂在某个页面组件里。这样即便用户从详情页切走，
 * 主进程的下载仍在继续，进度与完成事件也能持续写入全局 store，
 * 不会因页面卸载而丢失（旧实现挂在 VideoDetail 内，切页即停止追踪、完成也不落库）。
 */
class VideoDownloadManagerService {
  private initialized = false
  private pendingRef = new Map<string, PendingMeta>()
  private taskUrlRef = new Map<string, string>()
  private urlTaskRef = new Map<string, string>()

  ensureInitialized(): void {
    if (this.initialized) return
    const api = window.electronAPI
    if (!api?.onVideoDownloadEvent) return
    this.initialized = true
    api.onVideoDownloadEvent((payload) => this.handleEvent(payload))
  }

  private handleEvent(payload: VideoDownloadEventPayload): void {
    const url = this.taskUrlRef.get(payload.taskId)
    if (!url) return
    const store = useVideoStore.getState()

    if (payload.status === 'completed') {
      const pending = this.pendingRef.get(payload.taskId)
      if (pending && payload.filePath) {
        // 统一用 filePath 作为缓存项的唯一 id（与 scanCache 同步），避免「下载完成一条 + 扫描补一条」出现重复记录。
        store.addDownload({
          id: `cache:${payload.filePath}`,
          videoName: pending.videoName,
          episodeTitle: pending.episodeTitle,
          url: pending.url,
          filePath: payload.filePath,
          status: 'completed',
          downloadedAt: Date.now(),
          videoId: pending.videoId,
        })
      }
      this.pendingRef.delete(payload.taskId)
      this.taskUrlRef.delete(payload.taskId)
      this.urlTaskRef.delete(url)
      store.clearActiveDownload(url)
      return
    }

    if (payload.status === 'failed') {
      this.pendingRef.delete(payload.taskId)
      this.taskUrlRef.delete(payload.taskId)
      this.urlTaskRef.delete(url)
      store.setActiveDownload(url, { progress: 0, status: 'failed', error: payload.error })
      return
    }

    store.setActiveDownload(url, {
      progress: payload.progress,
      status: payload.status,
      taskId: payload.taskId,
    })
  }

  async startDownload(video: VideoDetail, episode: VideoEpisode, cacheDirectory?: string): Promise<void> {
    const api = window.electronAPI
    if (!api?.startVideoDownload) {
      // 手机 / 浏览器：CapacitorHttp 直链下载到 IndexedDB。
      await this.startWebDownload(video, episode)
      return
    }

    const taskId = `dl_${Math.random().toString(36).slice(2, 10)}`
    this.pendingRef.set(taskId, {
      videoName: video.name,
      episodeTitle: episode.title,
      url: episode.url,
      videoId: video.id,
    })
    this.taskUrlRef.set(taskId, episode.url)
    this.urlTaskRef.set(episode.url, taskId)
    useVideoStore.getState().setActiveDownload(episode.url, { progress: 0, status: 'pending', taskId })

    try {
      await api.startVideoDownload({
        taskId,
        videoName: video.name,
        episodeTitle: episode.title,
        url: episode.url,
        targetDirectory: cacheDirectory || undefined,
      })
    } catch (error) {
      this.pendingRef.delete(taskId)
      this.taskUrlRef.delete(taskId)
      this.urlTaskRef.delete(episode.url)
      useVideoStore.getState().setActiveDownload(episode.url, {
        progress: 0,
        status: 'failed',
        error: error instanceof Error ? error.message : '缓存失败',
      })
    }
  }

  private async startWebDownload(video: VideoDetail, episode: VideoEpisode): Promise<void> {
    const store = useVideoStore.getState()
    const taskId = `dl_${Math.random().toString(36).slice(2, 10)}`
    this.pendingRef.set(taskId, {
      videoName: video.name,
      episodeTitle: episode.title,
      url: episode.url,
      videoId: video.id,
    })
    this.taskUrlRef.set(taskId, episode.url)
    this.urlTaskRef.set(episode.url, taskId)
    store.setActiveDownload(episode.url, { progress: 0, status: 'downloading', taskId })

    try {
      const { id, size } = await downloadWebVideo(episode.url)
      store.addDownload({
        id: `cache:web://${id}`,
        videoName: video.name,
        episodeTitle: episode.title,
        url: episode.url,
        filePath: `web://${id}`,
        size,
        status: 'completed',
        downloadedAt: Date.now(),
        videoId: video.id,
      })
      store.setActiveDownload(episode.url, { progress: 100, status: 'completed', taskId })
    } catch (error) {
      store.setActiveDownload(episode.url, {
        progress: 0,
        status: 'failed',
        error: error instanceof Error ? error.message : '视频缓存失败',
      })
    } finally {
      this.pendingRef.delete(taskId)
      this.taskUrlRef.delete(taskId)
      this.urlTaskRef.delete(episode.url)
    }
  }

  async cancelDownload(url: string): Promise<void> {
    const taskId = this.urlTaskRef.get(url)
    const api = window.electronAPI
    if (taskId && api?.cancelVideoDownload) {
      try {
        await api.cancelVideoDownload(taskId)
      } catch {
        // 下载可能已结束，忽略
      }
      this.pendingRef.delete(taskId)
      this.taskUrlRef.delete(taskId)
      this.urlTaskRef.delete(url)
    }
    useVideoStore.getState().clearActiveDownload(url)
  }
}

export const videoDownloadManager = new VideoDownloadManagerService()
export default videoDownloadManager
