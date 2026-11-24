# JSON

A `.json` file opens with four view tabs: **Editor**, **Tree**, **JSONPath** and **Schema**,
and a **Compare with…** button in the toolbar.  
Every view reads the editor's current text, unsaved edits included.

## Editor

JSON highlighting, folding and bracket matching.  
The validator checks the text 300 ms after you stop typing:
a syntax error is underlined, marked in the gutter, and its message shows on hover.

Two toolbar buttons, shown in the Editor view, change the text:

- **Format** reformats the document with a 2-space indent.
- **Minify** strips every space and line break outside strings.

Both change the text in the editor and leave it unsaved; invalid JSON shows **Not valid JSON** in a toast instead,
with the error message, line and column.  
**Format JSON** in the Explorer or tab context menu reformats the file the same way, opening it first when needed,
and an invalid file shows the same **Not valid JSON** toast, with the line and column.

**Convert to YAML** in the toolbar, and **Convert JSON to YAML** in the Explorer or tab context menu,
open the document as YAML in a tab of its own, such as `data.json.converted.yaml`, which **Save** writes next to the JSON file;
see [YAML](Yaml.md#convert-json-to-yaml).

## Tree

The document as a collapsible tree, with every node open.

- Objects and arrays show `{` or `[` and a count, such as `3 keys` or `12 items`; click the `▾` twist to fold one.
- Object keys show in quotes and array items by index;
  strings, numbers, booleans and `null` take their own colours.
- `⊞` expands every node, `⊟` collapses them.
- Invalid JSON shows **Not valid JSON** with the error message, line and column.

The tree is read-only.

### Path bar

Click a key or a value to select it; the path bar above the tree shows its JSONPath.

- Array items carry their index, counted from 0, such as `$.orders[1].id` or `$.grid[1][0]`;
  the root is `$`, and a key that isn't a plain identifier goes in brackets, such as `$["first name"]`.
- **Any position** shows the same path with `[*]` for every index, such as `$.orders[*].id`,
  which matches that key in every item; it is greyed out when the two are the same.
- **Copy** puts the shown JSONPath on the clipboard and confirms with **JSONPath copied.**
- **Use in JSONPath** opens the [JSONPath](#jsonpath) view with the shown JSONPath as its expression.
- Show in tree, from a [JSONPath](#jsonpath) result or a [Schema](#schema) error, opens the tree on that node:
  selected, scrolled into view, flashed and shown in the path bar.
- Rows take focus with `Tab`, and `Enter` selects the focused row.

The same path bar, without **Use in JSONPath**, sits above the **As JSON** view of an XML file.

## Error messages

Outside the editor's underline, a JSON error names what the grammar expected and what it found,
at the exact line and column of the first character at fault,
such as `Expected ',' or '}' after the property value but found '"'. (line 3, column 3).`
for a missing comma before the third line's `"b": 2`.  
End of text reads as `end of input`, as in `Expected a value but found end of input.`  
Tree, Format, Minify and the JSON side of a diff tab all report errors this way.

## JSONPath

Type an expression and press `Enter` to run it.  
The box starts with `$`, and the expression runs as soon as the view opens.  
Expressions run with jsonpath-plus, whose filters run in its safe evaluator.

```text
$.orders[*].id
$..price
$.orders[?(@.total > 100)].customer
```

The status line under the box says `Enter to run` while the expression is edited,
then the count and the time it took, such as `12 matches · 3 ms` or `No matches · < 1 ms`.  
An empty box says `Type an expression, then press Enter to run it.`

### Result cards

Each match is a card:

- A header with its index, counted from `[0]`, its normalised path, such as `$['orders'][0]['id']`,
  a type badge, such as `object · 3 keys`, `array · 12 items`, `string`, `number`, `boolean` or `null`,
  and `↗` when the match is a node of the document.
- Its value below, with the Tree view's colours:
  objects and arrays pretty-printed with a 2-space indent, and strings, numbers, booleans and `null` on one line.
- A value over 24 lines shows its first 20 and **Show all n lines**, such as **Show all 312 lines**;
  **Show less** folds it again.
  Showing all draws at most 10,000 lines, and `Ctrl+C` on the card always takes the whole value.

Paths and values are plain text: select any part of them and press `Ctrl+C` to copy it.  
Double-click a card, press `Enter` on it or click its `↗` to switch to the [Tree](#tree) view,
where that node is selected, scrolled into view and flashed, and the path bar shows its JSONPath.  
A match that is not a node of the document, such as `$.orders.length`, has no `↗`.

### Results tools

Right of the status line:

- **Formatted** / **Compact** shows each value indented over several lines, or on one line;
  the choice applies to the XPath view too, and copying follows it.
- The copy icon copies every value as one JSON array, such as `[7, 8]`, and confirms with the number of matches.

The first 200 matches show, then **Show 200 more** adds the next 200, or as many as are left,
next to a count such as `200 of 1,240 shown`.

### Keyboard

- `Enter` in the box runs the expression, and `↓` moves to the first card.
- `↑`, `↓`, `Home` and `End` move between cards.
- `Enter` on a card shows it in the tree.
- `Ctrl+C` on a focused card copies its value as shown, with **Value copied.**, when no text is selected;
  with a selection, it copies the selection, as anywhere else.

### Errors

An invalid expression shows **Invalid JSONPath:** with the reason and its position,
such as `Invalid JSONPath: Unclosed '(' at character 11.`,
and the expression under the box with the part at fault marked.  
Unbalanced brackets, parentheses and quotes are found before jsonpath-plus runs;
for an error inside a filter, the filter `?(…)` is marked.  
Invalid JSON shows **Document is not valid JSON:** with the message, line and column.

### Help

`?` opens examples built from the document's own keys and values,
such as `$.orders[*].id` or `$.orders[?(@.customer == "Ada")]`, each of which matches something;
click one to run it.  
Below them, a short syntax list covers `$`, `.key` and `['key']`, indexes and slices, `*`, `..`, filters, `~` and `^`.

The expression, the layout and whether the help is open are kept when you switch views or files, until the studio tab closes.  
The box keeps its undo history with them, so `Ctrl+Z` and `Ctrl+Y` in it reach back past a trip to another view.

## Schema

The Schema view has three modes, **Validate**, **Generate** and **Sample**, switched at its top.  
**Validate** and **Sample** share one schema box.
Each file keeps its own mode, schema text, undo history and **Required only** while the studio tab is open,
across trips to other views and files: `Ctrl+Z` and `Ctrl+Y` in the box reach back past a trip to **Tree**.  
A file with no schema yet starts with the last schema used in any file, JSON or YAML,
so checking several files against one schema needs no second paste.
Its undo history starts there, so `Ctrl+Z` doesn't empty the box.
A box that has held a schema keeps its own text, even when emptied.

### Validate

Paste or type a JSON Schema into the box, and the document is checked against it as you type.  
The check runs 300 ms after the last key, at once on paste, and at once on `Ctrl+Enter`.

- `@cfworker/json-schema` checks the document against Draft 2020-12, with every error collected,
  and checks formats such as `email`, `date-time` and `uri`.
  It interprets the schema rather than generating code, which the extension's content security policy would block.
- Unknown keywords are allowed.
- A pass says how many keywords the schema has, such as `OK — 12 keywords checked.`
- A failure says how many errors, such as `3 errors`, and shows each as a card with its path,
  such as `$/orders/0/total`, its keyword as a badge, such as `type` or `required`, and its message,
  such as `Expected number, found string.` or `Missing required property "id".`
- Double-click a card, press `Enter` on it or click `↗` to show that node in the [Tree](#tree) view.
  A missing property points at the object that lacks it.
- Paths and messages are plain text to select and copy;
  `Ctrl+C` on a focused card with nothing selected copies its path and message, such as `$/age: Expected number, found string.`
- A schema that isn't valid JSON, isn't an object, `true` or `false`, or has a `$ref` that doesn't resolve shows why.
- An empty box says **Paste a JSON Schema to check this document against it.**,
  and an invalid document **Document is not valid JSON:** with the message, line and column.

Schemas are not loaded from files or URLs; `$ref` works only within the pasted schema.

### Generate

Infers a JSON Schema from the document and shows it formatted, with the same colours as the result cards.  
It is generated again whenever the view opens, so it follows edits made in the Editor.

- The schema is plain text: select it and press `Ctrl+C` to copy it.
- **Use to validate** puts it in the Validate box and switches to Validate, where the document passes it.
  A schema over 10,000 lines shows its first 10,000, and **Use to validate** still takes all of it.
- Invalid JSON shows **Document is not valid JSON:** with the message, line and column.

The rules:

- `$schema` is `https://json-schema.org/draft/2020-12/schema`, an identifier only; nothing is fetched.
- Every value gets its `type`; numbers are `integer` when every sample is whole, otherwise `number`.
- Objects list their `properties` in document order, and `required` names the keys every sample has,
  such as the keys every item of an array of objects has.
- An array's `items` merges every element of every sample;
  mixed plain types become a type array, such as `["string", "integer"]`,
  and objects or arrays mixed with other types become `anyOf`.
- `null` next to one other type becomes a type array, such as `["string", "null"]`.
- A string gets a `format` only when every sample fits it: `date-time`, `date`, `email`, `uri` (with `://`) or `uuid`.
- Empty arrays become `{"type": "array"}`, and empty objects `{"type": "object"}`.
- There is no `enum`, `additionalProperties` or `examples`.
- Every value is read; no array is sampled, and a 10 MB document takes well under a second.
  Values nested more than 100 levels deep get the empty schema `{}`, which accepts anything.

### Sample

Builds a sample JSON document that the schema in the box accepts, and shows it formatted,
with the same colours as **Generate**.  
The schema box is the one **Validate** uses, so a schema pasted in either mode shows in both.  
The sample is built again 300 ms after the last key, at once on paste, and at once on `Ctrl+Enter`.
It doesn't read the open document, so it works even when the document is not valid JSON.

- The sample is plain text: select it and press `Ctrl+C` to copy it.
- **Required only**, off at first, gives objects only their `required` properties.
- The status says **Passes the schema** when the validator accepts the sample,
  or how many keywords it misses, such as `1 keyword not satisfied`,
  with one muted note per keyword under the sample, such as "`pattern` at `$.code` not satisfied; edit the value".
- A schema that isn't valid JSON, isn't an object, `true` or `false`, or has a `$ref` that doesn't resolve shows why,
  as in **Validate**; the schema `false` says no value can match it.
- An empty box says **Paste a JSON Schema to build a sample document that passes it.**

The rules:

- `const` comes first, then the first of `examples`, then `default`, then the first of `enum`, each only when the schema accepts it.
  Otherwise the value is built from `type`.
- A type array takes its first type that isn't `null`; `null` only when nothing else is allowed.
  Without `type`, keywords such as `properties`, `items`, `pattern` or `minimum` imply one,
  and the empty schema `{}` or `true` gives `{}`.
- `$ref` follows references within the schema, such as `#/$defs/address`, `#/definitions/address` or `#/properties/name`.
  From 8 levels deep, objects keep only their required properties and arrays their `minItems`, so a recursive schema ends;
  a recursion the schema requires stops at 16 levels and is reported.
- `allOf` is merged; `anyOf` and `oneOf` take the first branch whose sample the schema accepts;
  `if` applies `then` when the sample satisfies it, and `else` when it doesn't; `not` is ignored.
- Objects list `properties` in schema order, all of them or, with **Required only**, the required ones.
  A required key missing from `properties` gets a value from `additionalProperties`, or a string.
  `minProperties` adds optional properties, then keys for `patternProperties`, then keys such as `property1`;
  `maxProperties` drops optional ones; `dependentRequired` and `dependentSchemas` apply to the keys present.
- Arrays take `prefixItems`, then `items`, `max(minItems, 1)` long, or as long as `prefixItems`, and no longer than `maxItems`.
  An array that says nothing about its items gets only its `minItems`.
  `uniqueItems` makes the items different, and `contains` with `minContains` is met.
- Strings with a `format` get a fixed value, such as `2024-01-01T12:00:00Z` for `date-time`, `2024-01-01` for `date`,
  `user@example.com` for `email`, `https://example.com` for `uri` and `url`,
  `123e4567-e89b-42d3-a456-426614174000` for `uuid`, `example.com` for `hostname`,
  `192.0.2.1` for `ipv4` and `2001:db8::1` for `ipv6`.
  Other strings are `string`, cut or repeated to fit `minLength` and `maxLength`.
- A `pattern` gets a match built from its literal text, classes such as `[A-Z]` or `\d`, groups and quantifiers,
  such as `AAA-0000` for `^[A-Z]{3}-\d{4}$`; lookarounds and back-references aren't built,
  so such a pattern is reported unless a simple word happens to match.
- Numbers prefer `0`, else the nearest value that `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum` and `multipleOf` allow.
  `boolean` gives `true`, and `null` gives `null`.
- The same schema always gives the same sample.
- Every sample is checked with the validator **Validate** uses, and each keyword it still misses is listed;
  a sample is never shown as passing when it doesn't.

## Compare with…

A structural comparison of two JSON documents in a new diff tab, with sorted keys and array rules.  
The button opens a chooser for the other side: an open tab, a workspace file, a file from disk, the clipboard or pasted text.  
See [Compare](Compare.md#json).

## Related

- YAML files are read as JSON data, with the same tree, JSONPath and Schema views, and convert to and from JSON;
  see [YAML](Yaml.md).
- XML files convert to JSON and have an XPath view; see [XML](Xml.md).
- `.jsonc` and `.json5` files carry the JSON icon but open as plain text, with the Editor view only.
  **Format JSON** in the context menus is offered for them too, and works when the text is plain JSON.
