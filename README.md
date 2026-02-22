# @pipobscure/xml

A fully capable, forgiving XML parser for TypeScript and JavaScript. Produces plain JS objects that are JSON-serialisable, well-typed, and straightforward to traverse.

Designed for CalDAV, CardDAV, WebDAV, Atom, and similar document-oriented XML workloads where documents are small, real-world servers are quirky, and zero dependencies are preferred.

## Features

- Full namespace support (prefix resolution, default namespace, `xmlns=""` undeclaration)
- All XML node types: elements, text, CDATA, comments, processing instructions, DOCTYPE, XML declaration
- Tolerant parsing — recovers gracefully from many real-world quirks instead of throwing
- Plain-object output — every node is a simple JS object, safe to `JSON.stringify` and `JSON.parse`
- Discriminated union type hierarchy — narrow any node to its concrete type with `instanceof`-free type guards
- Tree query helpers — a small functional API for locating elements and reading text
- Serializer — converts any node back to an XML string
- Zero dependencies, pure TypeScript, ESM

## Installation

```sh
npm install @pipobscure/xml
```

## Quick start

```ts
import { parse, rootElement, child, attr, textContent, serialize } from '@pipobscure/xml';

const doc = parse(`<?xml version="1.0" encoding="utf-8"?>
  <D:propfind xmlns:D="DAV:">
    <D:prop>
      <D:displayname/>
      <D:getcontenttype/>
    </D:prop>
  </D:propfind>`);

const root = rootElement(doc);             // Element — <D:propfind>
const prop = child(root, 'prop', 'DAV:'); // Element — <D:prop>
console.log(prop?.children.length);       // 2

// Serialize back to XML
const xml = serialize(doc);
```

---

## API reference

### `parse(xml: string): Document`

