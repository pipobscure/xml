/**
 * @pipobscure/xml — Type definitions
 *
 * All node types form a discriminated union hierarchy rooted at `Node`.
 * Every value is a plain JS object suitable for JSON serialisation.
 *
 *   Node
 *   ├── Document
 *   ├── Element
 *   ├── Text
 *   ├── CData
 *   ├── Comment
 *   ├── ProcessingInstruction
 *   ├── DocumentType
 *   └── XmlDeclaration
 */

// ---------------------------------------------------------------------------
// Discriminant
// ---------------------------------------------------------------------------

/** All legal values of `node.type`. */
export type NodeType = 'document' | 'element' | 'text' | 'cdata' | 'comment' | 'processing-instruction' | 'doctype' | 'xml-declaration';

// ---------------------------------------------------------------------------
// Base
// ---------------------------------------------------------------------------

/** Common root of every XML node. */
export interface Node {
	readonly type: NodeType;
}

// ---------------------------------------------------------------------------
// Attribute
// ---------------------------------------------------------------------------

/**
 * A single attribute on an element.
 *
 * Namespace-declaration attributes (`xmlns` / `xmlns:prefix`) are included
 * in the `attributes` array with their `namespace` resolved to the XML
 * Namespaces URI (`http://www.w3.org/2000/xmlns/`).
 *
 * Non-prefixed attributes that are not namespace declarations carry
 * `prefix: null` and `namespace: null` — per the XML Namespaces spec,
 * unprefixed attributes do *not* inherit the element's default namespace.
 */
export interface Attribute {
	/** Local name (the part after the colon, or the whole name if no prefix). */
	readonly name: string;
	/** Namespace prefix, or `null` when absent. */
	readonly prefix: string | null;
	/**
	 * Resolved namespace URI, or `null` when there is none.
	 * Always `http://www.w3.org/2000/xmlns/` for `xmlns`/`xmlns:*` attrs.
	 */
	readonly namespace: string | null;
	/** Decoded attribute value (entity references have been expanded). */
	readonly value: string;
}

// ---------------------------------------------------------------------------
// Concrete node types
// ---------------------------------------------------------------------------

/**
 * The XML declaration: `<?xml version="1.0" encoding="UTF-8"?>`.
 * Appears at most once, as the first child of a `Document`.
 */
export interface XmlDeclaration extends Node {
	readonly type: 'xml-declaration';
	/** XML version string, typically `"1.0"`. */
	readonly version: string;
	/** Declared character encoding, e.g. `"UTF-8"`, or `null` if absent. */
	readonly encoding: string | null;
	/** Standalone declaration, or `null` if absent. */
	readonly standalone: boolean | null;
}

/**
 * A document type declaration: `<!DOCTYPE …>`.
 * The internal subset (if any) is captured verbatim but not parsed further.
 */
export interface DocumentType extends Node {
	readonly type: 'doctype';
	/** The root element name declared by the DOCTYPE. */
	readonly name: string;
	/** Public identifier, or `null` if absent. */
	readonly publicId: string | null;
	/** System identifier (URI), or `null` if absent. */
	readonly systemId: string | null;
	/** Raw text of the internal subset (between `[` and `]`), or `null`. */
	readonly internalSubset: string | null;
}

/**
 * A processing instruction: `<?target data?>`.
 * The XML declaration is *not* represented as a PI; it uses `XmlDeclaration`.
 */
export interface ProcessingInstruction extends Node {
	readonly type: 'processing-instruction';
	/** PI target identifier. */
	readonly target: string;
	/** Everything after the target (leading whitespace stripped), may be `""`. */
	readonly data: string;
}

/** An XML comment: `<!-- … -->`. */
export interface Comment extends Node {
	readonly type: 'comment';
	/** Comment text (the content between `<!--` and `-->`). */
	readonly value: string;
}

/** A CDATA section: `<![CDATA[ … ]]>`. */
export interface CData extends Node {
	readonly type: 'cdata';
	/** Raw CDATA content (the text between `<![CDATA[` and `]]>`). */
	readonly value: string;
}

/** A run of character data (text) between element tags. */
export interface Text extends Node {
	readonly type: 'text';
	/** Decoded text content (entity references have been expanded). */
	readonly value: string;
}

/**
 * An XML element node: `<prefix:name attr="val">…</prefix:name>`.
 *
 * Namespace resolution is performed eagerly at parse time:
 * - `namespace` is the resolved URI of the element's own namespace.
 * - Each `Attribute` carries its own resolved `namespace`.
 */
export interface Element extends Node {
	readonly type: 'element';
	/** Local name — the part of the tag name after the colon. */
	readonly name: string;
	/** Namespace prefix, or `null` when there is no prefix. */
	readonly prefix: string | null;
	/** Resolved namespace URI for this element, or `null` if none. */
	readonly namespace: string | null;
	/**
	 * All attributes in document order, including namespace declarations.
	 * Duplicate attribute names (invalid XML) are preserved as-is.
	 */
	readonly attributes: ReadonlyArray<Attribute>;
	/** Child nodes in document order. */
	readonly children: ReadonlyArray<ChildNode>;
}

// ---------------------------------------------------------------------------
// Union aliases used in the tree
// ---------------------------------------------------------------------------

/** All node types that may appear as children of an `Element`. */
export type ChildNode = Element | Text | CData | Comment | ProcessingInstruction;

/** All node types that may appear as direct children of a `Document`. */
export type DocumentChild = XmlDeclaration | DocumentType | Element | Comment | ProcessingInstruction;

/** The root document node. Contains everything in the source document. */
export interface Document extends Node {
	readonly type: 'document';
	/** Top-level nodes in document order. */
	readonly children: ReadonlyArray<DocumentChild>;
}

/** Union of every possible XML node type. */
export type AnyNode = Document | Element | Text | CData | Comment | ProcessingInstruction | DocumentType | XmlDeclaration;

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isDocument(node: Node): node is Document {
	return node.type === 'document';
}

export function isElement(node: Node): node is Element {
	return node.type === 'element';
}

export function isText(node: Node): node is Text {
	return node.type === 'text';
}

export function isCData(node: Node): node is CData {
	return node.type === 'cdata';
}

export function isComment(node: Node): node is Comment {
	return node.type === 'comment';
}

export function isProcessingInstruction(node: Node): node is ProcessingInstruction {
	return node.type === 'processing-instruction';
}

export function isDocumentType(node: Node): node is DocumentType {
	return node.type === 'doctype';
}

export function isXmlDeclaration(node: Node): node is XmlDeclaration {
	return node.type === 'xml-declaration';
}
