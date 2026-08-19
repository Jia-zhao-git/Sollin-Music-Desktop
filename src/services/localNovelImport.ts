/**
 * 本地小说（TXT）导入 —— Web / 手机端实现。
 *
 * 桌面端由 Electron 主进程完成（novel:import-files：文件对话框 + fs 读取 + GBK 解码 + 章节切分）。
 * 手机端没有 Electron IPC，这里用文件选择器 + 浏览器解码复刻同样的解析逻辑：
 *  - 编码：优先 UTF-8（fatal），失败回退 GBK（与桌面 decodeTextBuffer 行为一致）
 *  - 章节切分：与 electron/main.ts 的 parseNovelTextToChapters 保持一致
 */

import type { LocalBook, LocalChapter } from '@/types/novel'

const parseNovelTextToChapters = (raw: string): Array<{ title: string; content: string }> => {
  const text = raw.replace(/\r\n?/g, '\n')
  const headingRegex = /^\s*(?:第\s*[0-9零一二三四五六七八九十百千两]+\s*[章回卷节部集]|Chapter\s*\d+|楔子|引子|番外|后记|尾声|序章|终章)\b/i
  const lines = text.split('\n')
  const chapters: Array<{ title: string; content: string }> = []
  let current: { title: string; content: string } | null = null
  let firstHeadingMatched = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (headingRegex.test(trimmed)) {
      firstHeadingMatched = true
      if (current) chapters.push(current)
      current = { title: trimmed.slice(0, 80), content: '' }
    } else {
      if (!current) current = { title: '正文', content: '' }
      current.content += `${line}\n`
    }
  }
  if (current) chapters.push(current)

  if (!firstHeadingMatched) {
    return [{ title: '正文', content: text }]
  }
  return chapters.length ? chapters : [{ title: '正文', content: text }]
}

const decodeTextFile = async (file: File): Promise<string> => {
  const buffer = await file.arrayBuffer()
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    // 桌面端同样在 UTF-8 解码失败后尝试 GBK。
    return new TextDecoder('gbk').decode(buffer)
  }
}

const hashText = async (value: string): Promise<string> => {
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

export const buildLocalBookFromText = async (fileName: string, text: string): Promise<LocalBook> => {
  const chapters: LocalChapter[] = parseNovelTextToChapters(text).map((chapter, index) => ({
    id: `ch-${index + 1}`,
    title: chapter.title,
    content: chapter.content.trim(),
  }))
  const name = fileName.replace(/\.[^.]+$/, '') || '未命名小说'
  const fileId = `local:${await hashText(`${name}:${text.slice(0, 2048)}`)}`
  return {
    id: fileId,
    name,
    sourceName: '本地导入',
    chapters,
    importedAt: Date.now(),
    format: 'txt',
  }
}

export const importNovelFiles = async (files: FileList | File[]): Promise<LocalBook[]> => {
  const books: LocalBook[] = []
  for (const file of Array.from(files)) {
    try {
      const text = await decodeTextFile(file)
      books.push(await buildLocalBookFromText(file.name, text))
    } catch (error) {
      console.warn('[localNovelImport] parse failed:', file.name, error)
    }
  }
  return books
}
