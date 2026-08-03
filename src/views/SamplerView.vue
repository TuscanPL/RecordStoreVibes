<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { provider, sourceLabel } from '../providers'
import type { Record as CrateRecord } from '../providers/types'
import { useLibrary } from '../stores/library'
import { PAD_COUNT, PAD_BANKS, padKey, type Pad } from '../stores/storage'
import { useSampler, semitonesToRate } from '../composables/useSampler'
import { makeZip, type ZipEntry } from '../lib/zip'
import { encodeWav } from '../lib/wav'
import { formatBytes } from '../composables/useWaveform'
import { useAudio, formatTime } from '../composables/useAudio'
import Waveform from '../components/Waveform.vue'

const props = defineProps<{ id: string; track: string }>()
const router = useRouter()
const library = useLibrary()
const sampler = useSampler()
const audio = useAudio()

const record = ref<CrateRecord | null>(null)
const loadError = ref<string | null>(null)

interface Range {
  startSec: number
  endSec: number
}

/**
 * The working range, and deliberately not a pad.
 *
 * It's the span lazy chop cuts within, and the thing a flag sets. Pads are
 * only ever made from it — copied, never the same object — so chopping can
 * rebuild the bank without destroying the range that produced it.
 */
const trim = ref<Range | null>(null)

/**
 * What the trim controls act on: the working range, or one pad.
 *
 * Tapping a pad points the nudges, zoom, Play and Roll at that chop so a
 * single slice can be adjusted properly. Touching the trim on the strip
 * points them back. CHOP always uses the trim regardless — that's the range
 * chopping happens inside.
 */
const focus = ref<'trim' | number>('trim')

/** Pad under the finger, for highlight and pitch editing. */
const activePad = computed<number | null>(() =>
  typeof focus.value === 'number' ? focus.value : null,
)

const trackName = computed(() => decodeURIComponent(props.track))
const key = computed(() => padKey(props.id, trackName.value))
/** Which bank of sixteen is on screen. Swipe the grid to change it. */
const bankIndex = ref(0)
const bank = computed(() => library.padsFor(key.value, bankIndex.value))
const bankCounts = computed(() => library.bankCounts(key.value))
const bankLetter = computed(() => String.fromCharCode(65 + bankIndex.value))

/** Everything below the trim controls, folded away by default. */
const showMore = ref(false)
const total = computed(() => sampler.buffer.value?.duration ?? 0)
const currentPad = computed<Pad | null>(() =>
  activePad.value === null ? null : (bank.value[activePad.value] ?? null),
)

/** The range the controls edit — a pad when one is focused, else the trim. */
const focused = computed<Range | null>(() => {
  const d = draft.value
  if (d && d.index === focus.value) return d.range
  if (focus.value === 'trim') return trim.value
  return bank.value[focus.value] ?? null
})

/** Writes an edit back to wherever focus is pointing. */
function writeFocused(range: Range) {
  if (focus.value === 'trim') {
    trim.value = range
    commitTrim()
    return
  }
  const pad = bank.value[focus.value]
  if (pad) library.setPad(key.value, bankIndex.value, focus.value, { ...pad, ...range })
}

const trackMeta = computed(
  () => record.value?.tracks.find(t => t.name === trackName.value) ?? null,
)

const MIN_LEN = 0.05

/* ---- zoom ---- */

const ZOOM_PAD = 0.15

/**
 * A ladder of window widths rather than an on/off toggle, following how the
 * SP-404 does it: knob two zooms the area around the point being edited, so
 * a marker can be placed by eye at whatever resolution the job needs.
 */
const ZOOM_LEVELS = [
  { label: 'ALL', span: 'all' },
  { label: 'FIT', span: 'fit' },
  { label: '8s', span: 8 },
  { label: '3s', span: 3 },
  { label: '1s', span: 1 },
  { label: '0.3s', span: 0.3 },
  { label: '0.1s', span: 0.1 },
] as const

const zoomLevel = ref(0)

/**
 * A window width pinched off the ladder, in seconds.
 *
 * The rungs are presets, not the model — a pinch lands wherever it lands and
 * being snapped to the nearest one would fight the finger. Null means the
 * ladder is in charge. Kept apart from the panned window so re-centring on a
 * pad keeps the magnification you pinched to.
 */
const zoomSpan = ref<number | null>(null)

/** Anything narrower is past the point of being able to see a waveform. */
const MIN_SPAN = 0.05

/**
 * What the strip does with a thumb.
 *
 * Zoomed in, the window is a few seconds of a several-minute track and it's
 * easy to lose the thread of where that is. Read mode gives the drag back to
 * the waveform so it can be pushed along like a scroll — nothing under the
 * finger is edited, so you can go looking without putting a chop wrong.
 * Edit mode is the working mode: draw a trim, grab an edge, retrim a chop.
 */
const stripMode = ref<'read' | 'edit'>('edit')

/**
 * What zoom centres on. Held rather than derived so it settles on the edge
 * that was last worked — moving the start point and zooming in should bring
 * you closer to that start point, not to the middle of the chop.
 */
const zoomCentre = ref(0)

/**
 * Where reading has pushed the window to, overriding what the zoom would
 * frame on its own.
 *
 * Kept as an explicit window rather than a centre because it has to survive
 * ALL and FIT, neither of which is built around one: FIT follows whatever is
 * focused, so a pan expressed as a centre would be argued back the moment
 * the focus moved. Any deliberate re-framing drops it.
 */
const panView = ref<{ start: number; end: number } | null>(null)

function recentreZoom(at?: number) {
  panView.value = null
  if (at !== undefined) {
    zoomCentre.value = at
    return
  }
  const f = focused.value
  if (f) zoomCentre.value = (f.startSec + f.endSec) / 2
}

function windowAround(start: number, end: number) {
  const span = Math.min(end - start, total.value)
  let a = Math.max(0, start)
  let b = Math.min(total.value, a + span)
  // Keep the width when the window runs off an end, rather than squashing it.
  if (b >= total.value) {
    b = total.value
    a = Math.max(0, b - span)
  }
  return { start: a, end: b }
}

/**
 * The slice of track on screen. Everything positional works against this
 * rather than the whole file, so zooming needs no separate code path.
 */
const view = computed(() => {
  if (total.value <= 0) return { start: 0, end: 0 }

  if (lazy.value) {
    const r = lazyRange.value
    const pad = Math.max(0.2, (r.end - r.start) * ZOOM_PAD)
    return windowAround(r.start - pad, r.end + pad)
  }

  if (panView.value) return panView.value

  if (zoomSpan.value !== null) {
    const half = zoomSpan.value / 2
    return windowAround(zoomCentre.value - half, zoomCentre.value + half)
  }

  const level = ZOOM_LEVELS[zoomLevel.value] ?? ZOOM_LEVELS[0]!
  if (level.span === 'all') return { start: 0, end: total.value }

  if (level.span === 'fit') {
    const f = focused.value
    if (!f) return { start: 0, end: total.value }
    const pad = Math.max(0.2, (f.endSec - f.startSec) * ZOOM_PAD)
    return windowAround(f.startSec - pad, f.endSec + pad)
  }

  const half = level.span / 2
  return windowAround(zoomCentre.value - half, zoomCentre.value + half)
})

function spanLabel(sec: number): string {
  if (sec >= 60) return `${Math.round(sec / 60)}m`
  if (sec >= 10) return `${Math.round(sec)}s`
  if (sec >= 1) return `${sec.toFixed(1)}s`
  return `${Math.round(sec * 1000)}ms`
}

