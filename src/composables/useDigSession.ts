import { ref } from 'vue'
import type { Record as CrateRecord } from '../providers/types'

/**
 * What's been dug up this session.
 *
 * Deliberately module scope and never written to storage: a page refresh is
 * a fresh session and the whole archive opens back up. Nothing here is worth
 * keeping — the things you actually wanted are already flagged.
 */
const seen = new Set<string>()

/** Next unfetched page per query, so each dig goes deeper rather than repeating. */
const nextPage = new Map<string, number>()

/** Queries whose results we've paged all the way through. */
const drained = new Set<string>()

/** Bumped so the UI can react to the counter changing. */
const seenCount = ref(0)

/** A crate as it was last shown, so coming back doesn't cost a fetch. */
export interface CachedView {
  key: string
  /** Crate id, or null when the view came from a search. */
  tag: string | null
  query: string
  label: string
  records: CrateRecord[]
  totalFound: number
  drained: boolean
  scrollTop: number
}

const views = new Map<string, CachedView>()
/** The view to restore when Browse mounts. */
let lastKey: string | null = null

export function useDigSession() {
  function takePage(query: string): number {
    return nextPage.get(query) ?? 1
  }

  function advance(query: string, lastPageUsed: number) {
    nextPage.set(query, lastPageUsed + 1)
  }

  /** Always called, even on an unfiltered load — remembering is not excluding. */
  function remember(ids: string[]) {
    for (const id of ids) seen.add(id)
    seenCount.value = seen.size
  }

  /**
   * Forgets everything dug up so far, opening the whole archive back up.
   *
   * Page positions go with it. Excluding nothing but still starting from
   * page seven would leave the first six pages exactly as unreachable as
   * they were, which isn't what resetting the filter means. Cached views
   * stay — what's on screen is still perfectly good to look at.
   */
  function reset() {
    seen.clear()
    nextPage.clear()
    drained.clear()
    for (const view of views.values()) view.drained = false
    seenCount.value = 0
  }

  function markDrained(query: string) {
    drained.add(query)
  }

  function isDrained(query: string): boolean {
    return drained.has(query)
  }

  function cacheView(view: CachedView) {
    views.set(view.key, view)
    lastKey = view.key
  }

  function getView(key: string): CachedView | undefined {
    return views.get(key)
  }

  /** Restoring a cached crate makes it the one to come back to. */
  function setLast(key: string) {
    if (views.has(key)) lastKey = key
  }

  function lastView(): CachedView | undefined {
    return lastKey ? views.get(lastKey) : undefined
  }

  function rememberScroll(key: string, scrollTop: number) {
    const v = views.get(key)
    if (v) v.scrollTop = scrollTop
  }

  return {
    seen: seen as ReadonlySet<string>,
    seenCount,
    takePage,
    advance,
    remember,
    reset,
    markDrained,
    isDrained,
    cacheView,
    getView,
    setLast,
    lastView,
    rememberScroll,
  }
}
