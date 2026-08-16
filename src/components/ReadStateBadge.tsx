import { Check } from 'lucide-react'
import { cn } from '@/utils/cn'

export type ReadState = 'none' | 'read' | 'last'
export type ReadTone = 'red' | 'amber' | 'emerald'

const TONE: Record<ReadTone, { fg: string; bg: string }> = {
  red: { fg: 'text-red-500', bg: 'bg-red-500' },
  amber: { fg: 'text-amber-500', bg: 'bg-amber-500' },
  emerald: { fg: 'text-emerald-500', bg: 'bg-emerald-500' },
}

export interface ReadStateBadgeProps {
  /** 状态：read=已读/已观看(角标✓)；last=上次读到/上次观看(圆点)；none=不显示 */
  state: ReadState
  /** 强调色调，默认红（视频集数）；小说目录用 amber */
  tone?: ReadTone
  /** 反色：父容器已是强调色（如正在播放/选中）时，标记显示为白底强调字/白点 */
  inverted?: boolean
  className?: string
}

/**
 * 跨模块「已读态」标记组件，章节(小说)与集数(视频)共用，统一视觉语义：
 * - read：右上角圆形 ✓，表示已读 / 已观看
 * - last：行首小圆点，表示上次读到 / 上次观看
 */
export default function ReadStateBadge({ state, tone = 'red', inverted = false, className = '' }: ReadStateBadgeProps) {
  if (state === 'none') return null
  const t = TONE[tone]

  if (state === 'read') {
    return (
      <span
        className={cn(
          'absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full shadow-sm',
          inverted ? cn('bg-white', t.fg) : cn(t.bg, 'text-white'),
          className,
        )}
        aria-hidden
      >
        <Check className="h-2.5 w-2.5" strokeWidth={3.5} />
      </span>
    )
  }

  // last：行首小圆点
  return (
    <span
      className={cn('h-1.5 w-1.5 shrink-0 rounded-full', inverted ? 'bg-white' : t.bg, className)}
      aria-hidden
    />
  )
}
