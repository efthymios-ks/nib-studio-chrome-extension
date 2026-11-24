# Editor

The **Files** surface shows one tab per open file, a toolbar with the views for the active file, and the editor or view below it.  
Without a workspace it shows the start screen instead, unless a compare or a dropped file is open;
with no tab open, it points to the Explorer and to right-clicking the tree for a new file.  
The `+` button at the end of the tab bar opens a new compare; see [Compare](Compare.md#on-the-fly-compare).

## Tabs

Each tab shows the file's type icon and name, a dot while it has unsaved edits, and a `×` close button.  
Hovering a tab shows the file's path from the workspace root, such as `docs/readme.md`.  
A file from outside the workspace carries a small `↗` after its name,
and hovering its tab says it is outside the workspace and where **Save** writes; see [Drop to open](#drop-to-open).  
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
Files opened by **New file**, **Compare with…**, **Format JSON**, **Format YAML**, [Lookup](Lookup.md),
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
| Reveal in Explorer | opens the file's parent folders, selects its row, scrolls it into view and moves the focus to the tree; a hidden Explorer comes back, and on a narrow screen the drawer slides in; see [Explorer](Explorer.md#reveal-in-tree) |
| Compare with… | **Compare with clipboard**, **Compare with a file…**, **Compare with open tab: name**, each in a new diff tab; see [Compare](Compare.md) |
| New compare | an empty compare of the kind picked under it: Compare text, Compare JSON, Compare YAML, Compare XML, Compare Markdown or Compare tables (CSV/TSV) |
| Copy name to clipboard | the file name |
| Copy path to clipboard | the path from the workspace root |
| Copy content to clipboard | the file's text as saved on disk |
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
**Reveal in Explorer** sits on its own at the top of the menu, as on a diff tab.  
**Reveal in Explorer**, **Copy path to clipboard**, **Convert XML to JSON**,
**Convert YAML to JSON** and **Convert JSON to YAML** work on tabs of workspace files;
they are left out of the menu on the tab of a file from outside the workspace, which has no place in the workspace.  
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
- **Compare with…:** a chooser for the other side, then a new diff tab; see [Compare](Compare.md#the-compare-with-chooser).
- **Actions** for the type and view: **Format**, **Minify** and **Convert to YAML** for JSON,
  **Format** and **Convert to JSON** for YAML, **Convert to JSON** for XML,
  **Export HTML** and **Export PDF** for Markdown.
- **Save**, or a **View only** badge for tables and documents.

Hovering a view tab shows what the view does where it isn't obvious, such as **Interactive**.  
Clicking a view tab or an action keeps the focus in the editor; switching to another editor view moves the focus to its editor.

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
| `.docx`, `.docm`, `.dotx`, `.dotm`, `.doc`, `.pdf` | no view tabs, the preview frame | none, view only |
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
- **Preview:** the page alone; see [Preview](#preview).

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

**Preview** draws the file as a page, the way a browser would, without running anything in it:

- The page sits in a sandboxed frame that allows no scripts, so its styles never reach the studio and the studio's never reach it.
- It is sanitised with DOMPurify first:
  scripts, frames, objects, embeds, forms, `<base>`, `<meta>` and event handlers are dropped.
  Its own `<style>` elements and `style` attributes stay, in this view only.
- A style sheet linked with `<link rel="stylesheet" href="page.css">` is read from the workspace, relative to the page's folder,
  and put in the page; so is a style sheet it brings in with `@import`.
  A style sheet open in a tab with unsaved edits is drawn from that tab's text, so the page shows the edits before they are saved.
  Images, backgrounds and fonts the CSS points at come from the workspace too.
- Images come from the workspace, resolved like [Markdown images](Markdown.md#images), TIFF included;
  a HEIC picture shows `Nib Studio doesn't decode HEIC pictures.`,
  a missing one shows `Image not found:` and its path, and a web image shows a placeholder.
- Nothing loads from the web: a web style sheet is left out, and a web image, font or video is never fetched.
- A click on a link works as in the Markdown preview: a workspace file opens in a permanent tab,
  a folder expands in the Explorer, a web, `mailto:` or `tel:` link opens in a new browser tab, and `#id` scrolls within the page.
  A middle click on a web link opens it in a new tab too.
  Hovering a workspace link shows its path from the workspace folder.
- `Ctrl+S` in the page saves the file, as it does in the editor.
- The page is drawn again 300 ms after the text changes, keeping its scroll,
  and when a style sheet or image it uses changes on disk.
- An HTML file dropped from outside the workspace has no workspace folder: its style sheets are left out,
  its relative images show a placeholder, and its relative links say so in a toast.

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
- The [editor bar](#editor-bar) above the text, with Markdown formatting for Markdown files;
  see [Markdown](Markdown.md#formatting).

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
- Leaving the workspace asks first when workspace files are dirty:
  switching to another workspace in the switcher, **Open folder…**, opening a dropped folder,
  and **Forget** on the open workspace.
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

## Session restore

The open tabs, the active tab and the active surface are saved to the workspace's `.nib-studio-configuration.json`;
tabs of files from outside the workspace are left out.  
Opening the workspace again reopens those tabs, as permanent tabs, and activates the same one.  
Files missing from the folder are skipped.  
See [Workspaces](Workspaces.md).
