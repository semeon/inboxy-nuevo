# Don't bundle a label with only one message

## Summary

A bundle containing one message is pure overhead: it hides the message behind a row that says the
same thing, costs a click to read, and adds a line to the inbox instead of removing one. Change the
rule from "every relevant label becomes a bundle" to "a label becomes a bundle only once it has at
least two messages on the page". A label with a single message renders as a plain Gmail row, exactly
like a message with no bundled labels.

The bundling decision already happens in one place, so the core change is small. Most of the work is
in the callers that assume "message has a label ⟹ that message lives in a bundle" — an invariant this
change breaks, and one of those callers crashes today if it is broken.

Estimated effort: half a day, most of it verification in real Gmail.

## Current state

`Bundler._bundleMessages()` ([src/bundling/Bundler.js:100](../src/bundling/Bundler.js#L100)) runs
three stages over the page's message rows:

1. `_groupByLabel()` — for each non-starred message, add it to a `Bundle` for every relevant label
   (relevance = the include/exclude list in `SelectiveBundling`). A message with two labels joins two
   bundles.
2. `_calculateMessageAndBundleRows()` — walk the messages in Gmail's order and emit one row per
   element: a `BUNDLE` row the first time a label is seen, or an `UNBUNDLED_MESSAGE` row if the
   message is starred or has no relevant labels. `DateDivider.withDateDividers()` then interleaves
   date headings.
3. `_drawTableRows()` — assign each row a flexbox `order` and append bundle rows / date dividers.
   `_drawBundleRow()` is what tags a message with `.bundled-message`, and CSS
   ([dist/style.css:285](../dist/style.css#L285)) hides anything carrying that class until its bundle
   is open.

Two consequences matter for this change:

- A message that ends up in no bundle never gets `.bundled-message`, so it stays visible with no CSS
  work — **provided step 2 emits an `UNBUNDLED_MESSAGE` row for it**, which is what gives it an
  `order`. Miss that and the row lands in flexbox order `0`, above everything.
- Bundle membership is computed per label independently, so removing a bundle never changes another
  bundle's size. One filtering pass is enough; no cascade, no iteration to a fixed point.

## The change

### 1. Drop undersized bundles at the single choke point

`src/bundling/Bundler.js` — filter at the end of `_groupByLabel()`, so every later stage sees only
real bundles:

```js
_groupByLabel(messageNodes) {
    const bundlesByLabel = {};
    // ...unchanged...
    return this._dropUndersizedBundles(bundlesByLabel);
}

/**
 * Labels with too few messages aren't worth bundling; their messages are shown unbundled.
 */
_dropUndersizedBundles(bundlesByLabel) {
    return Object.fromEntries(
        Object.entries(bundlesByLabel)
            .filter(([, bundle]) => bundle.getMessages().length >= MIN_BUNDLE_SIZE));
}
```

Add `MIN_BUNDLE_SIZE = 2` to [src/util/Constants.js](../src/util/Constants.js) next to
`ORDER_INCREMENT`, with a comment stating the rule.

### 2. Fall back to an unbundled row

`_calculateMessageAndBundleRows()` currently guards with `if (!labels.has(l) && bundlesByLabel[l])`,
which silently emits *nothing* for a message whose labels have no bundle. Restructure so the
fallback is driven by the surviving bundles rather than by the raw label list:

```js
for (let i = 0; i < messageNodes.length; i++) {
    const message = messageNodes[i];
    const bundledLabels = this._isStarred(message)
        ? []
        : this.selectiveBundling.findRelevantLabels(message).filter(l => bundlesByLabel[l]);

    if (bundledLabels.length === 0) {
        rows.push({ element: message, type: Element.UNBUNDLED_MESSAGE });
        continue;
    }

    bundledLabels.forEach(l => {
        if (!labels.has(l)) {
            rows.push({ element: bundlesByLabel[l], type: Element.BUNDLE });
            labels.add(l);
        }
    });
}
```

This preserves today's starred-message behaviour and folds the new case into the same branch. A
message keeping one bundled label and losing another (labels `A`×3, `B`×1) still renders inside `A`
only — correct, and unchanged from today.

### 3. Fix `StarHandler`, which crashes on the new state

[src/handlers/StarHandler.js:52](../src/handlers/StarHandler.js#L52) assumes a labelled message
implies a live bundle. Two failures appear once that stops being true:

**a. Starring an unbundled-but-labelled message — a new crash.** Today, to star a labelled message
you must first open its bundle, so `getLabelOfOpenedBundle()` is always non-empty at that point.
After this change a singleton-label message sits in the list with no bundle open, and
`this.bundledMail.getBundle('').getBundleRow()` throws a `TypeError` inside a `mousedown` handler.

**b. Unstarring the only message with its label.** `handleStarring()` records `labels[0]` as the
bundle to reopen; after rebundling that label has no bundle, and `scrollIfNecessary()` dereferences
`getBundle(label)` — same `TypeError`.

Fix both by treating a missing bundle as "nothing to restore" rather than an impossible state: pick
the first label that actually has a bundle (`labels.find(l => this.bundledMail.getBundle(l))`), and
in both `handleStarring()` and `scrollIfNecessary()` bail out with `this.prevTop = null` when there is
no bundle row to measure against. Losing scroll restoration in these cases is acceptable — the
message is a single row, not a collapsing bundle.

While there, make `BundledMail.getBundleOnPage()`
([src/containers/BundledMail.js:38](../src/containers/BundledMail.js#L38)) return `undefined` instead
of throwing when the page or tab has no entry yet (optional chaining on `this._bundlesMap[pageNumber]`).
Callers already treat a falsy bundle as absent.

### 4. No change needed (verified)

| Caller | Why it's safe |
|---|---|
| `Bundler.bundleMessages()` reopen path | Already gated on `bundledMail.getBundle(...)` before reopening |
| `InboxyStyler.markSelectedBundlesFor()` | Already returns early on a missing bundle |
| `MessageSelectHandler` | Only reaches bundles through `InboxyStyler` |
| `DateDivider` | Operates on the row list *after* filtering; the message arrives as `UNBUNDLED_MESSAGE`, so date headings and per-date bulk archive still cover it |
| `QuickSelectHandler` | Works purely off `style.order`, which every row still gets |
| CSS | `.bundled-message` is applied only when a bundle row is drawn |

## Accepted behaviour changes

- **Per-page counting.** Bundles are computed per page of messages, as they already are. A label with
  one message on page 1 and four on page 2 shows unbundled on page 1. This matches how bundle counts
  already work, but it means a bundle can appear and disappear as you page.
- **No "View all" for a lone message.** That link lives on the bundle row. The message still carries
  its Gmail label chip, which links to the same place.
- **Label chip is visible again.** `BundleToggler.openBundle()` hides the chip that duplicates the
  bundle name; an unbundled message keeps it, consistent with every other unbundled row.
- **Bundle counts never read `(1)`.** The `(1)` case disappears from `BundleRow` entirely.

## Optional: make it a setting

The options page already has the pattern for this — `groupMessagesByDate` is read in the `Bundler`
constructor via `chrome.storage.sync.get` and written from
[dist/options/options.js:25](../dist/options/options.js#L25) with a toggle in
[dist/options/options.html:233](../dist/options/options.html#L233).

Adding `bundleSingleMessages` (default `false`) is ~15 lines across those three files, with
`MIN_BUNDLE_SIZE` becoming `this.minBundleSize`. Worth doing only if the old behaviour needs to stay
reachable; the default should be the new one either way. Note the storage read is async and the
constructor doesn't await it — same latent race as `groupMessagesByDate`, not worsened here.

## Verification

**Unit** (`test/Bundler.test.js`, new — jest already runs jsdom, stub `global.chrome.storage.sync.get`
to invoke its callback synchronously):

- label with 2+ messages → one `BUNDLE` row, messages tagged `.bundled-message`
- label with exactly 1 message → one `UNBUNDLED_MESSAGE` row, no bundle row, no `.bundled-message`,
  non-zero `order`
- message with labels `A`×3 / `B`×1 → appears in bundle `A`, no bundle `B`
- starred message with a 1-message label → unbundled, as today
- every message row ends up with exactly one row in the output and a distinct `order`

**Manual, in Gmail** — the parts jsdom can't cover:

1. Inbox with a mix of singleton and multi-message labels: singletons render as ordinary rows,
   correctly positioned under their date heading.
2. Star a message in a 2-message bundle → bundle dissolves, remaining message renders unbundled,
   **no console error**.
3. Unstar it → bundle re-forms.
4. Star / unstar a singleton-label message directly → no console error (this is the regression from
   §3a).
5. Archive down to one message in an open bundle → bundle dissolves on Gmail's rerender.
6. Shift+click selection spanning a singleton row and a bundle row.
7. Per-date bulk archive includes singleton rows.
8. Switch inbox tabs and page forward/back; check light and dark themes.

## Files touched

- [src/bundling/Bundler.js](../src/bundling/Bundler.js) — `_groupByLabel`, new `_dropUndersizedBundles`, `_calculateMessageAndBundleRows`
- [src/util/Constants.js](../src/util/Constants.js) — `MIN_BUNDLE_SIZE`
- [src/handlers/StarHandler.js](../src/handlers/StarHandler.js) — missing-bundle guards
- [src/containers/BundledMail.js](../src/containers/BundledMail.js) — defensive lookup
- `test/Bundler.test.js` — new
- Optionally `dist/options/options.{html,js}` — the setting
