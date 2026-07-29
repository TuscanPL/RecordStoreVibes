# Crate

Find and flag sample material, one-handed, during the gaps in a day.

Not a sampler. Chopping and resampling happen on the SP-404 and in the
`wavfix.sh` pipeline — this app's only job is to help you *find* something
worth chopping and hand off a manifest of timestamps.

## Two rules that outrank every feature

1. **One thumb, eyes half-engaged.** If a screen needs two hands or real
   focus, it belongs in the after-phase, not here. All controls sit in the
   bottom third.
2. **It has to end.** Finite result lists, no "load more", no autoplay-next,
   no recommendations. Building those rebuilds the problem this replaces.

## Screens

Three. Resist a fourth.

- **Browse** — six curated crates plus search. Capped at 40 results, and it
  tells you it capped.
- **Player** — artwork, scrubber, one large flag button. Flagged spots show
  as ticks on the scrubber.
- **Flagged** — markers grouped by record, expandable, with export. Starred
  records live here too rather than earning their own tab.

## The core interaction

Tap **FLAG THIS** while something plays. One tap. No modal, no confirmation.
It records the current timestamp against the current file.

## Export

From the Flagged screen:

- **JSON** — records → tracks → markers, with `downloadUrl` per file
- **CSV** — one row per marker: `identifier, title, creator, file, downloadUrl,
  timestampSec, timestamp, note, sourceUrl`

Both land in Files via the share sheet. Source audio downloads directly from
archive.org, unmodified — conversion is `wavfix`'s job.

## Source

Internet Archive only. Public API, no auth, legally clean for sampling.
Multi-source aggregation is explicitly out of scope; `MusicProvider` in
`src/providers/types.ts` exists so app code never imports the IA client
directly, not because a second provider is planned.

Search is debounced — IA answers hammering with escalating IP-level bans.

## Stack

Vue 3 + TypeScript, Vite, Pinia, Tailwind, vue-router (hash history, because
GitHub Pages has no rewrite rules).

Audio is a plain `<audio>` element, not the Web Audio API: these are long
files over cellular, and `decodeAudioData` would need the whole thing in
memory before a note sounds. Lock screen transport comes from the Media
Session API. Nothing here needs pitch or rate manipulation.

Persistence is `localStorage`. Two entities, tiny volume.

## Running it

```sh
npm install
npm run dev -- --host    # then hit the LAN address from your phone
npm run build
```

Testing on an actual phone is the only test that counts — the whole premise
is whether it's usable one-handed.

## Add to home screen

Manifest + Apple meta tags are in place, so iOS "Add to Home Screen" gives a
standalone window. There is no service worker yet, so no offline support.
