/**
 * @pipobscure/xml — Tree-query helpers
 *
 * All functions are deliberately tolerant of incomplete / JSON-deserialized
 * objects. When a node was round-tripped through JSON.parse its arrays may
 * be missing entirely; every accessor below falls back gracefully rather than
 * throwing a TypeError.
 *
 * Tolerance contract
 * ──────────────────
 * • A missing `children` property is treated as an empty array.
 * • A missing `attributes` property is treated as an empty array.
 * • A missing or non-string `value` on a Text/CData node is treated as `""`.
 * • A `null` or `undefined` argument returns the neutral value for that
 *   function (`""`, `undefined`, `[]`, `0`).
 */

import { isElement, isText, isCData, isDocument } from './types.ts';
import type { AnyNode, Document, Element, Attribute, ChildNode, DocumentChild } from './types.ts';

// ---------------------------------------------------------------------------
// Internal defensive accessors
// ---------------------------------------------------------------------------

// Structural shapes used for defensive property access on JSON-deserialized
// objects where properties that are required by the type definitions may in
// practice be absent.
type MaybeHasChildren = { children?: readonly (ChildNode | DocumentChild)[] };
type MaybeHasAttributes = { attributes?: readonly Attribute[] };

/**
 * Returns the `children` array of an element or document, falling back to
 * `[]` when the property is absent (e.g. JSON-reconstructed objects).
 */
function childrenOf(node: Element | Document): readonly (ChildNode | DocumentChild)[] {
	return (node as unknown as MaybeHasChildren).children ?? [];
}

/**
 * Returns the `attributes` array of an element, falling back to `[]`.
 */
function attrsOf(el: Element): readonly Attribute[] {
	return (el as unknown as MaybeHasAttributes).attributes ?? [];
}

/**
 * Returns the string `value` of a Text or CData node, falling back to `""`.
 */
function nodeValue(node: { value?: string } | null | undefined): string {
	return node?.value ?? '';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Concatenated text content of a node — equivalent to the DOM's
 * `element.textContent`.
 *
 * - `Element` / `Document` → recurse into children, concatenating Text and
 *   CData nodes.
 * - `Text` / `CData` → the decoded value.
 * - All other node types (Comment, PI, Declaration, DOCTYPE) → `""`.
 * - `null` / `undefined` argument → `""`.
 */
export function textContent(node: AnyNode | null | undefined): string {
	if (node == null) return '';
	if (isText(node) || isCData(node)) return nodeValue(node);
	if (isElement(node)) {
		return (childrenOf(node) as readonly ChildNode[]).map((c) => textContent(c as AnyNode)).join('');
	}
	if (isDocument(node)) {
		return (childrenOf(node) as readonly DocumentChild[]).map((c) => textContent(c as AnyNode)).join('');
	}
	return '';
}

/**
 * The root element of a `Document`, or `undefined` if there is none.
 * Tolerant of a missing or empty `children` array.
 */
export function rootElement(doc: Document | null | undefined): Element | undefined {
	if (doc == null) return undefined;
	return (childrenOf(doc) as readonly DocumentChild[]).find(isElement);
}

/**
 * First direct child element of `el` whose local name is `name` and (if
 * provided) whose namespace URI is `ns`.
 * Returns `undefined` when not found or when `el` is null/undefined.
 */
export function child(el: Element | null | undefined, name: string, ns?: string): Element | undefined {
	if (el == null) return undefined;
	return (childrenOf(el) as readonly ChildNode[]).find((c): c is Element => isElement(c) && c.name === name && (ns === undefined || c.namespace === ns));
}

/**
 * Like {@link child} but throws a descriptive `Error` when not found.
 * Useful for strict processing where a missing element is a hard failure.
 */
export function requireChild(el: Element | null | undefined, name: string, ns?: string): Element {
	const found = child(el, name, ns);
	if (found === undefined) {
		const nsLabel = ns != null ? ` [${ns}]` : '';
		const parentName = el?.name ?? '(null)';
		throw new Error(`Missing required child <${name}>${nsLabel} in <${parentName}>`);
	}
	return found;
}

/**
 * All direct child elements of `el` with the given local name and optional
 * namespace URI. Returns `[]` when `el` is null/undefined or has no children.
 */
export function children(el: Element | null | undefined, name: string, ns?: string): Element[] {
	if (el == null) return [];
	return (childrenOf(el) as readonly ChildNode[]).filter((c): c is Element => isElement(c) && c.name === name && (ns === undefined || c.namespace === ns));
}

/**
 * All direct child elements of `el`, regardless of name or namespace.
 * Returns `[]` when `el` is null/undefined.
 */
export function childElements(el: Element | null | undefined): Element[] {
	if (el == null) return [];
	return (childrenOf(el) as readonly ChildNode[]).filter(isElement);
}

/**
 * Number of direct child elements of `el`.
 * Returns `0` when `el` is null/undefined.
 */
export function childElementCount(el: Element | null | undefined): number {
	return childElements(el).length;
}

/**
 * First element anywhere in the subtree of `node` whose local name is `name`
 * and (if provided) whose namespace URI is `ns`. Depth-first, pre-order.
 * Returns `undefined` when not found or when `node` is null/undefined.
 */
export function descendant(node: Document | Element | null | undefined, name: string, ns?: string): Element | undefined {
	if (node == null) return undefined;
	for (const item of childrenOf(node)) {
		if (isElement(item)) {
			if (item.name === name && (ns === undefined || item.namespace === ns)) return item;
			const found = descendant(item, name, ns);
			if (found !== undefined) return found;
		}
	}
	return undefined;
}

/**
 * All elements anywhere in the subtree of `node` whose local name is `name`
 * and (if provided) whose namespace URI is `ns`. Depth-first, pre-order.
 * Returns `[]` when `node` is null/undefined.
 */
export function descendants(node: Document | Element | null | undefined, name: string, ns?: string): Element[] {
	if (node == null) return [];
	const results: Element[] = [];
	for (const item of childrenOf(node)) {
		if (isElement(item)) {
			if (item.name === name && (ns === undefined || item.namespace === ns)) {
				results.push(item);
			}
			results.push(...descendants(item, name, ns));
		}
	}
	return results;
}

/**
 * The value of the attribute with local name `name` and (if provided)
 * namespace URI `ns`. Returns `undefined` when not found or when `el` is
 * null/undefined.
 */
export function attr(el: Element | null | undefined, name: string, ns?: string): string | undefined {
	if (el == null) return undefined;
	return attrsOf(el).find((a) => a.name === name && (ns === undefined || a.namespace === ns))?.value;
}
