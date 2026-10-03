# Landing Timer — Design

Date: 2026-10-02
Status: approved by user ("looks fine for me"; technical decisions delegated: "do whatever you think")
Ships as v1.0.0. New project, sibling of Chat+: `D:\dev\Torn City Scripts\LandingTimer`.

## 1. Goal

When someone the player is watching takes off, the player today googles the
flight time, guesses the plane from the profile picture, and sets a Google
timer a minute or two short. Landing Timer puts that on the profile: one
button opens a panel that already knows the destination and plane type,
shows every possible flight time, and starts a countdown that follows the
player around Torn and chimes before the target lands.

The player is watching the target when they take off, so **the timer starts
the moment the player presses Start**. Nothing detects the take-off.

## 2. Rule safety

The player wants this clearly inside Torn's scripting rules and will post it
for public review. The rules (torn.com/rules.php, "Scripting abuse") allow
software that relies on "data from our API or from a page that you have
manually loaded and are actively viewing" and forbid extra non-API requests,
scraping pages not being viewed, requests not initiated by the user, and
software that would "extract data from unfocused pages to send elsewhere,
generate alerts, or draw attention to itself or another window".

Landing Timer therefore:

- makes **no network requests of any kind**: no `fetch`, no
  `XMLHttpRequest`, no `GM_xmlhttpRequest`, `@grant none`, no `@connect`, no
  API key. The chime is synthesised with Web Audio, not loaded from a file.
  A build test fails if any of these appear in `dist/`.
- reads only the profile page the player has open, from its DOM.
- after Start, depends only on numbers it stored itself. The countdown and
  chime read nothing from any page. They are a kitchen timer.

The chime can play from a background Torn tab. That is the point of a sound,
and it reads no page data, but it is the closest thing to the "generate
alerts" wording, so the widget has a sound on/off switch (section 5.4) and
the README says so plainly for reviewers.

## 3. Flight data (`src/core/flights.js`)

One-way minutes from Torn, without the "Mailing Yourself Abroad" book. These
are the times after the 23 June 2026 travel patch (about −5.26%), checked
against the Torn wiki table the player sent on 2026-10-02. Return flights take
the same time by the same method.

| Destination     | Standard | Airstrip | WLT private | Business |
|-----------------|---------:|---------:|------------:|---------:|
| Mexico          |       24 |       17 |          12 |        7 |
| Cayman Islands  |       33 |       23 |          17 |       10 |
| Canada          |       39 |       27 |          19 |       12 |
| Hawaii          |      127 |       89 |          63 |       38 |
| United Kingdom  |      151 |      106 |          75 |       45 |
| Argentina       |      158 |      111 |          79 |       47 |
| Switzerland     |      166 |      116 |          83 |       50 |
| Japan           |      213 |      149 |         107 |       64 |
| China           |      229 |      160 |         114 |       69 |
| UAE             |      257 |      180 |         128 |       77 |
| South Africa    |      282 |      197 |         141 |       85 |

- Destination keys: `mexico`, `cayman`, `canada`, `hawaii`, `uk`,
  `argentina`, `switzerland`, `japan`, `china`, `uae`, `southafrica`, each
  with a display name. Plane keys: `standard`, `airstrip`, `private`,
  `business`, each with a display label (Standard, Airstrip, WLT private,
  Business).
