/**
 * Real-world server quirks and XML edge-case tests.
 *
 * Covers patterns observed from:
 *   - Apple iCal / macOS Calendar (iCloud, OS X Server)
 *   - Google Calendar / Google Contacts
 *   - Microsoft Exchange / Office 365 EWS
 *   - Zimbra Collaboration Suite
 *   - Fastmail
 *   - Radicale
 *   - Cyrus IMAP
 *   - sabre/dav
 *   - Baikal
 *   - DAViCal
 *
 * Many of these violate the XML spec in minor ways; the parser must handle
 * them gracefully rather than aborting.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parse, isElement, isText, isCData, isComment, isProcessingInstruction, isXmlDeclaration, isDocumentType } from '../src/index.ts';
import { rootElement, requireChild, children, descendants, textContent, attr, childElements } from './helpers.ts';

const DAV = 'DAV:';
const CAL = 'urn:ietf:params:xml:ns:caldav';
const _CARD = 'urn:ietf:params:xml:ns:carddav';

// ---------------------------------------------------------------------------
// BOM and encoding
// ---------------------------------------------------------------------------

describe('BOM and encoding quirks', () => {
	it('silently skips a UTF-8 BOM before the XML declaration', () => {
		// Some Windows servers (IIS, Exchange) prepend a BOM
		const xml = '\uFEFF<?xml version="1.0" encoding="UTF-8"?><root/>';
		const doc = parse(xml);
		const root = rootElement(doc);
		assert.equal(root.name, 'root');
		assert.equal(root.namespace, null);
	});

	it('parses without any XML declaration (common in many CardDAV clients)', () => {
		const doc = parse('<D:propfind xmlns:D="DAV:"><D:prop/></D:propfind>');
		const root = rootElement(doc);
		assert.equal(root.name, 'propfind');
		assert.equal(root.namespace, DAV);
		// No xml-declaration child
		assert.ok(!doc.children.find(isXmlDeclaration));
	});

	it('handles UTF-8 multibyte content in text nodes', () => {
		const doc = parse(`<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/calendars/user/</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>Terminkalender für Ärzte — 日本語テスト</D:displayname>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`);

		const dn = descendants(doc, 'displayname', DAV)[0]!;
		assert.ok(dn);
		const text = textContent(dn);
		assert.ok(text.includes('Ärzte'));
		assert.ok(text.includes('日本語'));
	});
});

// ---------------------------------------------------------------------------
// Namespace edge cases
// ---------------------------------------------------------------------------

describe('Namespace edge cases', () => {
	it('undeclares default namespace with xmlns=""', () => {
		// A child undeclares the default namespace — xmlns="" removes it
		const doc = parse(`<root xmlns="urn:example">
  <child xmlns="">
    <inner/>
  </child>
</root>`);

		const root = rootElement(doc);
		assert.equal(root.namespace, 'urn:example');

		const child_ = requireChild(root, 'child');
		assert.equal(child_.namespace, null, 'child should have no namespace after xmlns=""');

		const inner = requireChild(child_, 'inner');
		assert.equal(inner.namespace, null, 'inner should inherit null namespace');
	});

	it('re-declares a prefix with a different URI in a child element', () => {
		const doc = parse(`<a:root xmlns:a="urn:first">
  <a:child xmlns:a="urn:second">
    <a:inner/>
  </a:child>
</a:root>`);

		const root = rootElement(doc);
		assert.equal(root.namespace, 'urn:first');

		const child_ = requireChild(root, 'child');
		assert.equal(child_.namespace, 'urn:second');

		const inner = requireChild(child_, 'inner');
		assert.equal(inner.namespace, 'urn:second');
	});

	it("uses a prefix declared on a sibling's ancestor (scope stacking)", () => {
		const doc = parse(`<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:response>
    <D:href>/</D:href>
    <D:propstat>
      <D:prop>
        <C:calendar-data>data</C:calendar-data>
      </D:prop>
    </D:propstat>
  </D:response>
</D:multistatus>`);

		const calData = descendants(doc, 'calendar-data', CAL)[0]!;
		assert.ok(calData);
		assert.equal(calData.namespace, CAL);
	});

	it('handles multiple xmlns declarations on a single element', () => {
		const doc = parse(`<root xmlns:a="urn:a" xmlns:b="urn:b" xmlns:c="urn:c">
  <a:one xmlns:d="urn:d"><d:inner/></a:one>
</root>`);

		const root = rootElement(doc);
		// xmlns declarations should appear in attributes
		const nsAttrs = root.attributes.filter((a) => a.prefix === 'xmlns' || a.name === 'xmlns');
		assert.equal(nsAttrs.length, 3);

		const inner = descendants(doc, 'inner')[0]!;
		assert.ok(inner);
		assert.equal(inner.namespace, 'urn:d');
	});

	it('unprefixed attributes have null namespace even when default ns is set', () => {
		const doc = parse(`<root xmlns="urn:default" class="main" id="root-el"/>`);
		const root = rootElement(doc);
		assert.equal(root.namespace, 'urn:default');

		const classAttr = root.attributes.find((a) => a.name === 'class');
		assert.ok(classAttr);
		assert.equal(classAttr.namespace, null, 'unprefixed attrs should not inherit default NS');

		const idAttr = root.attributes.find((a) => a.name === 'id');
		assert.ok(idAttr);
		assert.equal(idAttr.namespace, null);
	});

	it('tolerates an undeclared namespace prefix (returns null, no throw)', () => {
		// Some servers emit XML with a prefix that was never declared; we return
		// null rather than crashing
		const doc = parse(`<D:propfind xmlns:D="DAV:">
  <D:prop>
    <UNDECLARED:foo/>
  </D:prop>
</D:propfind>`);

		const foo = descendants(doc, 'foo')[0]!;
		assert.ok(foo);
		assert.equal(foo.prefix, 'UNDECLARED');
		assert.equal(foo.namespace, null);
	});

	it('xml: prefix always resolves to the XML namespace URI', () => {
		const doc = parse(`<root xml:lang="en" xml:space="preserve">text</root>`);
		const root = rootElement(doc);

		for (const a of root.attributes) {
			if (a.prefix === 'xml') {
				assert.equal(a.namespace, 'http://www.w3.org/XML/1998/namespace');
			}
		}
	});

	it('xmlns: prefix always resolves to the XMLNS namespace URI', () => {
		const doc = parse(`<root xmlns:D="DAV:"/>`);
		const root = rootElement(doc);
		const nsDecl = root.attributes.find((a) => a.prefix === 'xmlns' && a.name === 'D');
		assert.ok(nsDecl);
		assert.equal(nsDecl.namespace, 'http://www.w3.org/2000/xmlns/');
	});

	it('ns0:/ns1: style prefixes (auto-generated by some serialisers)', () => {
		// Java JAXB and some Python serialisers emit ns0:, ns1:, ns2:, …
		const doc = parse(`<?xml version="1.0" encoding="UTF-8"?>
<ns0:multistatus xmlns:ns0="DAV:" xmlns:ns1="urn:ietf:params:xml:ns:caldav">
  <ns0:response>
    <ns0:href>/calendars/</ns0:href>
    <ns0:propstat>
      <ns0:prop>
        <ns1:calendar-data>BEGIN:VCALENDAR\nEND:VCALENDAR</ns1:calendar-data>
      </ns0:prop>
      <ns0:status>HTTP/1.1 200 OK</ns0:status>
    </ns0:propstat>
  </ns0:response>
</ns0:multistatus>`);

		const root = rootElement(doc);
		assert.equal(root.namespace, DAV);
		assert.equal(root.name, 'multistatus');

		const calData = descendants(doc, 'calendar-data', CAL)[0]!;
		assert.ok(calData);
		assert.equal(calData.namespace, CAL);
		assert.equal(calData.prefix, 'ns1');
	});
});

// ---------------------------------------------------------------------------
// Compact / whitespace-free XML (iCloud, some mobile clients)
// ---------------------------------------------------------------------------

describe('Compact whitespace-free XML', () => {
	it('parses XML with no whitespace between elements', () => {
		const doc = parse(
			'<?xml version="1.0"?><D:multistatus xmlns:D="DAV:"><D:response><D:href>/cal/</D:href><D:propstat><D:prop><D:displayname>Cal</D:displayname></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>',
		);

		const dn = descendants(doc, 'displayname', DAV)[0]!;
		assert.equal(textContent(dn), 'Cal');
		const st = descendants(doc, 'status', DAV)[0]!;
		assert.equal(textContent(st), 'HTTP/1.1 200 OK');
	});

	it('parses deeply nested comp-filter chains without whitespace', () => {
		const doc = parse(
			'<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><D:getetag/></D:prop><C:filter><C:comp-filter name="VCALENDAR"><C:comp-filter name="VEVENT"><C:time-range start="20240101T000000Z" end="20240201T000000Z"/></C:comp-filter></C:comp-filter></C:filter></C:calendar-query>',
		);

		const tr = descendants(doc, 'time-range', CAL)[0]!;
		assert.ok(tr);
		assert.equal(attr(tr, 'start'), '20240101T000000Z');
	});
});

// ---------------------------------------------------------------------------
// Entity and character reference quirks
// ---------------------------------------------------------------------------

describe('Entity and character reference quirks', () => {
	it('decodes all five predefined XML entities', () => {
		const doc = parse('<r>&amp;&lt;&gt;&apos;&quot;</r>');
		assert.equal(textContent(rootElement(doc)), `&<>'"`);
	});

	it('decodes decimal and hex numeric character references', () => {
		const doc = parse('<r>&#xA9; &#169; &#x1F600;</r>');
		const t = textContent(rootElement(doc));
		assert.ok(t.includes('©'));
		assert.ok(t.includes('😀'));
	});

	it('preserves unknown entities verbatim (tolerant mode)', () => {
		// Some servers send HTML entities in text content
		const doc = parse('<r>&nbsp;&hellip;&mdash;&euro;</r>');
		const t = textContent(rootElement(doc));
		assert.ok(t.includes('&nbsp;'));
		assert.ok(t.includes('&hellip;'));
	});

	it('handles entity references in attribute values', () => {
		const doc = parse('<root href="/path?a=1&amp;b=2" title="She said &quot;hello&quot;"/>');
		const root = rootElement(doc);
		const href = root.attributes.find((a) => a.name === 'href')!;
		const title = root.attributes.find((a) => a.name === 'title')!;
		assert.equal(href.value, '/path?a=1&b=2');
		assert.equal(title.value, 'She said "hello"');
	});

	it('handles entity references in CalDAV href elements', () => {
		// Some servers incorrectly leave & unescaped in hrefs; our tolerant
		// entity handling should deal with both escaped and unknown cases
		const doc = parse(`<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/calendars/user/home/?expand=true&amp;format=ics</D:href>
    <D:status>HTTP/1.1 200 OK</D:status>
  </D:response>
</D:multistatus>`);

		const href = descendants(doc, 'href', DAV)[0]!;
		assert.ok(href);
		// &amp; should be decoded to &
		assert.ok(textContent(href).includes('expand=true&format=ics'));
	});

	it('handles numeric char refs for Unicode supplementary planes', () => {
		const doc = parse('<r>&#x1F4C5; &#128197;</r>'); // calendar emoji in hex and decimal
		const t = textContent(rootElement(doc));
		assert.ok(t.includes('📅'));
	});
});

// ---------------------------------------------------------------------------
// Comment and processing instruction placement
// ---------------------------------------------------------------------------

describe('Comments and processing instructions', () => {
	it('allows comments between prolog and root element', () => {
		const doc = parse(`<?xml version="1.0"?>
<!-- Generated by Radicale 3.1.8 -->
<!-- Collection: user/calendar -->
<D:multistatus xmlns:D="DAV:"/>`);

		const comments = doc.children.filter(isComment);
		assert.equal(comments.length, 2);
		assert.ok(comments[0]!.value.includes('Radicale'));
		const root = rootElement(doc);
		assert.equal(root.name, 'multistatus');
	});

	it('allows processing instructions before root element', () => {
		const doc = parse(`<?xml version="1.0"?>
<?xml-stylesheet type="text/xsl" href="/style.xsl"?>
<root/>`);

		const pis = doc.children.filter(isProcessingInstruction);
		assert.equal(pis.length, 1);
		assert.equal(pis[0]!.target, 'xml-stylesheet');
		assert.ok(pis[0]!.data.includes('text/xsl'));
	});

	it('allows comments inside element content', () => {
		const doc = parse(`<D:prop xmlns:D="DAV:">
  <!-- displayname intentionally empty -->
  <D:displayname/>
  <!-- end of properties -->
</D:prop>`);

		const _comments = descendants(doc, 'displayname', DAV);
		// The prop element should have comment + element + comment
		const prop = rootElement(doc);
		const commentNodes = prop.children.filter(isComment);
		assert.equal(commentNodes.length, 2);
	});

	it('allows comments and PIs after root element', () => {
		const doc = parse(`<root/>
<!-- trailing comment -->
<?pi trailing?>`);
		const root = rootElement(doc);
		assert.equal(root.name, 'root');
		// Trailing nodes should be in doc.children after the element
		const trailingComment = doc.children.find(isComment);
		assert.ok(trailingComment);
		assert.ok(trailingComment.value.includes('trailing comment'));
	});

	it('allows "--" inside comments (tolerant)', () => {
		// Strictly forbidden by XML spec but emitted by some generators
		const doc = parse('<root><!-- note: foo -- bar --></root>');
		const root = rootElement(doc);
		const c = root.children[0];
		assert.ok(c);
		assert.ok(isComment(c));
		assert.ok(c.value.includes('--'));
	});
});

// ---------------------------------------------------------------------------
// CDATA quirks
// ---------------------------------------------------------------------------

describe('CDATA sections', () => {
	it('handles CDATA that contains what looks like markup', () => {
		const doc = parse(`<C:calendar-data xmlns:C="urn:ietf:params:xml:ns:caldav"><![CDATA[SUMMARY:<important>Meeting</important>]]></C:calendar-data>`);
		const root = rootElement(doc);
		const cd = root.children[0];
		assert.ok(cd);
		assert.ok(isCData(cd));
		assert.ok(cd.value.includes('<important>Meeting</important>'));
	});

	it('handles CDATA adjacent to text nodes', () => {
		const doc = parse('<r>before <![CDATA[inside]]> after</r>');
		const root = rootElement(doc);
		const all = textContent(root);
		assert.ok(all.includes('before'));
		assert.ok(all.includes('inside'));
		assert.ok(all.includes('after'));
	});

	it('handles empty CDATA section', () => {
		const doc = parse('<r><![CDATA[]]></r>');
		const root = rootElement(doc);
		const cd = root.children[0];
		assert.ok(cd);
		assert.ok(isCData(cd));
		assert.equal(cd.value, '');
	});

	it('handles multiple CDATA sections (iCal continuation pattern)', () => {
		// Some servers split large calendar-data across multiple CDATA sections
		const doc = parse(`<C:calendar-data xmlns:C="urn:ietf:params:xml:ns:caldav"><![CDATA[BEGIN:VCALENDAR
VERSION:2.0
]]><![CDATA[BEGIN:VEVENT
SUMMARY:Test
END:VEVENT
END:VCALENDAR]]></C:calendar-data>`);

		const root = rootElement(doc);
		const cdNodes = root.children.filter(isCData);
		assert.equal(cdNodes.length, 2);
		const full = textContent(root);
		assert.ok(full.includes('BEGIN:VCALENDAR'));
		assert.ok(full.includes('END:VCALENDAR'));
	});
});

// ---------------------------------------------------------------------------
// Whitespace handling
// ---------------------------------------------------------------------------

describe('Whitespace handling', () => {
	it('preserves whitespace-only text nodes between elements', () => {
		const doc = parse('<root>\n  <child/>\n</root>');
		const root = rootElement(doc);
		// There should be text nodes with whitespace
		const textNodes = root.children.filter(isText);
		assert.ok(textNodes.length > 0);
		assert.ok(textNodes.every((t) => t.value.trim() === ''));
	});

	it('handles xml:space="preserve" attribute (attribute present)', () => {
		const doc = parse(`<pre xml:space="preserve">  indented  text  </pre>`);
		const root = rootElement(doc);
		const space = root.attributes.find((a) => a.name === 'space');
		assert.ok(space);
		assert.equal(space.prefix, 'xml');
		assert.equal(space.value, 'preserve');
		// Content is preserved as-is
		assert.equal(textContent(root), '  indented  text  ');
	});

	it('handles mixed content (text interspersed with elements)', () => {
		// Seen in some D:error and custom property responses
		const doc = parse(`<D:error xmlns:D="DAV:">User <D:href>/u/</D:href> lacks permission</D:error>`);
		const root = rootElement(doc);
		const full = textContent(root);
		assert.ok(full.includes('User'));
		assert.ok(full.includes('/u/'));
		assert.ok(full.includes('lacks permission'));
	});
});

// ---------------------------------------------------------------------------
// Self-closing vs empty content elements
// ---------------------------------------------------------------------------

describe('Self-closing and empty elements', () => {
	it('treats self-closing <element/> and <element></element> equivalently', () => {
		const doc1 = parse('<D:prop xmlns:D="DAV:"><D:displayname/></D:prop>');
		const doc2 = parse('<D:prop xmlns:D="DAV:"><D:displayname></D:displayname></D:prop>');

		const dn1 = descendants(doc1, 'displayname', DAV)[0]!;
		const dn2 = descendants(doc2, 'displayname', DAV)[0]!;
		assert.ok(dn1 && dn2);
		assert.equal(dn1.children.length, 0);
		assert.equal(dn2.children.length, 0);
	});

	it('handles an empty prop element (server found no matching properties)', () => {
		const doc = parse(`<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/cal/</D:href>
    <D:propstat>
      <D:prop/>
      <D:status>HTTP/1.1 404 Not Found</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`);

		const prop = descendants(doc, 'prop', DAV)[0]!;
		assert.ok(prop);
		assert.equal(childElements(prop).length, 0);
	});
});

// ---------------------------------------------------------------------------
// DOCTYPE
// ---------------------------------------------------------------------------

describe('DOCTYPE declarations', () => {
	it('parses a PUBLIC DOCTYPE without error', () => {
		const doc = parse(`<?xml version="1.0"?>
<!DOCTYPE D:multistatus PUBLIC "-//Example//DTD//EN" "http://example.com/dtd">
<D:multistatus xmlns:D="DAV:"/>`);

		const dt = doc.children.find(isDocumentType);
		assert.ok(dt);
		assert.equal(dt.name, 'D:multistatus');
		assert.equal(dt.publicId, '-//Example//DTD//EN');
		assert.equal(dt.systemId, 'http://example.com/dtd');
		assert.ok(isElement(rootElement(doc)));
	});

	it('parses a DOCTYPE with internal subset', () => {
		const doc = parse(`<?xml version="1.0"?>
<!DOCTYPE root [
  <!ENTITY myent "expanded value">
  <!ELEMENT root ANY>
]>
<root>content</root>`);

		const dt = doc.children.find(isDocumentType);
		assert.ok(dt);
		assert.ok(dt.internalSubset!.includes('myent'));
	});
});

// ---------------------------------------------------------------------------
// Multiple-response body patterns
// ---------------------------------------------------------------------------

describe('Multi-response body patterns', () => {
	it('handles an empty multistatus (no D:response children)', () => {
		const doc = parse(`<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:"/>`);

		const root = rootElement(doc);
		assert.equal(root.name, 'multistatus');
		assert.equal(childElements(root).length, 0);
	});

	it('handles 100+ responses in a single multistatus (Nextcloud bulk sync)', () => {
		const items = Array.from(
			{ length: 120 },
			(_, i) => `
  <D:response>
    <D:href>/addressbooks/user/contacts/contact${i}.vcf</D:href>
    <D:propstat>
      <D:prop><D:getetag>"etag${i}"</D:getetag></D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`,
		).join('');

		const doc = parse(`<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:">${items}
</D:multistatus>`);

		const responses = children(rootElement(doc), 'response', DAV);
		assert.equal(responses.length, 120);

		// Spot-check first and last
		assert.equal(textContent(requireChild(responses[0]!, 'href', DAV)), '/addressbooks/user/contacts/contact0.vcf');
		assert.equal(textContent(requireChild(responses[119]!, 'href', DAV)), '/addressbooks/user/contacts/contact119.vcf');
	});
});

// ---------------------------------------------------------------------------
// JSON round-trip
// ---------------------------------------------------------------------------

describe('JSON serialisability', () => {
	it('entire parse result survives JSON.stringify / JSON.parse', () => {
		const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- comment -->
<?pi data?>
<!DOCTYPE root PUBLIC "-//X//DTD//EN" "x.dtd">
<D:root xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:child xml:lang="de">Ärger &amp; Freude</D:child>
  <C:data><![CDATA[raw & <unescaped>]]></C:data>
</D:root>`;

		const doc = parse(xml);
		const json = JSON.stringify(doc);
		const back = JSON.parse(json) as typeof doc;

		assert.equal(back.type, 'document');
		assert.equal(back.children.length, doc.children.length);

		// Root element survived
		const root = back.children.find((c: { type: string }) => c.type === 'element') as (typeof doc.children)[number] & { name?: string };
		assert.ok(root && 'name' in root);
		assert.equal(root.name, 'root');
	});

	it('produces output with no undefined values (JSON-safe)', () => {
		const doc = parse('<root xmlns:x="urn:x"><x:child attr="val">text</x:child></root>');
		const json = JSON.stringify(doc);
		// undefined values are dropped by JSON.stringify, so the result should
		// not contain "undefined" as a string
		assert.ok(!json.includes('"undefined"'));
		assert.ok(!json.includes(':undefined'));
	});
});
