# XML

`.xml`, `.xsd`, `.xsl`, `.xslt` and `.config` files open with four view tabs: **Editor**, **Tree**, **XPath** and **As JSON**,
and **Copy raw**, **Copy formatted** and **Compare with…** buttons in the toolbar.  
Every view reads the editor's current text, unsaved edits included.  
In every view, **Copy raw** copies that text as it is, and **Copy formatted** copies the document indented;
invalid XML copies nothing from **Copy formatted**, and the toast says why.
See [Copy](Editor.md#copy).  
Parsing uses a parser written for Nib Studio, not the browser's `DOMParser`, so error messages carry a line and column.

## Editor

Plain text, without XML highlighting, plus one toolbar button:

- **Convert to JSON** replaces the editor's text with the JSON conversion, unsaved.
  **Save** then writes JSON into the `.xml` file; close the tab without saving to keep the XML.

Invalid XML shows the parser message with line and column in a toast.

## Tree

Elements as a collapsible tree, with every element open.

- Each row shows `<name`, its attributes as `@name="value"`, and then `>` with its trimmed text and closing tag,
  or `/>` when the element has neither children nor text.
- An element with children has a `▾` twist to fold it, and shows its own text on a row after the children.
- `⊞` expands every node, `⊟` collapses them.
- Invalid XML shows **Not valid XML** with the parser message, line and column.

The tree is read-only.

### Path bar

Click an element, an attribute or a text to select it; the path bar above the tree shows its XPath.

- An element that has same-name siblings carries its position, counted from 1, and one without them carries none,
  such as `/orders/order[2]/@id` or `/orders/order[2]/item/text()`.
- **Any position** shows the same path without positions, such as `/orders/order/@id`,
  which matches that node under every repeated parent; it is greyed out when the two are the same.
- **Copy** puts the shown XPath on the clipboard and confirms with **XPath copied.**
- **Use in XPath** opens the [XPath](#xpath) view with the shown XPath as its expression.
- Rows take focus with `Tab`, and `Enter` selects the focused row.

## XPath

Type an expression and press `Enter` to run it.  
The box starts with `/*`, the root element, and the expression runs as soon as the view opens.

```text
//order/@id
/orders/order[2]/item
//item[@sku='A-1']/price/text()
//order[contains(@status, 'ship') and @id]
```

The view works like the [JSONPath view](Json.md#jsonpath), with the same status line, cards, tools and keyboard:

- The status line under the box says `Enter to run` while the expression is edited,
  then the count and the time it took, such as `3 matches · 1 ms`.
- Each match is a card with its index, counted from `[1]`, its exact XPath, such as `/orders/order[2]/@id`,
  a type badge, such as `element · 3 children`, `element`, `attribute` or `text`, and `↗`.
- Its value below:
  an element as indented, coloured XML of that element, with its attributes, text and children;
  an attribute as `name="value"`; a text as the text, trimmed.
  `/` shows the root element.
- A value over 24 lines shows its first 20 and **Show all n lines**.
- The XPath and the value are plain text: select any part and press `Ctrl+C` to copy it.
  `Ctrl+C` on a focused card with nothing selected copies its value as shown, with **Value copied.**
- Double-click a card, press `Enter` on it or click its `↗` to switch to the Tree view,
  where that node is selected, scrolled into view and flashed, and the path bar shows its XPath.
  A whitespace-only text shows its element.
- **Formatted** / **Compact** puts each element on one line; the choice applies to the JSONPath view too.
- The copy icon copies every match, one per block: elements as XML, attributes and text as their plain values.
- The first 200 matches show, then **Show 200 more**, or as many as are left.
- `?` opens examples built from the document's own element names, attributes and text,
  such as `//order[@id='A-1']` or `//order[customer='Ada']`, each of which matches something;
  click one to run it.
  Below them, a short syntax list covers the subset described below.
- An expression that doesn't parse says why and where, such as `Invalid XPath: Expected ']' at character 16.`,
  and marks that place in the expression under the box.
- Invalid XML shows **Document is not valid XML:** with the parser message, line and column.

An element's own text shows before its children, as the parser keeps it in one piece;
its place among mixed content is not kept.  
Element output escapes `&`, `<`, `>` and quotes, so it is XML again.

The expression is kept when you switch views or files, until the studio tab closes, with the box's undo history.  
The expression language is an XPath subset:
`/`, `//`, element names, `*`, `.`, `..`, `@name`, `@*` and `text()` as steps,
and as predicates positions such as `[2]`, `[-1]` and `[last()]`, `[@id]`, `[@id='2']`, `[name='x']`,
`contains()`, `starts-with()`, `local-name()`, `and` and `or`.  
A position counts among the matching siblings under each parent, so `//item[1]` is the first item of every parent.  
Namespace prefixes are part of the names.  
Other functions, such as `count()`, unions with `|`, named axes such as `following-sibling::`,
and comparisons other than `=` are not supported.

## As JSON

The document converted to JSON, shown as a read-only [JSON tree](Json.md#tree) and marked **converted from XML**.  
Clicking a node shows its JSONPath in the path bar, for the converted document.  
Invalid XML shows **Not valid XML** with the parser message, line and column.  
**Save** is disabled in this view.

## Conversion rules

| XML | JSON |
| --- | --- |
| `<order id="7">` | `{ "order": { "@id": "7" } }` |
| Element text | the `#text` key, or the value itself when the element has only text |
| Empty element without attributes | `null` |
| Repeated sibling elements | an array |
| Comments | dropped |
| Namespace prefixes | kept in the names |

Values stay strings; `"42"` doesn't become a number.  
Text is trimmed, and text that is only whitespace is dropped.  
Order between sibling elements of different names, and the position of text in mixed content, are not kept.

## Convert XML to JSON

**Convert XML to JSON** in the Explorer or tab context menu leaves the XML file alone.  
It converts the file as saved on disk, without unsaved edits,
and opens the JSON in a new tab named after the file, such as `orders.xml.converted.json`, in the Editor view.  
That tab exists only in the studio until you save it, so it opens unsaved, with **Save**;
**Save** writes it next to the XML file.  
Converting again replaces that tab's text.  
Invalid XML shows **Not valid XML** in a toast with the parser message, line and column.  
The command is left out for a file opened from outside the workspace, which has no folder to save next to.

## Compare with…

A structural XML comparison in a new diff tab, with element rules and options for whitespace-only text, trimming, namespace prefixes and case.  
The button opens a chooser for the other side: an open tab, a workspace file, a file from disk, the clipboard or pasted text.  
In the grid, elements keep their document order unless **Sort by name** is on.  
**Compare XML with…** in the Explorer or tab context menu opens it and asks for the other file on disk.  
See [Compare](Compare.md#xml).

## Paths in the diff

The diff names each change by its element path, such as `order/lines/line[1]/qty`, `order/@id` or `order/note/text()`;
hover the position in the diff bar to see the current one.  
A repeated element carries its position, counted from 0, or its element rule's match key, such as `item[@id=5]`.  
These paths name changes and are not XPath; to query a document, use the [XPath](#xpath) view.
