import { ref } from 'vue'

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

export function useDigSession() {
  function takePage(query: string): number {
    return nextPage.get(query) ?? 1
  }

  function advance(query: string, lastPageUsed: number) {
    nextPage.set(query, lastPageUsed + 1)
  }

  function remember(ids: string[]) {
    for (const id of ids) seen.add(id)
    seenCount.value = seen.size
  }

  function markDrained(query: string) {
    drained.add(query)
  }

  function isDrained(query: string): boolean {
    return drained.has(query)
  }

  return {
    seen: seen as ReadonlySet<string>,
    seenCount,
    takePage,
    advance,
    remember,
    markDrained,
    isDrained,
  }
}
