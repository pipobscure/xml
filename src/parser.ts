/**
 * @pipobscure/xml — Recursive-descent XML parser
 *
 * Design goals
 * ─────────────
 * • Correctness for well-formed XML (CalDAV, CardDAV, Atom, WebDAV …)
 * • Tolerant / forgiving: recovers from many real-world XML quirks instead
 *   of aborting with an error. The aim is to parse what servers actually send,
 *   not only what the spec mandates.
 * • Optimised for small documents (< ~1 MB) — no streaming, no SAX.
 * • Pure TypeScript, zero dependencies, plain-object output (JSON-safe).
 *
 * Tolerance specifics
 * ────────────────────
 * • Unknown named entity references (e.g. `&nbsp;`) are left verbatim
 *   (`&nbsp;`) rather than causing an error.
 * • Undefined namespace prefixes resolve to `null` rather than throwing.
 * • `--` inside comments is allowed (browsers are lenient here too).
 * • Missing XML declaration is fine.
 * • Attribute values may use either quote style.
 * • DOCTYPE internal subsets are captured verbatim, not validated.
 * • The BOM (U+FEFF) at the start of the stream is silently skipped.
 */

import type { Document, DocumentChild, ChildNode, Element, Attribute, Text, CData, Comment, ProcessingInstruction, DocumentType, XmlDeclaration } from './types.ts';
import { isXmlWhitespace, isNameStartChar, isNameChar, isHexDigit, isDecimalDigit } from './chars.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';

/** The five predefined XML entities. Unknown entities are left verbatim. */
const PREDEFINED_ENTITIES: Readonly<Record<string, string>> = {
	amp: '&',
	lt: '<',
	gt: '>',
	apos: "'",
	quot: '"',
};

// ---------------------------------------------------------------------------
// Public error type
// ---------------------------------------------------------------------------

/**
 * Thrown when the input is so malformed that the parser cannot produce a
 * meaningful tree. In practice the parser tries hard to recover, so only
 * truly unrecoverable situations (e.g. no root element found) reach here.
 */
export class ParseError extends Error {
	/** Byte offset in the source string where the problem was detected. */
	readonly position: number;
	/** 1-based line number. */
	readonly line: number;
	/** 1-based column number. */
	readonly column: number;

