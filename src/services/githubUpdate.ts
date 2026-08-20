import { APP_VERSION, GITHUB_REPO } from '@/config'

export interface GithubUpdateInfo {
  hasUpdate: boolean
  latestVersion: string
  releaseNotes: string[]
  downloadUrl: string
  releaseUrl: string
  publishedAt?: string
}

interface GithubReleaseAsset {
  name?: string
  browser_download_url?: string
}

interface GithubRelease {
  tag_name?: string
  name?: string
  body?: string
  html_url?: string
  published_at?: string
  prerelease?: boolean
  draft?: boolean
  assets?: GithubReleaseAsset[]
}

const normalizeVersion = (value: string) => value.trim().replace(/^v/i, '')

const parseVersionParts = (value: string): number[] => {
  const normalized = normalizeVersion(value)
  const match = normalized.match(/\d+(?:\.\d+)*/)
  if (!match) return [0]
  return match[0].split('.').map((part) => Number.parseInt(part, 10) || 0)
}

export const compareVersions = (left: string, right: string): number => {
  const a = parseVersionParts(left)
  const b = parseVersionParts(right)
  const length = Math.max(a.length, b.length)

  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0)
    if (diff !== 0) return diff
  }

  return 0
}

const getPlatformAssetHints = (): string[] => {
  const userAgent = navigator.userAgent.toLowerCase()
  if (userAgent.includes('mac')) return ['arm64.dmg', 'x64.dmg', '.dmg', '.zip']
  if (userAgent.includes('linux')) return ['.appimage', '.deb']
  return ['.exe']
}

const pickDownloadUrl = (release: GithubRelease): string => {
  const assets = Array.isArray(release.assets) ? release.assets : []
  const hints = getPlatformAssetHints()

  for (const hint of hints) {
    const matched = assets.find((asset) => {
      const name = String(asset.name || '').toLowerCase()
      return name.includes(hint)
    })
    if (matched?.browser_download_url) return matched.browser_download_url
  }

  return assets.find((asset) => asset.browser_download_url)?.browser_download_url
    || release.html_url
    || `https://github.com/${GITHUB_REPO}/releases`
}

const parseReleaseNotes = (body?: string): string[] => {
  const lines = String(body || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 30)

  return lines.length ? lines : ['查看 GitHub Release 获取更新内容。']
}

const isGithubRateLimited = (response: Response) => (
  response.status === 403
  && response.headers.get('X-RateLimit-Remaining') === '0'
)

const UPDATE_CACHE_KEY = 'github-update-cache-v1'
const UPDATE_CACHE_TTL_MS = 60 * 60 * 1000

const readUpdateCache = (): GithubUpdateInfo | null => {
  try {
    const raw = localStorage.getItem(UPDATE_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { cachedAt?: number; value?: GithubUpdateInfo }
    if (typeof parsed?.cachedAt !== 'number' || Date.now() - parsed.cachedAt > UPDATE_CACHE_TTL_MS) {
      localStorage.removeItem(UPDATE_CACHE_KEY)
      return null
    }
    return parsed.value || null
  } catch {
    return null
  }
}

const writeUpdateCache = (value: GithubUpdateInfo) => {
  try {
    localStorage.setItem(UPDATE_CACHE_KEY, JSON.stringify({ cachedAt: Date.now(), value }))
  } catch {
    // ignore quota errors
  }
}

export const checkGithubUpdate = async(currentVersion = APP_VERSION): Promise<GithubUpdateInfo> => {
  const cached = readUpdateCache()
  if (cached) return cached

  const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
    headers: {
      Accept: 'application/vnd.github+json',
    },
    // 启动时后台检查更新，不能因 GitHub API 被墙/限流而无限挂起（曾导致启动阻塞数分钟）。
    signal: AbortSignal.timeout(8000),
  })

  if (!response.ok) {
    const fallback: GithubUpdateInfo = {
      hasUpdate: false,
      latestVersion: currentVersion,
      releaseNotes: [],
      downloadUrl: `https://github.com/${GITHUB_REPO}/releases`,
      releaseUrl: `https://github.com/${GITHUB_REPO}/releases`,
    }
    if (isGithubRateLimited(response)) {
      console.debug('GitHub Release 检查跳过：API rate limit exceeded')
      writeUpdateCache(fallback)
      return fallback
    }
    throw new Error(`GitHub Release 检查失败：${response.status}`)
  }

  const release = await response.json() as GithubRelease
  const latestVersion = normalizeVersion(release.tag_name || release.name || '')
  const releaseUrl = release.html_url || `https://github.com/${GITHUB_REPO}/releases`

  const result: GithubUpdateInfo = !latestVersion
    ? {
      hasUpdate: false,
      latestVersion: currentVersion,
      releaseNotes: [],
      downloadUrl: releaseUrl,
      releaseUrl,
      publishedAt: release.published_at,
    }
    : {
      hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
      latestVersion,
      releaseNotes: parseReleaseNotes(release.body),
      downloadUrl: pickDownloadUrl(release),
      releaseUrl,
      publishedAt: release.published_at,
    }
  writeUpdateCache(result)
  return result
}
