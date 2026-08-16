import type { ComponentType } from 'react'
import { Disc3, ListMusic, Sparkles } from 'lucide-react'
import type { LyricsPlayerMode } from '@/types'

export type PlayerModeConfig = {
  id: LyricsPlayerMode
  label: string
  description: string
  icon: ComponentType<{ className?: string }>
}

export const PLAYER_MODE_OPTIONS: PlayerModeConfig[] = [
  {
    id: 'default',
    label: '经典',
    description: '封面、控制和歌词分栏显示',
    icon: ListMusic,
  },
  {
    id: 'amll',
    label: 'Apple Music',
    description: '动态背景与逐字歌词',
    icon: Disc3,
  },
  {
    id: 'mineradio',
    label: 'Mineradio',
    description: '封面粒子、3D 舞台歌词与电影镜头',
    icon: Sparkles,
  },
]

export const isLyricsPlayerMode = (value: unknown): value is LyricsPlayerMode => (
  typeof value === 'string' && PLAYER_MODE_OPTIONS.some((mode) => mode.id === value)
)