	constructor(message: string, position: number, line: number, column: number) {
		super(`${message} (line ${line}, col ${column})`);
		this.name = 'XmlParseError';
		this.position = position;
		this.line = line;
		this.column = column;
	}
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface QName {
	prefix: string | null;
	local: string;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

class XmlParser {
	private readonly src: string;
	private pos = 0;

	/**
	 * Namespace scope stack.
	 * Each layer maps prefix → URI; `''` (empty string) is the default NS.
	 * The bottom layer holds the two permanently-bound prefixes.
	 */
	private readonly nsStack: Array<Map<string, string>> = [
		new Map<string, string>([
			['xml', XML_NS],
			['xmlns', XMLNS_NS],
		]),
	];

	constructor(src: string) {
		this.src = src;
	}

	// -------------------------------------------------------------------------
	// Public entry point
	// -------------------------------------------------------------------------

	parse(): Document {
		// Strip BOM
		if (this.src.charCodeAt(0) === 0xfeff) this.pos = 1;

		const children: DocumentChild[] = [];

		// Optional XML declaration
		if (this.startsWith('<?xml') && this.isXmlDeclStart()) {
			children.push(this.parseXmlDeclaration());
		}

		// Misc* (comments, PIs, whitespace) then optional DOCTYPE then Misc*
		this.parseMisc(children);

		if (this.startsWith('<!DOCTYPE') || this.startsWith('<!doctype')) {
			try {
				children.push(this.parseDoctype());
			} catch {
				// If DOCTYPE is deeply malformed just skip to the next '<'
				this.skipToNext('<');
			}
			this.parseMisc(children);
		}

		// Root element
		if (this.pos < this.src.length && this.src[this.pos] === '<') {
			children.push(this.parseElement());
		} else if (this.pos < this.src.length) {
			throw this.error('No root element found');
		}

		// Trailing misc
		this.parseMisc(children);

		return { type: 'document', children };
	}

	// -------------------------------------------------------------------------
	// Prolog / misc
	// -------------------------------------------------------------------------

	/**
	 * Determines whether the `<?xml` we see is really the XML declaration
	 * (followed by whitespace or `?>`) and not a PI named `xmlfoo`.
	 */
	private isXmlDeclStart(): boolean {
		const c = this.src.charCodeAt(this.pos + 5);
		return isXmlWhitespace(c) || c === 0x3f; // ? for '?>'
	}

	private parseMisc(into: DocumentChild[]): void {
		while (this.pos < this.src.length) {
			this.skipWhitespace();
			if (this.startsWith('<!--')) {
				into.push(this.parseComment() as Comment);
			} else if (this.startsWith('<?')) {
				into.push(this.parseProcessingInstruction() as ProcessingInstruction);
			} else {
				break;
			}
		}
	}

	private parseXmlDeclaration(): XmlDeclaration {
		this.expect('<?xml');

		// Tolerate missing whitespace
		this.skipWhitespace();

		let version = '1.0';
		let encoding: string | null = null;
		let standalone: boolean | null = null;

		if (this.startsWith('version')) {
			this.advanceBy(7);
			this.skipWhitespace();
			if (this.current() === '=') {
				this.advance();
			}
			this.skipWhitespace();
			version = this.parseQuotedValue();
			this.skipWhitespace();
		}

		if (this.startsWith('encoding')) {
			this.advanceBy(8);
			this.skipWhitespace();
			if (this.current() === '=') {
				this.advance();
			}
			this.skipWhitespace();
			encoding = this.parseQuotedValue();
			this.skipWhitespace();
		}

		if (this.startsWith('standalone')) {
			this.advanceBy(10);
			this.skipWhitespace();
			if (this.current() === '=') {
				this.advance();
			}
			this.skipWhitespace();
			const val = this.parseQuotedValue();
			standalone = val === 'yes' ? true : val === 'no' ? false : null;
			this.skipWhitespace();
		}

		// Consume ?> — tolerate just > if ?> is missing
		if (this.startsWith('?>')) {
			this.advanceBy(2);
		} else if (this.current() === '>') {
			this.advance();
		}

		return { type: 'xml-declaration', version, encoding, standalone };
	}

	private parseDoctype(): DocumentType {
		// Case-insensitive match already confirmed by caller
		this.advanceBy('<!DOCTYPE'.length);
		this.skipWhitespace();

		const name = this.tryParseName() ?? 'unknown';
		this.skipWhitespace();

		let publicId: string | null = null;
		let systemId: string | null = null;
		let internalSubset: string | null = null;

		const kw = this.peekKeyword();
		if (kw === 'PUBLIC') {
			this.advanceBy(6);
			this.skipWhitespace();
			publicId = this.parseQuotedValue();
			this.skipWhitespace();
			if (this.current() === '"' || this.current() === "'") {
				systemId = this.parseQuotedValue();
				this.skipWhitespace();
			}
		} else if (kw === 'SYSTEM') {
			this.advanceBy(6);
			this.skipWhitespace();
			systemId = this.parseQuotedValue();
			this.skipWhitespace();
		}

		// Internal subset
		if (this.current() === '[') {
			this.advance();
			const start = this.pos;
			// Scan for the matching ']', respecting quoted strings
			while (this.pos < this.src.length && this.current() !== ']') {
				if (this.current() === '"' || this.current() === "'") {
					const q = this.current();
					this.advance();
					while (this.pos < this.src.length && this.current() !== q) this.advance();
					if (this.pos < this.src.length) this.advance();
				} else {
					this.advance();
				}
			}
			internalSubset = this.src.slice(start, this.pos);
			if (this.current() === ']') this.advance();
			this.skipWhitespace();
		}

		// Consume closing >
		if (this.current() === '>') this.advance();

		return { type: 'doctype', name, publicId, systemId, internalSubset };
	}

	// -------------------------------------------------------------------------
	// Element
	// -------------------------------------------------------------------------

	private parseElement(): Element {
		this.expect('<');

		const qname = this.parseQName();
		this.skipWhitespace();

		// ── Collect raw attributes (before namespace resolution) ───────────────
		// We need to process xmlns declarations before resolving other namespaces,
		// so we do two passes over the attribute list.

		interface RawAttr {
			prefix: string | null;
			local: string;
			value: string;
		}

		const rawAttrs: RawAttr[] = [];
		const nsDecls = new Map<string, string>(); // prefix → URI, '' = default

		while (this.pos < this.src.length && this.current() !== '>' && !this.startsWith('/>')) {
			const ch = this.src.charCodeAt(this.pos);
			if (!isNameStartChar(ch)) {
				// Garbage character inside element tag — skip it tolerantly
				this.advance();
				continue;
			}

			const attrQName = this.parseQName();
			this.skipWhitespace();
			// Tolerate missing = sign
			if (this.current() === '=') {
				this.advance();
			}
			this.skipWhitespace();

			// Tolerate missing quotes — if no quote, read until whitespace/>//>
			const value = this.parseQuotedValueOrBare();
			this.skipWhitespace();

			// Detect namespace declarations
			if (attrQName.prefix === null && attrQName.local === 'xmlns') {
				nsDecls.set('', value);
			} else if (attrQName.prefix === 'xmlns') {
				nsDecls.set(attrQName.local, value);
			}

			rawAttrs.push({ prefix: attrQName.prefix, local: attrQName.local, value });
		}

		// ── Push namespace scope ───────────────────────────────────────────────
		this.nsStack.push(nsDecls);

		// ── Resolve element namespace ──────────────────────────────────────────
		const elemNS = this.resolveNS(qname.prefix, true);

		// ── Resolve attribute namespaces ───────────────────────────────────────
		const attributes: Attribute[] = rawAttrs.map((raw): Attribute => {
			let ns: string | null;
			if (raw.prefix === null && raw.local === 'xmlns') {
				ns = XMLNS_NS;
			} else if (raw.prefix === 'xmlns') {
				ns = XMLNS_NS;
			} else if (raw.prefix !== null) {
				ns = this.resolveNS(raw.prefix, false);
			} else {
				ns = null; // unprefixed attributes have no namespace
			}
			return { name: raw.local, prefix: raw.prefix, namespace: ns, value: raw.value };
		});

		// ── Handle self-closing vs content ─────────────────────────────────────
		let selfClosing = false;
		if (this.startsWith('/>')) {
			this.advanceBy(2);
			selfClosing = true;
		} else if (this.current() === '>') {
			this.advance();
		} else {
			// Malformed — treat as self-closing and try to recover
			selfClosing = true;
		}

		const children: ChildNode[] = [];

		if (!selfClosing) {
			this.parseChildren(children, qname);
		}

		// ── Pop namespace scope ────────────────────────────────────────────────
		this.nsStack.pop();

		return {
			type: 'element',
			name: qname.local,
			prefix: qname.prefix,
			namespace: elemNS,
			attributes,
			children,
		};
	}

	private parseChildren(into: ChildNode[], parent: QName): void {
		while (this.pos < this.src.length) {
			if (this.startsWith('</')) {
				// Closing tag
				this.advanceBy(2);
				const closeQName = this.tryParseQName();
				this.skipWhitespace();
				if (this.current() === '>') this.advance();

				// Tolerant: accept mismatched closing tags (just stop parsing children)
				if (closeQName === null || closeQName.local !== parent.local || closeQName.prefix !== parent.prefix) {
					// Rewind if the tag was for a parent — we handle mismatches by
					// simply returning so the parent's loop can consume the tag.
					// Because we already consumed it, we just return.
				}
				return;
			}

			if (this.startsWith('<![CDATA[')) {
				into.push(this.parseCData());
			} else if (this.startsWith('<!--')) {
				into.push(this.parseComment());
			} else if (this.startsWith('<?')) {
				into.push(this.parseProcessingInstruction());
			} else if (this.current() === '<') {
				// Peek ahead — could be a malformed '<' in text
				const nextCode = this.src.charCodeAt(this.pos + 1);
				if (isNameStartChar(nextCode) || nextCode === 0x3a /* : */ || nextCode === 0x5f /* _ */) {
					into.push(this.parseElement());
				} else {
					// Treat the stray '<' as text
					into.push(this.parseText());
				}
			} else {
				const text = this.parseText();
				if (text.value.length > 0) into.push(text);
			}
		}
		// End of input without closing tag — tolerated
	}

	// -------------------------------------------------------------------------
	// Leaf nodes
	// -------------------------------------------------------------------------

	private parseComment(): Comment {
		this.expect('<!--');
		const start = this.pos;
		const end = this.src.indexOf('-->', this.pos);
		if (end === -1) {
			// Unterminated comment — consume the rest
			const value = this.src.slice(start);
			this.pos = this.src.length;
			return { type: 'comment', value };
		}
		const value = this.src.slice(start, end);
		this.pos = end + 3;
		return { type: 'comment', value };
	}

	private parseCData(): CData {
		this.expect('<![CDATA[');
		const start = this.pos;
		const end = this.src.indexOf(']]>', this.pos);
		if (end === -1) {
			const value = this.src.slice(start);
			this.pos = this.src.length;
			return { type: 'cdata', value };
		}
		const value = this.src.slice(start, end);
		this.pos = end + 3;
		return { type: 'cdata', value };
	}

	private parseProcessingInstruction(): ProcessingInstruction {
		this.expect('<?');
		const target = this.tryParseName() ?? '_pi';
		let data = '';

		if (this.pos < this.src.length && isXmlWhitespace(this.src.charCodeAt(this.pos))) {
			this.skipWhitespace();
			const end = this.src.indexOf('?>', this.pos);
			if (end === -1) {
				data = this.src.slice(this.pos);
				this.pos = this.src.length;
			} else {
				data = this.src.slice(this.pos, end).trimEnd();
				this.pos = end + 2;
			}
		} else {
			// No data, just consume '?>'
			if (this.startsWith('?>')) this.advanceBy(2);
		}

		return { type: 'processing-instruction', target, data };
	}

	private parseText(): Text {
		const parts: string[] = [];

		while (this.pos < this.src.length && this.current() !== '<') {
			if (this.current() === '&') {
				parts.push(this.parseEntityRef());
			} else {
				// Fast-path: find the next special character
				const next = this.nextSpecialInText();
				if (next === -1) {
					parts.push(this.src.slice(this.pos));
					this.pos = this.src.length;
				} else {
					parts.push(this.src.slice(this.pos, next));
					this.pos = next;
				}
			}
		}

		return { type: 'text', value: parts.join('') };
	}

	/** Returns the position of the next `<` or `&` at or after `this.pos`. */
	private nextSpecialInText(): number {
		const lt = this.src.indexOf('<', this.pos);
		const amp = this.src.indexOf('&', this.pos);
		if (lt === -1 && amp === -1) return -1;
		if (lt === -1) return amp;
		if (amp === -1) return lt;
		return lt < amp ? lt : amp;
	}

	// -------------------------------------------------------------------------
	// Entity references
	// -------------------------------------------------------------------------

	private parseEntityRef(): string {
		this.advance(); // skip &

		if (this.current() === '#') {
			this.advance(); // skip #
			return this.parseCharRef();
		}

		const start = this.pos;
		while (this.pos < this.src.length && isNameChar(this.src.charCodeAt(this.pos))) {
			this.pos++;
		}
		const name = this.src.slice(start, this.pos);

		if (this.current() === ';') {
			this.advance();
		}
		// Tolerate missing semicolon

		const resolved = PREDEFINED_ENTITIES[name];
		if (resolved !== undefined) return resolved;

		// Bare & with no recognisable name (e.g. "& " in malformed content) — preserve literally
		if (name.length === 0) return '&';

		// Unknown named entity — return verbatim with & and ;
		return `&${name};`;
	}

	private parseCharRef(): string {
		let codePoint: number;

		if (this.current() === 'x' || this.current() === 'X') {
			this.advance();
			let hex = '';
			while (this.pos < this.src.length && isHexDigit(this.src.charCodeAt(this.pos))) {
				hex += this.src[this.pos++];
			}
			codePoint = hex.length > 0 ? parseInt(hex, 16) : 0xfffd;
		} else {
			let dec = '';
			while (this.pos < this.src.length && isDecimalDigit(this.src.charCodeAt(this.pos))) {
				dec += this.src[this.pos++];
			}
			codePoint = dec.length > 0 ? parseInt(dec, 10) : 0xfffd;
		}

		if (this.current() === ';') this.advance();

		// Guard against surrogates and invalid code points
		if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff) || codePoint === 0) {
			return '\ufffd';
		}
		return String.fromCodePoint(codePoint);
	}

