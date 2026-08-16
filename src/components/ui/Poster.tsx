import { useEffect, useState } from 'react'
import { Clapperboard } from 'lucide-react'
import { cn } from '@/utils/cn'

interface PosterProps {
  src?: string
  title: string
  /** 尺寸/圆角由调用方父容器控制（父级负责 aspect 比例与背景渐变） */
  className?: string
  /** 首屏卡片用 eager，其余懒加载 */
  priority?: boolean
  iconClassName?: string
}

/**
 * 视频海报统一组件：处理「加载中 / 加载失败 / url 为空」三态。
 * 背景与宽高比交由父容器（aspect-[3/4] + bg-gradient）控制，组件本身只负责图与兜底占位。
 * 零依赖；不调用 electronAPI，web 预览天然兼容。
 */
export default function Poster({ src, title, className, priority = false, iconClassName = 'h-12 w-12' }: PosterProps) {
  const url = src?.trim()
  const [failed, setFailed] = useState(false)

  // src 变化（翻页/换源）即重置，避免同位置节点复用残留兜底态。
  useEffect(() => {
    setFailed(false)
  }, [url])

  if (!url || failed) {
    return (
      <div className={cn('grid h-full w-full place-items-center gap-1.5 overflow-hidden', className)}>
        <Clapperboard className={cn(iconClassName, 'text-white/35')} strokeWidth={1.8} aria-hidden />
        <span className="px-2 text-center text-[10px] leading-tight text-[var(--text-muted)] line-clamp-2">{title}</span>
      </div>
    )
  }

  return (
    <img
      src={url}
      alt={title}
      className={cn('h-full w-full object-cover transition-transform duration-500 group-hover:scale-105', className)}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  )
}
