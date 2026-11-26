# YAML

`.yaml` and `.yml` files open with four view tabs: **Editor**, **Tree**, **JSONPath** and **Schema**,
and **Copy raw**, **Copy formatted** and **Compare with…** buttons in the toolbar.  
Every view reads the editor's current text, unsaved edits included.  
In every view, **Copy raw** copies that text as it is, and **Copy formatted** copies the document as [Format](#format) lays it out;
invalid YAML copies nothing from **Copy formatted**, and the toast says why.
See [Copy](Editor.md#copy).  
Parsing uses the `yaml` package, as YAML 1.2,
or as YAML 1.1 for a document that starts with `%YAML 1.1`.  
Every view but **Editor** reads the YAML as JSON data, by the [conversion rules](#conversion-rules),
so the tree, queries, schemas and diffs work on the same values a YAML reader gets.

## Editor

YAML highlighting, folding of maps, lists and blocks, and bracket matching in flow collections.  
The validator checks the text 300 ms after you stop typing:

- A syntax error is underlined, marked in the gutter with a dot in the error colour,
  and its message shows on hover with its line and column,
  such as `Tabs are not allowed as indentation (line 4, column 1).`
- A warning is marked the same way in the warning colour.
  Warnings are what YAML allows but a reader may not expect:
  a repeated key, such as `The key debug is repeated; the last value wins (line 10, column 1).`,
  and a tag Nib Studio doesn't know, such as `Unresolved tag: !Ref`, whose value is read as if it had no tag.
- An alias with no anchor of its name before it is an error, such as `No anchor &base comes before this alias`,
  and so are aliases that expand an anchor too far; see [Aliases](#aliases).

Two toolbar buttons, shown in the Editor view, change the text:

- **Format** lays the document out again with a 2-space indent; see [Format](#format).
- **Convert to JSON** replaces the editor's text with the JSON conversion, with a 2-space indent, unsaved,
  as XML's does.
  **Save** then writes JSON into the `.yaml` file; close the tab without saving to keep the YAML.

Both leave the change unsaved, as one undo step;
invalid YAML shows **Not valid YAML** in a toast instead, with the parser message, line and column.

## Format

**Format** in the toolbar, or **Format YAML** in the Explorer or tab context menu,
reformats the document with a 2-space indent and leaves it unsaved.  
The context-menu command opens the file first when needed.

- Comments stay, on their own lines and at the end of lines, with one space before the `#`.
- Every document stays, with its `---` and `...` markers and its directives, such as `%YAML 1.1`.
- Anchors, aliases, merge keys and tags stay as written, such as `&defaults`, `*defaults`, `<<: *defaults` and `!!binary`.
- Quotes stay as written, and so does the way numbers are written, such as `0x1F`, `1e3` or `1.50`.
- Literal blocks `|` keep their lines, and folded blocks `>` and `>-` keep their line breaks where they were.
- Sequences under a key are indented, as `key:` then `  - item`,
  and flow collections get a space inside their brackets, such as `[ a, b ]` and `{ a: 1 }`.
- Long lines are never folded, and keys are never sorted.
- Blank lines between top-level entries stay.
- A text with comments alone, and no document, is left as it is.

The formatted text always holds the same data as before.  
A repeated key is only a warning, so it doesn't stop **Format**; a syntax error does, with a toast.

## Tree

The data as the [JSON tree](Json.md#tree): collapsible, read-only, with every node open.

- Objects and arrays show `{` or `[` and a count, such as `3 keys` or `12 items`; click the `▾` twist to fold one.
- `⊞` expands every node, `⊟` collapses them.
- Anchors and aliases are resolved, so an alias shows the value it stands for, and merge keys are merged.
- Invalid YAML shows **Not valid YAML** with the parser message, line and column.

### Several documents

A file with several documents, separated by `---`, shows each as a top-level item,
**Document 1**, **Document 2** and so on.  
Their paths are those of an array, `$[0]`, `$[1]` and so on, as the documents are an array when converted to JSON,
so a path from the tree works in the [JSONPath](#jsonpath) view.  
A file with one document shows its value, with no **Document** item.

### Path bar

Click a key or a value to select it; the path bar above the tree shows its JSONPath, such as `$.server.port` or `$[1].kind`.  
YAML has no path syntax of its own, so the path is the JSONPath of the data.  
**Any position**, **Copy** and **Use in JSONPath** work as for JSON; see [JSON](Json.md#path-bar).

## JSONPath

The [JSONPath view](Json.md#jsonpath), run on the data:
the same box, status line, result cards, tools, keyboard and help.  
Show in tree, from a card, opens the YAML's [Tree](#tree) on that node.  
Invalid YAML shows **Document is not valid YAML:** with the parser message, line and column.

## Schema

The [Schema view](Json.md#schema) on the data, as config files are often checked:

- **Validate** checks the YAML against a pasted JSON Schema as you type,
  and each error points at its node in the YAML's tree.
- **Generate** infers a JSON Schema from the data.
- **Sample** builds a sample document from the schema in the box, written as JSON, which is also valid YAML.
- A file with no schema yet starts with the last schema used in any file, JSON or YAML.

Invalid YAML shows **Document is not valid YAML:** with the parser message, line and column.

## Conversion rules

How every view but **Editor**, **Convert to JSON** and the diff read YAML as JSON:

| YAML | JSON |
| --- | --- |
| One document | its value |
| Several documents, separated by `---` | an array, one item per document |
| No document, such as an empty file or comments alone | `null` |
| Maps, lists, strings, numbers, `true`, `false` and `null` | the same JSON values |
| Anchors `&name` and aliases `*name` | resolved: each alias becomes a copy of the anchored value |
| Merge keys `<<: *name` | merged into the map; a key written in the map wins over a merged one |
| Timestamps, such as `2024-01-15` or `!!timestamp 2001-12-14t21:59:43.10-05:00` | strings, as written |
| Keys that are numbers or booleans, such as `1` or `true` | strings, as written, such as `"1"` or `"0x1F"` |
| A `null` key, `null` or `~` | `"null"` |
| Keys that are lists or maps, such as `[a, b]` | their YAML text, such as `"[ a, b ]"` |
| `!!binary` | a Base64 string |
| `.inf`, `-.inf` and `.nan` | the strings `"Infinity"`, `"-Infinity"` and `"NaN"`, which JSON has no numbers for |
| `!!set` | an array of its members |
| `!!omap` and `!!pairs` | an object, and an array of one-key objects |
| A repeated key | the last value |
| A tag Nib Studio doesn't know, such as `!Ref` | dropped; the value converts as if it had no tag |
| Comments | dropped |

Integers beyond `2^53` lose precision, as they do in JSON.

### Aliases

An alias copies its anchor, so a few lines of aliases that refer to other aliases can expand to billions of values,
an attack known as an alias bomb or "billion laughs".  
Reading stops once aliases expand an anchor to more than 1,000 copies, counting copies made through nested aliases,
with `Too many aliases: they expand an anchor to more than 1,000 copies` and the line and column of the first alias.  
Ordinary reuse stays well under it: an anchor used a few hundred times reads fine.  
An alias inside its own anchor, such as `loop: &loop [1, *loop]`, makes a cycle JSON can't hold, and is refused too.

## Convert YAML to JSON

**Convert YAML to JSON** in the Explorer or tab context menu leaves the YAML file alone.  
It converts the file as saved on disk, without unsaved edits,
and opens the JSON, with a 2-space indent, in a new tab named after the file, such as `app.yaml.converted.json`, in the Editor view.  
That tab exists only in the studio until you save it, so it opens unsaved, with **Save**;
**Save** writes it next to the YAML file, with the line endings of the YAML file.  
Converting again replaces that tab's text.  
Invalid YAML shows **Not valid YAML** in a toast with the parser message, line and column.  
The command is left out for a file opened from outside the workspace, which has no folder to save next to.

## Convert JSON to YAML

A `.json` file converts the other way, into one YAML document with a 2-space indent:

- **Convert JSON to YAML** in the Explorer or tab context menu converts the file as saved on disk.
- **Convert to YAML** in the toolbar of the JSON Editor view converts the editor's text, unsaved edits included.

Both open the YAML in a new tab named after the file, such as `data.json.converted.yaml`, unsaved until
**Save** writes it next to the JSON file; converting again replaces that tab's text.  
Strings that a YAML reader would take for another type stay quoted, such as `"yes"`, `"1"` or `"2024-01-15"`,
so older YAML 1.1 tools read the same data, and strings with line breaks become `|` blocks.  
Invalid JSON shows **Not valid JSON** in a toast with the message, line and column.  
Both are left out for a file opened from outside the workspace.

## Compare with…

A structural comparison of the data two YAML documents hold, in a new diff tab,
with the JSON diff's aligned grid, sorted keys, array rules, change kinds and exports.  
Comments, indentation, quotes and block or flow style never count; only the data does.  
The button opens a chooser for the other side: an open tab, a workspace file, a file from disk, the clipboard or pasted text.  
**Compare YAML** under **New compare** compares two pasted texts.  
See [Compare](Compare.md#yaml).

## Related

- JSON files have the same tree, JSONPath and Schema views; see [JSON](Json.md).
- XML files convert to JSON in the same way, with an As JSON view; see [XML](Xml.md).