	// -------------------------------------------------------------------------
	// Attribute value parsing
	// -------------------------------------------------------------------------

	private parseQuotedValue(): string {
		const ch = this.current();
		if (ch !== '"' && ch !== "'") {
			// No quote — tolerate and return empty string
			return '';
		}
		this.advance(); // opening quote
		const parts: string[] = [];

		while (this.pos < this.src.length && this.current() !== ch) {
			if (this.current() === '&') {
				parts.push(this.parseEntityRef());
			} else {
				const next = this.src.indexOf(ch, this.pos);
				const amp = this.src.indexOf('&', this.pos);
				let end: number;
				if (next === -1) {
					end = this.src.length;
				} else if (amp !== -1 && amp < next) {
					end = amp;
				} else {
					end = next;
				}
				parts.push(this.src.slice(this.pos, end));
				this.pos = end;
			}
		}

		if (this.pos < this.src.length) this.advance(); // closing quote
		return parts.join('');
	}

	/**
	 * Like `parseQuotedValue` but also handles unquoted attribute values
	 * (e.g. `attr=value` — common in broken HTML-as-XML).
	 */
	private parseQuotedValueOrBare(): string {
		const ch = this.current();
		if (ch === '"' || ch === "'") return this.parseQuotedValue();

		// Bare value — read until whitespace, >, or />
		const start = this.pos;
		while (this.pos < this.src.length && !isXmlWhitespace(this.src.charCodeAt(this.pos)) && this.current() !== '>' && !this.startsWith('/>')) {
			this.pos++;
		}
		return this.src.slice(start, this.pos);
	}

