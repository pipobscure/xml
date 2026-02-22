/**
 * Test helpers — re-export from the library, with a stricter `rootElement`
 * that throws rather than returning `undefined` (tests always expect a root).
 */
import { rootElement as _rootElement, textContent, child, requireChild, children, childElements, childElementCount, descendant, descendants, attr } from '../src/query.ts';
import type { Document, Element } from '../src/types.ts';

export { textContent, child, requireChild, children, childElements, childElementCount, descendant, descendants, attr };

/** Returns the root element, throwing if absent. */
export function rootElement(doc: Document): Element {
	const el = _rootElement(doc);
	if (el === undefined) throw new Error('Document has no root element');
	return el;
}

// TreeNode alias used as a parameter type in a few test files
export type { AnyNode as TreeNode } from '../src/types.ts';
