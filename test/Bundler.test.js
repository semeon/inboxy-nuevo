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

// Stub chrome storage, so that options fall back to their defaults
global.chrome = {
    storage: {
        sync: {
            get: (keys, callback) => callback({}),
        },
    },
};

import Bundler from '../src/bundling/Bundler';
import SelectiveBundling from '../src/bundling/SelectiveBundling';
import DomUtils from '../src/util/DomUtils';
import { Element } from '../src/util/Constants';

function createMessage(labels, starred = false) {
    const labelCells = labels
        .map(l => `<div class="ar as"><div class="at" title="${l}"></div></div>`)
        .join('');
    const star = starred ? '<div class="T-KT-Jp"></div>' : '';

    return DomUtils.htmlToElement(`
        <tr class="zA">
            <td>${star}</td>
            <td>${labelCells}</td>
        </tr>
    `);
}

function createBundler() {
    return new Bundler(null, null, null, new SelectiveBundling());
}

/**
 * Group the given messages and calculate their rows, the way _bundleMessages() does.
 */
function bundle(messages) {
    const bundler = createBundler();
    const bundlesByLabel = bundler._groupByLabel(messages);

    return {
        bundlesByLabel,
        rows: bundler._calculateMessageAndBundleRows(messages, bundlesByLabel),
    };
}

function labelsOfBundles(bundlesByLabel) {
    return Object.keys(bundlesByLabel).sort();
}

describe('bundling', () => {
    test('labels with multiple messages are bundled', () => {
        const messages = [createMessage(['Work']), createMessage(['Work'])];

        const { bundlesByLabel, rows } = bundle(messages);

        expect(labelsOfBundles(bundlesByLabel)).toEqual(['Work']);
        expect(bundlesByLabel['Work'].getMessages()).toEqual(messages);
        expect(rows).toEqual([{ element: bundlesByLabel['Work'], type: Element.BUNDLE }]);
    });

    test('a label with a single message is not bundled', () => {
        const message = createMessage(['Work']);

        const { bundlesByLabel, rows } = bundle([message]);

        expect(bundlesByLabel).toEqual({});
        expect(rows).toEqual([{ element: message, type: Element.UNBUNDLED_MESSAGE }]);
    });

    test('unbundled messages keep their position among bundles', () => {
        const lonely = createMessage(['Receipts']);
        const work1 = createMessage(['Work']);
        const work2 = createMessage(['Work']);
        const unlabeled = createMessage([]);
        const messages = [work1, lonely, work2, unlabeled];

        const { bundlesByLabel, rows } = bundle(messages);

        expect(labelsOfBundles(bundlesByLabel)).toEqual(['Work']);
        expect(rows).toEqual([
            { element: bundlesByLabel['Work'], type: Element.BUNDLE },
            { element: lonely, type: Element.UNBUNDLED_MESSAGE },
            { element: unlabeled, type: Element.UNBUNDLED_MESSAGE },
        ]);
    });

    test('a message is bundled by its labels that have enough messages', () => {
        const shared = createMessage(['Work', 'Receipts']);
        const messages = [shared, createMessage(['Work'])];

        const { bundlesByLabel, rows } = bundle(messages);

        expect(labelsOfBundles(bundlesByLabel)).toEqual(['Work']);
        expect(bundlesByLabel['Work'].getMessages()).toEqual(messages);
        expect(rows).toEqual([{ element: bundlesByLabel['Work'], type: Element.BUNDLE }]);
    });

    test('starred messages do not count towards a bundle', () => {
        const starred = createMessage(['Work'], true);
        const unstarred = createMessage(['Work']);

        const { bundlesByLabel, rows } = bundle([starred, unstarred]);

        expect(bundlesByLabel).toEqual({});
        expect(rows).toEqual([
            { element: starred, type: Element.UNBUNDLED_MESSAGE },
            { element: unstarred, type: Element.UNBUNDLED_MESSAGE },
        ]);
    });

    test('starred messages are shown outside of their bundle', () => {
        const starred = createMessage(['Work'], true);
        const work1 = createMessage(['Work']);
        const work2 = createMessage(['Work']);

        const { bundlesByLabel, rows } = bundle([starred, work1, work2]);

        expect(bundlesByLabel['Work'].getMessages()).toEqual([work1, work2]);
        expect(rows).toEqual([
            { element: starred, type: Element.UNBUNDLED_MESSAGE },
            { element: bundlesByLabel['Work'], type: Element.BUNDLE },
        ]);
    });
});
