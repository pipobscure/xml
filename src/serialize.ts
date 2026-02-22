/**
 * @pipobscure/xml — XML serializer
 *
 * Converts the plain-object tree produced by `parse()` back into an XML string.
 *
 * Tolerance contract (mirrors query.ts)
 * ──────────────────────────────────────
 * • `null` / `undefined` input → `""`.
 * • Missing `children` / `attributes` properties → treated as `[]`.
 * • Missing or non-string `value` / `name` / `target` → treated as `""`.
 * • Missing or non-string `prefix` → treated as absent (no prefix emitted).
 * • Missing or non-string `version` on an xml-declaration → defaults to `"1.0"`.
 * • Unrecognised `type` values → `""` (node silently skipped).
 * • Nameless attributes (missing or empty `name`) → silently skipped.
 * • Nameless elements (missing or empty `name`) → children rendered inline.
 */

import type { AnyNode } from './types.ts';

// ---------------------------------------------------------------------------
// Escaping helpers
// ---------------------------------------------------------------------------

/** Escape characters that are special in XML text content. */
function escapeText(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escape characters that are special inside a double-quoted attribute value. */
function escapeAttr(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

/** Build a qualified name; an empty or absent prefix is treated as "no prefix". */
function qname(prefix: string | null, name: string): string {
	return prefix !== null && prefix.length > 0 ? `${prefix}:${name}` : name;
}

/**
 * Ensure a CDATA value does not contain the `]]>` end-marker by splitting
 * it across adjacent CDATA sections wherever that sequence appears.
 */
function escapeCData(value: string): string {
	// Split at each ]]> by ending the section one character before the > and
	// opening a new one that begins with >, so every character stays inside a
	// CDATA section and no intermediate text nodes are introduced.
	//   'a ]]> b' → 'a ]]]><![CDATA[]> b'
	//   wrapped  → <![CDATA[a ]]]><![CDATA[]> b]]>
	//   parses   → CData("a ]") + CData("]> b")  ← textContent = "a ]]> b" ✓
	return value.split(']]>').join(']]]><![CDATA[]>');
}

// ---------------------------------------------------------------------------
// Defensive property accessors
// ---------------------------------------------------------------------------

/** An opaque bag of unknown properties, used for defensive access. */
type Bag = Record<string, unknown>;

/** Returns the value cast to a `Bag`, or `null` if the input is not an object. */
function bag(v: unknown): Bag | null {
	return v != null && typeof v === 'object' ? (v as Bag) : null;
}

/** Returns `v[key]` as a `string`, or `""` if absent or non-string. */
function strOf(b: Bag, key: string): string {
	const v = b[key];
	return typeof v === 'string' ? v : '';
}

/** Returns `v[key]` as a `string`, or `null` if absent, `null`, or non-string. */
function nullStrOf(b: Bag, key: string): string | null {
	const v = b[key];
	return typeof v === 'string' ? v : null;
}

/** Returns `v[key]` as a `boolean`, or `null` if absent, `null`, or non-boolean. */
function nullBoolOf(b: Bag, key: string): boolean | null {
	const v = b[key];
	return typeof v === 'boolean' ? v : null;
}

/** Returns `v["prefix"]` as a `string | null`, treating any non-string as `null`. */
function prefixOf(b: Bag): string | null {
	const v = b['prefix'];
	return typeof v === 'string' ? v : null;
}

/** Returns `v[key]` as an array, or `[]` if absent or non-array. */
function arrOf(b: Bag, key: string): unknown[] {
	const v = b[key];
	return Array.isArray(v) ? v : [];
}

// ---------------------------------------------------------------------------
// Attribute serialization
// ---------------------------------------------------------------------------

function serializeAttr(a: unknown): string {
	const b = bag(a);
	if (b === null) return '';
	const name = strOf(b, 'name');
	if (!name) return ''; // nameless attributes are silently skipped
	const prefix = prefixOf(b);
	const value = strOf(b, 'value');
	return `${qname(prefix, name)}="${escapeAttr(value)}"`;
}

// ---------------------------------------------------------------------------
// Internal recursive worker — accepts `unknown` for full tolerance
// ---------------------------------------------------------------------------

function serializeNode(node: unknown): string {
	const b = bag(node);
	if (b === null) return '';

	switch (strOf(b, 'type')) {
		case 'document':
			return arrOf(b, 'children').map(serializeNode).join('');

		case 'xml-declaration': {
			const version = strOf(b, 'version') || '1.0';
			const encoding = nullStrOf(b, 'encoding');
			const standalone = nullBoolOf(b, 'standalone');
			let s = `<?xml version="${version}"`;
			if (encoding !== null) s += ` encoding="${encoding}"`;
			if (standalone !== null) s += ` standalone="${standalone ? 'yes' : 'no'}"`;
			return `${s}?>`;
		}

		case 'doctype': {
			const name = strOf(b, 'name');
			const publicId = nullStrOf(b, 'publicId');
			const systemId = nullStrOf(b, 'systemId');
			const internalSubset = nullStrOf(b, 'internalSubset');
			let s = `<!DOCTYPE ${name}`;
			if (publicId !== null) {
				s += ` PUBLIC "${publicId}" "${systemId ?? ''}"`;
			} else if (systemId !== null) {
				s += ` SYSTEM "${systemId}"`;
			}
			if (internalSubset !== null) s += ` [${internalSubset}]`;
			return `${s}>`;
		}

		case 'processing-instruction': {
			const target = strOf(b, 'target');
			if (!target) return '';
			const data = strOf(b, 'data');
			return data.length > 0 ? `<?${target} ${data}?>` : `<?${target}?>`;
		}

		case 'comment':
			return `<!--${strOf(b, 'value')}-->`;

		case 'text':
			return escapeText(strOf(b, 'value'));

		case 'cdata':
			return `<![CDATA[${escapeCData(strOf(b, 'value'))}]]>`;

		case 'element': {
			const name = strOf(b, 'name');
			const prefix = prefixOf(b);
			const tag = qname(prefix, name);
			const attrParts = arrOf(b, 'attributes')
				.map(serializeAttr)
				.filter((s) => s.length > 0);
			const attrStr = attrParts.length > 0 ? ` ${attrParts.join(' ')}` : '';
			const kids = arrOf(b, 'children');
			if (!name) return kids.map(serializeNode).join(''); // nameless: render children only
			if (kids.length === 0) return `<${tag}${attrStr}/>`;
			return `<${tag}${attrStr}>${kids.map(serializeNode).join('')}</${tag}>`;
		}

		default:
			return '';
	}
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Serialize any XML node (or complete document) back to an XML string.
 *
 * - `Document`              → all children concatenated.
 * - `Element`               → `<tag attrs>…</tag>`, or `<tag attrs/>` when childless.
 * - `Text`                  → character-escaped text (`&`, `<`, `>` → entities).
 * - `CData`                 → `<![CDATA[…]]>`, splitting on embedded `]]>`.
 * - `Comment`               → `<!--…-->`.
 * - `ProcessingInstruction` → `<?target data?>`.
 * - `XmlDeclaration`        → `<?xml version="…" …?>`.
 * - `DocumentType`          → `<!DOCTYPE …>`.
 *
 * Tolerant: missing or wrong-typed properties are treated as absent/empty;
 * `null` / `undefined` input returns `""`.
 */
export function serialize(node: AnyNode | null | undefined): string {
	return serializeNode(node);
}
