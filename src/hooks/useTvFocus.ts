import { useEffect, useRef, useCallback } from 'react'

/**
 * TV (10-foot UI) focus navigation.
 *
 * When the app is running in TV mode (detected via `useResponsiveViewport`),
 * direction keys move focus between focusable elements on the page.
 *
 * Strategy:
 * - On Arrow keys, compute all focusable elements in the viewport, find the
 *   best candidate in the pressed direction (nearest by distance, preferring
 *   same axis), and focus it.
 * - Enter/Space activates the focused element (native behavior for buttons/links).
 * - Backspace navigates back.
 *
 * Usage: call `useTvFocus()` once per page (or globally in Layout).
 */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[data-tv-focus]',
  '.cursor-pointer',
  '[role="button"]',
].join(',')

const isTvViewport = () => {
  if (typeof window === 'undefined') return false
  const w = window.innerWidth
  const h = window.innerHeight
  const isLargeScreen = w >= 1280
  const isCoarse = window.matchMedia('(pointer: coarse)').matches
  const isLandscapeLike = w > h
  return isLargeScreen && isCoarse && isLandscapeLike
}

const getFocusableElements = (): HTMLElement[] => {
  const all = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
  return all.filter((el) => {
    const style = window.getComputedStyle(el)
    if (style.visibility === 'hidden' || style.display === 'none') return false
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) return false
    // Skip elements outside the viewport
    if (rect.bottom < -10 || rect.top > window.innerHeight + 10) return false
    if (rect.right < -10 || rect.left > window.innerWidth + 10) return false
    return true
  }).map((el) => {
    // Make clickable divs (cursor-pointer) focusable for D-pad navigation
    if (el.matches('.cursor-pointer, [role="button"]') && !el.hasAttribute('tabindex')) {
      el.setAttribute('tabindex', '0')
    }
    return el
  })
}

const getCenter = (rect: DOMRect) => ({
  x: rect.left + rect.width / 2,
  y: rect.top + rect.height / 2,
})

const findBestCandidate = (
  elements: HTMLElement[],
  current: HTMLElement | null,
  direction: 'up' | 'down' | 'left' | 'right',
): HTMLElement | null => {
  const currentRect = current?.getBoundingClientRect() ?? { left: window.innerWidth / 2, top: window.innerHeight / 2, width: 0, height: 0 }
  const currentCenter = {
    x: currentRect.left + currentRect.width / 2,
    y: currentRect.top + currentRect.height / 2,
  }

  let best: HTMLElement | null = null
  let bestScore = Infinity

  for (const el of elements) {
    if (el === current) continue
    const rect = el.getBoundingClientRect()
    const center = getCenter(rect)

    let dx = center.x - currentCenter.x
    let dy = center.y - currentCenter.y

    // Direction gating
    if (direction === 'up' && dy >= -1) continue
    if (direction === 'down' && dy <= 1) continue
    if (direction === 'left' && dx >= -1) continue
    if (direction === 'right' && dx <= 1) continue

    // Primary axis distance + small penalty for off-axis drift
    let score: number
    if (direction === 'up' || direction === 'down') {
      const primary = Math.abs(dy)
      const secondary = Math.abs(dx)
      score = primary + secondary * 0.6
      // Prefer elements roughly aligned on the same column
      if (secondary > 120) score += secondary
    } else {
      const primary = Math.abs(dx)
      const secondary = Math.abs(dy)
      score = primary + secondary * 0.6
      if (secondary > 120) score += secondary
    }

    if (score < bestScore) {
      bestScore = score
      best = el
    }
  }

  return best
}

export function useTvFocus(enabled = true) {
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!enabledRef.current) return
    if (!isTvViewport()) return

    // Ignore when typing in inputs
    const target = e.target as HTMLElement
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) {
      // Still allow Escape etc.
      return
    }

    // Elements that handle arrow keys themselves (e.g. video players, sliders)
    if (target && target.closest && target.closest('[data-tv-arrows="self"]')) {
      return
    }

    // Pages that declare themselves arrow-key handlers (window-level listeners, e.g. novel reader)
    if (typeof document !== 'undefined' && document.querySelector('[data-tv-arrows="page"]')) {
      return
    }

    const directionMap: Record<string, 'up' | 'down' | 'left' | 'right'> = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
    }

    const direction = directionMap[e.key]
    if (!direction) return

    // If a modal/dialog is open (role=dialog ancestor), still navigate within it
    e.preventDefault()
    const active = document.activeElement as HTMLElement | null
    const elements = getFocusableElements()
    const next = findBestCandidate(elements, active, direction)
    if (next) {
      next.focus({ preventScroll: false })
      next.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [enabled, handleKeyDown])
}

/**
 * TV focus styles — applied to :focus-visible in CSS for TV viewport.
 * This hook just provides runtime helpers; styles live in index.css.
 */
export function useTvPageFocus(enabled = true) {
  useTvFocus(enabled)
}
