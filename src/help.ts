/**
 * What each view is for, in its own words.
 *
 * Kept out of the views so the four of them read the same way and nothing
 * drifts: a note here is written once and shown by one component. On demand
 * only — nothing pops up on its own, and none of it is a checklist to get
 * through before the app is usable.
 */
export interface HelpItem {
  term: string
  text: string
}

export interface HelpTopic {
  title: string
  blurb: string
  items: HelpItem[]
}

export type HelpKey = 'browse' | 'player' | 'sampler' | 'flagged'

export const HELP: Record<HelpKey, HelpTopic> = {
  browse: {
    title: 'The crate',
    blurb: 'Somewhere to find material. One crate at a time, and each one ends.',
    items: [
      {
        term: 'Crates',
        text: 'A fixed menu along the bottom, not a feed. Tap one and you get a finite list you can reach the end of.',
      },
      {
        term: 'Pull to dig',
        text: "Drag the list down and it swaps for a deeper batch you haven't seen. Each pull goes further in, which is how you get past the obvious stuff.",
      },
      {
        term: 'The seen count',
        text: 'Tap it to forget what you\'ve been shown, so the whole crate opens back up and pulling starts from the top again.',
      },
      {
        term: '+ Add and Yours',
        text: 'Bring in your own: a link straight at an audio file, or a file off this device. Files stay on the phone.',
      },
      {
        term: 'Search',
        text: 'Searches the archive. What you were looking at is kept, so going into a record and back costs nothing.',
      },
    ],
  },

  player: {
    title: 'Listening',
    blurb: 'Hear something, mark it, move on. Flagging is the whole point.',
    items: [
      {
        term: 'FLAG THIS',
        text: 'Drops a marker at the moment you\'re hearing. Notes can go on it later from the Flagged tab — the thing to do while listening is just to catch it.',
      },
      {
        term: 'Drop the needle',
        text: 'The record icon left of the bar jumps to a random moment somewhere in the middle and plays. Good for a track you know nothing about.',
      },
      {
        term: 'Scrubbing',
        text: 'Drag the bar to move. Hold and a magnifier shows the exact spot before you commit, so you can place a flag properly.',
      },
      {
        term: 'WAVEFORM',
        text: "Opt-in, because drawing one means downloading the whole file. The size is on the button before you tap it.",
      },
      {
        term: 'PADS',
        text: 'Opens the sampler for this track — trimming, chopping and export.',
      },
    ],
  },

  sampler: {
    title: 'Pads',
    blurb: 'Cut a range out of a track, put it on pads, take it away as WAVs.',
    items: [
      {
        term: 'The trim',
        text: 'Drag across the waveform in EDIT to draw a range. It is not a pad — it is the range pads get cut from. CLEAR TRIM drops it.',
      },
      {
        term: 'READ and EDIT',
        text: 'READ drags the waveform along without changing anything, for finding your place. EDIT draws and retrims. Pinch to zoom in either.',
      },
      {
        term: 'Pads',
        text: 'Tap an empty pad to assign the trim to it. Tap a filled one to play it. The × clears it. Swipe the grid for banks A to D.',
      },
      {
        term: 'CHOP',
        text: 'Plays the trim and cuts a new chop everywhere you tap, filling pads in order — the cuts land where you heard them.',
      },
      {
        term: 'The ▾ button',
        text: 'Folds away the things you need less often — pitch, the flag list and clearing a bank. Tap it and they appear below the transport.',
      },
      {
        term: 'Nudges and pitch',
        text: 'IN and OUT move the edges, by an amount that follows the zoom. Pitch is varispeed, lives under ▾, and belongs to the pad rather than the trim.',
      },
      {
        term: 'EXPORT CHOPS',
        text: 'Pinned along the bottom as soon as there is a trim or a pad. A zip of WAVs plus a manifest with the timestamps, the pitches and a link back to the original where there is one.',
      },
    ],
  },

  flagged: {
    title: 'Flagged',
    blurb: "Everything you've marked, and the way out of the app.",
    items: [
      {
        term: 'Groups',
        text: 'One per record, newest first. Open one to see its markers, or tap Open to go back to the track.',
      },
      {
        term: 'Notes',
        text: 'Type next to a marker to say why you kept it. Saved as you go.',
      },
      {
        term: 'Source tag',
        text: "Where it came from, on every group. It travels into the export, so it's never a guess later.",
      },
      {
        term: 'Export',
        text: 'JSON or CSV of every flag — timestamps, notes, and a link back to the file where there is one.',
      },
      {
        term: 'Chopped',
        text: 'Tracks with pads on them, so work you started is findable again.',
      },
    ],
  },
}
