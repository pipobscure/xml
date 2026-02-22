/**
 * Tests for serialize().
 *
 * Two invariants are checked throughout:
 *   1. Round-trip — parse(serialize(parse(xml))) deepEquals parse(xml)
 *   2. Parseability — every string returned by serialize() is valid XML
 *      (it can be fed back to parse() without throwing)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parse, serialize, textContent, child } from '../src/index.ts';
import type { CData, Element } from '../src/index.ts';
import { rootElement } from './helpers.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Full round-trip: parse → serialize → parse → deepStrictEqual.
 * The serialized XML need not be byte-for-byte identical to the input; the
 * parsed trees must be structurally identical.
 */
function assertRoundTrip(xml: string): void {
	const doc = parse(xml);
	const xml2 = serialize(doc);
	assert.deepStrictEqual(parse(xml2), doc, `Round-trip failed.\n  original:   ${xml}\n  serialized: ${xml2}`);
}

/** Wrap a fragment in a root element and parse it without throwing. */
function parseFragment(fragment: string) {
	return rootElement(parse(`<wrap>${fragment}</wrap>`));
}

// ---------------------------------------------------------------------------
// Round-trip tests
// ---------------------------------------------------------------------------

describe('serialize — round-trip', () => {
	// ── basic structures ──────────────────────────────────────────────────────

	it('empty root element (self-closing)', () => assertRoundTrip('<root/>'));
	it('empty root element (explicit close)', () => assertRoundTrip('<root></root>'));
	it('text content', () => assertRoundTrip('<root>hello world</root>'));
	it('attributes', () => assertRoundTrip('<root a="1" b="two"/>'));
	it('nested elements', () => assertRoundTrip('<a><b><c/></b></a>'));
	it('whitespace text nodes between elements', () => assertRoundTrip('<root>\n  <child/>\n</root>'));
	it('mixed content', () => assertRoundTrip('<p>Hello <b>world</b>!</p>'));

	// ── entity references ─────────────────────────────────────────────────────

	it('entity references in text (&amp; &lt; &gt;)', () => assertRoundTrip('<root>&amp;&lt;&gt;</root>'));
	it('entity references in attribute values', () => assertRoundTrip('<root attr="&amp;&lt;&quot;"/>'));

	// ── XML declaration ───────────────────────────────────────────────────────

	it('XML declaration — version only', () => assertRoundTrip('<?xml version="1.0"?><root/>'));
	it('XML declaration — with encoding', () => assertRoundTrip('<?xml version="1.0" encoding="UTF-8"?><root/>'));
	it('XML declaration — standalone yes', () => assertRoundTrip('<?xml version="1.0" standalone="yes"?><root/>'));
	it('XML declaration — standalone no', () => assertRoundTrip('<?xml version="1.0" standalone="no"?><root/>'));

	// ── DOCTYPE ───────────────────────────────────────────────────────────────

	it('DOCTYPE — name only', () => assertRoundTrip('<!DOCTYPE root><root/>'));
	it('DOCTYPE — SYSTEM identifier', () => assertRoundTrip('<!DOCTYPE root SYSTEM "http://example.com/schema.dtd"><root/>'));
	it('DOCTYPE — PUBLIC identifier', () => assertRoundTrip('<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01//EN" "http://www.w3.org/TR/html4/strict.dtd"><html/>'));

	// ── comments and PIs ──────────────────────────────────────────────────────

	it('comment before and after root', () => assertRoundTrip('<!-- preamble --><root/><!-- postamble -->'));
	it('comment inside element', () => assertRoundTrip('<root><!-- note --></root>'));
	it('processing instruction before root', () => assertRoundTrip('<?xml-stylesheet type="text/xsl" href="s.xsl"?><root/>'));
	it('processing instruction inside element', () => assertRoundTrip('<root><?app-cmd arg="val"?></root>'));
	it('PI with no data', () => assertRoundTrip('<root><?bare?></root>'));

	// ── CDATA ─────────────────────────────────────────────────────────────────

	it('CDATA section', () => assertRoundTrip('<root><![CDATA[raw <markup> & stuff]]></root>'));
	it('CDATA in CalDAV calendar-data', () => assertRoundTrip('<C:calendar-data xmlns:C="urn:ietf:params:xml:ns:caldav">' + '<![CDATA[BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR]]>' + '</C:calendar-data>'));

	// ── namespaces ────────────────────────────────────────────────────────────

	it('prefixed namespace element', () => assertRoundTrip('<D:root xmlns:D="DAV:"><D:child/></D:root>'));
	it('default namespace', () => assertRoundTrip('<root xmlns="urn:example"><child/></root>'));
	it('default namespace undeclared (xmlns="")', () => assertRoundTrip('<root xmlns="urn:ex"><inner xmlns=""><plain/></inner></root>'));
	it('multiple namespace prefixes on same element', () => assertRoundTrip('<D:root xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><C:calendar/></D:root>'));
	it('prefixed attribute', () => assertRoundTrip('<r xmlns:x="urn:x" x:id="42"/>'));

	// ── CalDAV / CardDAV XML ──────────────────────────────────────────────────

	it('CalDAV PROPFIND request', () => assertRoundTrip('<?xml version="1.0" encoding="utf-8"?>' + '<D:propfind xmlns:D="DAV:"><D:prop><D:getcontentlength/><D:getlastmodified/></D:prop></D:propfind>'));

	it('CalDAV calendar-query with comp-filter', () =>
		assertRoundTrip(
			'<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
				'<D:prop><C:calendar-data/></D:prop>' +
				'<C:filter><C:comp-filter name="VCALENDAR">' +
				'<C:comp-filter name="VEVENT"><C:time-range start="20240101T000000Z" end="20240201T000000Z"/></C:comp-filter>' +
				'</C:comp-filter></C:filter>' +
				'</C:calendar-query>',
		));

	it('CardDAV addressbook-query with text-match', () =>
		assertRoundTrip(
			'<C:addressbook-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">' +
				'<D:prop><C:address-data/></D:prop>' +
				'<C:filter test="anyof"><C:prop-filter name="FN">' +
				'<C:text-match collation="i;unicode-casemap">Smith</C:text-match>' +
				'</C:prop-filter></C:filter>' +
				'</C:addressbook-query>',
		));

	it('D:multistatus with multiple D:response children', () =>
		assertRoundTrip(
			'<D:multistatus xmlns:D="DAV:">' +
				'<D:response><D:href>/cal/1.ics</D:href><D:status>HTTP/1.1 200 OK</D:status></D:response>' +
				'<D:response><D:href>/cal/2.ics</D:href><D:status>HTTP/1.1 404 Not Found</D:status></D:response>' +
				'</D:multistatus>',
		));
});

