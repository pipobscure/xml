/**
 * @pipobscure/xml — XML character classification
 *
 * All functions operate on numeric Unicode code points (from `charCodeAt`)
 * for maximum performance on the ASCII-heavy content typical of
 * CalDAV / CardDAV payloads.
 *
 * The ranges follow XML 1.0 (fifth edition) §2.2 and the XML Namespaces 1.0
 * specification. The parser itself is tolerant and will not reject documents
 * solely on character-class grounds, but these helpers are used to drive the
 * tokeniser for correct name recognition.
 */

/** XML whitespace: space, tab, carriage-return, newline. */
export function isXmlWhitespace(code: number): boolean {
	return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

/**
 * Valid XML NameStartChar (includes `:` so that QNames can be lexed as a
 * single token and split on `:` afterwards).
 *
 * XML 1.0 §2.3 production [4]
 */
export function isNameStartChar(code: number): boolean {
	if (code < 0x41) return code === 0x3a || code === 0x5f; // : or _
	if (code <= 0x5a) return true; // A-Z
	if (code < 0x61) return false;
	if (code <= 0x7a) return true; // a-z
	if (code < 0xc0) return false;
	if (code <= 0xd6) return true;
	if (code < 0xd8) return false;
	if (code <= 0xf6) return true;
	if (code < 0xf8) return false;
	if (code <= 0x2ff) return true;
	if (code < 0x370) return false;
	if (code <= 0x37d) return true;
	if (code < 0x37f) return false;
	if (code <= 0x1fff) return true;
	if (code === 0x200c || code === 0x200d) return true;
	if (code < 0x2070) return false;
	if (code <= 0x218f) return true;
	if (code < 0x2c00) return false;
	if (code <= 0x2fef) return true;
	if (code < 0x3001) return false;
	if (code <= 0xd7ff) return true;
	if (code < 0xf900) return false;
	if (code <= 0xfdcf) return true;
	if (code < 0xfdf0) return false;
	if (code <= 0xfffd) return true;
	if (code < 0x10000) return false;
	return code <= 0xeffff;
}

/**
 * Valid XML NameChar (superset of NameStartChar).
 *
 * XML 1.0 §2.3 production [4a]
 */
export function isNameChar(code: number): boolean {
	if (isNameStartChar(code)) return true;
	if (code === 0x2d || code === 0x2e) return true; // - or .
	if (code >= 0x30 && code <= 0x39) return true; // 0-9
	if (code === 0xb7) return true;
	if (code >= 0x0300 && code <= 0x036f) return true;
	if (code >= 0x203f && code <= 0x2040) return true;
	return false;
}

/** ASCII hex digit [0-9A-Fa-f]. */
export function isHexDigit(code: number): boolean {
	return (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x46) || (code >= 0x61 && code <= 0x66);
}

/** ASCII decimal digit [0-9]. */
export function isDecimalDigit(code: number): boolean {
	return code >= 0x30 && code <= 0x39;
}
