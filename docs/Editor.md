# Editor

The **Files** surface shows one tab per open file, a toolbar with the views for the active file, and the editor or view below it.  
Without a workspace it shows the start screen instead, unless a compare, a dropped file or a paste is open;
with no tab open, it points to the Explorer and to right-clicking the tree for a new file.  
The `+` button at the end of the tab bar opens a new compare, see [Compare](Compare.md#on-the-fly-compare),
or what is on the clipboard, see [Paste from clipboard](#paste-from-clipboard).

## Tabs

Each tab shows the file's type icon and name, a dot while it has unsaved edits, and a `×` close button.  
Hovering a tab shows the file's path from the workspace root, such as `docs/readme.md`.  
A file from outside the workspace carries a small `↗` after its name,
and hovering its tab says it is outside the workspace and where **Save** writes; see [Drop to open](#drop-to-open).  
A pasted tab has no `↗`, and hovering it says it was pasted from the clipboard and that **Save** asks where to save it.  
Tabs keep the order they were opened in.

### Preview and permanent tabs

| Action | Result |
| --- | --- |
| Single click on a file in the tree | opens it in the preview tab, name in italics |
| Single click on another file | replaces the preview tab with that file |
| Double click on the file in the tree | opens it as a permanent tab, or makes its preview tab permanent |
| Double click on the preview tab | makes it permanent |
| `Enter` on the file in the tree, or **Open** in the context menu | opens it as a permanent tab |
| Any edit in the preview tab | makes it permanent |

There is at most one preview tab.  
Files opened by **New file**, **Format JSON**, **Format YAML**, [Lookup](Lookup.md),
a desktop drop or a restored session open as permanent tabs.  
A file opened from Lookup at a match in its content opens in **Editor** with the match selected,
Markdown and HTML included.

### Activate, close and reveal

- Click a tab to make it active.
  The Explorer opens the file's parent folders and scrolls to its row.
- **Reveal in Explorer** in a tab's context menu also selects the row and focuses the tree,
  and brings a hidden Explorer back, without making the tab active.
- Click `×` to close it.
  A tab with unsaved edits asks **Discard unsaved changes** first, with the file's path.
- Closing the active tab activates the nearest tab to its right, or to its left when it was the last one.

### Tab context menu

Right-click a tab.  
The commands act on that tab, which need not be the active one.

| Command | Effect |
| --- | --- |
| Save… | on a pasted tab, asks where to save the paste; see [Paste from clipboard](#paste-from-clipboard) |
| Reveal in Explorer | opens the file's parent folders, selects its row, scrolls it into view and moves the focus to the tree; a hidden Explorer comes back, and on a narrow screen the drawer slides in; see [Explorer](Explorer.md#reveal-in-tree) |
| Compare with… | **Compare with clipboard**, **Compare with a file…**, **Compare with open tab: name**, each in a new diff tab; see [Compare](Compare.md) |
| New compare | an empty compare of the kind picked under it: Compare text, Compare JSON, Compare YAML, Compare XML, Compare Markdown or Compare tables (CSV/TSV) |
| Copy name to clipboard | the file name |
| Copy path to clipboard | the path from the workspace root |
| Copy content to clipboard | the tab's text as it is now, unsaved edits and pastes included, as the toolbar's **Copy content** copies it |
| Format JSON | reformats a JSON file, unsaved |
| Format YAML | reformats a YAML file with 2-space indent, keeping its comments, unsaved |
| Convert XML to JSON | opens the JSON in a new tab |
| Convert YAML to JSON | opens the JSON in a new tab, such as `app.yaml.converted.json` |
| Convert JSON to YAML | opens the YAML in a new tab, such as `data.json.converted.yaml` |
| Compare XML with… | asks for the other file on disk and opens the XML diff in a new diff tab |
| Save pages… | on a PDF's tab, saves chosen pages as a new PDF; from outside the workspace a file picker asks where; see [Documents](Documents.md#save-pages) |
| Close | closes the tab |
| Close others | closes every other tab |
| Close to the right | closes the tabs after this one |
| Close all | closes every tab |

**Close others**, **Close to the right** and **Close all** list every tab with unsaved edits, as `Unsaved` lines, and ask before closing.  
**Reveal in Explorer** sits on its own at the top of the menu.  
**Reveal in Explorer**, **Copy path to clipboard**, **Convert XML to JSON**,
**Convert YAML to JSON** and **Convert JSON to YAML** work on tabs of workspace files;
they are left out of the menu on the tab of a file from outside the workspace, which has no place in the workspace.  
On a pasted tab, **Save…** sits at the top of the menu, and **Copy content to clipboard** copies the paste as it is now.  
**Compare with…** and **Copy content to clipboard** show on the tab of every text file,
whether its folder is expanded in the tree, collapsed, or outside the workspace;
they are left out for a file that opens only as a preview, and for one that isn't text.

A diff tab has its own menu: **Swap sides**, **Reveal in Explorer**, **Export JSON**, **Export HTML**, **New compare**,
**Close**, **Close others**, **Close to the right** and **Close all**.  
Diff tabs are titled `left ↔ right`, carry a `⇄` glyph and are never preview tabs; see [Compare](Compare.md#diff-tabs).

## Toolbar

From left to right:

- **View tabs** for the file type, listed below.
- **Type badge:** `JSON`, `YAML`, `Markdown`, `XML`, `HTML`, `Text` or `Table`.
- **Copy** buttons, joined as one group: **Copy raw** and **Copy formatted**, or **Copy content**; see [Copy](#copy).
- **Compare with…:** a chooser for the other side, then a new diff tab; see [Compare](Compare.md#the-compare-with-chooser).
- **Actions** for the type and view: **Format**, **Minify** and **Convert to YAML** for JSON,
  **Format** and **Convert to JSON** for YAML, **Convert to JSON** for XML,
  **Export HTML** and **Export PDF** for Markdown.
- **Save**, or a **View only** badge for tables and documents.

Hovering a view tab shows what the view does where it isn't obvious, such as **Interactive**.  
Clicking a view tab or an action keeps the focus in the editor; switching to another editor view moves the focus to its editor.

## Copy

The copy buttons show in every view of a file's tab and copy from the tab's text as it is now:
the editor's text, unsaved edits included, and a pasted tab's text;
only a CSV or TSV too large to load is read from disk, as below.  
A toast says what was copied, such as `Raw text copied.`, `Formatted document copied.` or `1,250 rows copied.`,
and why when nothing was, such as `Could not copy: Document is not focused.`,
or `Could not copy: the file is no longer on disk.` for a large file deleted since it opened.  
Copying needs no permission of its own: the click asks for it.  
There is no shortcut: `Ctrl+Shift+C` is Chrome's element picker, and `Ctrl+C` copies the selection.

| File | Copy raw | Copy formatted | Copy content |
| --- | --- | --- | --- |
| Markdown | the source | the rendered document, as HTML with its text | |
| HTML | the source | the page as written, as HTML with its text, without its scripts | |
| CSV, TSV | the file's text | the table as shown, as an HTML table and tab-separated text | |
| Workbooks | | the sheet as shown, as an HTML table and tab-separated text | |
| JSON | the source | the document with a 2-space indent | |
| YAML | the source | the document as **Format** lays it out | |
| XML | the source | the document indented | |
| Word documents | | the page, as HTML with its text | |
| Any other text file | | | the text |

- **Rendered documents** paste into Word, Outlook or Google Docs with their headings, lists, tables, links and pictures.
  Workspace pictures go inside the copy, up to 10 MB of pictures in all,
  a picture past that becoming a line that says so, and web pictures keep their address.
  Mermaid diagrams go in as pictures, drawn at twice their size on white,
  and as their source in a code block when they can't be drawn.
  Links to the web or to a mail address stay links; a link to a workspace file or a heading keeps only its text.
  Scripts, handlers, style sheets, forms and controls are never copied, and hidden parts are left out.
  The plain text that goes with it is the text the document shows,
  with list items on lines of their own and a table's cells tab-separated.
- **An HTML page** copies as written: what its scripts would draw isn't in the copy, since they never run there.
- **JSON, YAML and XML** that don't parse copy nothing, and the toast says why,
  such as `Not valid JSON: Unexpected token (line 3, column 7). Nothing was copied.`;
  **Copy raw** still copies the text as it is.
  XML keeps its declaration, comments, CDATA and DOCTYPE, and an element holding text keeps its content as written.
- **Tables** copy as shown; see [Tables](Tables.md#copy).
- **Large CSV and TSV files:** **Copy raw** reads a file over 2 MB from disk, up to 64 MB;
  a larger one copies nothing,
  and the toast says `This file is too large to copy as text: it is 80.0 MB, and a copy takes up to 64.0 MB.`
- **Word documents:** **Copy formatted** shows once the page does, so not while the document opens or waits for its password.
- **Pictures** keep **Copy image** in their preview, an SVG included; PDFs, audio, video, fonts and archives have no copy buttons.
- At 720 px wide or less, **Copy raw** and **Copy formatted** fold into one **Copy** button with a menu of both,
  while the toolbar keeps to one row and scrolls sideways.

## Editor bar

A slim bar docked under the toolbar, above the text, in every view that edits text:
**Editor** for every text file, plus **Interactive** and **Split** for Markdown and HTML.  
There is no bar in **Preview**, **Tree**, **JSONPath**, **Schema**, **XPath** or **As JSON**, nor for tables and documents.

- **Undo** and **Redo** come first, with the tooltips **Undo (Ctrl+Z)** and **Redo (Ctrl+Y)**.
  Each is greyed out while there is nothing to undo or redo, and updates as you edit.
  There is no history list, only the two buttons.
- Markdown files add the formatting buttons after a divider; see [Markdown](Markdown.md#formatting).
- HTML files add **Bold**, **Italic** and **Link**, then **Heading level**, **Bulleted list** and **Numbered list**;
  see [HTML](#html).
- Clicking a button never takes focus from the text: the caret and the selection stay where they were.
- With a bar button focused, `←`, `→`, `Home` and `End` move between the buttons.
- At 720 px wide or less, the bar keeps to one row and scrolls sideways.

## View tabs per file type

`viewOptionsFor` in `views/filesSurface.ts` picks the views from the file name.

| File | Views | Actions |
| --- | --- | --- |
| `.json` | Editor, Tree, JSONPath, Schema | Format, Minify, Convert to YAML (Editor view) |
| `.yaml`, `.yml` | Editor, Tree, JSONPath, Schema | Format, Convert to JSON (Editor view) |
| `.md`, `.markdown`, `.mdx` | Editor, Interactive, Split, Preview | Export HTML, Export PDF |
| `.html`, `.htm` | Editor, Interactive, Split, Preview | none |
| `.xml`, `.xsd`, `.xsl`, `.xslt`, `.config` | Editor, Tree, XPath, As JSON | Convert to JSON (Editor view) |
| `.csv`, `.tsv`, `.xlsx`, `.xls`, `.xlsm`, `.xltx`, `.xltm`, `.xlsb`, `.ods` | Table | none, view only |
| `.docx`, `.docm`, `.dotx`, `.dotm`, `.doc`, `.pdf` | no view tabs, the preview frame | Copy formatted for Word documents, view only |
| images, audio, video, fonts | no view tabs, the preview frame | Copy image for images, view only |
| archives, such as `.zip`, `.7z` and `.tar.gz` | no view tabs, a message in the preview frame | none, view only |
| presentations, such as `.pptx` and `.odp`, and OpenDocument `.odt` and `.odg` | no view tabs, a message in the preview frame | none, view only |
| Any other file | Editor, when its first 8 KB are text; otherwise a message in the preview frame | none |

- The chosen view is shared across files: switching from one JSON file to another keeps **Tree**.
  When the next file lacks that view, its first view opens.
- Opening a Markdown or HTML file shows **Preview**, and a file made with **New file** opens in **Editor**.
  Coming back to a tab that is already open keeps the chosen view.
- **Save** is disabled in **As JSON**; it saves the source text in every other view.
- `.jsonc` and `.json5` carry the JSON icon but open as plain text, with the Editor view.
- Every file but Word documents, PDFs, images, audio, video, fonts, archives, presentations and files that aren't text
  has **Compare with…** in its toolbar;
  comparing never changes the file's own tab.
- A table keeps its sort, filters, search, column order, widths and scroll position when you leave its tab and come back.

See [JSON](Json.md), [YAML](Yaml.md), [XML](Xml.md), [Markdown](Markdown.md),
[Compare](Compare.md), [Tables](Tables.md), [Documents](Documents.md) and [Preview](Preview.md).

## HTML

`.html` and `.htm` files open with Markdown's four view tabs, **Editor**, **Interactive**, **Split** and **Preview**,
and an `HTML` badge.  
They open in **Preview**, and a new one made with **New file** opens in **Editor**.

- **Editor:** the source, with HTML highlighting, CSS in `<style>` and JavaScript in `<script>` included,
  and the [editor bar](#editor-bar) with the HTML formatting buttons.
- **Interactive:** the page edited like a document, while the file stays HTML; see [Interactive](#interactive).
- **Split:** the source on the left under **Source**, the page on the right under **Preview**,
  drawn again 300 ms after typing stops, with the divider of Markdown's [Split](Markdown.md#views).
- **Preview:** the page alone, with its scripts running in a sandbox; see [Preview](#preview).

### Formatting

The editor bar above **Editor**, **Interactive** and **Split** carries, after **Undo** and **Redo**:

- **Bold** (`Ctrl+B`) and **Italic** (`Ctrl+I`) wrap the selection, or the word at the caret, in `<strong>` or `<em>`.
  In `<strong>` or `<b>`, **Bold** removes the tags and keeps the text, and so does **Italic** in `<em>` or `<i>`.
  With no word at the caret they add an empty pair with the caret between, for the text typed next.
- **Link** (`Ctrl+K`) opens a popover for the address, as in Markdown's Interactive view:
  in a link it changes the `href`, and an empty address removes the link and keeps its text;
  on text it wraps it in `<a href>`, and with no text it adds a link that reads its address.
  The address is escaped, so `&` and `"` can't break the tag.
- **Heading level** opens a menu of **Normal text** and **Heading 1** to **Heading 6**, with the current level checked.
  It renames the paragraph or heading around the caret, keeping its attributes,
  and makes selected text outside any paragraph a heading of its own.
- **Bulleted list** and **Numbered list** turn a paragraph or heading into a one-item `<ul>` or `<ol>`,
  switch a list to the other kind, or, in a list of their own kind, turn its items back into paragraphs.

A selection that starts and ends in different elements, or inside a tag, would break the HTML,
so a format leaves it alone and says so in a toast.  
Every format is one undo step, and the buttons show as pressed while the caret is in their format.

### Interactive

**Interactive** shows the page as a document and edits its text, while the file stays HTML,
byte for byte apart from the edits.  
The source is never written out again from the page: each edit changes only the text it touches.

- Tags are hidden, and so is the indentation that starts a line, outside `<pre>`.
  The caret, the arrow keys, `Backspace` and `Delete` pass over them: each arrow press moves one shown character.
- Text takes the look of its elements: headings, bold, italic, underline, struck text, code, marks,
  small text, subscripts and superscripts, and links, with their address on hover.
  List items show a bullet, or their number in a numbered list; quotes have a bar at the left and `<pre>` is monospaced;
  table cells are set off by `│`, and `<hr>` is a line.
- Entities show as their characters, such as `&amp;` as `&`, and delete as one character.
- Images show from the workspace, as in the preview.
- `<head>`, `<style>`, `<script>`, comments, the doctype, forms, media, `<svg>` and other elements with no text to edit,
  custom elements included, show as small labelled boxes, such as `<script>`.
  They take no part in editing; change them in **Editor**.
- A line that holds nothing but tags, such as `<ul>` or `</body>`, is drawn short.
- Typed text goes where the caret shows it: after plain text before bold text it stays plain,
  and at the end of bold text it stays bold.
- `<`, `>` and `&` typed or pasted are escaped, so text never turns into markup;
  pasting always inserts the clipboard's plain text.
- `Backspace` and `Delete` remove the shown character beside the caret, never a tag.
  When an inline element, such as `<strong>`, loses its last character, its tags go too.
  A selection deletes its text and keeps every tag in it.
- `Backspace` at the start of a heading makes it a paragraph;
  at the start of a paragraph or list item, and `Delete` at its end, it joins the one beside it.
  A list's first item, and a block beside anything that isn't a paragraph, heading or item, stay as they are.
- `Enter` in a paragraph, heading or list item splits it in two, closing the inline elements the caret is in
  and opening them again on the new line; at its end it adds an empty paragraph, or list item, after it,
  and at its start an empty one before it.
  On an empty list item it ends the list with a paragraph after it.
  In `<pre>` it adds a line, and outside any paragraph a `<br>`.
- `Shift+Enter` adds a `<br>`, with the text after it on a line of its own;
  `Backspace` or `Delete` beside it removes it as one character.
- Attributes, the `<head>` and everything boxed are edited in **Editor**.
- A file over 500,000 characters opens in **Interactive** as plain source, with a note above it, as Markdown does.

### Preview

**Preview** draws the file as a page, the way a browser would, and runs its scripts,
inside a sandbox page that keeps the page away from the network and from the studio:

- The page sits in the extension's sandbox page, `nib-studio/sandbox.html`, in a frame of its own,
  so its styles never reach the studio and the studio's never reach it.
- Its scripts run as written: `<script>` elements, event handlers such as `onclick`, `javascript:` links,
  timers, `eval` and dialogs such as `alert`.
  Buttons, tabs, menus and other controls a script drives work,
  such as the **Diff**, **Before** and **After** buttons, the change stepping and the side-by-side view
  of a page saved by a Markdown compare's **Export HTML**.
- The page can't reach the network, the studio, the workspace or the extension:
  the sandbox page has an origin of its own, with no `chrome` extension API,
  no access to the studio's page, storage or files, and a content security policy that allows no connection at all;
  see [Privacy](Privacy.md#markdown-and-html).
  A `fetch`, a web image or font, a WebSocket or a script from the web added by the page's own script
  is refused, and the browser's console for the frame says so.
  WebRTC is taken away from the page before its scripts run.
- The page has no frames or workers of its own:
  `<iframe>`, `<frame>`, `<object>` and `<embed>` elements in the file are left out.
  A frame the page's script makes never runs a script: one with an address is refused,
  a `srcdoc` is refused as it is set, and one with no address stays empty.
  A worker is refused.
- A form's `submit` handlers run, so a script can read what was typed;
  the submission itself goes nowhere and the page stays as it is.
  A dialog's form, `method="dialog"`, closes its dialog.
  A script's own `form.submit()` is refused, and the page is drawn again as written.
- A script linked with `<script src="app.js">` is read from the workspace, relative to the page's folder,
  and put in the page as it is, keeping `defer`, `async`, `type="module"` and its place among the page's scripts.
  A script from the web, or from outside the workspace, is left out.
- A style sheet linked with `<link rel="stylesheet" href="page.css">` is read from the workspace, relative to the page's folder,
  and put in the page; so is a style sheet it brings in with `@import`.
  Images, backgrounds and fonts the CSS points at come from the workspace too.
- A style sheet or script open in a tab with unsaved edits is drawn from that tab's text,
  so the page shows the edits before they are saved.
- Images, video and other files the page loads come from the workspace, resolved like [Markdown images](Markdown.md#images),
  TIFF included;
  a HEIC picture shows `Nib Studio doesn't decode HEIC pictures.`,
  a missing one shows `Image not found:` and its path, and a web image shows a placeholder.
- Nothing loads from the web: a web style sheet or script is left out, and a web image, font or video is never fetched.
  `<base>` and a refresh `<meta>` are left out too.
- A click on a link works as in the Markdown preview: a workspace file opens in a permanent tab,
  a folder expands in the Explorer, a web, `mailto:` or `tel:` link opens in a new browser tab,
  and a missing file says so in a toast.
  A middle click on a link does the same.
  Only a click or a key press opens a link; a link the page's script clicks by itself opens nothing.
  Hovering a workspace link shows its path from the workspace folder.
- `#id` links, and a script that sets `location.hash`, move within the page, as in a browser.
  A script that sends the page to another address, such as `location.href = 'https://example.com'`, is stopped:
  the page is drawn again as written, once, with a toast that says so.
- `Ctrl+S` in the page saves the file, as it does in the editor, unless the page's own script takes the key.
- The page is drawn again 300 ms after the text changes, and when a style sheet, script or image it uses changes on disk.
  Each drawing runs the page's scripts afresh, in a new sandbox page that loads beneath the shown one
  and takes its place once it has loaded, keeping the scroll.
- The page is light, on white, whatever the studio's theme, unless its own styles say otherwise.
- An HTML file dropped from outside the workspace has no workspace folder: its style sheets and linked scripts are left out,
  its relative images show a placeholder, and its relative links say so in a toast.
  Its own inline scripts still run.

## Editing

The editor is CodeMirror 6, with:

- Line numbers, active line highlight, code folding in the gutter, bracket matching and auto-indent.
- Other occurrences of the selected text highlighted.
- Line wrapping.
- JSON highlighting for `.json`, YAML highlighting for `.yaml` and `.yml`, HTML highlighting for `.html` and `.htm`,
  Markdown highlighting for `.md`, `.markdown` and `.mdx`, GitHub tables and task lists included;
  other files are plain text.
- A JSON validator that underlines syntax errors and marks them in the gutter; see [JSON](Json.md#editor).
- A YAML validator that does the same for YAML, with the line and column in the message,
  and marks warnings, such as a repeated key, in the warning colour; see [YAML](Yaml.md#editor).
- The [editor bar](#editor-bar) above the text, with Markdown formatting for Markdown files
  and HTML formatting for HTML files; see [Markdown](Markdown.md#formatting) and [HTML](#formatting).

| Key | Effect |
| --- | --- |
| `Ctrl+S` | save |
| `Ctrl+Z`, `Ctrl+Y`, `Ctrl+Shift+Z` | undo, redo |
| `Ctrl+F` | search and replace panel, with match case, regex and whole word |
| `F3`, `Shift+F3` or `Ctrl+G`, `Ctrl+Shift+G` | next, previous match |
| `Ctrl+Alt+G` | go to line |
| `Ctrl+D` | add the next occurrence of the selection, as a selection of its own |
| `Ctrl+Shift+L` | select every occurrence of the selection, after `Ctrl+D` too, or of the word at the caret; whole words for a word, at most 1,000 |
| `Ctrl+click` | add a cursor where you click |
| `Esc` | go back to the main selection alone |
| `Alt+↑`, `Alt+↓` | move the line |
| `Shift+Alt+↑`, `Shift+Alt+↓` | copy the line |
| `Ctrl+Shift+K` | delete the line |
| `Tab`, `Shift+Tab` | indent, outdent |

Every selection and cursor is drawn, and typing, deleting and pasting act on all of them at once.  
In Markdown, `Enter`, `Backspace`, `Tab` and `Shift+Tab` also continue, end and nest lists,
and `Ctrl+B`, `Ctrl+I`, `Ctrl+Shift+X`, `Ctrl+E` and `Ctrl+K` format; see [Markdown](Markdown.md#formatting).  
In HTML, `Ctrl+B`, `Ctrl+I` and `Ctrl+K` format; see [HTML](#formatting).  
With a second keyboard layout, such as Greek, the shortcuts follow the place of the key,
so `Ctrl+σ` saves and `Ctrl+δ` adds the next occurrence, as Chrome reads its own shortcuts.

## Save and dirty state

- A file is dirty while its text differs from the text read from disk, line endings aside.
  Undoing back to that text clears the mark, whatever line endings the file has.
- Dirty files show a dot on their tab and their tree row, and the status bar counts them, `2 unsaved`, or says `clean`.
- `Ctrl+S` or **Save** writes the text back to the same path and shows a toast.
  The button reads **Saved** when there is nothing to save.
  In a view of the file without an editor, such as **Tree** or **JSONPath**, `Ctrl+S` saves as **Save** does.
  Where **Save** is off or missing, such as in **As JSON**, a preview, a table or a diff tab, `Ctrl+S` does nothing.
  It never opens the browser's **Save as** dialog.
  A file from outside the workspace saves back to its own file, never into the workspace; see [Drop to open](#drop-to-open).
- Files keep their line endings: a file with Windows line endings (CRLF) saves with CRLF,
  one with Unix line endings (LF) saves with LF, and one with old Mac line endings (CR) saves with CR.
  A file that mixes them saves with its most common one throughout.
- Files keep their [encoding](#text-encodings) too.
- A conversion in a tab of its own, such as `orders.xml.converted.json`, isn't on disk until it is saved,
  so it opens unsaved, with **Save**, and closing it asks first.
- So does a tab opened by **Paste from clipboard**,
  whose **Save** asks for a name and where the file goes; see [Paste from clipboard](#paste-from-clipboard).
- Leaving the workspace asks first when workspace files are dirty:
  switching to another workspace in the switcher, **Open folder…**, **Open as workspace** in the Explorer,
  opening a dropped folder, and **Forget** on the open workspace.
  The **Unsaved changes** dialog lists each file by its path from the workspace root,
  and offers **Save all**, **Discard** and **Cancel**.
  **Save all** stops at the first file that can't be saved, and the workspace stays open.
  Files from outside the workspace aren't listed; their tabs stay open.
- When a clean file changes on disk, it reloads.
  A change of line endings alone leaves the text as it is,
  and later saves use the line ending the file has on disk.
- When a dirty file changes on disk, the local edits stay and a warning toast says so.
  Saving then overwrites the disk version.
- Closing the studio tab doesn't ask; unsaved edits are lost.

## Text encodings

A text file opens in the encoding it is in, and saves back in it:

1. A byte order mark says it: UTF-8, or UTF-16 in either byte order.
2. Otherwise a file whose every byte reads as UTF-8 is UTF-8, plain ASCII included.
3. Otherwise it is text from an older Windows program, in a single-byte code page.
   Greek (Windows-1253), Western European (Windows-1252) and Cyrillic (Windows-1251) are weighed,
   and so is the code page of the first language in Chrome's language list that has one of its own,
   such as Central European (Windows-1250) for Polish.
   The one whose letters make the most sense wins: words in one alphabet, in the usual upper and lower case,
   and in Greek with its final `ς` only at the end of a word.
   A tie goes to the code page of Chrome's languages, then to Windows-1252.

The status bar shows the encoding, such as `UTF-8`, `UTF-8 with BOM` or `Windows-1253`.  
Line endings are kept as for any file.  
When an edit brings in a character the file's code page can't hold, such as `ü` in a Windows-1253 file,
**Save** asks first, in **Save name as UTF-8**, naming the characters:
**Save as UTF-8** writes the file in UTF-8 from then on, and **Cancel** writes nothing and keeps the edit.  
The same detection reads files for [Lookup](Lookup.md) and decides whether a file of an unknown type is text.

## Caret, scroll and undo

Each open file keeps one editor session, shared by the Editor view, the Interactive view and the Split view's source.  
Switching to another view or tab and back restores the caret, the selection, the scroll position and the undo history.  
A change made outside the editor, such as **Format**, **Minify**, **Convert to JSON** or a reload from disk, becomes one undo step.  
The session ends when the file's tab closes.

The editor stays in place while you work, so it keeps the focus and the caret:
typing, the first edit of a clean file or of a preview tab, `Ctrl+Z` and `Ctrl+Y` back to the saved text and away from it,
`Ctrl+S`, **Format**, **Minify**, **Convert to JSON** and the bar and toolbar buttons all leave the focus in the text.

## Drop to open

Drag files from the desktop or a file manager onto the editor area, the header or the status bar to open them.  
With no workspace open, a drop on the Explorer opens them too.  
While files are dragged over the window, the editor area shows a dashed outline with **Drop to open**.

- A file inside the workspace opens as that workspace file, in a permanent tab, and its row is revealed in the Explorer.
  The file is matched by its real location on disk, not by its name.
- Any other file opens in a tab of its own, marked `↗`, with the toast `Opened name from outside the workspace.`  
  It is never mixed up with a workspace file of the same name.
  Dropping the same file again activates its tab.
- Several files dropped at once each open.
- A dropped folder asks `Open name as a workspace?` in an **Open folder** dialog;
  **Open** adds it to the workspace switcher and switches to it, after asking about unsaved workspace files.
  With files and folders dropped together, the files open first and then the first folder is offered.
  A drop of the open workspace's own folder only says so.
  When the browser gives no link to the folder, a toast points to **Open folder…** in the workspace menu instead.
- A file dropped on a compare's empty side fills that side instead; see [Compare](Compare.md).
- The dropped file's text is never pasted into the editor it lands on.

Tabs of files from outside the workspace:

- They work with no workspace open, and stay open when the workspace changes.
- `Ctrl+S` or **Save** writes back to the original file.
  The first save asks the browser for permission to edit the file; a refusal keeps the edits unsaved.
- When the browser gives no link to the original file, **Save** opens a **Save as** dialog,
  whose **Save as…** button opens the browser's save dialog;
  the tab takes the picked file's name, and later saves go to that file.
  Nothing is ever written into the workspace in its place.
- They are open for the session only and are not saved to `.nib-studio-configuration.json`.
- A large CSV or TSV opens as a table that reads rows from disk as you scroll, like one in the workspace.

Files dropped on the Explorer tree are imported instead; see [Explorer](Explorer.md#drop-from-the-desktop).

## Paste from clipboard

**Paste from clipboard**, the last item of the `+` menu at the end of the tab bar and of **Start a compare** on the start screen,
opens what is on the clipboard in a tab of its own.  
It works with no workspace open too.  
The item is left out where the browser can't read the clipboard.  
Chrome may ask whether Nib Studio may see the clipboard, as for **Compare with clipboard**; the extension asks for no extra permission.

What it opens:

- **Text** opens with the views of the type its content reads as, in the view a file of that type opens in:
  **Tree** and **JSONPath** for JSON and YAML, **Tree** and **XPath** for XML, **Table** for CSV and TSV,
  and **Preview** for Markdown and HTML, which open in it.
- **A picture**, such as a screenshot, opens in the image preview.
- **Text and a picture together**, as Excel and Word put on the clipboard for copied cells or text, open as the text.
  The HTML a copy from a page or an editor also carries is never read, so the tab holds the plain text.

How the type is told, strictly, so that a sentence or a single line stays plain text:

| Type | When |
| --- | --- |
| JSON | an object or an array that parses as JSON; a bare number, string or `true` is plain text |
| HTML | a page that starts with `<!DOCTYPE html>` or `<html>`, or markup that starts with an HTML element such as `<div>`, `<p>` or `<table>`, closes a tag and ends with one |
| XML | well-formed markup that isn't HTML |
| YAML | at least two `key:` lines, no YAML error, and every document a mapping or a list of mappings; a sentence with a colon, a stack trace or a plain list is not YAML |
| TSV | two rows or more, each with the same number of tabs, and no column empty on every row, so lines of code indented with a tab aren't a table |
| CSV | the same with commas or semicolons, where most commas aren't followed by a space, as they are in prose |
| Markdown | a fenced code block, a table, or two kinds of Markdown, such as a heading and a list, or bold text and a link; a lone heading reads as a script's comment just as well |
| Plain text | anything else |

Names:

- The first pasted tab is `Clipboard.json`, `Clipboard.md` and so on, by its type, or `Clipboard.png` for a picture.
- The next ones are numbered after the highest number among the open tabs named so, saved pastes included,
  so no two tabs share a name: `Clipboard 2.csv`, `Clipboard 3.txt`.
  Once no such tab is open, numbering starts again at `Clipboard`.

The tab:

- It is unsaved from the start, with the dirty dot, and closing it asks **Discard unsaved changes** first.
- It has the toolbar, views and editor of its type, and edits to it stay unsaved until it is saved.
- It belongs to no folder, so it stays open when the workspace changes,
  is left out of `.nib-studio-configuration.json` and of Lookup,
  and relative links and images in pasted Markdown or HTML lead nowhere, as in a file from outside the workspace.
- Its context menu starts with **Save…**, which a table or a picture needs, as their toolbars have no **Save** button.
  **Reveal in Explorer**, **Copy path to clipboard** and the conversions are left out until it is saved;
  **Copy content to clipboard** and the toolbar's copy buttons copy its text as it is now.

Saving:

- **Save**, `Ctrl+S`, in a table or a picture's preview too, or **Save…** in the tab's menu,
  opens **Save Clipboard.json** with the name to give it, its base name selected.
  The file goes in the folder selected in the Explorer, or the folder of the file selected there,
  or at the workspace root when nothing is selected; the dialog says where, such as `Will be saved in docs/`.
- The suggested name is the tab's name, or the next number no entry of that folder takes, such as `Clipboard 2.json`.
  A name a file, a folder or an unsaved tab already takes, ignoring case, is refused in the dialog,
  and a file never overwrites one that appeared meanwhile.
- The text keeps the line endings it was copied with, and saves as UTF-8; a picture saves its own bytes.
- Once written, the tab becomes the file's tab: it takes the file's name and path, its row shows in the Explorer,
  and later saves write to it as for any workspace file.
- With no workspace open, **Save** asks `No workspace is open, so choose where to save Clipboard.json.`,
  and **Save as…** opens the browser's save dialog; the tab then saves back to the picked file,
  like a [file from outside the workspace](#drop-to-open).

Toasts:

| Case | Toast |
| --- | --- |
| Nothing, or only blank text, on the clipboard | `The clipboard is empty.` |
| Chrome or the user refused to let Nib Studio read it | `Nib Studio was not allowed to read the clipboard.` |
| Something other than text or a picture, such as formatted text with no plain text | `The clipboard holds no text or picture to paste.` |
| Any other failure | the browser's message, or `Could not read the clipboard.` |

## Session restore

The open tabs, the active tab and the active surface are saved to the workspace's `.nib-studio-configuration.json`;
tabs of files from outside the workspace are left out.  
Opening the workspace again reopens those tabs, as permanent tabs, and activates the same one.  
Files missing from the folder are skipped.  
See [Workspaces](Workspaces.md).
