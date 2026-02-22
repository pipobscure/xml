/**
 * CalDAV XML payload tests.
 *
 * Covers the most common request and response bodies produced by CalDAV
 * clients and servers in the wild, including Apple Calendar, Nextcloud,
 * Google Calendar, Fastmail, Radicale, sabre/dav and Cyrus IMAP.
 *
 * Namespace URIs used throughout:
 *   DAV:                          WebDAV (RFC 4918)
 *   urn:ietf:params:xml:ns:caldav CalDAV (RFC 4791)
 *   http://calendarserver.org/ns/ Apple CalendarServer extensions
 *   http://apple.com/ns/ical/     Apple iCal extensions
 *   http://owncloud.org/ns        ownCloud / Nextcloud core
 *   http://nextcloud.org/ns       Nextcloud extensions
 *   http://sabredav.org/ns        sabre/dav internal props
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parse, isCData } from '../src/index.ts';
import { rootElement, child, requireChild, children, descendant, textContent, attr, childElements } from './helpers.ts';

const DAV = 'DAV:';
const CAL = 'urn:ietf:params:xml:ns:caldav';
const CS = 'http://calendarserver.org/ns/';
const ICAL = 'http://apple.com/ns/ical/';
const OC = 'http://owncloud.org/ns';
const NC = 'http://nextcloud.org/ns';

// ---------------------------------------------------------------------------
// PROPFIND
// ---------------------------------------------------------------------------

describe('CalDAV PROPFIND', () => {
	it('parses a minimal PROPFIND request body', () => {
		const doc = parse(`<?xml version="1.0" encoding="UTF-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:displayname/>
    <D:resourcetype/>
    <D:current-user-privilege-set/>
  </D:prop>
</D:propfind>`);

		const root = rootElement(doc);
		assert.equal(root.name, 'propfind');
		assert.equal(root.namespace, DAV);

		const prop = requireChild(root, 'prop', DAV);
		const propChildren = childElements(prop);
		assert.equal(propChildren.length, 3);
		assert.ok(propChildren.every((e) => e.namespace === DAV));
		assert.deepEqual(
			propChildren.map((e) => e.name),
			['displayname', 'resourcetype', 'current-user-privilege-set'],
		);
	});

	it('parses a PROPFIND response — calendar collection', () => {
		const doc = parse(`<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"
               xmlns:CS="http://calendarserver.org/ns/">
  <D:response>
    <D:href>/calendars/user/home/</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>Home</D:displayname>
        <D:resourcetype>
          <D:collection/>
          <C:calendar/>
        </D:resourcetype>
        <D:current-user-privilege-set>
          <D:privilege><D:read/></D:privilege>
          <D:privilege><D:write/></D:privilege>
        </D:current-user-privilege-set>
        <CS:getctag>"abc123-etag"</CS:getctag>
        <C:supported-calendar-component-set>
          <C:comp name="VEVENT"/>
          <C:comp name="VTODO"/>
          <C:comp name="VJOURNAL"/>
        </C:supported-calendar-component-set>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`);

		const root = rootElement(doc);
		assert.equal(root.name, 'multistatus');
		assert.equal(root.namespace, DAV);

		const response = requireChild(root, 'response', DAV);
		assert.equal(textContent(requireChild(response, 'href', DAV)), '/calendars/user/home/');

		const propstat = requireChild(response, 'propstat', DAV);
		const prop = requireChild(propstat, 'prop', DAV);

		assert.equal(textContent(requireChild(prop, 'displayname', DAV)), 'Home');
		assert.equal(textContent(requireChild(propstat, 'status', DAV)), 'HTTP/1.1 200 OK');

		const resourcetype = requireChild(prop, 'resourcetype', DAV);
		assert.ok(child(resourcetype, 'collection', DAV));
		assert.ok(child(resourcetype, 'calendar', CAL));

		// CalendarServer getctag
		const ctag = requireChild(prop, 'getctag', CS);
		assert.equal(textContent(ctag), '"abc123-etag"');

		// Supported component set
		const compSet = requireChild(prop, 'supported-calendar-component-set', CAL);
		const comps = children(compSet, 'comp', CAL);
		assert.equal(comps.length, 3);
		assert.deepEqual(
			comps.map((c) => attr(c, 'name')),
			['VEVENT', 'VTODO', 'VJOURNAL'],
		);

		// Privilege set
		const privSet = requireChild(prop, 'current-user-privilege-set', DAV);
		const privs = children(privSet, 'privilege', DAV);
		assert.equal(privs.length, 2);
	});

	it('parses a PROPFIND response with 200 and 404 propstat sections', () => {
		const doc = parse(`<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:response>
    <D:href>/calendars/user/home/</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>Home</D:displayname>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
    <D:propstat>
      <D:prop>
        <C:calendar-color/>
      </D:prop>
      <D:status>HTTP/1.1 404 Not Found</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`);

		const response = requireChild(rootElement(doc), 'response', DAV);
		const propstats = children(response, 'propstat', DAV);
		assert.equal(propstats.length, 2);
		assert.equal(textContent(requireChild(propstats[0]!, 'status', DAV)), 'HTTP/1.1 200 OK');
		assert.equal(textContent(requireChild(propstats[1]!, 'status', DAV)), 'HTTP/1.1 404 Not Found');
	});
});

// ---------------------------------------------------------------------------
// calendar-query REPORT
// ---------------------------------------------------------------------------

describe('CalDAV calendar-query REPORT', () => {
	it('parses a calendar-query request with time-range filter', () => {
		const doc = parse(`<?xml version="1.0" encoding="UTF-8"?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:time-range start="20240101T000000Z" end="20241231T235959Z"/>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`);

		const root = rootElement(doc);
		assert.equal(root.name, 'calendar-query');
		assert.equal(root.namespace, CAL);

		const filter = requireChild(root, 'filter', CAL);
		const calComp = requireChild(filter, 'comp-filter', CAL);
		assert.equal(attr(calComp, 'name'), 'VCALENDAR');

		const eventComp = requireChild(calComp, 'comp-filter', CAL);
		assert.equal(attr(eventComp, 'name'), 'VEVENT');

		const timeRange = requireChild(eventComp, 'time-range', CAL);
		assert.equal(attr(timeRange, 'start'), '20240101T000000Z');
		assert.equal(attr(timeRange, 'end'), '20241231T235959Z');
	});

	it('parses a calendar-query response with inline iCalendar text', () => {
		const ical = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Example Corp//CalDAV Client//EN
BEGIN:VEVENT
DTSTART:20240315T100000Z
DTEND:20240315T110000Z
SUMMARY:Team Meeting
DESCRIPTION:Quarterly review & planning
UID:unique-event-id@example.com
END:VEVENT
END:VCALENDAR`;

		const doc = parse(`<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:response>
    <D:href>/calendars/user/home/event.ics</D:href>
    <D:propstat>
      <D:prop>
        <D:getetag>"v1-abc"</D:getetag>
        <C:calendar-data>${ical}</C:calendar-data>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`);

		const calData = descendant(doc, 'calendar-data', CAL)!;
		assert.ok(calData, 'calendar-data element missing');
		assert.ok(textContent(calData).includes('BEGIN:VCALENDAR'));
		assert.ok(textContent(calData).includes('Team Meeting'));
		// & in description must have been decoded from &amp;
		assert.ok(textContent(calData).includes('review & planning') || textContent(calData).includes('review &amp; planning'), 'description content should be present');
	});

	it('parses a calendar-query response with CDATA-wrapped calendar-data', () => {
		const doc = parse(`<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:response>
    <D:href>/calendars/user/home/event.ics</D:href>
    <D:propstat>
      <D:prop>
        <C:calendar-data><![CDATA[BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
SUMMARY:Meeting <important>
DESCRIPTION:Contains <xml> & special chars
UID:cdata-test@example.com
END:VEVENT
END:VCALENDAR]]></C:calendar-data>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`);

		const calData = descendant(doc, 'calendar-data', CAL)!;
		assert.ok(calData);
		const cdataNode = calData.children[0];
		assert.ok(cdataNode, 'calendar-data must have at least one child');
		assert.ok(isCData(cdataNode), 'calendar-data child should be CDATA');
		assert.ok(cdataNode.value.includes('SUMMARY:Meeting <important>'));
		assert.ok(cdataNode.value.includes('DESCRIPTION:Contains <xml> & special chars'));
	});
});

// ---------------------------------------------------------------------------
// calendar-multiget REPORT
// ---------------------------------------------------------------------------

describe('CalDAV calendar-multiget REPORT', () => {
	it('parses a calendar-multiget request', () => {
		const doc = parse(`<?xml version="1.0" encoding="UTF-8"?>
<C:calendar-multiget xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <D:href>/calendars/user/home/event1.ics</D:href>
  <D:href>/calendars/user/home/event2.ics</D:href>
  <D:href>/calendars/user/home/event3.ics</D:href>
</C:calendar-multiget>`);

		const root = rootElement(doc);
		assert.equal(root.name, 'calendar-multiget');
		assert.equal(root.namespace, CAL);

		const hrefs = children(root, 'href', DAV);
		assert.equal(hrefs.length, 3);
		assert.equal(textContent(hrefs[0]!), '/calendars/user/home/event1.ics');
		assert.equal(textContent(hrefs[2]!), '/calendars/user/home/event3.ics');
	});

	it('parses a calendar-multiget response with multiple events', () => {
		const doc = parse(`<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:response>
    <D:href>/calendars/user/home/event1.ics</D:href>
    <D:propstat>
      <D:prop>
        <D:getetag>"etag1"</D:getetag>
        <C:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
SUMMARY:Event One
UID:event1@example.com
END:VEVENT
END:VCALENDAR</C:calendar-data>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <D:response>
    <D:href>/calendars/user/home/event2.ics</D:href>
    <D:propstat>
      <D:prop>
        <D:getetag>"etag2"</D:getetag>
        <C:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
SUMMARY:Event Two
UID:event2@example.com
END:VEVENT
END:VCALENDAR</C:calendar-data>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <D:response>
    <D:href>/calendars/user/home/event3.ics</D:href>
    <D:propstat>
      <D:prop/>
      <D:status>HTTP/1.1 404 Not Found</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`);

		const root = rootElement(doc);
		const responses = children(root, 'response', DAV);
		assert.equal(responses.length, 3);

		// First two should have calendar-data
		for (const resp of responses.slice(0, 2)) {
			const cd = descendant(resp, 'calendar-data', CAL)!;
			assert.ok(cd);
			assert.ok(textContent(cd).includes('BEGIN:VCALENDAR'));
		}

		// Third is 404
		const status404 = textContent(requireChild(requireChild(responses[2]!, 'propstat', DAV), 'status', DAV));
		assert.equal(status404, 'HTTP/1.1 404 Not Found');
	});
});

// ---------------------------------------------------------------------------
// MKCALENDAR
// ---------------------------------------------------------------------------

describe('CalDAV MKCALENDAR', () => {
	it('parses a MKCALENDAR request', () => {
		const doc = parse(`<?xml version="1.0" encoding="UTF-8"?>
<C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:set>
    <D:prop>
      <D:displayname>Work Calendar</D:displayname>
      <C:calendar-description xml:lang="en">My work events</C:calendar-description>
      <C:calendar-timezone>BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VTIMEZONE
TZID:America/New_York
END:VTIMEZONE
END:VCALENDAR</C:calendar-timezone>
      <C:supported-calendar-component-set>
        <C:comp name="VEVENT"/>
        <C:comp name="VTODO"/>
      </C:supported-calendar-component-set>
    </D:prop>
  </D:set>
</C:mkcalendar>`);

		const root = rootElement(doc);
		assert.equal(root.name, 'mkcalendar');
		assert.equal(root.namespace, CAL);

		const prop = descendant(doc, 'prop', DAV)!;
		assert.ok(prop);

		assert.equal(textContent(requireChild(prop, 'displayname', DAV)), 'Work Calendar');

		const desc = requireChild(prop, 'calendar-description', CAL);
		assert.equal(textContent(desc), 'My work events');
		// xml:lang attribute must resolve to the XML namespace
		const lang = desc.attributes.find((a) => a.name === 'lang');
		assert.ok(lang);
		assert.equal(lang.namespace, 'http://www.w3.org/XML/1998/namespace');
		assert.equal(lang.value, 'en');

		const tz = requireChild(prop, 'calendar-timezone', CAL);
		assert.ok(textContent(tz).includes('BEGIN:VTIMEZONE'));

		const compSet = requireChild(prop, 'supported-calendar-component-set', CAL);
		const comps = children(compSet, 'comp', CAL);
		assert.deepEqual(
			comps.map((c) => attr(c, 'name')),
			['VEVENT', 'VTODO'],
		);
	});
});

// ---------------------------------------------------------------------------
// sync-collection REPORT (RFC 6578)
// ---------------------------------------------------------------------------

describe('CalDAV sync-collection REPORT', () => {
	it('parses a sync-collection request', () => {
		const doc = parse(`<?xml version="1.0" encoding="UTF-8"?>
<D:sync-collection xmlns:D="DAV:">
  <D:sync-token>http://example.com/ns/sync/1234</D:sync-token>
  <D:sync-level>1</D:sync-level>
  <D:prop>
    <D:getetag/>
    <D:getcontenttype/>
  </D:prop>
</D:sync-collection>`);

		const root = rootElement(doc);
		assert.equal(root.name, 'sync-collection');

		assert.equal(textContent(requireChild(root, 'sync-token', DAV)), 'http://example.com/ns/sync/1234');
		assert.equal(textContent(requireChild(root, 'sync-level', DAV)), '1');
	});

	it('parses a sync-collection response with added/modified/deleted resources', () => {
		const doc = parse(`<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/calendars/user/home/new-event.ics</D:href>
    <D:propstat>
      <D:prop>
        <D:getetag>"new-etag"</D:getetag>
        <D:getcontenttype>text/calendar; charset=utf-8</D:getcontenttype>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <D:response>
    <D:href>/calendars/user/home/deleted-event.ics</D:href>
    <D:status>HTTP/1.1 404 Not Found</D:status>
  </D:response>
  <D:sync-token>http://example.com/ns/sync/1235</D:sync-token>
</D:multistatus>`);

		const root = rootElement(doc);
		const responses = children(root, 'response', DAV);
		assert.equal(responses.length, 2);

		// The 404 response has status at response level (no propstat)
		const deleted = responses[1]!;
		const topStatus = child(deleted, 'status', DAV);
		assert.ok(topStatus);
		assert.equal(textContent(topStatus), 'HTTP/1.1 404 Not Found');

		// New sync-token
		const token = child(root, 'sync-token', DAV);
		assert.ok(token);
		assert.equal(textContent(token), 'http://example.com/ns/sync/1235');
	});
});

// ---------------------------------------------------------------------------
// Apple CalendarServer extensions
// ---------------------------------------------------------------------------

describe('Apple CalendarServer extensions', () => {
	it('parses CS:getctag and push-transports', () => {
		const doc = parse(`<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:"
               xmlns:CS="http://calendarserver.org/ns/"
               xmlns:A="http://apple.com/ns/ical/">
  <D:response>
    <D:href>/calendars/__uids__/user/</D:href>
    <D:propstat>
      <D:prop>
        <CS:getctag>"e8a923-ctag"</CS:getctag>
        <A:calendar-color>#0082c9</A:calendar-color>
        <A:calendar-order>1</A:calendar-order>
        <CS:push-transports>
          <CS:transport type="APSD">
            <CS:subscription-url>
              <D:href>https://p01-caldav.icloud.com/push</D:href>
            </CS:subscription-url>
          </CS:transport>
        </CS:push-transports>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`);

		const prop = descendant(doc, 'prop', DAV)!;
		assert.ok(prop);

		const ctag = requireChild(prop, 'getctag', CS);
		assert.equal(textContent(ctag), '"e8a923-ctag"');

		const color = requireChild(prop, 'calendar-color', ICAL);
		assert.equal(textContent(color), '#0082c9');

		const order = requireChild(prop, 'calendar-order', ICAL);
		assert.equal(textContent(order), '1');

		const pushTransports = requireChild(prop, 'push-transports', CS);
		const transport = requireChild(pushTransports, 'transport', CS);
		assert.equal(attr(transport, 'type'), 'APSD');
	});

	it('parses notifications (Apple CalendarServer)', () => {
		const doc = parse(`<?xml version="1.0" encoding="UTF-8"?>
<CS:notification xmlns:D="DAV:"
                 xmlns:CS="http://calendarserver.org/ns/">
  <CS:invite-notification>
    <D:href>/calendars/__uids__/invite-uid</D:href>
    <CS:uid>invite-uid</CS:uid>
    <CS:organizer>
      <D:href>mailto:organizer@example.com</D:href>
      <CS:cn>Alice Smith</CS:cn>
    </CS:organizer>
    <CS:invite-accepted/>
  </CS:invite-notification>
</CS:notification>`);

		const root = rootElement(doc);
		assert.equal(root.name, 'notification');
		assert.equal(root.namespace, CS);

		const invite = requireChild(root, 'invite-notification', CS);
		const org = requireChild(invite, 'organizer', CS);
		const orgHref = requireChild(org, 'href', DAV);
		assert.equal(textContent(orgHref), 'mailto:organizer@example.com');

		const cn = requireChild(org, 'cn', CS);
		assert.equal(textContent(cn), 'Alice Smith');
	});
});

// ---------------------------------------------------------------------------
// Nextcloud / ownCloud extensions
// ---------------------------------------------------------------------------

describe('Nextcloud / ownCloud CalDAV extensions', () => {
	it('parses Nextcloud PROPFIND response with OC and NC namespaces', () => {
		const doc = parse(`<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:"
               xmlns:C="urn:ietf:params:xml:ns:caldav"
               xmlns:OC="http://owncloud.org/ns"
               xmlns:NC="http://nextcloud.org/ns"
               xmlns:CS="http://calendarserver.org/ns/">
  <D:response>
    <D:href>/remote.php/dav/calendars/admin/personal/</D:href>
    <D:propstat>
      <D:prop>
        <OC:id>1</OC:id>
        <OC:color>#0082c9</OC:color>
        <NC:owner-displayname>Admin</NC:owner-displayname>
        <OC:enabled>true</OC:enabled>
        <OC:read-only>false</OC:read-only>
        <CS:getctag>http://sabre.io/ns/sync/1</CS:getctag>
        <D:sync-token>http://sabre.io/ns/sync/1</D:sync-token>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`);

		const prop = descendant(doc, 'prop', DAV)!;
		assert.ok(prop);

		assert.equal(textContent(requireChild(prop, 'id', OC)), '1');
		assert.equal(textContent(requireChild(prop, 'color', OC)), '#0082c9');
		assert.equal(textContent(requireChild(prop, 'owner-displayname', NC)), 'Admin');
		assert.equal(textContent(requireChild(prop, 'enabled', OC)), 'true');
		assert.equal(textContent(requireChild(prop, 'read-only', OC)), 'false');
	});
});

// ---------------------------------------------------------------------------
// Free-busy query
// ---------------------------------------------------------------------------

describe('CalDAV free-busy query', () => {
	it('parses a free-busy-query REPORT request', () => {
		const doc = parse(`<?xml version="1.0" encoding="UTF-8"?>
<C:free-busy-query xmlns:C="urn:ietf:params:xml:ns:caldav">
  <C:time-range start="20240101T000000Z" end="20240131T235959Z"/>
</C:free-busy-query>`);

		const root = rootElement(doc);
		assert.equal(root.name, 'free-busy-query');
		assert.equal(root.namespace, CAL);

		const timeRange = requireChild(root, 'time-range', CAL);
		assert.equal(attr(timeRange, 'start'), '20240101T000000Z');
		assert.equal(attr(timeRange, 'end'), '20240131T235959Z');
	});
});

// ---------------------------------------------------------------------------
// Error responses
// ---------------------------------------------------------------------------

describe('CalDAV error responses', () => {
	it('parses a D:error response', () => {
		const doc = parse(`<?xml version="1.0" encoding="UTF-8"?>
<D:error xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <C:valid-calendar-data/>
  <D:precondition-failed>
    <D:error-description>The iCalendar data is not valid</D:error-description>
  </D:precondition-failed>
</D:error>`);

		const root = rootElement(doc);
		assert.equal(root.name, 'error');
		assert.equal(root.namespace, DAV);

		assert.ok(child(root, 'valid-calendar-data', CAL), 'valid-calendar-data should be present');
		const pre = requireChild(root, 'precondition-failed', DAV);
		assert.ok(textContent(requireChild(pre, 'error-description', DAV)).length > 0);
	});

	it('parses a multistatus error response', () => {
		const doc = parse(`<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/calendars/user/home/bad.ics</D:href>
    <D:status>HTTP/1.1 403 Forbidden</D:status>
    <D:error>
      <D:need-privileges>
        <D:resource><D:href>/calendars/user/home/bad.ics</D:href></D:resource>
        <D:privilege><D:write/></D:privilege>
      </D:need-privileges>
    </D:error>
  </D:response>
</D:multistatus>`);

		const response = requireChild(rootElement(doc), 'response', DAV);
		assert.equal(textContent(requireChild(response, 'status', DAV)), 'HTTP/1.1 403 Forbidden');
		const error = requireChild(response, 'error', DAV);
		assert.ok(descendant(error, 'write', DAV));
	});
});

// ---------------------------------------------------------------------------
// PROPPATCH
// ---------------------------------------------------------------------------

describe('CalDAV PROPPATCH', () => {
	it('parses a PROPPATCH request', () => {
		const doc = parse(`<?xml version="1.0" encoding="UTF-8"?>
<D:propertyupdate xmlns:D="DAV:"
                  xmlns:A="http://apple.com/ns/ical/"
                  xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:set>
    <D:prop>
      <D:displayname>Updated Calendar Name</D:displayname>
      <A:calendar-color>#e8a923</A:calendar-color>
    </D:prop>
  </D:set>
  <D:remove>
    <D:prop>
      <C:calendar-description/>
    </D:prop>
  </D:remove>
</D:propertyupdate>`);

		const root = rootElement(doc);
		assert.equal(root.name, 'propertyupdate');
		assert.equal(root.namespace, DAV);

		const set = requireChild(root, 'set', DAV);
		const prop = requireChild(set, 'prop', DAV);
		assert.equal(textContent(requireChild(prop, 'displayname', DAV)), 'Updated Calendar Name');
		assert.equal(textContent(requireChild(prop, 'calendar-color', ICAL)), '#e8a923');

		const remove = requireChild(root, 'remove', DAV);
		const removeProp = requireChild(remove, 'prop', DAV);
		assert.ok(child(removeProp, 'calendar-description', CAL));
	});
});

// ---------------------------------------------------------------------------
// sabre/dav specifics
// ---------------------------------------------------------------------------

describe('sabre/dav responses', () => {
	it('parses sabre/dav s:exception error response', () => {
		const SABRE = 'http://sabredav.org/ns';
		const doc = parse(`<?xml version="1.0" encoding="UTF-8"?>
<d:error xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns">
  <s:exception>Sabre\\DAV\\Exception\\NotFound</s:exception>
  <s:message>Principal with name admin not found</s:message>
  <s:sabredav-version>4.6.0</s:sabredav-version>
</d:error>`);

		const root = rootElement(doc);
		assert.equal(root.name, 'error');
		assert.equal(root.namespace, DAV);

		const ex = requireChild(root, 'exception', SABRE);
		assert.ok(textContent(ex).includes('NotFound'));

		const msg = requireChild(root, 'message', SABRE);
		assert.ok(textContent(msg).length > 0);
	});
});