const zoomLabel = computed(() =>
  zoomSpan.value !== null
    ? spanLabel(zoomSpan.value)
    : (ZOOM_LEVELS[zoomLevel.value] ?? ZOOM_LEVELS[0]!).label,
)

/**
 * The rung a pinched span sits closest to, so the ± buttons carry on from
 * where the fingers left off instead of from a level nothing is showing.
 * Compared on a log scale — the ladder is geometric, so 2s is nearer 3s than
 * it is to 1s by ratio even though the differences are equal.
 */
function nearestRung(span: number): number {
  let best = ZOOM_LEVELS.length - 1
  let bestDiff = Infinity
  ZOOM_LEVELS.forEach((l, i) => {
    if (typeof l.span !== 'number') return
    const d = Math.abs(Math.log(l.span / span))
    if (d < bestDiff) {
      bestDiff = d
      best = i
    }
  })
  return best
}

/** Where the ladder currently stands, pinch included. */
const rung = computed(() =>
  zoomSpan.value !== null ? nearestRung(zoomSpan.value) : zoomLevel.value,
)

function stepZoom(by: number) {
  const from = rung.value
  const next = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, from + by))
  if (next === from && zoomSpan.value === null) return
  const panned = panView.value
  // Zoom around wherever reading left off, or the middle of what was fitted.
  if (panned) recentreZoom((panned.start + panned.end) / 2)
  else if (from <= 1) recentreZoom()
  panView.value = null
  zoomSpan.value = null
  zoomLevel.value = next
  commitTrim()
}
const degraded = computed(() => sampler.rate.value > 0 && sampler.rate.value < 44100)

onMounted(async () => {
  // Entering the pads stops the record — two sources at once helps nobody.
  audio.pause()

  try {
    const fetched = await provider.getRecord(props.id)
    if (!fetched) {
      loadError.value = 'Record unavailable.'
      return
    }
    record.value = fetched
    const t = fetched.tracks.find(x => x.name === trackName.value)
    if (!t) {
      loadError.value = 'That track is gone.'
      return
    }
    await sampler.load(t.streamUrl, t.durationSec ?? 0)

    // Pick up exactly where this track was left. Clamped, because the
    // decoded duration can differ slightly from the metadata's.
    const saved = library.trimFor(key.value)
    if (saved && total.value > 0) {
      const start = Math.max(0, Math.min(saved.startSec, total.value - MIN_LEN))
      const end = Math.max(start + MIN_LEN, Math.min(saved.endSec, total.value))
      trim.value = { startSec: start, endSec: end }
      // `zoomed` predates the ladder: an old on/off save maps to FIT.
      zoomLevel.value = saved.zoom ?? (saved.zoomed ? 1 : 0)
      zoomSpan.value =
        saved.span && saved.span < total.value
          ? Math.max(MIN_SPAN, Math.min(total.value, saved.span))
          : null
      recentreZoom()
    }
  } catch {
    loadError.value = "Couldn't open the sampler for this track."
  }
})

onBeforeUnmount(() => sampler.release())

/* ---- the strip ---- */

const strip = ref<HTMLElement | null>(null)
let mode: 'new' | 'start' | 'end' | null = null
/** A selection waiting on the finger to lift, so a pinch can pre-empt it. */
let tapSelect: 'trim' | number | null = null
let anchor = 0

const EDGE_GRAB_PX = 18
/** Dragging an edge this close to a neighbour's snaps them together. */
const SNAP_PX = 14

/**
 * Nearest assigned pad on either side, skipping gaps.
 *
 * Index±1 isn't enough: clearing pad 4 would leave 3 and 5 unable to reach
 * each other, so the chain broke wherever a pad had been removed.
 */
function prevPadIndex(i: number): number {
  for (let k = i - 1; k >= 0; k--) if (bank.value[k]) return k
  return -1
}

function nextPadIndex(i: number): number {
  for (let k = i + 1; k < PAD_COUNT; k++) if (bank.value[k]) return k
  return -1
}

/**
 * The view is frozen for the duration of a drag.
 *
 * Zoom frames what's being edited, so without this the first pointermove
 * rewrites it, the window collapses onto the new tiny range, and the rest
 * of the drag maps against a scale that's shrinking under your finger.
 */
const dragView = ref<{ start: number; end: number } | null>(null)

/**
 * The in-progress edit, held here rather than written straight through.
 *
 * Every store mutation serialises the whole library to localStorage, so
 * editing a pad on pointermove meant a JSON write per frame — which is what
 * made dragging a chop feel broken. Nothing is committed until the finger
 * lifts, and the strip then redraws from what was actually saved.
 */
const draft = ref<{ index: 'trim' | number; range: Range } | null>(null)
/** The joined neighbour, dragged along so the seam stays visibly closed. */
const draftNeighbour = ref<{ index: number; range: Range } | null>(null)

/**
 * What's actually on screen. Frozen for the whole gesture, canvas included:
 * the overlays already used the frozen window but the waveform was reading
 * the live one, so the bars slid under the finger while the markers stayed
 * put. It re-frames once the thumb lifts.
 */
const shownView = computed(() => dragView.value ?? view.value)

function activeView(): { start: number; end: number } {
  return shownView.value
}

/**
 * Written at rest, never mid-drag: the store persists on every mutation, so
 * committing on pointermove would mean a JSON write per frame.
 */
function commitTrim() {
  library.setTrim(
    key.value,
    trim.value
      ? { ...trim.value, zoom: zoomLevel.value, span: zoomSpan.value ?? undefined }
      : null,
  )
}

/** What to draw for a pad — the live edit if it has one, else what's saved. */
function padRange(i: number): Range | null {
  if (draft.value && draft.value.index === i) return draft.value.range
  if (draftNeighbour.value && draftNeighbour.value.index === i) return draftNeighbour.value.range
  return bank.value[i] ?? null
}

function trimRange(): Range | null {
  if (draft.value && draft.value.index === 'trim') return draft.value.range
  return trim.value
}

/** Chops as drawn: live edits where they exist, saved values otherwise. */
const chops = computed<(Range | null)[]>(() => bank.value.map((_, i) => padRange(i)))
const trimShown = computed<Range | null>(() => trimRange())

function timeAt(e: PointerEvent): number {
  const el = strip.value
  if (!el || total.value <= 0) return 0
  const r = el.getBoundingClientRect()
  const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
  const v = activeView()
  return v.start + frac * Math.max(1e-6, v.end - v.start)
}

function pxPerSec(): number {
  const el = strip.value
  if (!el || total.value <= 0) return 1
  const v = activeView()
  return el.getBoundingClientRect().width / Math.max(1e-6, v.end - v.start)
}

/** Topmost chop under a time, so a tap selects what it looks like it hit. */
function chopAt(t: number): number {
  return bank.value.findIndex(p => p && t >= p.startSec && t <= p.endSec)
}

function focusTrim() {
  focus.value = 'trim'
  recentreZoom()
}

/**
 * A read drag, held from the window it started in.
 *
 * Panning against the live window would compound — each frame would shift a
 * view that had already shifted — so the offset is always measured from
 * where the thumb went down.
 */
let pan: { x: number; base: { start: number; end: number }; moved: boolean } | null = null

/** Below this a read drag was a tap, and selects instead of pans. */
const PAN_SLOP_PX = 6

/**
 * Every finger currently on the strip, by x.
 *
 * Only x matters — the strip is one-dimensional, so a pinch is the distance
 * between two points on a line and a vertical component would be noise.
 */
const points = new Map<number, number>()

/**
 * A pinch, held from the two fingers that started it.
 *
 * `anchor` is the moment of the track that was under the midpoint when the
 * gesture began, and it stays under the midpoint throughout — the same
 * contract a map makes. Measuring against the frame it started in rather
 * than the last one keeps the scaling from compounding frame to frame.
 */