	// -------------------------------------------------------------------------
	// Name / QName parsing
	// -------------------------------------------------------------------------

	/**
	 * Parses an XML Name (may include `:` for QName tokenisation).
	 * Throws on invalid input.
	 */
	private parseName(): string {
		const start = this.pos;
		if (!isNameStartChar(this.src.charCodeAt(this.pos))) {
			throw this.error(`Expected XML name character, got ${JSON.stringify(this.current())}`);
		}
		while (this.pos < this.src.length && isNameChar(this.src.charCodeAt(this.pos))) {
			this.pos++;
		}
		return this.src.slice(start, this.pos);
	}

	/** Like `parseName` but returns `null` instead of throwing. */
	private tryParseName(): string | null {
		if (!isNameStartChar(this.src.charCodeAt(this.pos))) return null;
		const start = this.pos;
		while (this.pos < this.src.length && isNameChar(this.src.charCodeAt(this.pos))) {
			this.pos++;
		}
		return this.src.slice(start, this.pos);
	}

	/** Parses a qualified name and splits it on the first `:`. */
	private parseQName(): QName {
		const name = this.parseName();
		const colon = name.indexOf(':');
		if (colon !== -1) {
			return { prefix: name.slice(0, colon), local: name.slice(colon + 1) };
		}
		return { prefix: null, local: name };
	}

