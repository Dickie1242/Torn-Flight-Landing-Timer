# Landing Timer

A userscript for [Torn City](https://www.torn.com) that puts a landing timer on player profiles.

- **One button on the profile.** When someone is flying, a **⏱ Landing timer** button under their status opens a panel that already knows where they're headed and which plane the profile shows.
- **Every flight time at a glance.** The panel lists the Standard, Airstrip, WLT private and Business times for the destination, picks the likely one, and says how far flights can vary.
- **Rings early.** You choose how many minutes before the estimated landing it rings. The default is 2, and it remembers your last choice.
- **Follows you around Torn.** A small box on every page counts down, turns red when it's time, and then counts on past the estimated landing.
- **Several at once.** One row per player, soonest first.
- **Two chimes, each played once in one Torn tab.** Three short beeps when a timer comes due, a few minutes before the estimated landing, then a rising four-note airport chime at the landing itself, so you can tell them apart. The 🔊 button mutes both.

## Rule safety

**Landing Timer makes no network requests.** It sends nothing to Torn, to its API or to any other server, and it needs no API key. A test in the build fails if any of the known ways to make a request (the network APIs, or an element or style that loads a URL) appears in the finished script, and the script asks for no special permissions (`@grant none`).

What it reads:
- It reads **only the profile page you have open**, to fill in the panel.
- After you press **Start** it is a clock. The countdown and the chime use only the numbers you set, and read nothing from any page.

Torn's rules allow scripts that rely on "a page that you have manually loaded and are actively viewing". The chime can play while Torn is in a background tab. It reads nothing when it does, but if you'd rather not have that, the 🔊 button in the timer box turns it off.

Your timers are stored in your browser (`localStorage`, key `landingtimer.v1`) and nowhere else.

The one thing that does go over the network is Tampermonkey's own update check. Because of the `@updateURL` line, Tampermonkey checks this GitHub repository for new versions now and then, as it does for any script installed from a link. That is Tampermonkey, not the script, and it never involves Torn.

## Install

1. Install a userscript manager, such as [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).
2. Open the install link and click **Install**:
   https://raw.githubusercontent.com/Dickie1242/Torn-Flight-Landing-Timer/main/dist/landingtimer.user.js
   Your userscript manager checks this link for updates, so new versions arrive automatically.
3. Open a Torn profile.

After an update, reload any Torn tabs you had open, so every tab runs the same version.

To install by hand instead:
1. Open the Tampermonkey dashboard and click the **+** tab.
2. Delete everything in the editor.
3. Paste in the whole of `dist/landingtimer.user.js`.
4. Save with **Ctrl+S**.

## Using it

1. Open the profile of someone who is flying.
2. Click **⏱ Landing timer** under their status.
3. Check the plane. The profile shows **Commercial**, **Airstrip** or **Private**, and the panel picks the matching time.
   - A Business class ticket looks exactly like Commercial on a profile, so Commercial picks **Standard**.
   - If you know they bought a ticket, click **Business**.
4. Set how many minutes early it should ring, and press **Start**.

The timer starts when you press Start, so start it when you see them take off. Flights can run up to about 3% long or short. On a 4h42m flight that is about 8 minutes, and the panel shows the figure for each flight, so you can give long flights a bigger buffer.

The box can be dragged by its title bar. Click a name to open that profile, and click ✕ to remove a timer. Timers clear themselves an hour after landing.

If someone travels disguised, the profile only says "Traveling", so you pick the destination and plane yourself.

### Known limits

- **A Torn tab must be open** for the chime. If none is, there's no chime, but the box shows where things stand as soon as you open Torn again.
- **Sleeping tabs can't chime.** Chrome's Memory Saver and Energy Saver can put background tabs to sleep, and a sleeping tab can't chime. To be safe, keep one Torn tab where you'll see it, or turn Memory Saver off for torn.com.
- **Sound needs a click.** Browsers only let a page make sound after you've clicked in it. If the 🔊 button shows 🔇 and you didn't mute it, the browser hasn't let that page play sound yet: click anywhere on it once.
- **Times are estimates.** Flights vary by up to about 3%. The "Mailing Yourself Abroad" book (−25%) and the Detective Agency's delay are not shown on a profile, so your buffer has to cover them.
- **Built for Chrome and Edge.** Other browsers are untested.

### Flight times (one way, minutes)

These are the times after Torn's 23 June 2026 travel patch, without the "Mailing Yourself Abroad" book.

| Destination | Standard | Airstrip | WLT private | Business |
|---|---:|---:|---:|---:|
| Mexico | 24 | 17 | 12 | 7 |
| Cayman Islands | 33 | 23 | 17 | 10 |
| Canada | 39 | 27 | 19 | 12 |
| Hawaii | 127 | 89 | 63 | 38 |
| United Kingdom | 151 | 106 | 75 | 45 |
| Argentina | 158 | 111 | 79 | 47 |
| Switzerland | 166 | 116 | 83 | 50 |
| Japan | 213 | 149 | 107 | 64 |
| China | 229 | 160 | 114 | 69 |
| UAE | 257 | 180 | 128 | 77 |
| South Africa | 282 | 197 | 141 | 85 |

## Build

Requires Node 20 or newer.

```bash
npm install
npm run build      # writes dist/landingtimer.user.js
npm test           # runs the tests, including the no-network check
npm run watch      # rebuilds on every change under src/
```

## Install your own build (dev loader)

To pick up every rebuild without pasting, create a *separate* tiny script in Tampermonkey that loads the build from disk:

```javascript
// ==UserScript==
// @name         Landing Timer (dev loader)
// @namespace    landingtimer.torn
// @version      1.0.0
// @match        https://www.torn.com/*
// @run-at       document-idle
// @grant        none
// @require      file:///C:/path/to/LandingTimer/dist/landingtimer.user.js
// ==/UserScript==
```

- **Paths:** spaces are `%20` and the separators are forward slashes.
- **Chrome and Edge:** open `chrome://extensions`, then Tampermonkey's *Details*, and turn on **Allow access to file URLs**.
- **Avoid running it twice:** disable the pasted copy while the loader is on.

## Manual acceptance checklist

Run through this on `https://www.torn.com/` after installing a new build.

- [ ] Someone flying: the button under their status is green; the panel shows the right country and plane, the times match the table, and the ring time is 2 minutes before landing.
- [ ] Press Start, then go to another Torn page: the box is there and counting down.
- [ ] Two Torn tabs open when a timer comes due: one warning chime, not two; at the landing, one landing chime.
- [ ] The landing chime sounds clearly different from the warning.
- [ ] 🔊 mutes it in every tab; a timer comes due silently and its row still turns red.
- [ ] Reload: the timers are still there.
- [ ] Someone travelling disguised: the panel opens blank and Start waits for a country and plane.
- [ ] Drag the box somewhere, reload: it stays there. Shrink the window: it stays on screen.
- [ ] A profile of someone at home: the button is grey and still opens the panel.
- [ ] In both Torn's light and dark mode, the button, the panel and the box look right, with readable text, a blue name link and a green plane tag. The box and the panel sit above the chat.
- [ ] With a timer running, open Torn in a new tab and don't click in it. Within a few seconds 🔊 either stays (Chrome allows sound) or turns 🔇. One click in the page turns it back to 🔊.

## How to send the profile HTML

If the panel opens blank for someone who is clearly flying, Torn has changed its page and `src/core/selectors.js` needs updating. Send the real markup:

1. Open the profile of someone who is flying.
2. Right-click their travel status text and choose **Inspect**.
3. In the Elements panel, find the nearest `<div class="profile-status ...">` above the highlighted line.
4. Right-click it, choose **Copy > Copy outerHTML**, and paste it into the chat with Claude. A screenshot of the Elements panel works too.
5. Do the same for the player's **name** at the top of the profile.
6. Say what you saw on the page: where they were flying, and which plane.

## Project layout

```
build.mjs                     esbuild bundle + userscript header
src/header.txt                ==UserScript== metadata block
src/main.js                   bootstrap
src/styles.css                the whole stylesheet, injected once at boot
src/core/flights.js           the flight table
src/core/selectors.js         EVERY Torn page lookup lives here
src/core/storage.js           timers and settings, shared across tabs
src/core/alarm.js             plays each timer's two chimes once, in one tab
src/core/audio.js             the two synthesised chimes, and whether this tab may play them
src/core/time.js, clock.js    formatting; the injectable clock
src/core/dom.js, log.js       element builder; console helpers
src/core/version.js, styles.js build version; stylesheet injection
src/profile/readStatus.js     profile page → destination, direction, plane
src/profile/button.js         the profile button
src/profile/panel.js          the panel
src/widget/widget.js          the floating timer box
src/widget/drag.js            dragging the box
test/fixtures/                real Torn markup the player captured
testlib/                      test fakes and jsdom helpers
```

## License

MIT
