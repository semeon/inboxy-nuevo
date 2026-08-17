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

## Action plan

**Phase 1 — code cleanup (blocking)**
- [ ] Remove `dist/background.js`, its `background` manifest entry, and the `declarativeContent` permission
- [ ] Remove `action.show_matches` from the manifest
- [ ] Fix or redirect the Chrome Web Store link in `options.html`
- [ ] Reconcile the `package.json` / manifest version mismatch
- [ ] Run Jest; verify the extension still loads clean in Chrome

**Phase 2 — packaging**
- [ ] Add `npm run package`
- [ ] Gitignore the zip artifact

**Phase 3 — verification**
- [ ] Load unpacked in Edge; work the test plan above
- [ ] Re-verify in Chrome for regressions

**Phase 4 — publish**
- [ ] Register on Partner Center
- [ ] Assemble listing assets from the Chrome listing
- [ ] Submit; track certification
- [ ] On approval: update [README.md](../README.md) and inboxymail.com to list Edge

## Open questions

- **Firefox.** The README advertises a Firefox build, but this repo contains only the Chrome MV3
  manifest — that build lives elsewhere. Adding Edge does not touch it, but if a multi-target build
  is ever wanted, that is the fork worth abstracting, not Edge.
- **Ownership.** Partner Center registration needs a Microsoft account tied to a real owner. Decide
  who holds it before Phase 4.
- **Release cadence.** Every future release now needs two submissions. Worth deciding whether Edge
  tracks Chrome release-for-release, or only picks up meaningful changes.