	/** Like `parseQName` but returns `null` instead of throwing. */
	private tryParseQName(): QName | null {
		const name = this.tryParseName();
		if (name === null) return null;
		const colon = name.indexOf(':');
		if (colon !== -1) {
			return { prefix: name.slice(0, colon), local: name.slice(colon + 1) };
		}
		return { prefix: null, local: name };
	}

	// -------------------------------------------------------------------------
	// Namespace resolution
	// -------------------------------------------------------------------------

	/**
	 * Resolves `prefix` against the current namespace scope stack.
	 *
	 * - `prefix === 'xml'`   → always `XML_NS`
	 * - `prefix === 'xmlns'` → always `XMLNS_NS`
	 * - `prefix === null` and `isElement` → default namespace (may be null)
	 * - `prefix === null` and `!isElement` → `null` (attrs have no default NS)
	 * - Unknown prefix → `null` (tolerant; spec says this is an error)
	 */
	private resolveNS(prefix: string | null, isElement: boolean): string | null {
		if (prefix === 'xml') return XML_NS;
		if (prefix === 'xmlns') return XMLNS_NS;

		const key = prefix ?? (isElement ? '' : null);
		if (key === null) return null;

		for (let i = this.nsStack.length - 1; i >= 0; i--) {
			const scope = this.nsStack[i];
			if (scope?.has(key)) {
				const uri = scope.get(key)!;
				return uri === '' ? null : uri; // empty URI = un-declare
			}
		}

		// Unknown prefix — tolerate by returning null
		return null;
	}