let pinch: { base: { start: number; end: number }; dist: number; anchor: number } | null = null

/** The two fingers' x positions and the strip's box, or null if it's gone. */
function pinchGeometry() {
  const el = strip.value
  if (!el) return null
  const xs = [...points.values()]
  if (xs.length < 2) return null
  const r = el.getBoundingClientRect()
  const width = Math.max(1, r.width)
  return {
    dist: Math.max(1, Math.abs(xs[0]! - xs[1]!)),
    focal: Math.min(1, Math.max(0, ((xs[0]! + xs[1]!) / 2 - r.left) / width)),
  }
}

/** Throws away an in-progress edit without writing it. */
function abortEdit() {
  mode = null
  tapSelect = null
  draft.value = null
  draftNeighbour.value = null
  dragView.value = null
}

function startPinch(base: { start: number; end: number }) {
  const g = pinchGeometry()
  if (!g) return
  pinch = { base, dist: g.dist, anchor: base.start + g.focal * (base.end - base.start) }
}

function applyPinch() {
  const g = pinchGeometry()
  if (!g || !pinch || total.value <= 0) return

  const baseSpan = pinch.base.end - pinch.base.start
  const span = Math.min(total.value, Math.max(MIN_SPAN, baseSpan * (pinch.dist / g.dist)))

  // Spreading the fingers all the way out is a request for the whole track,
  // and leaving a span pinned at exactly the duration would just be ALL with
  // extra state to carry.
  if (span >= total.value - 1e-6) {
    zoomSpan.value = null
    panView.value = null
    zoomLevel.value = 0
    return
  }

  zoomSpan.value = span
  // The anchor stays under the midpoint, so the fingers also drag the window
  // along — pinching and panning at once, the way a map behaves.
  panView.value = windowAround(pinch.anchor - g.focal * span, pinch.anchor + (1 - g.focal) * span)
}

function onDown(e: PointerEvent) {
  if (!sampler.buffer.value || lazy.value) return
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  points.set(e.pointerId, e.clientX)

  // A second finger is a pinch in either mode — it can't be anything else,
  // and an edit already under way is abandoned rather than committed from
  // wherever the first finger happened to be.
  //
  // Scaled from the window the *first* finger landed in, not the live one:
  // fingers never arrive together, and anything the first one set in motion
  // would otherwise become the base the pinch works from.
  if (points.size === 2) {
    const base = dragView.value ?? pan?.base ?? { ...view.value }
    abortEdit()
    pan = null
    startPinch(base)
    return
  }
  if (points.size > 2) return

  if (stripMode.value === 'read') {
    pan = { x: e.clientX, base: { ...view.value }, moved: false }
    return
  }

  dragView.value = { ...view.value }
  const t = timeAt(e)
  const scale = pxPerSec()

  // 1. An edge of what's focused wins, so a chop can be trimmed in place.
  const cur = focused.value
  if (cur) {
    if (Math.abs(t - cur.startSec) * scale < EDGE_GRAB_PX) {
      mode = 'start'
      draft.value = { index: focus.value, range: { ...cur } }
      return
    }
    if (Math.abs(t - cur.endSec) * scale < EDGE_GRAB_PX) {
      mode = 'end'
      draft.value = { index: focus.value, range: { ...cur } }
      return
    }
  }

  // 2. Tapping a chop selects it. Chops sit inside the trim, so this has to
  //    come first or every tap would land on the trim instead.
  //
  //    Held until the finger lifts. Selecting re-frames the window and plays
  //    the chop, and a finger on its way to a pinch shouldn't do either —
  //    the second one is only a few milliseconds behind.
  const hit = chopAt(t)
  if (hit >= 0) {
    mode = null
    tapSelect = hit
    return
  }

  // 3. Inside the trim but on no chop: back to the trim.
  const t0 = trim.value
  if (t0 && t >= t0.startSec && t <= t0.endSec) {
    mode = null
    tapSelect = 'trim'
    return
  }

  // 4. Bare waveform draws a new trim, which focuses it by definition.
  focusTrim()
  mode = 'new'
  anchor = t
  draft.value = { index: 'trim', range: { startSec: t, endSec: t + MIN_LEN } }
}

function onMove(e: PointerEvent) {
  if (points.has(e.pointerId)) points.set(e.pointerId, e.clientX)

  if (pinch) {
    applyPinch()
    return
  }

  if (pan) {
    const el = strip.value
    if (!el) return
    const dx = e.clientX - pan.x
    if (!pan.moved) {
      if (Math.abs(dx) < PAN_SLOP_PX) return
      pan.moved = true
    }
    // The window keeps its width, so the track slides under a fixed scale.
    const span = pan.base.end - pan.base.start
    const width = el.getBoundingClientRect().width || 1
    const dt = (dx / width) * span
    panView.value = windowAround(pan.base.start - dt, pan.base.end - dt)
    return
  }

  if (!mode || !draft.value) return
  const t = timeAt(e)
  const cur = draft.value.range
  const index = draft.value.index

  if (mode === 'new') {
    draft.value = {
      index,
      range: {
        startSec: Math.min(anchor, t),
        endSec: Math.max(anchor + MIN_LEN, Math.max(anchor, t)),
      },
    }
    return
  }

  const snap = SNAP_PX / pxPerSec()

  if (mode === 'start') {
    const pi = typeof index === 'number' ? prevPadIndex(index) : -1
    const prev = pi >= 0 ? bank.value[pi] : null
    let at = Math.max(0, Math.min(t, cur.endSec - MIN_LEN))

    if (prev) {
      // Drag within snapping distance and the two edges meet; carry on past
      // and the neighbour is pushed along, so a gap can be closed by hand
      // and not just inherited from chopping.
      if (Math.abs(at - prev.endSec) <= snap) at = prev.endSec
      if (at <= prev.endSec + 1e-6) {
        at = Math.max(at, prev.startSec + MIN_LEN)
        draft.value = { index, range: { ...cur, startSec: at } }
        draftNeighbour.value = { index: pi, range: { ...prev, endSec: at } }
        return
      }
    }
    draft.value = { index, range: { ...cur, startSec: at } }
    draftNeighbour.value = null
  } else {
    const ni = typeof index === 'number' ? nextPadIndex(index) : -1
    const next = ni >= 0 ? bank.value[ni] : null
    let at = Math.min(total.value, Math.max(t, cur.startSec + MIN_LEN))

    if (next) {
      if (Math.abs(at - next.startSec) <= snap) at = next.startSec
      if (at >= next.startSec - 1e-6) {
        at = Math.min(at, next.endSec - MIN_LEN)
        draft.value = { index, range: { ...cur, endSec: at } }
        draftNeighbour.value = { index: ni, range: { ...next, startSec: at } }
        return
      }
    }
    draft.value = { index, range: { ...cur, endSec: at } }
    draftNeighbour.value = null
  }
}

