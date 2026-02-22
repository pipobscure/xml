/**
 * CardDAV XML payload tests.
 *
 * Covers addressbook-query, addressbook-multiget, PROPFIND, REPORT, and
 * server-specific extensions from Apple Contacts, Google Contacts, Nextcloud,
 * and Radicale.
 *
 * Namespace URIs:
 *   DAV:                             WebDAV (RFC 4918)
 *   urn:ietf:params:xml:ns:carddav   CardDAV (RFC 6352)
 *   http://calendarserver.org/ns/    Apple CalendarServer (shared with CalDAV)
 *   http://owncloud.org/ns           ownCloud / Nextcloud
 *   http://nextcloud.org/ns          Nextcloud
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parse, isCData } from '../src/index.ts';
import { rootElement, child, requireChild, children, descendants, descendant, textContent, attr, childElements } from './helpers.ts';

const DAV = 'DAV:';
const CARD = 'urn:ietf:params:xml:ns:carddav';
const CS = 'http://calendarserver.org/ns/';
const OC = 'http://owncloud.org/ns';
const NC = 'http://nextcloud.org/ns';

// ---------------------------------------------------------------------------
// PROPFIND on addressbook collection
// ---------------------------------------------------------------------------

describe('CardDAV PROPFIND on address book', () => {
	it('parses a PROPFIND request for address book properties', () => {
		const doc = parse(`<?xml version="1.0" encoding="UTF-8"?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav"
            xmlns:CS="http://calendarserver.org/ns/">
  <D:prop>
    <D:displayname/>
    <D:resourcetype/>
    <D:current-user-principal/>
    <CS:getctag/>
    <D:sync-token/>
    <C:max-resource-size/>
    <C:supported-address-data/>
  </D:prop>
</D:propfind>`);

		const prop = requireChild(rootElement(doc), 'prop', DAV);
		const propNames = childElements(prop).map((e) => e.name);
		assert.ok(propNames.includes('displayname'));
		assert.ok(propNames.includes('resourcetype'));
		assert.ok(propNames.includes('getctag'));
		assert.ok(propNames.includes('supported-address-data'));
	});

	it('parses a PROPFIND response for an address book collection', () => {
		const doc = parse(`<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:"
               xmlns:C="urn:ietf:params:xml:ns:carddav"
               xmlns:CS="http://calendarserver.org/ns/">
  <D:response>
    <D:href>/addressbooks/__uids__/user/addressbook/</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>My Contacts</D:displayname>
        <D:resourcetype>
          <D:collection/>
          <C:addressbook/>
        </D:resourcetype>
        <CS:getctag>"contacts-ctag-v7"</CS:getctag>
        <D:sync-token>http://example.com/ns/sync/42</D:sync-token>
        <C:max-resource-size>102400</C:max-resource-size>
        <C:supported-address-data>
          <C:address-data-type content-type="text/vcard" version="3.0"/>
          <C:address-data-type content-type="text/vcard" version="4.0"/>
        </C:supported-address-data>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`);

		const prop = descendants(doc, 'prop', DAV)[0]!;
		assert.ok(prop);

		assert.equal(textContent(requireChild(prop, 'displayname', DAV)), 'My Contacts');
		assert.equal(textContent(requireChild(prop, 'max-resource-size', CARD)), '102400');
		assert.equal(textContent(requireChild(prop, 'sync-token', DAV)), 'http://example.com/ns/sync/42');

		const rt = requireChild(prop, 'resourcetype', DAV);
		assert.ok(child(rt, 'collection', DAV));
		assert.ok(child(rt, 'addressbook', CARD));

		const sad = requireChild(prop, 'supported-address-data', CARD);
		const types = children(sad, 'address-data-type', CARD);
		assert.equal(types.length, 2);
		assert.equal(attr(types[0]!, 'content-type'), 'text/vcard');
		assert.deepEqual(
			types.map((t) => attr(t, 'version')),
			['3.0', '4.0'],
		);
	});
});

// ---------------------------------------------------------------------------
// addressbook-query REPORT
// ---------------------------------------------------------------------------

describe('CardDAV addressbook-query REPORT', () => {
	it('parses an addressbook-query with text-match filter', () => {
		const doc = parse(`<?xml version="1.0" encoding="UTF-8"?>
<C:addressbook-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:prop>
    <D:getetag/>
    <C:address-data/>
  </D:prop>
  <C:filter test="anyof">
    <C:prop-filter name="FN">
      <C:text-match collation="i;unicode-casemap" match-type="contains">Smith</C:text-match>
    </C:prop-filter>
    <C:prop-filter name="EMAIL">
      <C:text-match collation="i;unicode-casemap" match-type="contains">smith</C:text-match>
    </C:prop-filter>
  </C:filter>
</C:addressbook-query>`);

		const root = rootElement(doc);
		assert.equal(root.name, 'addressbook-query');
		assert.equal(root.namespace, CARD);

		const filter = requireChild(root, 'filter', CARD);
		assert.equal(attr(filter, 'test'), 'anyof');

		const propFilters = children(filter, 'prop-filter', CARD);
		assert.equal(propFilters.length, 2);
		assert.deepEqual(
			propFilters.map((f) => attr(f, 'name')),
			['FN', 'EMAIL'],
		);

		const tm = requireChild(propFilters[0]!, 'text-match', CARD);
		assert.equal(attr(tm, 'collation'), 'i;unicode-casemap');
		assert.equal(attr(tm, 'match-type'), 'contains');
		assert.equal(textContent(tm), 'Smith');
	});

	it('parses an addressbook-query with param-filter', () => {
		const doc = parse(`<?xml version="1.0" encoding="UTF-8"?>
<C:addressbook-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:prop>
    <D:getetag/>
    <C:address-data>
      <C:prop name="VERSION"/>
      <C:prop name="FN"/>
      <C:prop name="EMAIL"/>
      <C:prop name="TEL"/>
    </C:address-data>
  </D:prop>
  <C:filter>
    <C:prop-filter name="TEL">
      <C:param-filter name="TYPE">
        <C:text-match collation="i;ascii-casemap" match-type="equals">CELL</C:text-match>
      </C:param-filter>
    </C:prop-filter>
  </C:filter>
</C:addressbook-query>`);

		const addrData = descendant(doc, 'address-data', CARD)!;
		assert.ok(addrData);
		const props = children(addrData, 'prop', CARD);
		assert.equal(props.length, 4);
		assert.deepEqual(
			props.map((p) => attr(p, 'name')),
			['VERSION', 'FN', 'EMAIL', 'TEL'],
		);

		const paramFilter = descendant(doc, 'param-filter', CARD)!;
		assert.ok(paramFilter);
		assert.equal(attr(paramFilter, 'name'), 'TYPE');
		assert.equal(textContent(requireChild(paramFilter, 'text-match', CARD)), 'CELL');
	});

	it('parses an addressbook-query response with vCard 3.0', () => {
		const vcard3 = `BEGIN:VCARD
VERSION:3.0
FN:John Smith
N:Smith;John;;;
EMAIL;TYPE=INTERNET,WORK:john.smith@example.com
TEL;TYPE=CELL:+1-555-0100
ADR;TYPE=WORK:;;123 Main St;Springfield;IL;62701;US
UID:urn:uuid:contact1@example.com
END:VCARD`;

		const doc = parse(`<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:response>
    <D:href>/addressbooks/user/contacts/contact1.vcf</D:href>
    <D:propstat>
      <D:prop>
        <D:getetag>"v1-contact1"</D:getetag>
        <C:address-data>${vcard3}</C:address-data>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`);

		const addrData = descendants(doc, 'address-data', CARD)[0]!;
		assert.ok(addrData);
		const content = textContent(addrData);
		assert.ok(content.includes('BEGIN:VCARD'));
		assert.ok(content.includes('FN:John Smith'));
	});
});

// ---------------------------------------------------------------------------
// addressbook-multiget REPORT
// ---------------------------------------------------------------------------

describe('CardDAV addressbook-multiget REPORT', () => {
	it('parses an addressbook-multiget request', () => {
		const doc = parse(`<?xml version="1.0" encoding="UTF-8"?>
<C:addressbook-multiget xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:prop>
    <D:getetag/>
    <C:address-data/>
  </D:prop>
  <D:href>/addressbooks/user/contacts/contact1.vcf</D:href>
  <D:href>/addressbooks/user/contacts/contact2.vcf</D:href>
</C:addressbook-multiget>`);

		const root = rootElement(doc);
		assert.equal(root.name, 'addressbook-multiget');
		assert.equal(root.namespace, CARD);

		const hrefs = children(root, 'href', DAV);
		assert.equal(hrefs.length, 2);
		assert.equal(textContent(hrefs[1]!), '/addressbooks/user/contacts/contact2.vcf');
	});

	it('parses an addressbook-multiget response with vCard 4.0 in CDATA', () => {
		const doc = parse(`<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:response>
    <D:href>/addressbooks/user/contacts/contact1.vcf</D:href>
    <D:propstat>
      <D:prop>
        <D:getetag>"v4-contact1"</D:getetag>
        <C:address-data><![CDATA[BEGIN:VCARD
VERSION:4.0
FN:Jörg Müller
N:Müller;Jörg;;;
EMAIL;TYPE=work:joerg.mueller@example.de
TEL;VALUE=uri;TYPE="voice,work":tel:+49-30-12345678
PHOTO;MEDIATYPE=image/jpeg:data:image/jpeg;base64,/9j/4AAQSkZJR==
UID:urn:uuid:joerg@example.de
END:VCARD]]></C:address-data>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <D:response>
    <D:href>/addressbooks/user/contacts/contact2.vcf</D:href>
    <D:propstat>
      <D:prop/>
      <D:status>HTTP/1.1 404 Not Found</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`);

		const responses = children(rootElement(doc), 'response', DAV);
		assert.equal(responses.length, 2);

		// First response has CDATA vCard
		const addrData = descendant(responses[0]!, 'address-data', CARD)!;
		assert.ok(addrData);
		const cdataNode = addrData.children[0];
		assert.ok(cdataNode);
		assert.ok(isCData(cdataNode), 'address-data should contain CDATA');
		assert.ok(cdataNode.value.includes('VERSION:4.0'));
		assert.ok(cdataNode.value.includes('Jörg Müller'), 'UTF-8 chars in vCard should be preserved');

		// Second is 404
		const status = textContent(requireChild(requireChild(responses[1]!, 'propstat', DAV), 'status', DAV));
		assert.equal(status, 'HTTP/1.1 404 Not Found');
	});
});

// ---------------------------------------------------------------------------
// Apple Contacts (macOS) specifics
// ---------------------------------------------------------------------------

describe('Apple Contacts CardDAV', () => {
	it('parses Apple Contacts PROPFIND with me-card', () => {
		const doc = parse(`<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:"
               xmlns:C="urn:ietf:params:xml:ns:carddav"
               xmlns:CS="http://calendarserver.org/ns/"
               xmlns:AI="http://apple.com/ns/ical/">
  <D:response>
    <D:href>/addressbooks/__uids__/user/addressbook/</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>Card</D:displayname>
        <CS:getctag>"v12-ctag"</CS:getctag>
        <CS:me-card>
          <D:href>/addressbooks/__uids__/user/addressbook/me.vcf</D:href>
        </CS:me-card>
        <C:addressbook-description xml:lang="en">My address book</C:addressbook-description>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`);

		const prop = descendants(doc, 'prop', DAV)[0]!;
		const meCard = requireChild(prop, 'me-card', CS);
		const href = requireChild(meCard, 'href', DAV);
		assert.equal(textContent(href), '/addressbooks/__uids__/user/addressbook/me.vcf');

		const desc = requireChild(prop, 'addressbook-description', CARD);
		assert.equal(textContent(desc), 'My address book');
		const lang = desc.attributes.find((a) => a.name === 'lang');
		assert.ok(lang);
		assert.equal(lang.value, 'en');
	});
});

// ---------------------------------------------------------------------------
// Google Contacts CardDAV
// ---------------------------------------------------------------------------

describe('Google Contacts CardDAV', () => {
	it('parses Google response — multiple groups (resourcetype with collection)', () => {
		// Google uses "default" group for the main contact list and separate
		// groups for each contact group, all under /carddav/v1/principals/
		const doc = parse(`<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:response>
    <D:href>/carddav/v1/principals/user@gmail.com/lists/default/</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>My Contacts</D:displayname>
        <D:resourcetype>
          <D:collection/>
          <C:addressbook/>
        </D:resourcetype>
        <D:getetag>W/"12345"</D:getetag>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <D:response>
    <D:href>/carddav/v1/principals/user@gmail.com/lists/group1/</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>Work</D:displayname>
        <D:resourcetype>
          <D:collection/>
          <C:addressbook/>
        </D:resourcetype>
        <D:getetag>W/"67890"</D:getetag>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`);

		const responses = children(rootElement(doc), 'response', DAV);
		assert.equal(responses.length, 2);

		for (const resp of responses) {
			const rt = descendant(resp, 'resourcetype', DAV)!;
			assert.ok(child(rt, 'collection', DAV));
			assert.ok(child(rt, 'addressbook', CARD));
		}

		const names = responses.map((r) => textContent(descendant(r, 'displayname', DAV)!));
		assert.deepEqual(names, ['My Contacts', 'Work']);
	});

	it('parses a Google-style getetag with weak validator W/"..."', () => {
		const doc = parse(`<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:response>
    <D:href>/carddav/v1/principals/u@gmail.com/lists/default/contact.vcf</D:href>
    <D:propstat>
      <D:prop>
        <D:getetag>W/"abc-123-def"</D:getetag>
        <C:address-data>BEGIN:VCARD
VERSION:3.0
FN:Test User
UID:test@gmail.com
END:VCARD</C:address-data>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`);

		const etag = descendant(doc, 'getetag', DAV)!;
		assert.ok(etag);
		// Weak ETags contain quotes that must survive entity decoding correctly
		assert.equal(textContent(etag), 'W/"abc-123-def"');
	});
});

// ---------------------------------------------------------------------------
// Nextcloud CardDAV
// ---------------------------------------------------------------------------

describe('Nextcloud CardDAV', () => {
	it('parses Nextcloud addressbook PROPFIND with sharing properties', () => {
		const doc = parse(`<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:"
               xmlns:C="urn:ietf:params:xml:ns:carddav"
               xmlns:OC="http://owncloud.org/ns"
               xmlns:NC="http://nextcloud.org/ns"
               xmlns:CS="http://calendarserver.org/ns/">
  <D:response>
    <D:href>/remote.php/dav/addressbooks/users/admin/contacts/</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>Contacts</D:displayname>
        <OC:id>1</OC:id>
        <OC:enabled>1</OC:enabled>
        <OC:read-only>0</OC:read-only>
        <NC:owner-displayname>Administrator</NC:owner-displayname>
        <OC:invite/>
        <CS:getctag>http://sabre.io/ns/sync/5</CS:getctag>
        <D:sync-token>http://sabre.io/ns/sync/5</D:sync-token>
        <OC:contacts-birthday-calendar>/remote.php/dav/calendars/admin/contact_birthdays/</OC:contacts-birthday-calendar>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`);

		const prop = descendants(doc, 'prop', DAV)[0]!;
		assert.ok(prop);

		assert.equal(textContent(requireChild(prop, 'owner-displayname', NC)), 'Administrator');
		assert.equal(textContent(requireChild(prop, 'id', OC)), '1');
		assert.equal(textContent(requireChild(prop, 'enabled', OC)), '1');

		const birthdayCal = requireChild(prop, 'contacts-birthday-calendar', OC);
		assert.ok(textContent(birthdayCal).includes('/contact_birthdays/'));
	});
});

// ---------------------------------------------------------------------------
// sync-collection REPORT for CardDAV
// ---------------------------------------------------------------------------

describe('CardDAV sync-collection REPORT', () => {
	it('parses a sync-collection response for an address book', () => {
		const doc = parse(`<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:response>
    <D:href>/addressbooks/user/contacts/new.vcf</D:href>
    <D:propstat>
      <D:prop>
        <D:getetag>"etag-new"</D:getetag>
        <D:getcontenttype>text/vcard; charset=utf-8</D:getcontenttype>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <D:response>
    <D:href>/addressbooks/user/contacts/changed.vcf</D:href>
    <D:propstat>
      <D:prop>
        <D:getetag>"etag-changed"</D:getetag>
        <D:getcontenttype>text/vcard; charset=utf-8</D:getcontenttype>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <D:response>
    <D:href>/addressbooks/user/contacts/removed.vcf</D:href>
    <D:status>HTTP/1.1 404 Not Found</D:status>
  </D:response>
  <D:sync-token>http://sabre.io/ns/sync/100</D:sync-token>
</D:multistatus>`);

		const root = rootElement(doc);
		const responses = children(root, 'response', DAV);
		assert.equal(responses.length, 3);

		// Verify content-type on updated contacts
		const ct = descendant(responses[0]!, 'getcontenttype', DAV)!;
		assert.ok(ct);
		assert.equal(textContent(ct), 'text/vcard; charset=utf-8');

		// 404 at response level
		const removed = responses[2]!;
		const topStatus = requireChild(removed, 'status', DAV);
		assert.equal(textContent(topStatus), 'HTTP/1.1 404 Not Found');

		// New sync-token is a sibling of the response elements
		const newToken = requireChild(root, 'sync-token', DAV);
		assert.equal(textContent(newToken), 'http://sabre.io/ns/sync/100');
	});
});

// ---------------------------------------------------------------------------
// REPORT with limit
// ---------------------------------------------------------------------------

describe('CardDAV REPORT with limit', () => {
	it('parses an addressbook-query with nresults limit', () => {
		const doc = parse(`<?xml version="1.0" encoding="UTF-8"?>
<C:addressbook-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:prop>
    <D:getetag/>
    <C:address-data/>
  </D:prop>
  <C:filter>
    <C:prop-filter name="FN">
      <C:is-not-defined/>
    </C:prop-filter>
  </C:filter>
  <C:limit>
    <C:nresults>50</C:nresults>
  </C:limit>
</C:addressbook-query>`);

		const limit = requireChild(rootElement(doc), 'limit', CARD);
		assert.equal(textContent(requireChild(limit, 'nresults', CARD)), '50');

		const isNotDefined = descendant(doc, 'is-not-defined', CARD);
		assert.ok(isNotDefined);
	});
});

// ---------------------------------------------------------------------------
// Well-known discovery
// ---------------------------------------------------------------------------

describe('Well-known CardDAV discovery', () => {
	it('parses a current-user-principal PROPFIND response', () => {
		const doc = parse(`<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/</D:href>
    <D:propstat>
      <D:prop>
        <D:current-user-principal>
          <D:href>/principals/user@example.com/</D:href>
        </D:current-user-principal>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`);

		const cup = descendants(doc, 'current-user-principal', DAV)[0]!;
		assert.ok(cup);
		const href = requireChild(cup, 'href', DAV);
		assert.equal(textContent(href), '/principals/user@example.com/');
	});

	it('parses a home-set PROPFIND response', () => {
		const doc = parse(`<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:response>
    <D:href>/principals/user@example.com/</D:href>
    <D:propstat>
      <D:prop>
        <C:addressbook-home-set>
          <D:href>/addressbooks/user@example.com/</D:href>
        </C:addressbook-home-set>
        <D:principal-URL>
          <D:href>/principals/user@example.com/</D:href>
        </D:principal-URL>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`);

		const homeSet = descendants(doc, 'addressbook-home-set', CARD)[0]!;
		assert.ok(homeSet);
		const href = requireChild(homeSet, 'href', DAV);
		assert.equal(textContent(href), '/addressbooks/user@example.com/');
	});
});