	// -------------------------------------------------------------------------
	// Low-level cursor helpers
	// -------------------------------------------------------------------------

	private current(): string {
		return this.src[this.pos] ?? '';
	}

	private advance(): void {
		this.pos++;
	}

	private advanceBy(n: number): void {
		this.pos += n;
	}

	private startsWith(str: string): boolean {
		return this.src.startsWith(str, this.pos);
	}

	private expect(str: string): void {
		if (!this.src.startsWith(str, this.pos)) {
			throw this.error(`Expected ${JSON.stringify(str)}, got ${JSON.stringify(this.src.slice(this.pos, this.pos + str.length))}`);
		}
		this.pos += str.length;
	}

	private skipWhitespace(): void {
		while (this.pos < this.src.length && isXmlWhitespace(this.src.charCodeAt(this.pos))) {
			this.pos++;
		}
	}

	/** Scans forward until the given character is found (useful for recovery). */
	private skipToNext(ch: string): void {
		const idx = this.src.indexOf(ch, this.pos);
		this.pos = idx === -1 ? this.src.length : idx;
	}

	/**
	 * Reads up to 8 ASCII uppercase characters to detect DOCTYPE keywords
	 * (PUBLIC / SYSTEM) without consuming them.
	 */
	private peekKeyword(): string {
		let s = '';
		for (let i = this.pos; i < this.src.length && i < this.pos + 8; i++) {
			const c = this.src.charCodeAt(i);
			if (c >= 0x41 && c <= 0x5a) s += String.fromCharCode(c);
			else if (c >= 0x61 && c <= 0x7a) s += String.fromCharCode(c - 32);
			else break;
		}
		return s;
	}

	// -------------------------------------------------------------------------
	// Error helper
	// -------------------------------------------------------------------------

	private error(message: string): ParseError {
		// Compute line/col lazily (only on error)
		let line = 1;
		let col = 1;
		for (let i = 0; i < this.pos && i < this.src.length; i++) {
			if (this.src.charCodeAt(i) === 0x0a) {
				line++;
				col = 1;
			} else {
				col++;
			}
		}
		return new ParseError(message, this.pos, line, col);
	}
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parses an XML string into a `Document` tree of plain JS objects.
 *
 * The parser is deliberately forgiving:
 * - Unknown entity references are preserved verbatim.
 * - Undeclared namespace prefixes resolve to `null`.
 * - Minor structural quirks (missing closing quotes, stray characters in
 *   element tags, unterminated comments) are recovered from where possible.
 *
 * @throws {ParseError} Only for unrecoverable structural failures such as a
 *   completely absent root element.
 */
export function parse(xml: string): Document {
	return new XmlParser(xml).parse();
}