Parses an XML string and returns a `Document` node. Never throws for malformed input — the parser is deliberately tolerant (see [Tolerance](#tolerance) below). It does throw `ParseError` for hard structural failures such as a completely empty input.

```ts
import { parse } from '@pipobscure/xml';

const doc = parse('<root attr="hello">world</root>');
// doc.type === 'document'
// doc.children[0].type === 'element'
```

### `class ParseError extends Error`

Thrown by `parse()` only for unrecoverable failures. Carries three extra properties:

| Property | Type | Description |
|---|---|---|
| `position` | `number` | Byte offset in the source string |
| `line` | `number` | 1-based line number |
| `column` | `number` | 1-based column number |

---

## Node types

Every node has a `type` discriminant. All nodes are plain JS objects with readonly properties.

### `Document`

The root container returned by `parse()`.

```ts
interface Document {
  readonly type: 'document';
  readonly children: ReadonlyArray<DocumentChild>;
}
```

`DocumentChild` is the union `XmlDeclaration | DocumentType | Element | Comment | ProcessingInstruction`.

### `Element`

```ts
interface Element {
  readonly type: 'element';
  readonly name: string;           // local name
  readonly prefix: string | null;  // namespace prefix, or null
  readonly namespace: string | null; // resolved namespace URI, or null
  readonly attributes: ReadonlyArray<Attribute>;
  readonly children: ReadonlyArray<ChildNode>;
}
```

`ChildNode` is the union `Element | Text | CData | Comment | ProcessingInstruction`.

### `Attribute`

```ts
interface Attribute {
  readonly name: string;           // local name
  readonly prefix: string | null;  // namespace prefix, or null
  readonly namespace: string | null; // resolved namespace URI, or null
  readonly value: string;          // decoded value
}
```

Namespace-declaration attributes (`xmlns`, `xmlns:prefix`) are included in the `attributes` array with their namespace resolved to `http://www.w3.org/2000/xmlns/`. Unprefixed attributes carry `namespace: null` — they do not inherit the element's default namespace, per the XML Namespaces specification.

### `Text`

```ts
interface Text {
  readonly type: 'text';
  readonly value: string; // decoded character content
}
```

### `CData`

```ts
interface CData {
  readonly type: 'cdata';
  readonly value: string; // raw CDATA content (between <![CDATA[ and ]]>)
}
```

### `Comment`

```ts
interface Comment {
  readonly type: 'comment';
  readonly value: string; // text between <!-- and -->
}
```

### `ProcessingInstruction`

```ts
interface ProcessingInstruction {
  readonly type: 'processing-instruction';
  readonly target: string; // PI target
  readonly data: string;   // everything after the target, leading whitespace stripped
}
```

### `XmlDeclaration`

```ts
interface XmlDeclaration {
  readonly type: 'xml-declaration';
  readonly version: string;
  readonly encoding: string | null;
  readonly standalone: boolean | null;
}
```

### `DocumentType`

```ts
interface DocumentType {
  readonly type: 'doctype';
  readonly name: string;
  readonly publicId: string | null;
  readonly systemId: string | null;
  readonly internalSubset: string | null; // verbatim, unparsed
}
```

### Union aliases

| Alias | Members |
|---|---|
| `ChildNode` | `Element \| Text \| CData \| Comment \| ProcessingInstruction` |
| `DocumentChild` | `XmlDeclaration \| DocumentType \| Element \| Comment \| ProcessingInstruction` |
| `AnyNode` | All eight concrete types |

---

## Type guards

Each node type has a corresponding type guard that doubles as a discriminating predicate:

```ts
import {
  isDocument, isElement, isText, isCData,
  isComment, isProcessingInstruction, isDocumentType, isXmlDeclaration,
} from '@pipobscure/xml';

for (const node of doc.children) {
  if (isElement(node)) {
    console.log(node.name, node.namespace);
  }
}
```

All guards have the signature `(node: Node) => node is T`.

---

## Tree query helpers

A small set of functions for navigating the document tree. All helpers are **tolerant**: they accept `null` and `undefined` and return the neutral value (`undefined`, `[]`, `""`, `0`) rather than throwing.

### `rootElement(doc)`

```ts
rootElement(doc: Document | null | undefined): Element | undefined
```

Returns the first element child of a `Document`, or `undefined`.

### `child(el, name, ns?)`

```ts
child(el: Element | null | undefined, name: string, ns?: string): Element | undefined
```

Returns the first direct child element with the given local name and (optionally) namespace URI.

### `requireChild(el, name, ns?)`

```ts
requireChild(el: Element | null | undefined, name: string, ns?: string): Element
```

Like `child`, but throws a descriptive `Error` when the element is not found. Useful for strict processing where a missing child is a hard failure.

### `children(el, name, ns?)`

```ts
children(el: Element | null | undefined, name: string, ns?: string): Element[]
```

Returns all direct child elements with the given local name and optional namespace URI.

### `childElements(el)`

```ts
childElements(el: Element | null | undefined): Element[]
```

Returns all direct child elements regardless of name or namespace.

### `childElementCount(el)`

```ts
childElementCount(el: Element | null | undefined): number
```

Returns the number of direct child elements.

### `descendant(node, name, ns?)`

```ts
descendant(
  node: Document | Element | null | undefined,
  name: string,
  ns?: string,
): Element | undefined
```

Returns the first element anywhere in the subtree with the given local name and optional namespace URI. Depth-first, pre-order.

### `descendants(node, name, ns?)`

```ts
descendants(
  node: Document | Element | null | undefined,
  name: string,
  ns?: string,
): Element[]
```

Returns all elements anywhere in the subtree with the given local name and optional namespace URI.

### `textContent(node)`

```ts
textContent(node: AnyNode | null | undefined): string
```

Concatenates all `Text` and `CData` content in the subtree, equivalent to the DOM's `element.textContent`. Returns `""` for node types that carry no text (comments, PIs, etc.).

### `attr(el, name, ns?)`

```ts
attr(el: Element | null | undefined, name: string, ns?: string): string | undefined
```

Returns the value of the attribute with the given local name and optional namespace URI, or `undefined` if not found.

### Example — CalDAV response

```ts
import { parse, rootElement, children, child, textContent, attr } from '@pipobscure/xml';

const doc = parse(calDavMultistatusXml);
const root = rootElement(doc);

for (const response of children(root, 'response', 'DAV:')) {
  const href   = textContent(child(response, 'href', 'DAV:'));
  const status = textContent(child(response, 'status', 'DAV:'));
  console.log(href, status);
}
```

---

## Serializer

### `serialize(node)`

```ts
serialize(node: AnyNode | null | undefined): string
```

Converts any node (or a complete `Document`) back to an XML string.

| Input type | Output |
|---|---|
| `Document` | All children concatenated |
| `Element` | `<tag attrs>…</tag>`, or `<tag attrs/>` when childless |
| `Text` | Character-escaped text (`&`, `<`, `>` → entities) |
| `CData` | `<![CDATA[…]]>`, splitting on embedded `]]>` |
| `Comment` | `<!--…-->` |
| `ProcessingInstruction` | `<?target data?>` |
| `XmlDeclaration` | `<?xml version="…" …?>` |
| `DocumentType` | `<!DOCTYPE …>` |
| `null` / `undefined` | `""` |

The serializer is tolerant of the same kind of incomplete objects as the query helpers — missing `children`, `attributes`, or `prefix` properties are treated as empty/absent rather than causing a throw.

**Round-trip guarantee.** For any valid XML document, `parse(serialize(parse(xml)))` produces a tree that is deeply equal to `parse(xml)`. Character content is re-escaped on serialize and re-decoded on re-parse, so the tree comparison holds even when the source used unescaped `>` or non-canonical entity forms.

**CDATA with `]]>`.** The sequence `]]>` inside a CDATA value is split across two adjacent CDATA sections so that the output remains well-formed. The text content is preserved exactly; only the tree structure changes (one `CData` node becomes two).

```ts
import { parse, serialize } from '@pipobscure/xml';

const doc  = parse('<root><![CDATA[<em>bold</em>]]></root>');
const xml  = serialize(doc);
// '<root><![CDATA[<em>bold</em>]]></root>'

const doc2 = parse(xml);
// deepEqual(doc2, doc) === true
```

---

## Tolerance

The parser is designed to handle the kind of non-conformant XML that real-world CalDAV and CardDAV servers emit. Specifically:

| Quirk | Behaviour |
|---|---|
| UTF-8 BOM | Silently skipped |
| No XML declaration | Parsed without error |
| Unknown named entities (`&nbsp;`) | Preserved verbatim (`&nbsp;`) |
| Bare `&` with no entity name | Emitted as `&` literally |
| Undeclared namespace prefix | Resolved to `null`; no throw |
| `--` inside a comment | Allowed |
| Attribute values with either quote style | Accepted |
| DOCTYPE internal subset | Captured verbatim, not validated |
| Mismatched closing tag | Tolerated |

The query helpers and serializer apply the same philosophy: missing or wrong-typed properties on nodes (e.g. a JSON-deserialised object missing its `children` array) are treated as absent or empty, never as fatal errors.

---

## JSON serialisation

All parse output is composed of plain objects and primitive values — no class instances, no `undefined` values, no circular references. A document tree can be safely round-tripped through `JSON.stringify` / `JSON.parse`:

```ts
const doc  = parse(xml);
const json = JSON.stringify(doc);
const doc2 = JSON.parse(json);

// Query helpers work on the revived object exactly as on the original:
const root = rootElement(doc2);
```

---

## License

[EUPL-1.2](LICENSE) — European Union Public Licence v. 1.2
