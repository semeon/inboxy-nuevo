# Supporting Microsoft Edge

## Summary

Edge is Chromium-based, so inboxy's MV3 package runs on it essentially unmodified. This is a
**distribution project, not a porting project**: the bulk of the work is packaging, store
registration, and verification — not code.

Estimated effort: ~1 day of engineering, plus store review latency (days to weeks, outside our
control).

Scope note: the README declares the extension unmaintained. This plan deliberately stays minimal —
add a target, fix what blocks it, change nothing else.

## Current state

Single build target, no browser abstraction layer:

- `manifest_version: 3`, service worker background — [dist/manifest.json](../dist/manifest.json)
- Extension APIs used: `chrome.storage.sync`, `chrome.tabs.create`, `chrome.declarativeContent`,
  `chrome.runtime.onInstalled`
- Distribution is manual — `dist/` is loaded unpacked; there is no packaging script
- `src/` is webpack-bundled into `dist/content.js` (gitignored); everything else in `dist/` is
  hand-authored and shipped verbatim

## Compatibility analysis

### Works as-is

| Area | Why it's safe |
|---|---|
| MV3 manifest, service worker | Edge tracks the Chromium extension platform |
| `chrome.*` namespace | Edge aliases `chrome.*`; no `browser.*` polyfill needed |
| Content script + Gmail DOM | Gmail serves the same DOM to all Chromium engines |
| `chrome.tabs.create` in [popup.js:20](../dist/popup/popup.js#L20) | Supported; needs no `tabs` permission for `create` |
| Bundling/date-grouping logic | Pure DOM work, engine-independent |

### Needs attention

**1. `declarativeContent` is dead code and a review liability.**
[dist/background.js:17-28](../dist/background.js#L17-L28) calls
`new chrome.declarativeContent.ShowPageAction()`, which was removed in MV3 (`ShowAction` replaced
it). The `if (chrome.declarativeContent)` guard passes — the API object exists — so the constructor
throws at runtime inside the `onInstalled` callback. This is a **pre-existing Chrome bug**, not
Edge-specific; it is silent because MV3 toolbar actions are always visible anyway.

Recommendation: delete the background service worker and the `declarativeContent` permission
entirely. Fewer permissions means a faster, less contentious store review on both stores.

**2. `action.show_matches` is not a valid MV3 key.**
[manifest.json:32](../dist/manifest.json#L32) carries an MV2 `page_action` leftover. Ignored at
runtime; may surface as a Partner Center validation warning. Remove it.

**3. `chrome.storage.sync` syncs through the Microsoft account on Edge.**
Reads/writes work regardless — used at [SelectiveBundling.js:26](../src/bundling/SelectiveBundling.js#L26),
[DateGrouper.js:38](../src/bundling/DateGrouper.js#L38), [Bundler.js:53](../src/bundling/Bundler.js#L53),
and [options.js:25,41](../dist/options/options.js#L25). Cross-device sync is tied to Edge profile
sync being enabled. Verify persistence across restart; do not assume cross-device sync works.

**4. Chrome Web Store link in the options page.**
[options.html:254](../dist/options/options.html#L254) hardcodes the Chrome listing URL. Edge users
following it land on the wrong store. Either detect the host browser and swap the link, or point it
at inboxymail.com and let the site route.

**5. Version drift.**
`package.json` says `1.1.0`; the manifest says `1.6.5`. Any release automation must read the
manifest as the source of truth — or the two must be reconciled first.

### Explicitly out of scope

Edge's own UI (sidebar, Copilot pane) narrows the viewport rather than changing the page DOM. Gmail
handles that with its existing responsive behavior; no inboxy CSS work is anticipated. Confirm
during testing, don't pre-engineer for it.

## Build & packaging

No source fork, no per-browser manifest. One artifact serves Chrome and Edge.

Add a package step:

```
npm run build      # webpack → dist/content.js
npm run package    # zip dist/ → inboxy-<version>.zip
```

Implement `package` as a small Node script that reads the version from `dist/manifest.json` and zips
`dist/` — excluding nothing, since `dist/` is already exactly the shipped tree. Add
`inboxy-*.zip` to [.gitignore](../.gitignore).

## Distribution

Publish through **Microsoft Partner Center** → Edge Program:

1. Register a developer account (free; no fee, unlike Chrome's one-time registration).
2. Create the extension listing; upload the ZIP from `npm run package`.
3. Supply listing assets. Most can be reused from the Chrome listing: description, screenshots,
   icon, privacy policy URL, homepage.
4. Declare data usage — inboxy reads Gmail DOM locally and stores preferences via
   `storage.sync`; no data leaves the device. State this plainly; it is the item most likely to
   trigger reviewer questions for a mail-adjacent extension.
5. Submit and wait on certification.

Edge review commonly probes broad host permissions and undeclared data collection. Our narrow
`mail.google.com` match pattern and the `declarativeContent` removal both help here.

## Test plan

Load `dist/` unpacked in Edge via `edge://extensions` → Developer mode, then verify against a real
Gmail account:

- Bundles render, expand, and collapse
- Bulk archive on a bundle page
- Star-to-pin removes the message from its bundle
- Date headings group correctly
- Light and dark theme
- Options page saves and reloads settings; settings survive a browser restart
- Popup opens and its links open new tabs
- Service worker shows no errors in `edge://extensions` → "Inspect views"
- Category tabs (Primary/Social/Promotions) inbox layout

Cross-check the same list once in Chrome to confirm no regression from the manifest and background
changes.

Existing Jest tests ([test/](../test/)) cover pure logic and need no change.

## Documentation rewrite

The current [README.md](../README.md) is upstream's. It opens by declaring the extension
unmaintained and points every support channel at `teresa-ou/inboxy` — the direct opposite of this
fork's purpose. It must be rewritten, not amended.

### Must cover

**1. Attribution and provenance.** inboxy was created by
[Teresa Ou](https://github.com/teresa-ou); this is a fork of `teresa-ou/inboxy`, continued after
upstream stopped active maintenance. Link the original repo. Credit is both courtesy and a GPL
obligation — copyright notices stay, and §5(a) requires modified files to carry prominent notice of
change.

**2. Purpose.** Keep inboxy alive and working across Chrome, Edge, and Firefox. State it plainly up
front — it is the reason the fork exists and the first thing a visitor needs. Frame it as the
project's intent, not a claim of present-day support: Chrome works today, Edge is next, Firefox
follows. A short status line per browser (working / in progress / planned) keeps the ambition
honest and saves the README from going stale as each lands.

**3. Divergence from upstream.** A short, running list of what this fork changed, starting with the
1.7.1 manifest cleanup. Doubles as the GPL §5(a) notice and as the honest answer to "why not just
use the original?"

**4. Per-browser install and development.** Build once, load the same `dist/` in each browser:
Chrome and Edge via `chrome://extensions` / `edge://extensions` → Developer mode → Load unpacked;
Firefox via `about:debugging` (see the Firefox caveat below). Keep the existing `npm install` /
`npm run build` steps, and add `npm run package` once it exists.

**5. Repo layout — specifically the `dist/` trap.** `dist/` is not a disposable build directory. It
is the extension package root: 38 of its 39 files are hand-authored and tracked, and only
`content.js` is generated from [src/](../src/). Deleting `dist/` destroys the popup, options page,
and all artwork. This is the single most likely way for a newcomer to break the project, and the
directory name actively misleads. Document it; renaming is not worth the churn.

**6. Support channels.** Issues go to this fork, not upstream. This includes the in-product link at
[options.html:250-258](../dist/options/options.html#L250-L258), currently pointing at
`teresa-ou/inboxy/issues`.

**7. License.** GPL-3.0-**or-later** — the file headers say "or (at your option) any later version".
Note that `package.json` currently declares `"description": "GPL-3.0-only"`, which contradicts them
and should be corrected to a proper `"license": "GPL-3.0-or-later"` field.

### Framing

**Firefox ordering.** Firefox is in scope as intent, not as a same-day deliverable — the README
should say so rather than imply all three work now. The repo currently holds only a Chrome MV3
manifest, so Firefox needs real work of its own: `browser_specific_settings` with an extension ID,
its differing MV3 background model, and an AMO submission. That becomes a phase after Edge ships;
until then the README lists it as planned.

**Naming and branding — unresolved, settled in Phase 4.** The GPL licenses the *code*; it does not
license trademarks. The name "inboxy", the logo, and `inboxymail.com` are not ours to take. A public
store listing under that name is a trademark question wholly separate from the license, and it
applies to the Chrome and Firefox listings as much as Edge. Options, in increasing order of safety:
publish as-is and hope; email Teresa Ou for permission; or rename and rebrand the fork. It
determines the store listing name, the docs, the logo assets, and possibly the manifest `name`.

Nothing before Phase 4 depends on it — local builds, Edge testing, and the doc rewrite all proceed
under the current name — so it is deferred rather than blocking.

Renaming is harder than it looks: candidate clearance checks killed *Bindle* (an existing Chrome
extension), *Tidings* (Tidings Company LLC, an email newsletter SaaS shipping Chrome and Firefox
extensions), and *Sorted* (homophone of Sortd for Gmail, same niche). The obvious vocabulary for
"tidy inbox" is thoroughly worked by existing email products. If a rename is needed, coined or
oblique names clear far more easily than descriptive ones — but asking Teresa Ou first is cheaper
than any of it.

## Action plan

**Phase 1 — code cleanup (blocking) — DONE, released as 1.7.1**
- [x] Remove `dist/background.js`, its `background` manifest entry, and the `declarativeContent` permission
- [x] Remove `action.show_matches` from the manifest
- [x] Make the `options.html` feedback link browser-neutral. A per-browser store link
      needs the Edge listing URL, which does not exist until Phase 5 — deferred there.
- [x] Reconcile the `package.json` / manifest version mismatch
- [x] Run Jest; verify the extension loads clean in Chrome — 13 tests pass; unpacked load verified

**Phase 2 — verification — DONE**
- [x] Load unpacked in Chrome — no manifest errors, storage-only permissions, bundling intact
- [x] Load unpacked in Edge — works; the "runs unmodified on Chromium" premise holds

The compatibility risks this plan opened with turned out to be theoretical. No Edge-specific
code was needed, and the [Test plan](#test-plan) above is retained only as a regression
checklist for future changes.

**Phase 3 — documentation**
- [ ] Rewrite the documentation — see [Documentation rewrite](#documentation-rewrite).
      Write it under the current name; branding is settled in Phase 4, and a rename means
      one more pass over the docs then.

**Phase 4 — branding**
- [ ] Settle whether this ships as "inboxy", under a new name, or as a contribution upstream
      rather than a published fork — see [Framing](#framing). Cheapest first move by far:
      email Teresa Ou and ask.
- [ ] Apply the outcome to the manifest `name`, logo assets, docs, and site references

**Phase 5 — publish**
- [ ] Add `npm run package` — must zip the *contents* of `dist/`, so `manifest.json` lands
      at the archive root; a `dist/`-prefixed archive is rejected by both stores
- [ ] Switch webpack to `mode: 'production'` for release builds. Development mode plus
      `inline-source-map` currently inflates `content.js` to ~267KB of mostly source map.
- [ ] Gitignore the zip artifact
- [ ] Register on Partner Center
- [ ] Assemble listing assets from the Chrome listing
- [ ] Submit; track certification
- [ ] On approval: update [README.md](../README.md) and inboxymail.com to list Edge

## Open questions

- **Firefox.** A phase after Edge ships, listed as planned until then — see
  [Framing](#framing). Adding Edge does not touch it; if a real multi-target build is ever
  wanted, Firefox is the fork worth abstracting for, not Edge.
- **Naming and branding.** Trademark, not license — see [Framing](#framing). Settled in Phase 4.
- **Ownership.** Partner Center registration needs a Microsoft account tied to a real owner. Decide
  who holds it before Phase 5 — and note it may not be us at all, if the Edge work goes upstream.
- **Release cadence.** Every future release now needs two submissions. Worth deciding whether Edge
  tracks Chrome release-for-release, or only picks up meaningful changes.