function onUp(e: PointerEvent) {
  try {
    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
  } catch {
    // capture already gone
  }
  points.delete(e.pointerId)

  if (pinch) {
    if (points.size >= 2) return
    pinch = null
    const v = panView.value
    if (v) zoomCentre.value = (v.start + v.end) / 2
    commitTrim()
    // One finger left over carries on as a pan rather than being stranded
    // until it lifts. Already "moved", so it can't land as a tap.
    const rest = [...points.values()][0]
    pan = rest === undefined ? null : { x: rest, base: { ...view.value }, moved: true }
    return
  }

  if (pan) {
    const p = pan
    pan = null
    if (p.moved) {
      // Zooming from here should step in on what was just read, not jump
      // back to whatever the controls were pointing at.
      const v = panView.value
      if (v) zoomCentre.value = (v.start + v.end) / 2
      return
    }
    // A tap that went nowhere still selects — reading is easier when you can
    // hear what you're looking at. Nothing re-frames; that's the point.
    const t = timeAt(e)
    const hit = chopAt(t)
    if (hit >= 0) {
      focus.value = hit
      playFocused()
      return
    }
    const t0 = trim.value
    if (t0 && t >= t0.startSec && t <= t0.endSec) {
      focus.value = 'trim'
      playFocused()
    }
    return
  }

  if (tapSelect !== null) {
    const sel = tapSelect
    tapSelect = null
    dragView.value = null
    if (sel === 'trim') focusTrim()
    else {
      focus.value = sel
      recentreZoom()
    }
    playFocused()
    return
  }

  // One write for the whole gesture, then the strip redraws from the store.
  const edit = draft.value
  const neighbour = draftNeighbour.value
  if (edit) {
    if (edit.index === 'trim') {
      trim.value = edit.range
      commitTrim()
    } else {
      const pad = bank.value[edit.index]
      if (pad) library.setPad(key.value, bankIndex.value, edit.index, { ...pad, ...edit.range })
      if (neighbour) {
        const other = bank.value[neighbour.index]
        if (other) {
          library.setPad(key.value, bankIndex.value, neighbour.index, {
            ...other,
            ...neighbour.range,
          })
        }
      }
      if (record.value) library.remember(record.value)
    }
  }

  // Re-frame on the edge that was just placed, the way the hardware zooms
  // around the point being edited.
  if (edit) {
    if (mode === 'start') recentreZoom(edit.range.startSec)
    else if (mode === 'end') recentreZoom(edit.range.endSec)
    else recentreZoom()
  }

  draft.value = null
  draftNeighbour.value = null
  dragView.value = null
  if (mode) {
    mode = null
    playFocused()
  }
}

/* ---- controls, pointed at whatever is focused ---- */

/**
 * Nudge granularity follows the zoom, so a tap always moves about a
 * fiftieth of what's on screen. A fixed step can't work across the ladder:
 * 0.1s is a reasonable hop at ALL and a third of the window at 0.1s.
 *
 * Bounded at both ends — a long track at ALL would otherwise jump seconds
 * per tap, and the deepest zoom would land below what the ear can place.
 */
const nudgeStep = computed(() => {
  const span = shownView.value.end - shownView.value.start
  return Math.min(0.5, Math.max(0.002, span / 50))
})

const nudgeLabel = computed(() => {
  const s = nudgeStep.value
  return s >= 0.1 ? `${s.toFixed(2)}s` : `${Math.round(s * 1000)}ms`
})

/** @param dir -1 or 1; the distance comes from the zoom. */
function nudge(edge: 'startSec' | 'endSec', dir: number) {
  const cur = focused.value
  if (!cur) return
  const next = { ...cur }
  next[edge] = Math.max(0, Math.min(total.value, next[edge] + dir * nudgeStep.value))
  if (next.endSec - next.startSec < MIN_LEN) return
  writeFocused(next)
  recentreZoom(next[edge])
}

function playFocused() {
  const cur = focused.value
  if (!cur) return
  sampler.play({ ...cur, pitch: currentPad.value?.pitch ?? 0 }, activePad.value)
}

/** The tail of what's focused, for hearing where the out point lands. */
const ROLL_SEC = 3

function roll() {
  const cur = focused.value
  if (!cur) return
  sampler.play(
    {
      startSec: Math.max(cur.startSec, cur.endSec - ROLL_SEC),
      endSec: cur.endSec,
      pitch: currentPad.value?.pitch ?? 0,
    },
    activePad.value,
  )
}

/** Pitch belongs to the pad, not the trim — it's a property of the sample. */
function setPitch(semitones: number) {
  const cur = currentPad.value
  if (activePad.value === null || !cur) return
  library.setPad(key.value, bankIndex.value, activePad.value, {
    ...cur,
    pitch: Math.max(-12, Math.min(12, semitones)),
  })
}

/* ---- flags ---- */

const flagsOpen = ref(false)

/**
 * Held as the raw string so typing isn't fought mid-keystroke — clamping
 * "0" up to a minimum while someone is on their way to "0.75" makes the
 * field unusable. Parsed and bounded only at the point of use.
 */
const flagLengthInput = ref('2')

const flagLength = computed(() => {
  const n = parseFloat(flagLengthInput.value)
  return Number.isFinite(n) && n > 0 ? n : 2
})

const trackFlags = computed(() =>
  record.value ? library.markersFor(record.value.id, trackName.value) : [],
)

/** Flags drawn on the strip, as track percentages — the view maps them. */
const flagPercents = computed(() =>
  total.value > 0 ? trackFlags.value.map(m => (m.timestampSec / total.value) * 100) : [],
)

/** A flag sets the range and nothing else. No pad is touched. */
function useFlag(atSec: number) {
  if (total.value <= 0) return
  const start = Math.max(0, Math.min(atSec, total.value - MIN_LEN))
  const end = Math.max(start + MIN_LEN, Math.min(total.value, start + flagLength.value))
  trim.value = { startSec: start, endSec: end }
  focus.value = 'trim'
  if (zoomLevel.value === 0) zoomLevel.value = 1
  recentreZoom(start)
  commitTrim()
  playFocused()
}

/* ---- pads ---- */

/**
 * Assignment is armed on the way down and only committed on the way up, so
 * a swipe across the grid or a thumb resting too long doesn't silently
 * overwrite an empty pad. Playing a filled pad stays immediate — it's a
 * drum pad, latency there would be worse than the risk.
 */
const ARM_HOLD_MS = 450
const ARM_MOVE_PX = 12

let armedPad: number | null = null
let armedAt = { x: 0, y: 0 }
let armTimer: ReturnType<typeof setTimeout> | null = null

function cancelArm() {
  armedPad = null
  if (armTimer !== null) {
    clearTimeout(armTimer)
    armTimer = null
  }
}

function padDown(i: number, e: PointerEvent) {
  // The chop overlay sits above the grid, so this can't fire mid-chop.
  if (lazy.value) return

  focus.value = i
  const existing = bank.value[i]

  if (existing) {
    recentreZoom()
    sampler.play(existing, i)
    return
  }

  if (!trim.value) return
  armedPad = i
  armedAt = { x: e.clientX, y: e.clientY }
  armTimer = setTimeout(cancelArm, ARM_HOLD_MS)
}

function padMove(e: PointerEvent) {
  if (armedPad === null) return
  const dx = Math.abs(e.clientX - armedAt.x)
  const dy = Math.abs(e.clientY - armedAt.y)
  if (dx > ARM_MOVE_PX || dy > ARM_MOVE_PX) cancelArm()
}

function padUp(i: number) {
  if (armedPad !== i) {
    cancelArm()
    return
  }
  cancelArm()
  if (!trim.value) return
  // A copy of the range, not the range itself.
  const pad: Pad = { ...trim.value, pitch: 0 }
  library.setPad(key.value, bankIndex.value, i, pad)
  if (record.value) library.remember(record.value)
  sampler.play(pad, i)
}

/* ---- bank switching ---- */

let swipeFrom: { x: number; y: number } | null = null
const SWIPE_PX = 55

function gridDown(e: PointerEvent) {
  swipeFrom = { x: e.clientX, y: e.clientY }
}

function swipeFromReset() {
  swipeFrom = null
  cancelArm()
}

