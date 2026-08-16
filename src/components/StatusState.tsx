import type { LucideIcon } from 'lucide-react'
import { AlertTriangle, Inbox, Loader2, RotateCcw } from 'lucide-react'

export type StatusVariant = 'loading' | 'empty' | 'error'

export interface StatusStateProps {
  variant: StatusVariant
  /** 自定义图标；缺省按 variant 自动选择（loading=转圈 / error=警告 / empty=空盒） */
  icon?: LucideIcon
  /** 主标题，缺省按 variant 给出通用文案 */
  title?: string
  /** 次要说明文案 */
  description?: string
  /** 操作按钮文案；配合 onAction 显示（error 默认给出「重试」按钮） */
  actionLabel?: string
  /** 操作按钮回调 */
  onAction?: () => void
  /** 附加类名 */
  className?: string
  /** 紧凑模式：减小上下留白，适合嵌在卡片/列表内部 */
  compact?: boolean
}

const DEFAULT_TITLE: Record<StatusVariant, string> = {
  loading: '加载中…',
  empty: '这里空空如也',
  error: '出错了',
}

const ICON_COLOR: Record<StatusVariant, string> = {
  loading: 'text-[var(--text-muted)]',
  empty: 'text-[var(--text-muted)]',
  error: 'text-red-500',
}

/**
 * 统一的加载 / 空 / 错误状态组件，跨模块复用，保证一致的视觉与交互。
 * - loading：旋转加载图标，不打断布局。
 * - empty：空态提示，可配 icon/description。
 * - error：错误提示 + 可选操作按钮（默认「重试」）。
 */
export default function StatusState({
  variant,
  icon,
  title,
  description,
  actionLabel,
  onAction,
  className = '',
  compact = false,
}: StatusStateProps) {
  const Icon = icon ?? (variant === 'loading' ? Loader2 : variant === 'error' ? AlertTriangle : Inbox)
  const resolvedTitle = title ?? DEFAULT_TITLE[variant]
  const showAction = variant === 'error' && Boolean(actionLabel && onAction)

  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 text-center ${compact ? 'py-6' : 'py-12'} ${className}`}
      role={variant === 'error' ? 'alert' : undefined}
    >
      <Icon
        className={`h-9 w-9 ${variant === 'loading' ? 'animate-spin' : ''} ${ICON_COLOR[variant]}`}
        strokeWidth={variant === 'loading' ? 2.4 : 1.8}
      />
      <div className="space-y-1">
        {resolvedTitle && <p className="text-base font-semibold text-[var(--text-primary)]">{resolvedTitle}</p>}
        {description && <p className="max-w-md text-sm text-[var(--text-muted)]">{description}</p>}
      </div>
      {showAction && (
        <button
          onClick={onAction}
          className="mt-1 inline-flex items-center gap-2 rounded-2xl bg-red-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-600"
        >
          <RotateCcw className="h-4 w-4" /> {actionLabel}
        </button>
      )}
    </div>
  )
}
