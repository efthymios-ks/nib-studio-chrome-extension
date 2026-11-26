# Compare

Every compare opens in its own **diff tab**, the way VS Code does it.  
The file's own tab never turns into a diff,
so you can keep editing it while the diff tab shows the comparison.

The diff picks its engine from the type of the files being compared:

| Files | Engine |
| --- | --- |
| JSON | structural JSON diff, with array rules |
| YAML | structural YAML diff: the JSON diff on the data the YAML holds |
| XML | structural XML diff, with element rules |
| Markdown | rendered document diff |
| CSV, TSV and workbooks, such as XLSX, XLS and ODS | row diff keyed by columns |
| Any other text | line diff, with compare rules |

Clipboard and pasted text take the engine of the file they are compared with;
two texts without a file get the line diff.  
A new compare uses the kind you pick for it;
see [On-the-fly compare](#on-the-fly-compare).

## Diff tabs

A diff tab is titled `left ↔ right` with the two names,
such as `orders.json ↔ orders-v2.json`, or `notes.md ↔ Clipboard`.  
It carries a `⇄` glyph,
and its tooltip spells out both sides in full.  
A diff tab is never a preview tab,
so it stays open until you close it.

Asking for the same pair again, in either order, focuses the diff tab that already compares it.

- Right-clicking a diff tab offers **Swap sides**, **Reveal in Explorer**, **Export JSON**, **Export HTML**, **New compare**,
  **Close**, **Close others**, **Close to the right** and **Close all**.
  **Reveal in Explorer** shows when the modified side is a workspace file,
  and selects its row and focuses the tree as on a file tab; see [Explorer](Explorer.md#reveal-in-tree).
  **Close others** and **Close to the right** show only when there are such tabs to close.
  See [Exports](#exports) for the two exports.
- Activating a diff tab reveals its modified side in the Explorer when that side is a workspace file.
- `Ctrl+S` does nothing in a diff tab; there is nothing to save.
- A side that is open in a file tab shows that tab's current text, unsaved edits included, and follows them as you type.
- A side that is a workspace file, and not open, is read again when it changes on disk.
- Renaming or moving a workspace file keeps the diff sides that show it.

## Opening a diff

| Where | What opens |
| --- | --- |
| **Compare with…** in a file's toolbar | a chooser for the other side, then the diff tab with both sides set |
| **Compare with clipboard**, under **Compare with…** in the Explorer or tab context menu | the file against the clipboard |
| **Compare with a file…**, in the same place | the file against a file picked from disk |
| **Compare with open tab: name**, in the same place | the file against that tab's text, unsaved edits included |
| **Compare these two files**, with two files of one type selected in the tree | the upper file as the original, the lower as the modified |
| **Compare XML with…** in the Explorer or tab context menu of an XML file | the XML file against a file picked from disk |
| `+` at the end of the tab bar, **Start a compare** on the start screen or **New compare** | an empty compare; see [On-the-fly compare](#on-the-fly-compare) |

The file is always the **original**, on the left;
the other side is the **modified**, on the right.  
**Swap** exchanges them.

**Compare these two files** takes two CSV or TSV files, or two text files of the same type, such as two JSON files.  
Excel workbooks are compared with **Compare with…**.

### The Compare with… chooser

The **Compare with…** button in a file's toolbar opens a chooser under the button, titled `Compare orders.json with…`.  
Choosing an entry opens the diff tab at once; `Esc` or a click outside cancels and opens nothing.

- **Open tab:** the other open tabs of a comparable type.
- **Workspace file:** a search box over the workspace files of a comparable type, sorted by path;
  `Enter` in the box picks the first match.
  The list shows up to 200 matches and leaves out `.git` and `node_modules` folders.
- **File from disk…:** the browser's file picker; the file need not be in the workspace.
- **Clipboard:** the text on the clipboard; the browser asks for access the first time,
  and the button is left out when the browser offers no clipboard.
  A clipboard with no text says `The clipboard holds no text.`,
  and a refused one `Nib Studio was not allowed to read the clipboard.`, as for every read of the clipboard,
  and no diff tab opens.
- **Paste text…:** a box to paste or type the other side into, and **Compare** to use it.

Comparable means the same engine: JSON with JSON, YAML with YAML, tables with tables,
and any text file with any other text file for the line diff.

## Left and right

Every diff kind labels its sides the same way.  
A header over each side shows an **Original** or **Modified** badge,
the name, and a muted line with where it comes from:
the workspace path, `data/orders.json (open tab)`, `orders.json (from disk)`,
**Text read from the clipboard**, or **Pasted at 14:32** and **Edited at 14:32** in local time.  
An empty side reads **Not chosen**, with **Drop, paste or pick the other side**.  
Hovering a header spells the side out, such as `Original: data/orders.json`.  
The original side is marked red on its left edge, the modified side green.

The text, JSON, YAML, XML and row diffs put each header over its own side.  
The Markdown diff shows both headers in one row, joined by `↔`,
and the rendered page below them has its own **Diff**, **Before** and **After** views.

## Changing a side

Inside a diff tab, **Change original…** and **Change modified…** in the toolbar open the same chooser for that side,
titled **Original side** or **Modified side**;
on an empty side they read **Pick original…** and **Pick modified…**.  
The chooser lists the files and tabs of the diff's kind, and leaves out the file on the other side.

A side that has nothing, such as a new compare, a cleared side, or a persisted diff whose file was deleted,
shows a drop zone titled **Choose what to compare with**:

- **Drag a file from the Explorer:** the workspace file is read and compared;
  with several rows dragged, the first one counts, and folders are ignored.
- **Drop a file from your computer:** the dropped file fills that side as a file from disk,
  and Excel workbooks stay binary for the row diff.
- **Paste text (Ctrl+V):** pasting while the zone or the view has focus compares the pasted text; **Paste from clipboard** does the same.
  A file on the clipboard is compared as a file.
- **Click to choose a file:** opens the file picker; `Enter` and `Space` work when the zone has focus.

Only an empty side takes a drop.  
A file dropped anywhere else in a diff tab opens in a tab of its own;
to replace a side, use **Clear** first, or **Choose file…**.  
Pasted text in the row diff is read as TSV when it has tabs, and as CSV otherwise.

Every side header also has its own actions, in file compares as well as new ones:

- **Paste:** replaces the side with the text on the clipboard.
- **Edit:** types or changes the side's text; see [On-the-fly compare](#on-the-fly-compare).
- **Choose file…:** the chooser for that side: open tabs and workspace files of the diff's kind,
  **File from disk…**, **Clipboard** and **Paste text…**.
- **Clear:** empties the side, which shows the drop zone again.
  It shows only on a side that has something.

A diff tab with pasted or edited text on a side isn't saved with the workspace.

## On-the-fly compare

Compare two texts without saving them anywhere:
paste one on the left, one on the right, and keep pasting to change either side.

1. Click `+` at the end of the tab bar,
   **Start a compare** on the start screen,
   or **New compare** in a tab's context menu.
2. Pick the kind: **Compare text**, **Compare JSON**, **Compare YAML**, **Compare XML**,
   **Compare Markdown** or **Compare tables (CSV/TSV)**.
3. An empty diff tab opens, titled by its kind, such as **JSON compare**, then **JSON compare 2**.
4. Fill each side: paste, drop a file, click the drop zone to choose one, or use the side header's actions.

The diff is computed again as soon as a side changes.  
These work in every diff tab, not only in new compares:

- **Ctrl+V:** replaces the side that has focus, or else the side under the pointer.
  With neither, it fills the first empty side.
  It works wherever the focus is in the tab, or with the focus nowhere, as after a click on the tab's title.
  Pasting into a text box, such as the chooser's **Search workspace files** box, pastes there as usual.  
  When the **Compare with…** chooser closes, the focus goes back where it was before it opened,
  and no caret is left behind in the page, so a later `Ctrl+V` still reaches the compare.
- **Edit:** the side's text opens in an editor in place of the diff,
  titled such as `Editing the original side as JSON` and highlighted for JSON, YAML and Markdown.
  **Apply**, `Ctrl+Enter` or `Ctrl+S` puts the text on the side and the diff comes back;
  applying empty text empties the side, and **Cancel** leaves the side as it was.
  An unapplied edit waits for you when you leave the tab and come back.
- **Invalid input:** a side that isn't valid for the kind, JSON, YAML or XML,
  shows **Not valid JSON**, **Not valid YAML** or **Not valid XML** with the parser message, line and column above its text,
  and the text stays as it was, ready for **Edit**.
- **Swap** exchanges the sides, as in any diff.

A new compare also has:

- **Compare as:** buttons in its toolbar, **Text**, **JSON**, **YAML**, **XML**, **Markdown** and **Table**,
  switch its kind, reading both sides again.
- **No folder needed:** new compares work before a workspace is open,
  and new compares whose sides aren't workspace files carry over when a workspace is opened or switched.

New compares last for the session only and are never saved with the workspace,
even when both sides are workspace files.

## Leaving and coming back

Everything a diff tab shows belongs to that tab:
its sides, swaps, rules, the bar's view, the current change, the scroll position,
expanded nodes, an unapplied **Edit**, and the computed result.  
Switching to another tab, or to **Hash & encode**, and back restores it exactly,
without comparing again.

Diff tabs between two workspace files are saved with the workspace and reopen with it,
at their place among the tabs, reading both files again.  
Any other diff with a workspace file on one side, such as a file and the clipboard, closes when another workspace opens.  
Diffs with no workspace file side, of the clipboard, pasted text or files from disk,
stay open when another workspace opens or the open one is forgotten, and last until the studio tab closes.

## The diff bar

The text, JSON, YAML, XML and row diffs show both sides side by side, aligned row for row, under one shared scroll.  
A floating bar at the bottom right of the diff works like the Markdown diff's:

- **Diff** shows both sides, **Before** only the original and **After** only the modified side,
  each at full width with the same highlights.
  Their tooltips read **Insertions and deletions**, **Read the original** and **Read the revision**.
  Before leaves out what only the modified side has, After what only the original has,
  and the rows at the top of the diff stay in place when the view changes.
- The position of the current change, such as `3 / 12`, or `– / 12` before the first one;
  hovering it shows where the change is, such as `items[3].price`.
  While you scroll, it follows the change nearest the middle of the diff.
  With nothing different, it reads **No changes** and the steps hide.
- `↑` **Previous change (p)** and `↓` **Next change (n)** step through the changes from top to bottom
  and stop at the first and the last.
  The change scrolls to the middle of the diff and flashes with a fading amber ring;
  in the JSON, YAML and XML diffs, a change inside a closed node opens its parents first.
- `n`, `p`, `↓` and `↑` step too, while the diff has focus and you aren't typing in a box, a field or an editor.
- Clicking a highlighted change in the diff makes it the current one.
- `↻` **Recompute** runs the comparison again, such as after a file changed; meanwhile the position reads **Comparing…**.
- Steps count only the changes the chosen view shows.

Changing a rule or an option compares again at once.  
When the two sides hold more than about half a million characters together, the comparison waits a moment first,
so quick successive changes compare once, and the bar reads **Comparing…** meanwhile.

The chosen view, the current change and the scroll belong to the diff tab, and come back with it.  
On screens 720 px wide or narrower, both sides stay side by side in tighter columns,
the toolbar popovers fit the window, and the bar keeps to the corner with larger buttons.

## Text

A line diff for any text file that has no structural engine.

- Both sides side by side, the full width of the tab, each with its line numbers, aligned line for line:
  within a change, the removed lines sit beside the added ones,
  and where one side has fewer lines it shows hatched placeholders.
- Added lines are green with `+`, removed lines red with `−`.
- Each run of changed lines is one change for the [diff bar](#the-diff-bar), which counts them.
- While a side is missing, the chosen side shows its text and the other side a drop zone.

The text diff is used for TypeScript, JavaScript, CSS, HTML, logs, `.txt` and every other file read as text,
so they all get the same compare rules.

### Compare rules

**Compare rules** in the toolbar decides what counts as a difference.  
The button is always there, and while rules differ from the defaults it counts them, such as `Compare rules · 2`;
each ignore pattern counts as one, and **Unique lines only** counts only while sorting is on.

Clicking it opens the rules in a popover under the button, the same as the JSON, YAML and XML **Rules (n)**.  
`Esc` or a second click on the button closes it, with focus back on the button;
a click outside the popover closes it too.  
Inside, `Tab` and `Shift+Tab` go round the rules, `↑` and `↓` step from one rule to the next,
and the arrow keys pick a choice of **Ignore whitespace**.  
On screens 720 px wide or narrower, the popover fits the window.

| Rule | Effect |
| --- | --- |
| Ignore whitespace | **Don't ignore**, **Trailing whitespace**, **Changes in amount** or **All whitespace** |
| Ignore case | `Value` and `value` are the same line |
| Ignore blank lines | empty and whitespace-only lines are left out |
| Normalise line endings (CRLF / LF) | on by default; off makes a `\r\n` line differ from a `\n` line |
| Trim each line | leading and trailing whitespace doesn't count |
| Sort lines before comparing | both sides are sorted, so lines that only moved aren't reported |
| Unique lines only | with sorting on, repeated lines count once; it can be ticked only while sorting is on |
| Ignore lines matching | lines matching any of the regular expressions are left out |

**Changes in amount** counts each run of spaces and tabs as one space and ignores trailing whitespace.

**+ Add pattern** asks for a regular expression, such as `^\s*//`; an invalid one shows the error and isn't saved.  
Each pattern has **Edit** and **Remove**; adding a pattern that is already listed keeps one copy.  
Once the dialog closes, focus is back in the popover.

Changing a rule reruns the comparison at once,
and the diff and the button's count update behind the open popover.  
Both sides still show the real lines, with their own line numbers.  
Lines a rule leaves out stay in place, greyed out in italics,
and they are never a change of their own.  
With sorting on, each side lists the compared lines in sorted order, followed by the lines left out.  
The rules belong to the diff tab, and come back with it.

## Aligned trees

The JSON, YAML and XML diffs show both documents as one aligned grid with a shared scroll, the full width of the tab:
every key, element or array item sits on the same row on both sides.  
Where a side lacks it, that side shows a hatched placeholder row,
and a whole missing object or array gets a placeholder for each of its rows,
so everything below stays aligned.

- A twist on either side opens or closes the node on both sides together.
- Nodes on the path to a difference start open; the rest start closed.
  With no differences, every node starts open.
- Changed rows have an amber edge, rows only in the modified side a green edge, rows only in the original a red edge.
- Objects show `{` and a count of keys, arrays `[` and a count of items.
  Clicking the `[` of an array opens its [rules picker](#the-rules-picker).
- **Sort keys**, on by default in the JSON and YAML diffs, orders keys by name, naturally and ignoring case;
  with it off, keys keep the file's order.
  Array order only changes when an array rule sorts it.

## Changes

The JSON, YAML, XML and row diffs sort each change into a kind,
which sets its highlight and whether **Before** or **After** shows it:

| Kind | Meaning |
| --- | --- |
| Added | only in the modified side |
| Removed | only in the original side |
| Changed | in both, with another value |
| Type changed | in both, with another kind of value, such as a string that became a number or an object that became an array |

`null` counts as a missing value:
a value in place of `null` is added, and `null` in place of a value is removed.

The [diff bar](#the-diff-bar) counts the changes, such as `3 / 12`.  
Each change has a path, which the bar's position shows when you hover it:
`author.github`, `items[0].price`, `items[id=5].name` when an array rule matches items, `tags[3]`;
in XML, `order/item[@id=5]/@price`;
in the row diff, `row id=2 · price`.

## JSON

A structural comparison: key order inside objects never counts.

- A side that isn't valid JSON shows the parser message.
- With nothing different, the bar reads **No changes**.

### Array rules

Without rules, arrays compare item by item, by position.  
A rule tells the diff how to pair or order the items of one array:

- **Match items by:** fields that identify an item, such as `id`; items with the same values pair up wherever they sit,
  and the grid aligns them on one row.
  Items without a match fall back to position.
- **Sort items by:** fields to sort both sides by before comparing, so order alone never shows as a difference.

A rule applies to every array at its path, such as `$.orders[*].lines[*]` for the lines of every order.  
To add a rule, click the `[` of an array in the grid.  
Once there are rules, **Rules (n)** in the toolbar lists them in a popover,
each with its path, **Match items by** and **Sort items by** fields, and **Edit** and **Remove** buttons;
`Esc` or a click elsewhere closes it.  
A toast confirms each rule the dialog adds, updates or removes, such as `Rule added for $.items[*].`

### The rules picker

Array rules, element rules and row matching share one dialog,
titled **Add array rule** or **Edit array rule**, **Add element rule** or **Edit element rule**, or **Row matching**,
and headed by the path it applies to:

- **Match items by** (or **Match rows by**) lists every field found on the items, or every column of either table,
  as checkboxes, sorted by name.
- **Sort items by** (or **Sort rows by**) offers the same fields.
- Under each list, **Order** shows the picked fields in priority order;
  `↑` and `↓` move a field, `×` removes it.
- **Save rule** applies it and reruns the comparison, **Cancel** leaves everything as it was,
  and **Remove**, on an existing array or element rule, deletes it.
  Saving a rule with no fields picked removes it too.

## YAML

Both sides are read as JSON data, by the [YAML conversion rules](Yaml.md#conversion-rules),
and compared with the JSON engine:
the same grid, **Sort keys**, [array rules](#array-rules), [change kinds](#changes), [diff bar](#the-diff-bar) and [exports](#exports).
Only the data counts, so comments, indentation, quotes and the choice between block and flow style never show as changes.

- Anchors and aliases are resolved and merge keys merged, so an alias compares as the value it stands for.
- A file of several documents is an array of them, so its documents compare by position, `[0]`, `[1]` and so on.
- A side that isn't valid YAML shows **Not valid YAML** with the parser message, line and column, above its text.
- Changes are named by their path, as in JSON, such as `server.port` or `features[name=search].rollout`.
- The exports name the kind `yaml`; the HTML page is titled such as `app.yaml ↔ app-v2.yaml · YAML diff`.

**Compare with…** in a YAML file's toolbar, **Compare these two files** with two YAML files selected,
and **Compare YAML** under **New compare** open it.

## XML

Both documents are converted to JSON and compared with the JSON engine.  
Before converting, every element that repeats on either side is turned into an array on both sides,
so one `<line>` against two `<line>` elements still compares item by item.

- **XML** labels the grid with element names, such as `<line>`, `@id` and `text()`; **JSON names** shows the converted keys.
- **Sort by name** orders elements and attributes by name; it is off by default, so the document order shows.
- Each change is named by its element path, such as `order/lines/line[1]/qty`, `order/@id` or `order/note/text()`.
  Repeated elements carry their position, counted from 0, or their rule's match key, such as `item[@id=5]`.
- With nothing different, the bar reads **No changes**.
- A side that isn't valid XML shows the parser message with line and column.
- An empty element converts to `null`, so text in a once empty element is **Added**,
  and an element whose text was emptied is **Removed**.

The options sit in a row under the toolbar, and each one's tooltip says what it does:

| Option | Effect |
| --- | --- |
| Ignore whitespace-only text | on by default; text made only of spaces, tabs and line breaks, such as the indentation between elements, doesn't count; off reports it |
| Trim text and attribute values | on by default; leading and trailing whitespace in text and in attribute values doesn't count; off compares them exactly |
| Ignore namespace prefixes | `ns:order` and `order` are the same element, and `xmlns` attributes are left out |
| Case-sensitive names | on by default; off makes `Order` and `order` the same, for elements and attributes |

Each whitespace option covers its own text, so either one changes the result while the other is on:
whitespace-only text is never trimmed away, and whitespace inside a text, such as `a  b` against `a b`, always counts.

**Element rules** pair and sort repeated elements like array rules:
click the `[` of a repeated element in the grid and the [rules picker](#the-rules-picker) opens.  
Once there are rules, **Rules (n)** in the toolbar lists them for **Edit** and **Remove**,
and a toast confirms each rule added, updated or removed, as for array rules.  
Its fields are the attributes of the element, such as `@id`, and the names of its child elements.

## Markdown

A rendered, document-style diff in a frame, built from the original and modified text.

- A **Changes** index, headed with its count, such as **Changes (12)**, groups the changes by section.
- Prose shows insertions and deletions inline; a paragraph rewritten end to end shows as two full bands.
- Tables align cell by cell; code blocks diff line by line.
- A changed Mermaid diagram renders on both sides, with **Before** and **After** tabs.
- Each entry in **Changes** jumps to its change; links within the document jump too, and web links open in a new browser tab.
- The floating bar switches between **Diff**, **Before** and **After**, steps through changes with its `↑` and `↓` buttons, or `n` and `p`,
  shows the position, such as `3 / 12`, and `⇄` opens a side-by-side modal.
  Clicking any change opens the modal too; `←`, `→` and `Esc` work inside it,
  and on a diagram its magnifier button turns on a lens that follows the pointer.
- **Copy Mermaid** and **Copy table** copy the source; **Enlarge** opens a diagram in a new tab.

The chosen view and the scroll position belong to the diff tab, and the page is built once per pair of texts;
a **Building diff…** toast shows while it is built.  
The Markdown diff has its own matching and doesn't use the text compare rules.  
The frame is sandboxed without scripts; the studio page drives its controls from outside the frame.

## Row diff

Compares two tables row by row, keyed by columns.

- The toolbar button reads `Match: id · Sort rows: none` and opens the [rules picker](#the-rules-picker),
  for the key columns and the columns to sort rows by.
  Until you pick, Nib Studio suggests a shared column named `id`, `key`, `code`, `sku`, `uuid` or `name`,
  in that order, ignoring case, and otherwise the first shared column.
- One aligned table shows both files side by side, with a shared scroll:
  rows paired by key sit on the same line, and a row only one file has shows a placeholder row on the other side.
  Each side's `#` column shows the row's key.
- Rows whose key cells are empty are left out.
- A column only one file has shows as a placeholder column on the other side, and its cells don't count as differences.
- Changed cells are highlighted on both sides; their tooltip reads **Original** and **Modified**, with `∅` for an empty cell.
- **Sort columns** orders the columns by name; it is off by default, so each file's column order shows.
- The first row of each file, or of each sheet, is the header.
- **Sheets:** a workbook with more than one sheet gets a picker in the toolbar, **Original sheet** or **Modified sheet**,
  listing its sheets in order, hidden ones marked `(hidden)`.
  The original starts on the sheet its table tab shows, or its first visible sheet;
  the modified side starts on the sheet with the same name, ignoring case, when it has one.
  Picking the original's sheet moves the modified side to the sheet of the same name too,
  and picking the modified side's sheet on its own compares two different sheets.
  When the sheets picked lack the key columns chosen, the key columns are suggested again.
  A workbook is read once while its tab or the compare is open, so changing the sheet is quick.
- Stepping to a change with the [diff bar](#the-diff-bar) scrolls to it,
  flashes the whole row or both cells of a changed value, and outlines the row.

CSV and TSV files over 2 MB are too large for the row diff;
the tab shows **File is too large for row diff** and points to the Table view.

## Exports

Every compare works in two steps:
it first builds a **diff document**, plain JSON that says what changed and how both sides line up,
and the diff tab is then drawn from that document.  
The two exports save either step.

Right-clicking a diff tab offers both, for every kind, Markdown included:

- **Export JSON** saves the diff document, such as `orders-vs-orders-v2.diff.json`.
- **Export HTML** saves a page of its own, such as `orders-vs-orders-v2.diff.html`.

Each file is named after the two sides, without their extensions,
with characters a file name can't hold, and spaces, turned into `-`,
such as `Pasted-text-vs-Clipboard.diff.json`.  
An export shows the diff as the tab does: its rules and options, its key columns, and its sides after **Swap**.  
Both items are left out of the menu until both sides are chosen.
A side that isn't valid JSON, YAML or XML, or a table with no key column, has nothing to export yet, and a toast says so.

The file goes to the browser's downloads, like any download,
and a toast names it, such as `Downloaded orders-vs-orders-v2.diff.html.`  
Nothing is written into the workspace.

### The HTML page

The page needs nothing but itself:
its styles and its small script are inside it, it fetches nothing, and it opens from disk with no network.  
It follows the system's light or dark setting.

- The same side-by-side layout as the diff tab, under the **Original** and **Modified** headers,
  with hatched placeholders where a side has nothing.
  A workbook's header names the sheet compared, such as `data/sales-2026.xlsx · Sheet: Q2`.
- JSON, YAML and XML objects and arrays start open or closed as in the tab, and their twists open and close them.
- The bar at the bottom right: **Diff**, **Before** and **After**, the position, and **Previous** and **Next**,
  with `p`, `n`, `↑` and `↓` as in the tab;
  stepping to a change inside a closed object opens it.
  Printed, the page leaves out the bar.
- Clicking a change makes it the current one.
- Everything from the files is escaped, so a value never turns into markup,
  and the page's content policy forbids loading anything.

A Markdown export is the Markdown diff page itself, the same page the tab shows,
light whatever the system's setting, with `n` and `p` for keys and `↑` and `↓` as buttons;
only the ids Mermaid gives the parts of each diagram differ from one drawing to the next.  
Printed, it leaves out its on-page controls: the copy buttons, **Enlarge**, the **Diff**, **Before** and **After** bar,
and the **Before** and **After** tab labels.
A changed diagram or table prints both sides, each labelled **Before** or **After**,
and the **Changes** list prints in full.

### The JSON format

A text diff of `notes.txt` against the clipboard, where the second line changed from `eggs` to `bread`:

```json
{
  "format": "nib-studio-diff",
  "version": 1,
  "kind": "text",
  "original": { "name": "notes.txt", "source": "file", "path": "docs/notes.txt" },
  "modified": { "name": "Clipboard", "source": "clipboard" },
  "options": {
    "whitespace": "none",
    "ignoreCase": false,
    "ignoreBlankLines": false,
    "normalizeLineEndings": true,
    "ignorePatterns": [],
    "sortLines": false,
    "uniqueLines": false,
    "trimLines": false
  },
  "summary": {
    "total": 1,
    "added": 0,
    "removed": 0,
    "changed": 1,
    "typeChanged": 0,
    "lines": { "added": 1, "removed": 1, "ignored": 0 }
  },
  "changes": [
    {
      "id": "0",
      "kind": "changed",
      "location": { "lines": { "original": { "from": 2, "to": 2 }, "modified": { "from": 2, "to": 2 } } },
      "row": 1,
      "before": "eggs",
      "after": "bread"
    }
  ],
  "rows": [
    {
      "left": { "status": "unchanged", "line": 1, "tokens": [{ "text": "milk", "type": "text" }] },
      "right": { "status": "unchanged", "line": 1, "tokens": [{ "text": "milk", "type": "text" }] }
    },
    {
      "change": "0",
      "left": { "status": "removed", "line": 2, "tokens": [{ "text": "eggs", "type": "text" }] },
      "right": { "status": "added", "line": 2, "tokens": [{ "text": "bread", "type": "text" }] }
    }
  ]
}
```

A JSON, YAML or XML diff names its changes by their path, such as `items[id=5].price` or `library/book[3]/title`,
and its cells carry the node's `depth`, `label`, `path` and `node`.

| Field | What it holds |
| --- | --- |
| `format`, `version` | always `nib-studio-diff` and `1` |
| `kind` | `text`, `json`, `yaml`, `xml`, `rows` or `markdown` |
| `original`, `modified` | each side's `name`; its `source`, one of `file`, `open-tab`, `disk`, `clipboard`, `pasted` or `edited`; the `path` of a file; and the `sheet` compared, for a workbook |
| `options` | the rules and options the compare used, such as the text compare rules, the array or element rules, or the key columns |
| `summary` | the changes counted by kind; a text diff adds its added, removed and ignored `lines`, and a table or a Markdown diff its `unchanged` rows or blocks |
| `changes` | every change, top to bottom: its `id`, its `kind`, one of `added`, `removed`, `changed` or `typeChanged`, its `location`, the first `row` that shows it, and its `before` and `after` values |
| `rows` | both sides aligned row for row: each row has a `left` and a `right` cell, `null` for a placeholder, and the `change` it shows |
| `columns` | in a table diff, every column, and whether each file has it |
| `markdown` | in a Markdown diff, the Markdown compare the page is drawn from |

A `location` holds the readable `path` and the JSONPath `pointer` of a JSON, YAML or XML change,
the `lines` of a text change on each side,
or the `key` and `column` of a table change.

A cell holds its `status`, one of `unchanged`, `added`, `removed`, `changed`, `typeChanged` or `ignored`,
and its `tokens`: the value as typed pieces of text.  
Depending on the kind, it also holds the `line`, the `depth` and `label` of a node, its JSONPath `path`,
whether it opens, closes or is a `leaf` `node`, `collapsed` for an object or array that starts closed,
and the `rulePath` a rule for an array's items uses.  
A table row has one token per column, with `null` for a column its file lacks.

The same inputs always give the same JSON: change ids are stable and nothing records the time.