function gridUp(e: PointerEvent) {
  const from = swipeFrom
  swipeFrom = null
  if (!from || lazy.value) return
  const dx = e.clientX - from.x
  const dy = e.clientY - from.y
  // Horizontal and decisive, or it was a tap on a pad.
  if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return
  cancelArm()
  goToBank(bankIndex.value + (dx < 0 ? 1 : -1))
}

/**
 * Two taps to empty a bank. No modal — the app doesn't use them — but
 * sixteen pads is too much to lose to one stray thumb, so the button asks
 * first and forgets the question after a few seconds.
 */
const clearArmed = ref(false)
let clearTimer: ReturnType<typeof setTimeout> | null = null

function clearBank() {
  if (clearTimer !== null) clearTimeout(clearTimer)
  if (!clearArmed.value) {
    clearArmed.value = true
    clearTimer = setTimeout(() => (clearArmed.value = false), 3000)
    return
  }
  clearArmed.value = false
  library.clearBank(key.value, bankIndex.value)
  focus.value = 'trim'
  sampler.stop()
}

const bankHasPads = computed(() => bank.value.some(p => p !== null))

function goToBank(next: number) {
  const clamped = Math.max(0, Math.min(PAD_BANKS - 1, next))
  if (clamped === bankIndex.value) return
  bankIndex.value = clamped
  clearArmed.value = false
  // The old focus pointed into a bank that's no longer on screen.
  focus.value = 'trim'
  sampler.stop()
}

function clearPad(i: number) {
  library.setPad(key.value, bankIndex.value, i, null)
  if (focus.value === i) focus.value = 'trim'
}

/* ---- lazy chop ---- */

/**
 * Lazy chopping: the trim plays through and every pad tap cuts at the
 * playhead. The first chop starts at the trim's start whether you tap or
 * not, each tap closes one chop and opens the next, and the last runs to
 * the trim's end — so N taps give N+1 chops filling pads in order.
 *
 * Not evenly spaced slicing; the cuts land where you heard them.
 */
const lazy = ref(false)
const lazyRange = ref({ start: 0, end: 0 })
const lazyBounds = ref<number[]>([])
const lazyNextPad = ref(0)

const MIN_CHOP = 0.05

function startLazyChop() {
  if (lazy.value) {
    endLazyChop()
    return
  }
  focus.value = 'trim'
  const cur = trim.value
  if (!cur || cur.endSec - cur.startSec < MIN_CHOP * 2) return

  lazyRange.value = { start: cur.startSec, end: cur.endSec }
  lazyBounds.value = [cur.startSec]
  lazyNextPad.value = 0
  // Deliberately not cleared: chopping overwrites only the pads it actually
  // fills. Wiping sixteen pads for a three-cut performance was too blunt —
  // clear the bank or swipe to an empty one for a clean slate.

  lazy.value = true
  sampler.play({ startSec: cur.startSec, endSec: cur.endSec, pitch: 0 }, null, endLazyChop)
}

/** One tap: close the open chop at the playhead, open the next. */
function lazyCut() {
  const t = sampler.playhead.value
  const last = lazyBounds.value[lazyBounds.value.length - 1] ?? lazyRange.value.start
  if (t - last < MIN_CHOP) return
  if (lazyNextPad.value >= PAD_COUNT) return

  library.setPad(key.value, bankIndex.value, lazyNextPad.value, {
    startSec: last,
    endSec: t,
    pitch: 0,
  })
  if (record.value) library.remember(record.value)
  lazyNextPad.value++
  lazyBounds.value.push(t)

  if (lazyNextPad.value >= PAD_COUNT) endLazyChop()
}

function endLazyChop() {
  if (!lazy.value) return
  lazy.value = false

  const last = lazyBounds.value[lazyBounds.value.length - 1] ?? lazyRange.value.start
  const end = lazyRange.value.end
  // The final chop always runs to the end of the trim.
  if (lazyNextPad.value < PAD_COUNT && end - last >= MIN_CHOP) {
    library.setPad(key.value, bankIndex.value, lazyNextPad.value, {
      startSec: last,
      endSec: end,
      pitch: 0,
    })
    if (record.value) library.remember(record.value)
    lazyNextPad.value++
  }
  sampler.stop()
}

/* ---- export ---- */

const exporting = ref(false)
const exportNote = ref<string | null>(null)

/**
 * Whether pitched pads export as they sound, or as the raw region.
 *
 * Applied matches what was auditioned; dry keeps the untouched material for
 * a sampler that will do its own pitching. Only offered when some pad is
 * actually pitched — otherwise the choice means nothing.
 */
const applyPitch = ref(true)
const hasPitchedPads = computed(() => bank.value.some(p => p && p.pitch !== 0))

interface Archive {
  blob: Blob
  filename: string
  files: number
  bytes: number
}

/**
 * The built archive, held until it's sent somewhere.
 *
 * Preparing and sending are separate steps on purpose. iOS only allows
 * navigator.share() while a tap is still "active", and encoding a bank of
 * WAVs takes long enough to burn that through — so the share would be
 * rejected and the sheet never appear. Building first means the send
 * happens directly inside its own tap.
 */
const archive = ref<Archive | null>(null)

const exportable = computed(() => !!trim.value || bank.value.some(p => p !== null))

const canShareFiles = computed(() => typeof navigator.canShare === 'function')