- `minutesFor(dest, plane)` returns the number, or `null` for an unknown key.
- `VARIANCE = 0.03`: flights vary by up to 3% (wiki, since Patch #26).
- Not modelled, so the buffer has to absorb them: the book (−25%), the
  Detective Agency "Watchlist" delay, and rounding between sources (±1 min).

## 4. Reading the profile (`src/profile/readStatus.js`)

`readStatus(doc, location)` returns
`{ id, name, state, direction, destination, plane }`, with `null` for
anything it cannot read. It never throws.

- `state`: `traveling`, `hidden` (disguised), `abroad`, or `other`.
- `direction`: `to` (outbound from Torn), `from` (returning to Torn), or `null`.
- `destination`: a key from section 3, the foreign country in either
  direction, also filled in for `abroad` ("In Mexico").
- `plane`: what the profile shows, `commercial`, `airstrip` or `private`, and
  only when travelling. `flights.js` maps it to the plane the panel picks
  (`PROFILE_PLANES`): Commercial picks `standard`, because Business looks
  identical on a profile; the others pick themselves.
- `id`: the `XID` query parameter, otherwise from the page. `name`: from the
  profile page, otherwise `#<id>`.

Sources, in order of trust (all lookups live in `src/core/selectors.js`):

1. **Classes on `div.profile-status`**, from Torn's profile stylesheet:
   `travelling to <country words> <flightType>` /
   `travelling from <country words> <flightType>`, with `flightType` one of
   `commercial | airstrip | private`. A country is recognised from any of its
   tokens (`mexico`, `cayman`, `canada`, `hawaii`, `kingdom`, `argentina`,
   `switzerland`, `japan`, `china`, `uae`, `africa`). **Seen live
   2026-10-02:** a Commercial flight to Canada had the classes
   `profile-status m-top10 travelling to canada  ` with no flight-type word,
   so for Commercial the plane comes from source 2.
2. **The status `aria-label`** on `span.main-desc`: `"Traveling from <text>.
   Type of plane: Commercial | Personal | Private"` (Personal = airstrip).
   Seen live: `"Traveling from Torn to Canada  . Type of plane: Commercial"`,
   with spaces before the full stop.
3. **The visible status text** (`span.main-desc > span[aria-hidden]`, seen
   live as "Torn to Canada "): "Torn to Mexico", "Mexico to Torn",
   "In Mexico", "Hiding out in Mexico", "Traveling" (disguised), and the
   older wording still used in the hospital and jail variants: "Traveling to
   Mexico", "Returning to Torn from Japan". "UAE" and "United Arab Emirates"
   both match.

These selectors come from Torn's stylesheet and app code, not from a live
page. The parser is first built and tested against markup written to that
description. **Before release**, the player sends the real outerHTML of a
travelling player's status box and name heading (README: "How to send the
profile HTML"), ideally one outbound, one return and one abroad. They become
test fixtures that confirm or correct the selectors.

## 5. User-facing behaviour

### 5.1 Button (`src/profile/button.js`)

On `profiles.php` only, a **⏱ Landing timer** button sits next to the status
box. It is on every profile. When `state` is `traveling` or `hidden` it gets
an accent style. A MutationObserver puts it back if Torn redraws the status
box, and never inserts it twice.

### 5.2 Panel (`src/profile/panel.js`)

Clicking the button opens a popover anchored to it. It closes on Cancel,
Escape or an outside click. `readStatus` runs again on each open, so the
values are current.

```
┌─ Landing timer: SomeName [1234567] ────────────┐
│ Torn → Canada · plane on profile: Airstrip       │
│ Destination  [ Canada          ▾ ]               │
│ ( ) Standard      39 min                         │
│ (•) Airstrip      27 min    ← from profile       │
│ ( ) WLT private   19 min                         │
│ ( ) Business      12 min                         │
│ Ring  [ 2 ] min early  →  rings in 25 min (14:37)│
│ Flights vary up to ~3% (about 1 min on this one) │
│                        [ Cancel ]  [ Start ]     │
└──────────────────────────────────────────────────┘
```

- **Header:** the name and ID, then the direction ("Torn → Canada" or
  "Canada → Torn") and the plane read from the profile. Disguised: "Travelling
  disguised: pick the destination and plane." Abroad: "In Mexico. Not flying yet: the timer starts when you press Start."
  At home: "Not flying right now: the timer starts when you press Start." A
  timer started on someone abroad counts as their flight home.
- **Destination:** a dropdown of the 11 countries, plus a blank entry.
  Pre-selected from `destination`.
- **Plane:** four radios, each showing its minutes for the chosen destination
  (or "–" when no destination is chosen). Pre-selected from `plane`, and the
  detected one is tagged "← from profile". When the profile says Commercial,
  Standard is tagged and Business gets the note "← also Commercial".
- **Ring … min early:** a whole number from 0 to 30. It defaults to 2 and
  remembers the last value used (`settings.bufferMin`).
- **Summary:** "rings in X (HH:MM)" in local time.
  `ringAt = max(now, landingAt − buffer)`, and a buffer at or above the flight
  time says "rings now".
- **Variance line:** `round(minutes × 0.03)` minutes, or "under 1 min". When
  that is more than the buffer, the line adds ": more than your buffer" and
  turns amber, so long flights get a bigger buffer.
- **Placement:** the panel opens under the button, or above it when there's no
  room below. It stays inside the window while its button is on screen, and
  follows the button when the page scrolls. The keyboard starts on the first
  thing left to do. Escape, Cancel and Start hand it back to the button; a
  press elsewhere does not.
- **Start** is disabled until both a destination and a plane are chosen. It
  saves the timer, saves the buffer and closes the panel.

### 5.3 Floating timer box (`src/widget/`)

It is on every Torn page and hidden while there are no timers.

```
┌ ✈ Landing timers ─────── 🔊 ┐
│ SomeName   Canada     12:41 ✕ │
│ OtherGuy   Japan    2:03:10 ✕ │
└───────────────────────────────┘
```

- **Order:** one row per timer, soonest `ringAt` first.
- **Row contents:** the name links to `profiles.php?XID=<id>`. The country is
  shown, with "→ Torn" added for return flights.
- **Hover title:** "Lands ~14:39 · rings 14:37 · Airstrip, 27 min".
- **States, by the clock:**
  - before `ringAt`: a normal countdown to `ringAt` (`m:ss`, or `h:mm:ss`).
  - from `ringAt` to `landingAt`: a red row, "LANDING in m:ss".
  - after `landingAt`: a red row, "LANDED +m:ss".
- **Removing timers:** ✕ removes a timer. A timer removes itself 60 minutes
  after `landingAt`.
- **One timer per player:** a second Start on the same player replaces that
  player's timer.
- **Ticking:** while the page is visible, the box checks the clock four times
  a second and rewrites only the text that changed. A hidden tab doesn't tick
  at all and catches up when shown. With no timers the box writes nothing. The
  box is marked `translate="no"` so a page translator leaves the countdown
  alone.
- **Moving the box:** drag it by its title bar. The position is saved
  (`settings.widgetPos`) and kept on screen when the window shrinks. It
  starts at top-right, 16 px from the right edge and 120 px down. Its z-index
  sits above Torn's and Chat+'s chat boxes.

### 5.4 Chimes (`src/core/alarm.js`, `src/core/audio.js`)

- **The sounds:** synthesised with Web Audio (`audio.js`), with no sound file.
  The warning is three equal 880 Hz beeps, about 1.5 s in all. The landing
  chime is a rising four-note airport chime (C5–E5–G5–C6) in a triangle voice
  whose notes ring on into each other like a bell, about 2 s in all, a little
  louder than the warning.
- **The switch:** 🔊 toggles `settings.sound`, which is shared by all tabs and
  mutes both chimes. Default on.
- **When:**
  - Each timer has two chimes, each played **once, in exactly one tab**: the
    warning at `ringAt` and the landing at `landingAt`.
  - Each chime has its own mark in storage (`rungAt`, `landRungAt`).
  - Chimes that come due together play as one sound: the landing chime if
    anyone is landing, else the warning. With a buffer of 0 that means a single
    landing chime.
- **Console:** each decision is noted once in the console as
  `[Landing Timer] …`: chimed, no sound and why, or held back because the page
  may not play sound. The notes count chimes and never name players, since
  pages can collect what the console says.
- **Scheduling:**
  - Every tab aims one plain `setTimeout` at each chime still to play, and
    re-aims only the chimes that changed. Single, unchained timeouts avoid
    Chrome's intensive throttling of hidden tabs.
  - While a chime is waiting, a 1 s check, `visibilitychange`, `focus` and
    storage changes re-check as a safety net.
  - With nothing waiting, the alarm does nothing.
- **Exactly once:**
  - Chimes are claimed with `navigator.locks.request('landingtimer:ring',
    { ifAvailable: true })`, one lock for every timer.
  - Inside the lock the tab re-reads storage and plays every due chime that is
    still unmarked. It then holds the lock for 5 s so its marks reach the other
    tabs first.
  - A tab that finds the lock busy looks again 500 ms later.
  - A page also remembers every mark it has seen. A tab still running 1.0.0
    drops `landRungAt` when it writes, so this stops it making a landing chime
    play again. After an update, reload open Torn tabs.
- **Which tab:**
  - Browsers only let a tab play sound after the player has clicked in it. A
    chime is marked only once this tab has actually started its audio.
  - A tab that can't play leaves the chime for one that can, or for the next
    click in this one. A click starts the audio and re-checks at once.
  - With a chime waiting and the sound on, the tab checks once whether it may
    play. While it is known to be blocked, the 🔊 icon shows as 🔇 with the
    tooltip "Click anywhere on this page to allow the chime".
  - Any click on the page clears the hint. Clicking the icon itself counts as
    that click; it does not mute.
  - With the chime off, no sound is started at all.
- **Late:** if more than 2 minutes have passed since the estimated landing
  (computer asleep, browser closed), each chime still unplayed is marked
  without a sound. A big buffer therefore still chimes late, up to 2 minutes after the landing.
  The row still shows red.
- **Sound off:** each chime is marked silently. The setting is read afresh
  inside the lock, so a mute in another tab counts at once.

## 6. Storage (`src/core/storage.js`)

There is one `localStorage` key, `landingtimer.v1`, holding:

```js
{
  version: 1,
  timers: [{ id, name, destination, plane, direction,
             minutes, startedAt, landingAt, ringAt, rungAt, landRungAt }],
  settings: { bufferMin: 2, sound: true, widgetPos: null }
}
```

- Times are epoch milliseconds.
- **Sanitising:** reads are sanitised. Unknown keys are dropped, bad timers
  are discarded, numbers are clamped, and unparseable JSON starts fresh.
- **Other tabs:** the `storage` event re-renders other tabs and reschedules
  their chimes. A page restored from the back/forward cache re-reads.
- **Writes:** every change re-reads storage first, so a tab with a stale copy
  never writes it over another tab's change.
- **Save failures:** if the browser refuses to save (storage for torn.com
  full or blocked), the tab keeps working from memory. The panel then stays
  open and says the timer runs on this page only.

## 7. Project layout

The build is the same as Chat+: esbuild produces an IIFE with the userscript
header as a banner, CSS is loaded as text, and tests run on `node --test` with
jsdom. There is no runtime dependency.

```
build.mjs                       esbuild bundle + userscript header
src/header.txt                  ==UserScript== metadata block
src/main.js                     bootstrap: storage, widget, alarm; profile button on profiles.php
src/styles.css                  the whole stylesheet, injected once
src/core/flights.js             flight table + variance
src/core/selectors.js           EVERY Torn DOM lookup
src/core/storage.js             landingtimer.v1, sanitising, cross-tab events
src/core/alarm.js               scheduling and the exactly-once claim
src/core/audio.js               the synthesised chime, and whether this tab may play it
src/core/time.js                countdown and clock formatting
src/core/clock.js               the real clock (now + timers), injectable so tests drive time
src/core/dom.js                 el(): builds elements, page text always as text
src/core/log.js                 prefixed console helpers, safe()
src/core/version.js, styles.js  build version, stylesheet injection
src/profile/readStatus.js       profile DOM → { id, name, state, direction, destination, plane }
src/profile/button.js           the profile button + re-insertion observer
src/profile/panel.js            the popover
src/widget/widget.js            the floating box: rows, states, ✕, tick
src/widget/drag.js              title-bar drag, saved position, keep on screen
test/fixtures/*.html            real profile status markup sent by the player
test/*.test.js                  node --test suites
testlib/dom.js                  jsdom helpers, profile markup builder
testlib/fakes.js                fake clock, fake Web Locks, in-memory storage, a sample timer
```

The header has `@name Landing Timer`, `@namespace landingtimer.torn`,
`@version 1.0.0`, `@match https://www.torn.com/*`, `@run-at document-idle`,
`@grant none`, `@noframes` and `@license MIT`. There are no update URLs until the player
publishes a repo. The git identity is the anonymous local one ("Torn Landing
Timer" <torn-landing-timer@noreply.invalid>), as in Chat+.

## 8. Tests

- `flights.test.js`: all 44 minutes equal the table in section 3; unknown keys
  return `null`.
- `readStatus.test.js`:
  - Real fixtures: outbound, return, abroad, disguised and not travelling,
    plus a hospital or jail variant if the player can capture one. Otherwise
    a variant is built from the wording in section 4.
  - The class path, the aria-label fallback and the text fallback (both
    wordings) each tested on their own.
  - Commercial maps to `standard`; a missing XID falls back to the page.
- `storage.test.js`: defaults; sanitising junk; one timer per player
  (replace); removal; expiry 60 minutes after landing; cross-tab events.
- `alarm.test.js` (fake clock, fake locks granted asynchronously, fake audio,
  and storage that reaches other tabs late):
  - The chime fires once at `ringAt`; two tabs give one chime; without the 5 s
    hold, slow storage lets a second tab chime.
  - Sound off, or more than 2 minutes after landing, means no chime but
    `rungAt` is set; a mute from another tab counts at once.
  - A tab that cannot play leaves the ring unmarked and rings it after a click.
  - Timers due together ring with one chime; a busy lock is retried soon.
  - Rescheduling happens when the timers change; nothing runs while none wait.
- `audio.test.js` (fake AudioContext that starts, starts late, hangs or
  refuses): `ready()`, `play()`, `unlock()` and `likely()`, a closed
  context replaced, no Web Audio at all.
- `panel.test.js`:
  - Pre-filled from status; blanks when unknown; Start disabled until both
    are chosen.
  - Minutes update with the destination; the "from profile" tag and the
    Business note.
  - Ring time maths, including a buffer of at least the flight time.
  - The variance text; the buffer remembered.
- `widget.test.js`: hidden when empty; order; the three states and their
  text; ✕; drag clamping and the saved position.
- `button.test.js`: inserted once, re-inserted after a redraw, accent only
  when travelling, absent off `profiles.php`.
- `build.test.js`:
  - The header is present and correct, and the version is stamped.
  - The rule-safety guard: `dist/` contains none of `fetch(`,
    `XMLHttpRequest`, `GM_xmlhttpRequest`, `sendBeacon`, `WebSocket`,
    `EventSource`, `@connect`, `@require`, or a `@grant` other than `none`.
  - A smoke test runs the built bundle in jsdom. On a profile it gives the
    styles, the button, a pre-filled panel, and a row after Start. Off a
    profile it gives a hidden timer box and no button.

The README carries a manual acceptance checklist for a live Torn session:
- The button appears on a travelling profile with the right pre-fill.
- Start, then go to another page: the countdown follows.
- Two tabs give one chime.
- Mute works.
- Reload keeps the timers.
- Disguised travel gives blanks.
- The box can be dragged, and keeps its place after a reload.

## 9. Out of scope

- Detecting take-off automatically, polling, or any API key.
- The travel book (−25%) and Detective Agency delays (the buffer covers the
  slack).
- Telling Business from Standard (the profile cannot).
- Torn PDA and mobile layouts.
- Desktop notifications and a flashing tab title.
- Two alarms (Business then Standard) for commercial flights.
