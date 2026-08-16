import type { LyricData } from '@/types'
import type { MineradioLyricLine, MineradioLyricWord } from '@/vendor/mineradio/engine'
import { convertSollinLyricsToAmll } from '@/utils/amllLyricConverter'

export interface MineradioLyricsResult {
  lines: MineradioLyricLine[]
  hasKaraoke: boolean
  timingSource: string
}

/**
 * 把 Sollin 的歌词数据转换为 Mineradio 舞台歌词引擎的行格式：
 *   { t(秒), duration(秒), text, words:[{text, t, d, c0, c1}], charCount, source }
 * words 存在时舞台歌词做逐字卡拉OK擦除，否则按整行进度平滑填充。
 */
export function convertLyricsToMineradio(
  lyricData: LyricData | null,
  fallbackLyrics: string | null,
): MineradioLyricsResult {
  const amllLines = convertSollinLyricsToAmll(lyricData, fallbackLyrics)
  const lines: MineradioLyricLine[] = []
  let karaokeLines = 0

  for (const line of amllLines) {
    const rawWords = line.words || []
    let text = ''
    const words: MineradioLyricWord[] = []

    for (const word of rawWords) {
      const wordText = String(word.word || '')
      if (!wordText) continue
      const c0 = text.length
      text += wordText
      words.push({
        text: wordText,
        t: word.startTime / 1000,
        d: Math.max(0.06, (word.endTime - word.startTime) / 1000),
        c0,
        c1: text.length,
      })
    }

    const trimmed = text.replace(/\s+/g, ' ').trim()
    if (!trimmed) continue

    // 逐字信息只有在多词且时间戳有区分度时才有意义；纯 LRC 转换出的
    // 单词行（整行一个 word）按行级时间处理。
    const isWordTimed = words.length > 1
    if (isWordTimed) karaokeLines += 1

    const startSec = line.startTime / 1000
    const durationSec = Math.max(0.06, (line.endTime - line.startTime) / 1000)

    if (isWordTimed && trimmed.length !== text.length) {
      // 折叠空白后修正字符区间
      let compact = ''
      let cursor = 0
      for (const w of words) {
        const compactText = w.text.replace(/\s+/g, ' ')
        w.c0 = cursor
        compact += compactText
        cursor = compact.length
        w.c1 = cursor
      }
    }

    lines.push({
      t: startSec,
      duration: durationSec,
      text: trimmed,
      words: isWordTimed ? words : undefined,
      charCount: Math.max(1, trimmed.length),
      source: isWordTimed ? 'yrc-word' : 'lrc',
    })
  }

  lines.sort((a, b) => a.t - b.t)

  // 行时长兜底：无 duration 或重叠时用下一行起点收口（对应 finalizeLyricLineDurations）
  for (let i = 0; i < lines.length; i += 1) {
    const next = lines[i + 1]
    const current = lines[i]
    if (next) {
      const gap = Math.max(0.06, next.t - current.t)
      current.duration = Math.min(current.duration || gap, gap)
    } else if (!current.duration) {
      current.duration = 6
    }
  }

  const hasKaraoke = karaokeLines > 0 && karaokeLines >= Math.ceil(lines.length * 0.3)
  return {
    lines,
    hasKaraoke,
    timingSource: hasKaraoke ? 'yrc-word' : (lines.length ? 'lrc' : 'none'),
  }
}