function safeName(text: string): string {
  return text.replace(/[^a-z0-9-_]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

// Any edit makes the built archive stale, so it goes.
watch([bank, trim, applyPitch], () => {
  archive.value = null
})

/**
 * Everything cut from this track, as WAVs in a zip with a manifest.
 *
 * The manifest keeps the untouched timestamps, the semitone values and the
 * archive.org URL, so anything can be re-cut at full fidelity from the
 * original regardless of what was exported here.
 */
async function prepareArchive() {
  const buf = sampler.buffer.value
  if (!buf || exporting.value) return

  exporting.value = true
  exportNote.value = null

  try {
    // Yield once so the button paints its busy state before the encode.
    await new Promise(r => setTimeout(r, 0))

    const entries: ZipEntry[] = []
    const manifestPads: unknown[] = []

    if (trim.value) {
      entries.push({
        name: 'trim.wav',
        data: encodeWav(buf, trim.value.startSec, trim.value.endSec),
      })
    }

    bank.value.forEach((pad, i) => {
      if (!pad) return
      const name = `pad-${String(i + 1).padStart(2, '0')}.wav`
      entries.push({
        name,
        data: encodeWav(
          buf,
          pad.startSec,
          pad.endSec,
          applyPitch.value ? semitonesToRate(pad.pitch) : 1,
        ),
      })
      manifestPads.push({
        pad: i + 1,
        file: name,
        startSec: Number(pad.startSec.toFixed(3)),
        endSec: Number(pad.endSec.toFixed(3)),
        pitchSemitones: pad.pitch,
        pitchApplied: applyPitch.value && pad.pitch !== 0,
      })
    })

    const manifest = {
      generatedAt: new Date().toISOString(),
      source: {
        identifier: props.id,
        title: record.value?.title ?? props.id,
        creator: record.value?.creator ?? 'Unknown',
        track: trackName.value,
        library: record.value ? sourceLabel(record.value) : 'unknown source',
        details: record.value?.sourceUrl,
        download: `https://archive.org/download/${props.id}/${encodeURIComponent(trackName.value)}`,
      },
      audio: {
        sampleRate: buf.sampleRate,
        channels: buf.numberOfChannels,
        bitDepth: 16,
        note:
          buf.sampleRate < 44100
            ? `Cut from a ${(buf.sampleRate / 1000).toFixed(1)}kHz decode, which is how a track this long fits in memory. Re-cut from the download URL for full fidelity.`
            : 'Cut at the source rate.',
      },
      pitch: applyPitch.value
        ? 'Applied — pads are resampled to the pitch they were auditioned at.'
        : 'Not applied — pads are the raw regions; pitchSemitones says what was set.',
      trim: trim.value
        ? {
            file: 'trim.wav',
            startSec: Number(trim.value.startSec.toFixed(3)),
            endSec: Number(trim.value.endSec.toFixed(3)),
          }
        : null,
      pads: manifestPads,
    }

    entries.push({
      name: 'manifest.json',
      data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
    })

    const dry = hasPitchedPads.value && !applyPitch.value ? '-dry' : ''
    const blob = makeZip(entries)

    archive.value = {
      blob,
      filename: `crate-${safeName(props.id)}-${safeName(trackName.value)}${dry}.zip`,
      files: entries.length,
      bytes: blob.size,
    }
  } catch {
    exportNote.value = "Couldn't build the archive."
  } finally {
    exporting.value = false
  }
}

/**
 * Hands the file to whatever will take it — Mail, Files, Dropbox, Drive,
 * anything registered for the type. Called with nothing awaited before it,
 * or iOS treats the tap as expired and refuses.
 */
function sendArchive() {
  const built = archive.value
  if (!built) return
  const file = new File([built.blob], built.filename, { type: 'application/zip' })

  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    navigator
      .share({ files: [file], title: built.filename })
      .then(() => {
        exportNote.value = 'Sent'
        setTimeout(() => (exportNote.value = null), 3000)
      })
      .catch((err: unknown) => {
        // Dismissing the sheet isn't a failure worth reporting.
        if (err instanceof DOMException && err.name === 'AbortError') return
        exportNote.value = 'Sharing unavailable — saved instead.'
        saveArchive()
      })
    return
  }
  saveArchive()
}

/** Straight to the download folder, for anywhere the share sheet isn't. */
function saveArchive() {
  const built = archive.value
  if (!built) return
  const url = URL.createObjectURL(built.blob)
  const a = document.createElement('a')
  a.href = url
  a.download = built.filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/* ---- geometry ---- */

function pct(sec: number): number {
  const v = activeView()
  return ((sec - v.start) / Math.max(1e-6, v.end - v.start)) * 100
}

function inView(a: number, b: number): boolean {
  const v = activeView()
  return b > v.start && a < v.end
}

/**
 * Where the window sits in the whole track, as percentages.
 *
 * The strip alone can't say this: at 1s every part of a song looks like
 * every other part. Null when the whole track is already on screen, since
 * there's nothing to locate then.
 */
/** Whether the strip is showing less than the whole track. */
const zoomedIn = computed(
  () => total.value > 0 && shownView.value.end - shownView.value.start < total.value - 1e-6,
)

const overview = computed(() => {
  if (total.value <= 0) return null
  const v = shownView.value
  const span = v.end - v.start
  if (span >= total.value - 1e-6) return null
  return {
    left: (v.start / total.value) * 100,
    width: Math.max(1.5, (span / total.value) * 100),
    trim: trimShown.value ? (trimShown.value.startSec / total.value) * 100 : null,
  }
})

const focusedLength = computed(() =>
  focused.value ? focused.value.endSec - focused.value.startSec : 0,
)

const focusLabel = computed(() =>
  focus.value === 'trim' ? 'Trim' : `Pad ${focus.value + 1}`,
)
</script>

<template>
  <div class="h-full flex flex-col">
    <header class="flex-none flex items-center gap-1 px-2 pt-safe pb-1">
      <button
        class="w-11 h-11 flex items-center justify-center text-flag-soft"
        aria-label="Back"
        @click="router.back()"
      >
        <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path d="M15 19l-7-7 7-7" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <div class="flex-1 min-w-0 px-1">
        <p class="text-[13px] text-cream truncate">{{ trackMeta?.title ?? 'Pads' }}</p>
        <p class="text-[11px] text-flag-dim truncate">{{ record?.creator }}</p>
      </div>
      <button
        class="px-3 h-9 rounded-lg border border-ink-500 text-[11px] tracking-wide
               text-flag-soft active:bg-ink-700"
        @click="sampler.stop()"
      >
        STOP
      </button>
    </header>

    <p v-if="loadError" class="px-6 py-10 text-center text-[14px] text-red-300/80">
      {{ loadError }}
    </p>
    <p v-else-if="sampler.error.value" class="px-6 py-10 text-center text-[14px] text-red-300/80">
      {{ sampler.error.value }}
    </p>

    <div
      v-else-if="sampler.loading.value"
      class="flex-1 flex flex-col items-center justify-center gap-2 px-8"
    >
      <div class="w-5 h-5 border-2 border-flag border-t-transparent rounded-full animate-spin" />
      <p class="text-[13px] text-flag-dim">
        <template v-if="sampler.progress.value !== null">
          Downloading {{ Math.round(sampler.progress.value * 100) }}%
        </template>
        <template v-else>Decoding…</template>
      </p>
    </div>

    <template v-if="sampler.buffer.value">
      <div class="flex-none px-4 pt-1">
        <div
          ref="strip"
          class="sel relative h-24 rounded overflow-hidden bg-ink-800"
          :class="lazy ? 'ring-2 ring-flag' : ''"
          @pointerdown="onDown"
          @pointermove="onMove"
          @pointerup="onUp"
          @pointercancel="onUp"
        >
          <div class="absolute inset-0">
            <Waveform
              :peaks="sampler.peaks.value"
              :progress="0"
              :markers="flagPercents"
              :range-start="total > 0 ? shownView.start / total : 0"
              :range-end="total > 0 ? shownView.end / total : 1"
              :dense="zoomedIn"
            />
          </div>

          <!-- What the thumb does here: push the track along, or cut it. -->
          <div
            v-if="!lazy"
            class="absolute top-1 left-1 z-10 flex items-center rounded border
                   border-ink-500 bg-ink-900/80 overflow-hidden"
          >
            <button
              v-for="m in (['read', 'edit'] as const)"
              :key="m"
              class="px-2 h-6 text-[9px] tracking-wider leading-none transition-colors"
              :class="stripMode === m ? 'bg-flag text-ink-900 font-medium' : 'text-flag-soft'"
              :aria-pressed="stripMode === m"
              @pointerdown.stop="stripMode = m"
            >
              {{ m.toUpperCase() }}
            </button>
          </div>

          <!-- Zoom ladder. Steps in around the point last edited. -->
          <div
            class="absolute top-1 right-1 z-10 flex items-center rounded border
                   border-ink-500 bg-ink-900/80 overflow-hidden"
          >
            <button
              class="w-7 h-6 text-[13px] leading-none text-flag-soft disabled:opacity-30"
              :disabled="zoomSpan === null && zoomLevel === 0"
              aria-label="Zoom out"
              @pointerdown.stop="stepZoom(-1)"
            >
              −
            </button>
            <span class="px-1 text-[9px] tabular-nums w-9 text-center"
                  :class="zoomedIn ? 'text-flag' : 'text-flag-soft'">
              {{ zoomLabel }}
            </span>
            <button
              class="w-7 h-6 text-[13px] leading-none text-flag-soft disabled:opacity-30"
              :disabled="zoomSpan === null && zoomLevel === ZOOM_LEVELS.length - 1"
              aria-label="Zoom in"
              @pointerdown.stop="stepZoom(1)"
            >
              +
            </button>
          </div>

          <!-- Chops already assigned, drawn under the trim. -->
          <template v-for="(p, i) in chops" :key="i">
            <div
              v-if="p && inView(p.startSec, p.endSec)"
              class="absolute inset-y-0 pointer-events-none border-l"
              :class="sampler.playing.value === i
                ? 'bg-flag/45 border-cream'
                : focus === i
                  ? 'bg-flag/30 border-cream'
                  : 'bg-flag/10 border-flag/40'"
              :style="{ left: `${pct(p.startSec)}%`, width: `${pct(p.endSec) - pct(p.startSec)}%` }"
            >
              <span class="absolute top-0.5 left-1 text-[9px] tabular-nums text-cream/80">
                {{ i + 1 }}
              </span>
            </div>
          </template>

          <!-- The trim: the range chopping works inside. -->
          <template v-if="trimShown">
            <div
              class="absolute inset-y-0 border-x-2 pointer-events-none transition-colors"
              :class="[
                focus === 'trim' ? 'border-cream' : 'border-cream/40',
                sampler.active.value && sampler.playing.value === null
                  ? 'bg-cream/30'
                  : 'bg-cream/10',
              ]"
              :style="{
                left: `${pct(trimShown.startSec)}%`,
                width: `${pct(trimShown.endSec) - pct(trimShown.startSec)}%`,
              }"
            />
          </template>

          <div
            v-if="sampler.active.value || lazy"
            class="absolute inset-y-0 w-0.5 bg-flag pointer-events-none"
            :style="{ left: `${pct(sampler.playhead.value)}%` }"
          />

        </div>

        <!-- The whole track, with the window marked on it. Only worth the
             pixels once the strip has stopped showing everything. -->
        <div v-if="overview" class="relative h-1 mt-1 rounded-full bg-ink-700 overflow-hidden">
          <div
            v-if="overview.trim !== null"
            class="absolute inset-y-0 w-px bg-cream/50"
            :style="{ left: `${overview.trim}%` }"
          />
          <div
            class="absolute inset-y-0 rounded-full bg-flag transition-none"
            :style="{ left: `${overview.left}%`, width: `${overview.width}%` }"
          />
        </div>

        <div class="flex items-center justify-between mt-1 text-[11px] tabular-nums text-flag-dim">
          <span>{{ focused ? formatTime(focused.startSec) : '—' }}</span>
          <!-- Where playback actually is, for judging how long a phrase
               runs before committing to a flag length. -->
          <span v-if="sampler.active.value" class="text-cream">
            ▸{{ formatTime(sampler.playhead.value) }}
          </span>
          <button
            class="px-2 h-6 rounded"
            :class="focus === 'trim' ? 'text-cream' : 'text-flag active:bg-ink-700'"
            :disabled="focus === 'trim'"
            @click="focusTrim"
          >
            <template v-if="focused">
              {{ focusLabel }} · {{ focusedLength.toFixed(2) }}s
              <span v-if="focus !== 'trim'" class="text-ink-500 text-[10px]">· to trim</span>
            </template>
            <template v-else-if="stripMode === 'read'">Switch to EDIT to cut a range</template>
            <template v-else>Drag the waveform, or tap a flag</template>
          </button>
          <span>{{ focused ? formatTime(focused.endSec) : '—' }}</span>
        </div>

        <div class="flex items-center gap-1.5 mt-2">
          <span class="text-[10px] text-ink-500 w-4">IN</span>
          <button class="trim" :disabled="!focused" @click="nudge('startSec', -1)">−</button>
          <button class="trim" :disabled="!focused" @click="nudge('startSec', 1)">+</button>
          <!-- What a tap is worth at this zoom. -->
          <span class="flex-1 text-center text-[10px] tabular-nums text-ink-500">
            ±{{ nudgeLabel }}
          </span>
          <button class="trim" :disabled="!focused" @click="nudge('endSec', -1)">−</button>
          <button class="trim" :disabled="!focused" @click="nudge('endSec', 1)">+</button>
          <span class="text-[10px] text-ink-500 w-6 text-right">OUT</span>
        </div>

        <div class="flex items-center gap-2 mt-2">
          <button
            class="flex-1 h-10 rounded-lg bg-ink-600 text-cream text-[13px]
                   active:bg-ink-500 disabled:opacity-40"
            :disabled="!focused"
            @click="playFocused"
          >
            Play
          </button>
          <button
            class="flex-1 h-10 rounded-lg border border-ink-500 text-flag-soft text-[13px]
                   active:bg-ink-700 disabled:opacity-40"
            :disabled="!focused"
            @click="roll"
          >
            Roll
          </button>
          <button
            class="px-3 h-10 rounded-lg border text-[13px] active:bg-ink-700"
            :class="showMore ? 'border-flag text-flag' : 'border-ink-500 text-flag-dim'"
            :aria-expanded="showMore"
            aria-label="More controls"
            @click="showMore = !showMore"
          >
            {{ showMore ? '▴' : '▾' }}
          </button>
          <button
            class="px-3 h-10 rounded-lg border border-ink-500 text-flag-soft text-[11px]
                   tracking-wide active:bg-ink-700 disabled:opacity-40"
            :disabled="!trim"
            title="Play the trim and cut on the fly"
            @click="startLazyChop"
          >
            CHOP
          </button>
        </div>

        <!-- Pitch is the selected pad's, not the trim's. -->
        <div v-if="showMore && !lazy" class="flex items-center gap-2 mt-2">
          <span class="text-[10px] text-ink-500 w-9">PITCH</span>
          <input
            type="range"
            min="-12"
            max="12"
            step="1"
            :value="currentPad?.pitch ?? 0"
            :disabled="!currentPad"
            class="flex-1 accent-[#d99a4e] disabled:opacity-40"
            aria-label="Pitch in semitones"
            @input="setPitch(Number(($event.target as HTMLInputElement).value))"
          />
          <span class="w-16 text-right text-[11px] tabular-nums text-flag">
            <template v-if="currentPad">
              pad {{ activePad! + 1 }} {{ currentPad.pitch > 0 ? '+' : '' }}{{ currentPad.pitch }}
            </template>
            <template v-else>—</template>
          </span>
        </div>
      </div>

      <div
        class="flex-1 min-h-0 px-4 pt-3 pb-safe overflow-y-auto"
        :class="lazy ? 'pb-32' : ''"
      >
        <!-- Flags for this track. Tapping one sets the range, nothing else. -->
        <div v-if="showMore && !lazy && trackFlags.length" class="mb-3 rounded-lg border border-ink-600">
          <button
            class="w-full flex items-center justify-between px-3 py-2 text-left"
            @click="flagsOpen = !flagsOpen"
          >
            <span class="text-[11px] uppercase tracking-wider text-flag">
              Flags · {{ trackFlags.length }}
            </span>
            <svg
              class="w-4 h-4 text-ink-500 transition-transform"
              :class="flagsOpen ? 'rotate-180' : ''"
              fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"
            >
              <path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>

          <div v-if="flagsOpen" class="px-3 pb-3">
            <div class="flex items-center gap-2 mb-2">
              <span class="text-[10px] text-ink-500">LENGTH</span>
              <input
                v-model="flagLengthInput"
                type="number"
                inputmode="decimal"
                step="0.1"
                min="0.1"
                class="w-24 h-9 px-2 rounded bg-ink-700 text-cream text-[15px] tabular-nums
                       border border-ink-600 focus:outline-none focus:border-flag-dim"
                aria-label="Trim length in seconds"
              />
              <span class="text-[12px] text-flag-dim">seconds</span>
            </div>

            <button
              v-for="m in trackFlags"
              :key="m.id"
              class="w-full flex items-center gap-2 px-2 py-2 rounded text-left
                     border-t border-ink-700/50 active:bg-ink-700"
              @click="useFlag(m.timestampSec)"
            >
              <span class="text-[13px] tabular-nums text-flag w-14">
                {{ formatTime(m.timestampSec) }}
              </span>
              <span class="flex-1 min-w-0 truncate text-[12px] text-flag-dim">
                {{ m.note || 'flagged' }}
              </span>
              <span class="text-[10px] text-ink-500">→ trim</span>
            </button>
          </div>
        </div>

        <!-- Banks. Swiping the grid moves between them; the counts say which
             hold anything, so an empty bank is easy to find. -->
        <div class="flex items-center justify-center gap-2 mb-2">
          <button
            class="w-8 h-8 flex items-center justify-center text-flag-soft disabled:opacity-30"
            :disabled="bankIndex === 0"
            aria-label="Previous bank"
            @click="goToBank(bankIndex - 1)"
          >
            ‹
          </button>
          <button
            v-for="(n, i) in bankCounts"
            :key="i"
            class="px-2 h-7 rounded text-[11px] tabular-nums border transition-colors"
            :class="i === bankIndex
              ? 'bg-flag text-ink-900 border-flag font-medium'
              : n > 0
                ? 'border-ink-500 text-flag-soft'
                : 'border-ink-600 text-ink-500'"
            @click="goToBank(i)"
          >
            {{ String.fromCharCode(65 + i)
            }}<span v-if="n" class="opacity-70">·{{ n }}</span>
          </button>
          <button
            class="w-8 h-8 flex items-center justify-center text-flag-soft disabled:opacity-30"
            :disabled="bankIndex === PAD_BANKS - 1"
            aria-label="Next bank"
            @click="goToBank(bankIndex + 1)"
          >
            ›
          </button>
        </div>

        <div
          class="grid grid-cols-4 gap-2 touch-pan-y"
          @pointerdown="gridDown"
          @pointerup="gridUp"
          @pointercancel="swipeFromReset"
        >
          <button
            v-for="i in PAD_COUNT"
            :key="i - 1"
            class="relative aspect-square rounded-lg border text-[11px] tabular-nums
                   flex items-center justify-center transition-colors"
            :class="[
              bank[i - 1]
                ? 'border-flag bg-flag/15 text-flag'
                : 'border-ink-600 bg-ink-800 text-ink-500',
              activePad === i - 1 ? 'ring-2 ring-flag' : '',
              sampler.playing.value === i - 1 ? '!bg-flag !text-ink-900' : '',
            ]"
            @pointerdown="padDown(i - 1, $event)"
            @pointermove="padMove"
            @pointerup="padUp(i - 1)"
            @pointercancel="cancelArm"
          >
            <span class="absolute top-1 left-1.5 text-[9px] opacity-60">{{ i }}</span>
            <span v-if="bank[i - 1]" class="leading-tight text-center">
              {{ (bank[i - 1]!.endSec - bank[i - 1]!.startSec).toFixed(1) }}s
              <span v-if="bank[i - 1]!.pitch" class="block text-[9px]">
                {{ bank[i - 1]!.pitch > 0 ? '+' : '' }}{{ bank[i - 1]!.pitch }}
              </span>
            </span>
            <span
              v-if="bank[i - 1]"
              class="absolute top-0 right-0 w-7 h-7 flex items-center justify-center
                     text-ink-500 text-[13px]"
              role="button"
              aria-label="Clear pad"
              @pointerdown.stop="clearPad(i - 1)"
            >
              ×
            </span>
          </button>
        </div>

        <!-- Only worth asking when something is actually pitched. -->
        <div
          v-if="exportable && !lazy && hasPitchedPads"
          class="flex items-center gap-2 mt-3"
        >
          <span class="text-[10px] text-ink-500 flex-none">PITCH</span>
          <button
            v-for="opt in [true, false]"
            :key="String(opt)"
            class="flex-1 h-9 rounded text-[12px] border transition-colors"
            :class="applyPitch === opt
              ? 'bg-flag text-ink-900 border-flag font-medium'
              : 'border-ink-500 text-flag-soft active:bg-ink-700'"
            @click="applyPitch = opt"
          >
            {{ opt ? 'Applied' : 'Dry' }}
          </button>
        </div>

        <template v-if="showMore && exportable && !lazy">
          <button
            v-if="!archive"
            class="w-full h-12 mt-2 rounded-lg bg-flag text-ink-900 text-[14px] font-semibold
                   active:scale-[0.99] transition-transform disabled:opacity-50"
            :disabled="exporting"
            @click="prepareArchive"
          >
            {{ exporting ? 'BUILDING…' : 'EXPORT CHOPS' }}
          </button>

          <!-- Built and waiting. Sending is its own tap so iOS still counts
               it as user-initiated. -->
          <div v-else class="mt-2">
            <p class="text-center text-[11px] text-flag-dim mb-2">
              {{ archive.filename }} · {{ archive.files }} files ·
              {{ formatBytes(archive.bytes) }}
            </p>
            <div class="flex gap-2">
              <button
                v-if="canShareFiles"
                class="flex-1 h-12 rounded-lg bg-flag text-ink-900 text-[14px] font-semibold
                       active:scale-[0.99] transition-transform"
                @click="sendArchive"
              >
                Send to…
              </button>
              <button
                class="h-12 rounded-lg border border-ink-500 text-flag-soft text-[13px]
                       active:bg-ink-700"
                :class="canShareFiles ? 'px-5' : 'flex-1'"
                @click="saveArchive"
              >
                Save
              </button>
            </div>
          </div>
        </template>

        <p v-if="exportNote" class="text-center text-[11px] text-flag mt-2">
          {{ exportNote }}
        </p>

        <div v-if="showMore && bankHasPads && !lazy" class="flex justify-center mt-3">
          <button
            class="px-4 h-9 rounded-full border text-[12px] transition-colors"
            :class="clearArmed
              ? 'border-red-400/70 text-red-300 bg-red-950/40'
              : 'border-ink-500 text-flag-dim active:bg-ink-700'"
            @click="clearBank"
          >
            {{ clearArmed ? 'Tap again to clear bank ' + bankLetter : 'Clear bank ' + bankLetter }}
          </button>
        </div>

        <p v-if="showMore" class="text-center text-[10px] text-ink-500 mt-3 leading-relaxed">
          READ drags the waveform along without changing anything; EDIT draws
          and retrims. Pinch the waveform to zoom in either mode.
          Tap a pad to point the controls at that chop; tap the trim to go
          back. Swipe the pads for another bank.
          <span v-if="degraded" class="block">
            Decoded at {{ (sampler.rate.value / 1000).toFixed(1) }}kHz to fit in memory.
          </span>
        </p>
      </div>
    </template>

    <!-- Chopping layers over the view rather than replacing it: the pads
         stay visible and fill in as cuts land, but the sheet swallows taps
         so none of it is interactive. Aiming at a pad was misleading
         anyway — a cut lands on the next pad in sequence, not the one
         tapped. -->
    <template v-if="lazy">
      <div class="fixed inset-0 z-40" @pointerdown.prevent="lazyCut" />
      <div class="fixed inset-x-0 bottom-0 z-50 px-4 pb-safe pt-3 bg-ink-900/90">
        <p class="text-center text-[12px] text-flag mb-2">
          Tap anywhere to cut · {{ lazyNextPad }} chopped
        </p>
        <button
          class="w-full h-14 rounded-lg bg-flag text-ink-900 text-[15px] font-semibold
                 active:scale-[0.99] transition-transform"
          @pointerdown.stop.prevent="endLazyChop"
        >
          DONE CHOPPING
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.sel {
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}
.trim {
  @apply w-9 h-9 rounded bg-ink-700 text-cream text-[15px] leading-none
         active:bg-ink-600 flex-none disabled:opacity-40;
}
</style>
