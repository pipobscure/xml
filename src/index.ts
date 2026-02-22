/**
 * @pipobscure/xml
 *
 * A fully capable, forgiving XML parser that produces plain JS objects
 * suitable for JSON serialisation and TypeScript consumption.
 *
 * Quick start
 * ───────────
 * ```ts
 * import { parse } from '@pipobscure/xml';
 *
 * const doc = parse(`<?xml version="1.0"?>
 *   <cal:calendar xmlns:cal="urn:ietf:params:xml:ns:caldav">
 *     <cal:displayname>My Calendar</cal:displayname>
 *   </cal:calendar>`);
 *
 * // doc.type === 'document'
 * // doc.children[0].type === 'xml-declaration'
 * // doc.children[1].type === 'element'
 * ```
 */

// Parser function and error class
export { parse, ParseError } from './parser.ts';

// All node types and type guards
export type {
	NodeType,
	Node,
	Attribute,
	XmlDeclaration,
	DocumentType,
	ProcessingInstruction,
	Comment,
	CData,
	Text,
	Element,
	Document,
	ChildNode,
	DocumentChild,
	AnyNode,
} from './types.ts';

export {
	isDocument,
	isElement,
	isText,
	isCData,
	isComment,
	isProcessingInstruction,
	isDocumentType,
	isXmlDeclaration,
} from './types.ts';

// Serializer
export { serialize } from './serialize.ts';

// Tree-query helpers
export {
	textContent,
	rootElement,
	child,
	requireChild,
	children,
	childElements,
	childElementCount,
	descendant,
	descendants,
	attr,
} from './query.ts';