// ---------------------------------------------------------------------------
// Output-format tests (verify specific serialized strings)
// ---------------------------------------------------------------------------

describe('serialize — output format', () => {
	it('uses self-closing syntax for childless elements', () => {
		assert.ok(serialize(parse('<root/>')).includes('<root/>'));
		// explicit open/close with no children also normalises to self-closing
		assert.ok(serialize(parse('<root></root>')).includes('<root/>'));
	});

	it('uses open/close tags when element has children', () => {
		const s = serialize(parse('<root><child/></root>'));
		assert.ok(s.includes('<root>') && s.includes('</root>'));
	});

	it('reconstructs prefixed element names', () => {
		assert.ok(serialize(parse('<D:prop xmlns:D="DAV:"/>')).includes('<D:prop'));
	});

	it('reconstructs prefixed attribute names', () => {
		assert.ok(serialize(parse('<r xmlns:x="urn:x" x:a="v"/>')).includes('x:a="v"'));
	});

	it('escapes & < > in text content', () => {
		const doc = parse('<r>a &amp; b &lt; c &gt; d</r>');
		const s = serialize(doc);
		assert.ok(s.includes('&amp;'));
		assert.ok(s.includes('&lt;'));
		assert.ok(s.includes('&gt;'));
		assert.ok(!s.match(/&[^a-z#]/)); // no bare &
	});

	it('escapes & < " in attribute values', () => {
		const doc = parse('<r x="&amp;&lt;&quot;"/>');
		const s = serialize(doc);
		assert.ok(s.includes('&amp;'));
		assert.ok(s.includes('&lt;'));
		assert.ok(s.includes('&quot;'));
	});

	it('emits full xml-declaration with encoding and standalone', () => {
		const s = serialize(parse('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><r/>'));
		assert.ok(s.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'));
	});

	it('omits absent encoding / standalone from xml-declaration', () => {
		const s = serialize(parse('<?xml version="1.0"?><r/>'));
		assert.ok(s.startsWith('<?xml version="1.0"?>'));
		assert.ok(!s.includes('encoding'));
		assert.ok(!s.includes('standalone'));
	});

	it('emits standalone="yes" / "no" from boolean', () => {
		assert.ok(serialize(parse('<?xml version="1.0" standalone="yes"?><r/>')).includes('standalone="yes"'));
		assert.ok(serialize(parse('<?xml version="1.0" standalone="no"?><r/>')).includes('standalone="no"'));
	});

	it('emits CDATA section verbatim', () => {
		const s = serialize(parse('<r><![CDATA[hello <world>]]></r>'));
		assert.ok(s.includes('<![CDATA[hello <world>]]>'));
	});

	it('CDATA containing ]]> is split so output is parseable', () => {
		// Construct the node directly — this value cannot be expressed in XML source
		const cdataNode: CData = { type: 'cdata', value: 'a ]]> b' };
		const el: Element = {
			type: 'element',
			name: 'r',
			prefix: null,
			namespace: null,
			attributes: [],
			children: [cdataNode],
		};
		const s = serialize(el);
		// Must not contain a bare ]]> that isn't immediately followed by ] or <![CDATA[
		// Simpler: the wrapped fragment must parse without throwing
		const reparsed = parseFragment(s);
		// All CDATA content reassembles to the original value
		assert.equal(textContent(child(reparsed, 'r')), 'a ]]> b');
	});

	it('CDATA containing multiple ]]> sequences reassembles correctly', () => {
		const cdataNode: CData = { type: 'cdata', value: ']]>x]]>y' };
		const el: Element = {
			type: 'element',
			name: 'r',
			prefix: null,
			namespace: null,
			attributes: [],
			children: [cdataNode],
		};
		const reparsed = parseFragment(serialize(el));
		assert.equal(textContent(child(reparsed, 'r')), ']]>x]]>y');
	});
});

// ---------------------------------------------------------------------------
// Tolerance tests — missing / wrong-typed properties must not throw
// ---------------------------------------------------------------------------

describe('serialize — tolerance', () => {
	it('returns "" for null', () => assert.equal(serialize(null), ''));
	it('returns "" for undefined', () => assert.equal(serialize(undefined), ''));

	it('returns "" for unrecognised type', () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		assert.equal(serialize({ type: 'unknown-node-type' } as any), '');
	});

	it('element with no children property → self-closing', () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const node = { type: 'element', name: 'root', prefix: null, namespace: null, attributes: [] } as any;
		assert.equal(serialize(node), '<root/>');
	});

	it('element with undefined children → self-closing', () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const node = { type: 'element', name: 'root', prefix: null, namespace: null, attributes: [], children: undefined } as any;
		assert.equal(serialize(node), '<root/>');
	});

	it('element with no attributes property → no attributes', () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const node = { type: 'element', name: 'root', prefix: null, namespace: null, children: [] } as any;
		assert.equal(serialize(node), '<root/>');
	});

	it('attribute with no prefix → emitted without prefix', () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const node = { type: 'element', name: 'root', prefix: null, namespace: null, attributes: [{ name: 'id', value: '42' }], children: [] } as any;
		assert.equal(serialize(node), '<root id="42"/>');
	});

	it('attribute with empty-string prefix → treated as absent', () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const node = { type: 'element', name: 'root', prefix: null, namespace: null, attributes: [{ name: 'id', prefix: '', value: '1' }], children: [] } as any;
		assert.equal(serialize(node), '<root id="1"/>');
	});

	it('attribute with no value → emitted as empty string', () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const node = { type: 'element', name: 'root', prefix: null, namespace: null, attributes: [{ name: 'id', prefix: null }], children: [] } as any;
		assert.equal(serialize(node), '<root id=""/>');
	});

	it('attribute with no name → silently skipped', () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const node = { type: 'element', name: 'root', prefix: null, namespace: null, attributes: [{ prefix: null, value: 'x' }], children: [] } as any;
		assert.equal(serialize(node), '<root/>');
	});

	it('text node with no value → ""', () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		assert.equal(serialize({ type: 'text' } as any), '');
	});

	it('cdata node with no value → empty CDATA section', () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		assert.equal(serialize({ type: 'cdata' } as any), '<![CDATA[]]>');
	});

	it('comment node with no value → empty comment', () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		assert.equal(serialize({ type: 'comment' } as any), '<!---->');
	});

	it('PI with no target → ""', () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		assert.equal(serialize({ type: 'processing-instruction' } as any), '');
	});

	it('PI with target but no data → just the target', () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		assert.equal(serialize({ type: 'processing-instruction', target: 'php' } as any), '<?php?>');
	});

	it('xml-declaration with no version → defaults to "1.0"', () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const s = serialize({ type: 'xml-declaration', encoding: null, standalone: null } as any);
		assert.ok(s.includes('version="1.0"'));
	});

	it('xml-declaration with undefined encoding/standalone → omitted', () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const s = serialize({ type: 'xml-declaration', version: '1.0' } as any);
		assert.equal(s, '<?xml version="1.0"?>');
	});

	it('nameless element → renders children inline', () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const node = { type: 'element', name: '', prefix: null, namespace: null, attributes: [], children: [{ type: 'text', value: 'hi' }] } as any;
		assert.equal(serialize(node), 'hi');
	});

	it('output of tolerance path is always parseable', () => {
		const cases = [
			// Missing children
			{ type: 'element', name: 'div', prefix: null, namespace: null, attributes: [{ name: 'class', value: 'main' }] },
			// Null child in children array
			{ type: 'element', name: 'p', prefix: null, namespace: null, attributes: [], children: [null, { type: 'text', value: 'ok' }, undefined] },
			// Null attribute in attributes array
			{ type: 'element', name: 'span', prefix: null, namespace: null, attributes: [null, { name: 'id', prefix: null, value: '1' }], children: [] },
		];
		for (const c of cases) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const s = serialize(c as any);
			assert.doesNotThrow(() => parse(`<wrap>${s}</wrap>`), `Failed to parse: ${s}`);
		}
	});

	it('document with no children → ""', () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		assert.equal(serialize({ type: 'document' } as any), '');
	});
});
