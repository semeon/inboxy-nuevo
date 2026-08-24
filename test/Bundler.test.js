// inboxy: Chrome extension for Google Inbox-style bundles in Gmail.
// Copyright (C) 2020  Teresa Ou

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

import Bundler from '../src/bundling/Bundler';
import Bundle from '../src/containers/Bundle';
import { Element } from '../src/util/Constants';
import DomUtils from '../src/util/DomUtils';

const TODAY = String(new Date(2020, 2, 15, 9));
const EARLIER = String(new Date(2020, 0, 3, 9));

function messageNode(date) {
    return DomUtils.htmlToElement(
        `<tr><td class="xW"><span title="${date}"></span></td></tr>`);
}

function messageRow(date) {
    return { element: messageNode(date), type: Element.UNBUNDLED_MESSAGE };
}

function bundleRow(label, date) {
    const bundle = new Bundle(label);
    bundle.addMessage(messageNode(date));
    return { element: bundle, type: Element.BUNDLE };
}

/**
 * Call the method under test directly; constructing a Bundler needs the
 * chrome extension apis.
 */
function sortedRows(rows, groupMessagesByDate = true) {
    return Bundler.prototype._calculateSortedTableRows.call(
        {
            groupMessagesByDate,
            _calculateMessageAndBundleRows: () => rows,
            _getLatestMessage: Bundler.prototype._getLatestMessage,
        },
        [messageNode(TODAY)],
        {});
}

function typesOf(rows) {
    return rows.map(r => r.type);
}

test('bundles are hoisted above the unbundled messages', () => {
    const types = typesOf(sortedRows([
        messageRow(TODAY),
        bundleRow('Receipts', EARLIER),
        messageRow(EARLIER),
        bundleRow('News', TODAY),
    ]));

    expect(types.filter(t => t === Element.BUNDLE).length).toBe(2);
    expect(types.lastIndexOf(Element.BUNDLE))
        .toBeLessThan(types.indexOf(Element.UNBUNDLED_MESSAGE));
});

test('hoisting preserves the original bundle order', () => {
    const labels = sortedRows([
        bundleRow('Receipts', EARLIER),
        messageRow(TODAY),
        bundleRow('News', TODAY),
    ])
        .filter(r => r.type === Element.BUNDLE)
        .map(r => r.element.getLabel());

    expect(labels).toEqual(['Receipts', 'News']);
});

test('date dividers cover the unbundled messages only', () => {
    const types = typesOf(sortedRows([
        bundleRow('News', TODAY),
        messageRow(TODAY),
        messageRow(EARLIER),
    ]));

    // A divider above the bundles would put them under the wrong heading
    expect(types.indexOf(Element.DATE_DIVIDER))
        .toBeGreaterThan(types.lastIndexOf(Element.BUNDLE));
    expect(types).toContain(Element.DATE_DIVIDER);
});

test('bundles stay hoisted when date grouping is off', () => {
    const types = typesOf(sortedRows(
        [messageRow(TODAY), bundleRow('News', TODAY)],
        false));

    expect(types).toEqual([Element.BUNDLE, Element.UNBUNDLED_MESSAGE]);
});
