import { useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, FolderOpen, Trash2 } from 'lucide-react'
import StatusState from '@/components/StatusState'
import { VideoPlayer } from '@/pages/VideoDetail'
import { useVideoStore } from '@/stores/videoStore'
import { isWebCachedPath, getWebCacheId, removeWebVideoFile } from '@/services/webVideoCache'
import type { VideoDetail, VideoEpisode } from '@/types/video'

// 孤儿缓存文件（磁盘上无元数据的视频）走应用内播放：把本地文件路径合成单集，
// 复用主播放器直接播放，不再丢给系统外部播放器。
const toFileUrl = (filePath: string) => {
  const normalized = filePath.replace(/\\/g, '/')
  return normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`
}

// 从文件名推断「剧名 / 集数标题」，与 videoStore.buildCacheItemFromFile 的命名规则保持一致
// （文件名形如「剧名-第3集.mp4」时拆分出两部分）。
const inferNames = (filePath: string) => {
  const base = filePath.replace(/\\/g, '/').split('/').pop() || ''
  const nameWithoutExt = base.replace(/\.[^.]+$/, '')
  const dashIndex = nameWithoutExt.lastIndexOf('-')
  const videoName = dashIndex > 0 ? nameWithoutExt.slice(0, dashIndex).trim() : nameWithoutExt
  const episodeTitle = dashIndex > 0 ? nameWithoutExt.slice(dashIndex + 1).trim() : nameWithoutExt
  return { videoName, episodeTitle }
}

export default function VideoOfflinePlayback() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const filePath = searchParams.get('file')
  const paramName = searchParams.get('name')
  const paramTitle = searchParams.get('title')

  const parsed = useMemo(() => {
    if (!filePath) return null
    const { videoName, episodeTitle } = inferNames(filePath)
    const name = paramName || videoName
    const title = paramTitle || episodeTitle || videoName
    const url = toFileUrl(filePath)
    const video: VideoDetail = {
      id: `offline:${filePath}`,
      rawId: filePath,
      name,
      typeId: '',
      typeName: '',
      slug: '',
      updatedAt: '',
      remarks: '本地离线文件',
      playFrom: [],
      sourceId: 'offline',
      sourceName: '本地文件',
      episodes: [],
      sources: [],
    }
    const episode: VideoEpisode = { title, url, source: '离线', sourceIndex: 0 }
    return { video, episode }
  }, [filePath, paramName, paramTitle])

  const handleOpenFolder = () => {
    if (filePath) window.electronAPI?.showVideoCacheItemInFolder(filePath)
  }

  const handleDelete = async () => {
    if (!filePath) return
    if (!window.confirm('确定删除该离线文件吗？此操作不可恢复。')) return
    if (isWebCachedPath(filePath)) {
      const cacheId = getWebCacheId(filePath)
      if (cacheId) {
        try {
          await removeWebVideoFile(cacheId)
        } catch {
          // ignore
        }
      }
    } else {
      try {
        await window.electronAPI?.deleteVideoCacheItem(filePath)
      } catch {
        // 文件可能已被外部移除，忽略后继续清理记录
      }
    }
    useVideoStore.getState().removeDownload(`cache:${filePath}`)
    navigate(-1)
  }

  if (!filePath || !parsed) {
    return (
      <div className="pb-8">
        <button onClick={() => navigate(-1)} className="mb-6 flex items-center gap-2 text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
          <ArrowLeft className="h-5 w-5" />返回
        </button>
        <StatusState
          variant="error"
          title="无法播放"
          description="缺少本地文件路径，请从「离线缓存」重新打开。"
          actionLabel="返回"
          onAction={() => navigate(-1)}
        />
      </div>
    )
  }

  return (
    <div className="pb-10">
      <button onClick={() => navigate(-1)} className="mb-6 flex items-center gap-2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">
        <ArrowLeft className="h-5 w-5" />返回
      </button>

      <VideoPlayer video={parsed.video} episode={parsed.episode} />

      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-black/5 dark:border-white/10 bg-white/60 dark:bg-gray-900/50 p-3 shadow-sm">
        <span className="text-sm text-[var(--text-muted)]">当前集缓存</span>
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-3 py-1 text-sm font-semibold text-blue-600 dark:text-blue-300">
          <FolderOpen className="h-3.5 w-3.5" /> 正在离线播放（本地文件）
        </span>
        {!isWebCachedPath(filePath) && (
          <button onClick={handleOpenFolder} className="inline-flex items-center gap-1 rounded-full border border-black/10 dark:border-white/10 px-3 py-1 text-sm hover:bg-black/5 dark:hover:bg-white/10">打开所在文件夹</button>
        )}
        <button onClick={handleDelete} className="inline-flex items-center gap-1 rounded-full border border-red-500/20 px-3 py-1 text-sm text-red-500 hover:bg-red-500/10"><Trash2 className="h-3.5 w-3.5" /> 删除</button>
      </div>
    </div>
  )
}
