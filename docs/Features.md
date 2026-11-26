# Features

Every feature of Nib Studio, grouped by area.  
Each item says what it does and how to reach it.  
The other docs go deeper on each area; this one is the complete list.

## Opening Nib Studio

- **Toolbar button:** click the Nib Studio icon to open the studio in a new browser tab.
  Each click opens another tab.
  No keyboard shortcut opens the studio.
- **Language:** the interface is in English.

## Header

- **Skip to content:** the first `Tab` on the page shows a **Skip to content** link that moves to the main area.
- **Brand:** the Nib Studio mark and name on the left; at 720 px wide or less, the mark alone.
- **Workspace switcher:** the button with the workspace name, or **No workspace**, opens a menu with every remembered workspace,
  **Open folder…**, and a **Forget "name"** item per workspace.
  The active workspace is marked `(active)`; with none remembered, the menu shows **No recent workspaces**.
- **Surface tabs:** **Files** and **Hash & encode** switch the main area.
  The active surface is saved per workspace.
- **Theme toggle:** the moon (`☾`) or sun (`☀`) button switches between the light and dark theme.
  The choice is remembered.

## Workspaces

- **Pick a folder:** **Choose folder** on the start screen, or **Open folder…** in the workspace switcher, opens the browser folder picker.
  The folder becomes the workspace, with read and write access.
  A refused folder is neither remembered nor made active, and the open workspace stays;
  when Chrome hands the folder over but refuses edit access, a warning toast says so.
  Chrome reports a prompt refused inside its picker as a cancel, so that passes silently.
- **Drop a folder:** a folder dropped from the computer anywhere but the Explorer tree asks `Open name as a workspace?`;
  see [Drag and drop](#drag-and-drop).
- **Open a subfolder:** **Open as workspace** in the Explorer context menu of a folder makes that folder the workspace,
  as **Open folder…** would; the old workspace stays in the switcher.
- **Several workspaces:** every folder you open is remembered in the switcher.
  Picking the same folder again reuses its entry.
- **Switch workspace:** pick another workspace in the switcher.
  Tabs of dropped files from outside the workspace, and compares with no workspace file side, such as pasted or picked text, stay open.
  The new workspace's saved active tab is shown; when it has none, the first tab kept is the active one,
  after **Open folder…**, **Open as workspace** and a dropped folder too.
- **Forget workspace:** **Forget "name"** removes it from the list after confirmation.
  Files on disk are not touched.
  Forgetting the active workspace closes it with its tabs and compares;
  tabs of files from outside the workspace, and compares with no workspace file side, stay open.
- **Unsaved changes:** before another folder replaces the workspace, by **Open folder…**, **Open as workspace**,
  the switcher or a dropped folder, and before the active workspace is forgotten,
  workspace files with unsaved edits are listed by their path from the workspace root,
  such as `reports/data/orders.json`.
  **Save all** saves them and goes on, stopping with a message at a file that fails to save.
  **Discard** goes on without saving, and **Cancel**, `Esc` or a click outside keeps everything as it was.
  Unsaved files from outside the workspace are not listed; they stay open with their edits.
- **Same folder:** picking the open workspace's folder again with **Open folder…**, or dropping it,
  says it is already open and changes nothing.
- **Resume on open:** the last active workspace reopens by itself when the browser still grants access.
  Otherwise a toast asks you to click **Re-open last workspace** on the start screen, which asks for permission again.
- **Per-workspace state:** open tabs, the active tab, expanded folders and the active surface,
  saved to `.nib-studio-configuration.json` at the workspace root 400 ms after the last change.
  The file shows in the tree as soon as the studio first writes it.
- **Live refresh:** changes made on disk by other programs show up in the tree within moments.
  Unchanged open files reload; files with unsaved edits keep them and show a warning toast.
  A Markdown or HTML preview draws again when an image, style sheet or script it uses changes on disk.
- See [Workspaces](Workspaces.md).

## Explorer

- **Folder tree:** folders first, then files, sorted by name with numbers in natural order.
  Hidden files show too, `.nib-studio-configuration.json` included.
- **File-type icons and colours:** each row carries a glyph and colour for its type: JSON, XML, CSV, Excel, Word,
  presentation, OpenDocument, text, Markdown, HTML, CSS,
  JavaScript, TypeScript, YAML, HAR, PDF, image, archive, audio, video, font, folder, other.
  The longest matching suffix wins, so `.tar.gz` is an archive.
- **Tooltips:** hovering a row shows its path from the workspace root.
- **Dirty marker:** files with unsaved edits are marked in the tree.
- **Expand and collapse a folder:** click it, or use the arrow keys; its folder icon shows open while it is expanded.
- **Collapse all:** the `⊟` button in the Explorer header.
- **Expand all:** the `⊞` button in the Explorer header expands every folder in the workspace.
- **Preview open:** a single click on a file opens it in the preview tab.
- **Permanent open:** a double click on a file, or `Enter`, opens it in a tab that stays.
- **Multi-select:** `Ctrl+click` adds or removes a row, `Shift+click` selects a range, `Ctrl+A` selects every visible row,
  `Esc` clears the selection.
- **Keyboard:** `↑` and `↓` move, `→` expands a folder or steps into it, `←` collapses a folder or steps to its parent,
  `Enter` opens a file or toggles a folder, `F2` renames, `Delete` deletes the selection, `Ctrl+D` duplicates.
  Keys work while the tree has focus, and the focus comes back to the tree when their dialog closes;
  after a delete, the row after the deleted ones takes it.
- **Context menu:** right-click a row, or the empty area below the rows; on a touch screen, press and hold a row.
  A right-click on an unselected row selects it first.
- **Reveal in tree:** clicking an editor tab expands the file's parent folders and scrolls its row into view.
- **Reveal in Explorer:** in a file tab's context menu, it also selects the row and focuses the tree,
  brings a hidden Explorer back and, at 720 px wide or less, slides the drawer in.
- **Hide the Explorer:** a double click on the divider, or dragging the divider narrower than 100 px.
  A hidden Explorer leaves a `›` strip at the left edge; a click on the strip, a drag out of it or a double click shows the Explorer again.
  There is no keyboard shortcut for it.
- **Resize the Explorer:** drag the divider between the Explorer and the editor, from 160 px to 560 px.
  Width and hidden state are remembered.
- **Narrow screens:** at 720 px wide or less, the Explorer is a drawer that the `›` strip opens over the editor;
  `×`, `Esc` or a tap outside closes it.
  On touch screens, press and hold a row or a tab for its context menu.
- See [Explorer](Explorer.md).

## Lookup

- **Look up files…:** the box at the top of the Explorer, under its header, finds files by name and by content as you type.
  It shows while a workspace is open, and at the top of the drawer at 720 px wide or less.
- **Panel:** the files found show under the box, reaching over the editor, with a preview of the selected one beside them;
  at 720 px wide or less the panel takes the drawer's width, with the preview under the list.
- **Matching:** case, accents and Greek tones are ignored, a final `ς` counts as `σ`,
  and the separators space, `_`, `-`, `.` and `,` may come and go, so `my name` finds `MyName.txt`.
- **Ranking:** phrase in the name, then words in the name in any order, then phrase in the content,
  then scattered letters in the name, such as `mnm` for `MyName.txt`, only when close together, then words in the content;
  within each, an earlier match first, then a shorter name.
  At most 500 files, with at most 50 highlighted matches each.
- **List and preview:** each row has the type icon, the name with its matches highlighted and the folder, dimmed.
  A content match previews the text on one line around the first match, every match highlighted,
  with the line number for a text file, or the sheet and row for a workbook, such as `Q2 · row 14`.
- **Keys:** `↑` and `↓`, `PageUp` and `PageDown` select, `Enter` opens, `Ctrl+E` reveals the file in the Explorer,
  `Esc` clears the box and a second `Esc` goes back to the tree; the arrows never move the tree's selection.
  Moving the pointer over a file selects it and shows its preview, as the arrows do.
  A click on a file opens it; a click outside closes the panel and keeps the query.
- **Opening a match:** the file opens in a permanent tab; a content match in a text file opens in **Editor** with the match selected,
  one in a Word document or a PDF puts the match into **Find in document…**, and one in a workbook shows the sheet it is on.
- **What it reads:** text and files of an unknown type that are text, HTML without its tags and scripts,
  Word, Word 97–2003, every visible sheet of Excel and OpenDocument spreadsheets row by row,
  PowerPoint slides and speaker notes, OpenDocument text, presentations and drawings, and PDFs.
  Images, media, fonts, archives and files over 20 MB are found by name.
  It keeps at most 2,000,000 characters of each file, and 64,000,000 in all; files past the total are found by name.
  Files in `.git`, `node_modules`, `bin` and `obj` folders, and `.nib-studio-configuration.json`, are never listed.
- **Protected files:** found by name, and by content too while their tab keeps them unlocked with their password.
- **Index:** names are searchable from the first key; contents are read in the background in a worker, with a progress line,
  and every key searches in memory.
  The index lasts for the session, reads again only files that changed, follows the live refresh,
  and searches open files' unsaved edits.
- See [Lookup](Lookup.md).

## Explorer context menu

- **Open** (`Enter`): opens the selected file in a permanent tab.
  One file selected.
- **Open as workspace:** on one folder's row, makes that folder the workspace, as **Open folder…** would.
  Unsaved workspace files are settled first, the folder is remembered under its own name,
  and its `.nib-studio-configuration.json` is written in the folder itself.
  Left out for files, for several selected items and in the empty area.
- **Compare with…:** with one file selected, a header followed by **Compare with clipboard**, **Compare with a file…**,
  and **Compare with open tab: name** for every other open tab of a file with text.
  Each choice opens a new diff tab with the file as the original and the other side as the modified.
  See [Compare](Compare.md).
- **Compare these two files:** with two files of the same comparable type selected,
  opens them in a new diff tab, the upper one in the tree as the original.
- **Multi-select menu:** with more than one item selected, the menu holds **Compare these two files** (two comparable files only),
  **Delete** and **Refresh**.
- **New file:** asks for a name, `untitled.md` by default, and creates the file in the selected folder,
  the selected file's folder, or the workspace root.
  The new file opens.
- **New folder:** asks for a name and creates the folder in the same place.
- **Rename** (`F2`): asks for the new name with the name before the extension selected.
  Works on files and folders, and refuses inside the dialog a name another entry of the folder takes, ignoring case;
  a change of case only is allowed.
  Open tabs, and expanded folders inside a renamed folder, follow the new name.
- **Duplicate** (`Ctrl+D`): suggests a free name, such as `report-copy.json`, `report-copy-2.json`,
  and copies the file or the whole folder byte for byte.
- **Delete** (`Del`): deletes every selected item after a confirmation that lists each path.
  Their tabs close.
- **Copy name to clipboard:** the file or folder name.
- **Copy path to clipboard:** the path from the workspace root, such as `data/orders.json`.
- **Copy content to clipboard:** the text of one text file: as its tab holds it when it is open, unsaved edits included,
  and as saved on disk when it isn't, up to 64 MB.
  Files over 10 MB ask first.
- **Format JSON:** reformats a JSON file with 2-space indent and opens it with the change unsaved.
- **Format YAML:** reformats a YAML file with 2-space indent, keeping its comments, and opens it with the change unsaved.
- **Convert XML to JSON:** converts an XML file in the workspace and opens the result in a new tab named `name.xml.converted.json`.
- **Convert YAML to JSON:** converts a YAML file in the workspace and opens the result in a new tab named `name.yaml.converted.json`.
- **Convert JSON to YAML:** converts a JSON file in the workspace and opens the result in a new tab named `name.json.converted.yaml`.
- **Compare XML with…:** asks for the other file on disk and opens the XML diff in a new diff tab.
- **Save pages…:** saves chosen pages of a PDF as a new PDF beside it; see [PDF preview](#pdf-preview).
- **Refresh:** rereads the tree from disk.
- Items that do not apply to the selection are left out of the menu.
  Name checks: names cannot contain `/` or `\`, and cannot be `.` or `..`.

## Drag and drop

- **Move or copy in the tree:** drag one row, or a selection, onto a folder or onto the empty area for the workspace root.
  A dialog lists the source and target paths and offers **Move**, **Copy**, or `×` to cancel.
- **Drop target highlight:** the folder under the pointer is highlighted; the whole tree when the target is the root.
- **Spring-loaded folders:** holding a drag over a closed folder for 0.7 s expands it.
- **Edge scroll:** dragging near the top or bottom edge of the tree scrolls it.
- **Safe targets:** a folder cannot be dropped into itself or one of its descendants.
- **Same folder:** items dropped on the folder they are already in, on a file beside them,
  or at the root on the empty area, stay where they are; the drop does nothing, with no dialog and no message.
  A selection that mixes them with items from elsewhere lists, and moves or copies, only the items from elsewhere.
- **Name clashes on Move:** a **Name already exists** dialog offers **Replace**, **Keep both** and **Skip**,
  with **Apply to all** when more than one item clashes.
- **Name clashes on Copy:** copies get a free name such as `name-copy.ext`.
- **Open tabs follow:** a moved file, or a file inside a moved folder, keeps its tab under the new path.
- **Byte for byte:** moves, copies, renames, duplicates and desktop imports copy the file's bytes,
  so binary files such as `.xlsx`, `.docx` and images arrive intact.
- **Drop from the computer onto the tree:** files and whole folders dropped on a folder, on a file for its folder,
  or on the tree's empty area for the root, are imported after an **Import into the workspace** confirmation
  that lists each path they get.
  Name clashes, inside dropped folders too, offer **Replace**, **Keep both** or **Skip**, with **Apply to all**;
  a folder of the same name is merged into.
  The first imported file opens and is revealed, and a toast counts what was imported.
- **Drop of workspace items onto the tree:** a file or folder that already lives in the workspace,
  such as one dragged from the workspace folder in the file manager, is matched by its real location
  and gets the **Move or copy** dialog instead of an import.
- **Drop anywhere else:** the editor area, the header and the status bar open dropped files in tabs, never importing them.
  A file inside the workspace, matched by its real location, opens as that workspace file and is revealed in the tree;
  any other opens in a tab of its own, marked `↗`.
  Dropping the same file again activates its tab.
- **No workspace:** with no workspace open, files dropped on the Explorer tree open in tabs too.
- **Drop a folder:** a folder dropped anywhere but the tree asks `Open name as a workspace?`, and **Open** switches to it;
  with files and folders dropped together, the files open first, then the first folder is offered.
- **Drop on a compare:** a file dropped on an empty diff side fills that side instead of opening a tab.
- **Drop on the editor:** the dropped file's text is never pasted into the editor under the pointer.
- **Drop hints:** while files from the computer are dragged over the window, the editor area shows **Drop to open**
  inside a dashed outline, and, with a workspace open, the Explorer shows **Drop on a folder to import**
  and highlights the folder under the pointer.
  The hints clear on drop, when the pointer leaves the window, and on `Esc`.
- **Tabs of files from outside the workspace:** **Save** writes back to the original file after the browser's permission prompt;
  when the browser gave no link to it, **Save as…** opens the browser's save dialog.
  Nothing is written into the workspace in their place.
  They work without a workspace, survive switching workspaces, last for the session only,
  and are left out of `.nib-studio-configuration.json`.

## Tabs

- **Tab bar:** one tab per open file, with its type icon, name, a dirty dot and a `×` close button.
  Hovering shows the file's path from the workspace root.
  A file dropped from outside the workspace carries `↗`, and its tooltip says where **Save** writes.
  A pasted tab's tooltip says it was pasted from the clipboard.
- **Preview tab:** a single click in the tree opens the file in the one preview tab, in italics.
  The next single click replaces it.
- **Keep a tab:** a double click on the tab or the tree row, `Enter`, or any edit turns the preview tab into a permanent one.
- **Activate:** click a tab.
  The file is revealed in the tree.
- **Close:** the `×` button.
  A file with unsaved edits asks **Discard unsaved changes** first.
  The nearest tab to the right, or else to the left, becomes active.
- **New tab:** the `+` button at the end of the tab bar lists the empty compares,
  see [Compare](Compare.md#on-the-fly-compare),
  and **Paste from clipboard** after them; **Start a compare** on the start screen opens the same menu.
- **Paste from clipboard:** opens what is on the clipboard in an unsaved tab of its own,
  with the views of the type its content reads as: JSON, YAML, XML, HTML, Markdown, CSV or TSV, or else plain text.
  A picture opens in the image preview.
  When the clipboard holds text and a picture, as a copy of cells from Excel does, the text wins.
  Tabs are named `Clipboard.json`, then `Clipboard 2.md`, `Clipboard 3.txt` and so on.
  **Save**, `Ctrl+S` or **Save…** in the tab's menu asks for a name, in the folder selected in the Explorer or at the workspace root,
  and the tab becomes that file's tab.
  With no workspace open, the browser's save dialog asks where.
  An empty clipboard, a refused one and one with nothing to paste each say so in a toast.
  See [Editor](Editor.md#paste-from-clipboard).
- **Reveal in Explorer:** the first item of a file tab's context menu reveals the file in the tree,
  selects it and focuses the tree, without making the tab active.
  It is left out on the tab of a file from outside the workspace.
- **Tab context menu:** right-click a tab for **Reveal in Explorer**, **Compare with…**, **New compare**,
  **Copy name to clipboard**, **Copy path to clipboard**, **Copy content to clipboard**, **Format JSON**, **Format YAML**,
  **Convert XML to JSON**, **Convert YAML to JSON**, **Convert JSON to YAML**, **Compare XML with…**, **Save pages…**,
  **Close**, **Close others**,
  **Close to the right** and **Close all**.
  Closing tabs with unsaved edits lists them and asks first.
  **Compare with…** and **Copy content to clipboard** show on the tab of any text file,
  in a collapsed folder or from outside the workspace too.
  On a pasted tab, **Save…** comes first,
  and the commands for a file on disk, such as **Copy path to clipboard**, are left out;
  **Copy content to clipboard** copies the paste with its edits.
- See [Editor](Editor.md).

## Editor

- **CodeMirror 6:** line numbers, active line highlight, code folding, bracket matching, auto-indent,
  highlight of other matches of the selection, line wrapping, undo history.
- **JSON validator:** syntax errors in a `.json` file are underlined and marked in the gutter as you type, with the message on hover.
- **YAML validator:** syntax errors in a `.yaml` or `.yml` file are underlined and marked in the gutter as you type,
  with the message, line and column on hover; warnings, such as a repeated key or an unknown tag, are marked in the warning colour.
- **Syntax highlighting:** JSON, YAML, Markdown and HTML, with the CSS and JavaScript inside HTML.
  XML and other text open without highlighting.
- **Search and replace:** `Ctrl+F` opens the search panel with replace, match case, regex and whole word; `F3` and `Shift+F3`,
  or `Ctrl+G` and `Ctrl+Shift+G`, step through matches; `Esc` closes it.
- **Go to line:** `Ctrl+Alt+G`.
- **Multiple selections:** `Ctrl+D` adds the next occurrence of the selection;
  `Ctrl+Shift+L` selects every occurrence, at most 1,000; `Ctrl+click` adds a cursor.
  Every selection and cursor is drawn, and edits act on all of them.
- **Second keyboard layout:** with a layout such as Greek, shortcuts follow the place of the key, as Chrome reads its own,
  so `Ctrl+σ` saves and `Ctrl+δ` adds an occurrence, in the editor and in the Explorer alike.
- **Line editing:** `Alt+↑` and `Alt+↓` move lines, `Shift+Alt+↑` and `Shift+Alt+↓` copy them, `Ctrl+Shift+K` deletes them.
- **Undo and redo:** `Ctrl+Z`, `Ctrl+Y` and `Ctrl+Shift+Z`, or the **Undo** and **Redo** buttons of the editor bar.
  The history belongs to the file's tab, so it survives switching views or tabs;
  **Format**, **Minify** and reloads from disk are single undo steps.
- **Editor bar:** a slim bar docked above the text in every view that edits it,
  with **Undo** and **Redo**, greyed out when there is nothing to undo or redo,
  and the formatting buttons for Markdown and HTML; it scrolls sideways at 720 px wide or less.
  Its buttons never take focus from the text; see [Editor](Editor.md#editor-bar).
- **Focus kept:** typing, saving, undoing, **Format**, **Minify** and the bar and toolbar buttons
  leave the focus and the caret in the editor.
- **Indent:** `Tab` and `Shift+Tab` indent and outdent.
- **Save:** `Ctrl+S`, or the **Save** button in the toolbar.
  The button reads **Saved** when there is nothing to save.
  A file from outside the workspace saves back to its own file.
  In a view without an editor, such as **Tree** or **JSONPath**, `Ctrl+S` saves as **Save** does;
  where **Save** is off or missing, such as in **As JSON**, a preview or a table, it does nothing.
  On a pasted tab it asks where to save the paste, in a table or a picture's preview too.
  It never opens the browser's **Save as** dialog.
- **Line endings:** files keep their line endings, CRLF, LF or CR, when saved;
  a file that mixes them saves with its most common one.
- **Encodings:** a file opens in the encoding it is in and saves back in it:
  UTF-8 or UTF-16 by a byte order mark, UTF-8, or else the single-byte code page its letters read best in:
  Greek, Western European and Cyrillic are weighed whatever Chrome's languages are,
  and so is the code page of Chrome's languages, such as Windows-1250 for Polish;
  a tie goes to the code page of Chrome's languages, then Windows-1252.
  The status bar names it, such as `Windows-1253`.
  When an edit brings in a character that code page can't hold, **Save** asks whether to save as UTF-8 instead;
  see [Editor](Editor.md#text-encodings).
- **Conversions:** a conversion in a tab of its own, such as `orders.xml.converted.json`,
  is unsaved until **Save** writes it next to its source.
- **Pastes:** a tab opened by **Paste from clipboard** is unsaved until **Save** asks for its name and writes it;
  its text keeps the line endings it was copied with, and saves as UTF-8.
- **Dirty tracking:** a file is dirty while its text differs from the text on disk, line endings aside;
  undoing back to it clears the mark.
- **Caret and scroll memory:** switching views or tabs and coming back restores the caret, the selection and the scroll position.
- **View tabs:** the toolbar above the editor offers the views that fit the file type, listed below.
- **Type badge:** the toolbar shows `JSON`, `YAML`, `Markdown`, `XML`, `HTML`, `Text` or `Table`.
- **Copy buttons:** the toolbar copies the file in every view of its tab, from its text as it is,
  unsaved edits and pasted tabs included, and a toast says what was copied.
  A file with a rendered view (Markdown, HTML, CSV, TSV, JSON, YAML and XML) has **Copy raw**, its source text,
  and **Copy formatted**, what it renders as;
  a workbook has **Copy formatted** alone, and any other text file **Copy content**.
  **Copy formatted** copies JSON with a 2-space indent, YAML as **Format** lays it out and XML indented;
  one that doesn't parse copies nothing, and the toast says why.
  At 720 px wide or less the two fold into one **Copy** button with a menu of both.
  See [Editor](Editor.md#copy).
- **Empty state:** with no tab open, the editor area points to the Explorer and to right-clicking the tree for a new file.

## Views per file type

| File | Views |
| --- | --- |
| `.json` | Editor, Tree, JSONPath, Schema |
| `.yaml`, `.yml` | Editor, Tree, JSONPath, Schema |
| `.md`, `.markdown`, `.mdx` | Editor, Interactive, Split, Preview |
| `.html`, `.htm` | Editor, Interactive, Split, Preview |
| `.xml`, `.xsd`, `.xsl`, `.xslt`, `.config` | Editor, Tree, XPath, As JSON |
| `.csv`, `.tsv`, `.xlsx`, `.xls`, `.xlsm`, `.xltx`, `.xltm`, `.xlsb`, `.ods` | Table |
| `.docx`, `.docm`, `.dotx`, `.dotm`, `.doc` | Word preview with zoom, Find, Info and Copy formatted, no view tabs |
| `.pdf` | PDF preview with the zoom menu and Fit page, the page box, Save pages…, Find and Info, no view tabs |
| Images, TIFF included | Preview with zoom and Copy image, no view tabs; a HEIC shows its size and details only |
| Audio and video | Preview with the browser's player, no view tabs |
| Fonts | Preview with samples, characters and axis sliders, no view tabs |
| Archives, such as `.zip`, `.7z`, `.rar`, `.tar.gz` and `.iso` | A message with Info, no zoom and no view tabs |
| Presentations, `.ppt`, `.pptx`, `.pptm`, `.pps`, `.ppsx`, `.ppsm`, `.pot`, `.potx`, `.potm`, `.odp`, and OpenDocument `.odt` and `.odg` | A message with Info, no zoom and no view tabs |
| Any other file | Editor, when its first 8 KB are text; otherwise a message with Info |

The chosen view stays when you switch to another file that offers it.
Opening a Markdown or HTML file shows **Preview**, and a file made with **New file** opens in **Editor**.

## JSON

- **Views:** a `.json` file offers **Editor**, **Tree**, **JSONPath** and **Schema** in its toolbar.
- **Tree:** the **Tree** view, a read-only collapsible tree with type-coloured values and a count of keys or items per object and array.
  The `▾` twist folds a node; `⊞` expands every node, `⊟` collapses them.
  Invalid JSON shows what was expected and what was found, such as `Expected a value but found end of input.`,
  with the exact line and column.
- **Path bar:** clicking a key or value in the tree, or `Enter` on a focused row, shows its JSONPath above the tree,
  such as `$.orders[1].id`; **Any position** turns every index into `[*]`, **Copy** copies the path,
  and **Use in JSONPath** opens the JSONPath view with it.
- **Format:** the toolbar button in the Editor view reformats with 2-space indent.
- **Minify:** the toolbar button in the Editor view strips all whitespace.
  Both leave the change unsaved and report invalid JSON in a toast, with the line and column.
- **Format JSON:** the Explorer and tab context-menu command reformats a JSON file, opening it first when needed.
  Invalid JSON gets the same toast as **Format**, with the line and column.
- **JSONPath:** the **JSONPath** view; type an expression, such as `$.orders[*].id`, and press `Enter`.
  The box starts with `$`, and the expression runs whenever the view opens.
  The status line says `Enter to run` while the box is edited, then the count and time, such as `12 matches · 3 ms`,
  or the error with its position, with the part at fault marked under the box.
  Each match is a card with its index from `[0]`, its normalised path, a type badge such as `object · 3 keys`,
  and its value pretty-printed with the tree's colours; a value over 24 lines shows 20 and **Show all n lines**.
  Paths and values are plain text to select and copy;
  `Ctrl+C` on a focused card with nothing selected copies its value.
  Double-click a card, press `Enter` on it or click its `↗` to show the node in the Tree view.
  **Compact** puts each value on one line and **Formatted** indents it again,
  and the copy icon copies every value as a JSON array.
  `?` opens examples built from the document's own keys, which run on click, and a syntax list.
  The first 200 matches show, then **Show 200 more**, or as many as are left; the arrow keys move between cards.
  The last expression, the layout and the help stay as they were while the studio is open,
  and `Ctrl+Z` and `Ctrl+Y` in the box reach back past a trip to another view.
- **Schema:** the **Schema** view, with **Validate**, **Generate** and **Sample** at its top;
  each file keeps its mode, its schema text with its undo history, and **Required only** while its tab is open.
  A file with no schema yet starts with the last schema used in any file, so several files check against one schema with one paste.
  **Validate** checks the document against a pasted JSON Schema as you type, 300 ms after the last key, at once on paste and on `Ctrl+Enter`.
  `@cfworker/json-schema` checks Draft 2020-12 with formats; the status says `OK — n keywords checked.`, the number of errors,
  or why the schema itself is invalid, and each error is a card with its path, keyword badge and message.
  Double-click, `Enter` or `↗` shows the node in the Tree view.
  **Generate** infers a Draft 2020-12 schema from the document and shows it formatted, as text to select and copy;
  **Use to validate** puts it in the Validate box.
  **Sample** builds a sample document from the schema in the box Validate shares, as you type, at once on paste and on `Ctrl+Enter`,
  formatted like Generate's output and without reading the open document.
  `const`, `examples`, `default` and `enum` come first, then `type`, with `$ref`, `allOf`, `anyOf`, `oneOf`, `if` / `then` / `else`,
  formats, patterns, bounds, `uniqueItems` and `contains` followed;
  from 8 levels deep objects keep only their required properties and arrays their minimum length, so recursion ends,
  and from 16 levels they stay empty.
  **Required only** gives objects only their required properties.
  The validator checks every sample, and each keyword it misses, such as a complex `pattern`, is listed under it.
- **Convert to YAML:** the toolbar button in the Editor view, and **Convert JSON to YAML** in the context menus,
  open the document as YAML in a tab of its own; see [YAML](#yaml).
- **Compare with…:** the toolbar button opens a structural diff in a new diff tab; see [Compare](Compare.md#json).
- See [JSON](Json.md).

## YAML

- **Views:** `.yaml` and `.yml` files offer **Editor**, **Tree**, **JSONPath** and **Schema** in their toolbar.
  Every view but **Editor** reads the YAML as JSON data, by the [conversion rules](Yaml.md#conversion-rules).
- **Editor:** YAML highlighting and folding, and the validator, which underlines errors as you type and marks them in the gutter,
  with the parser message, line and column on hover; a repeated key or an unknown tag is a warning.
- **Tree:** the **Tree** view, the data as the read-only [JSON](#json) tree, with JSONPath in the path bar, such as `$.server.port`.
  A file of several documents shows each as a top-level item, **Document 1**, **Document 2** and so on,
  whose paths are `$[0]`, `$[1]` and so on, as the documents are an array when converted to JSON.
  Invalid YAML shows the parser message with line and column.
- **JSONPath:** the [JSONPath](#json) view, run on the data.
- **Schema:** the [Schema](#json) view on the data: **Validate** against a pasted JSON Schema, **Generate** a schema, or **Sample** one.
- **Format:** the toolbar button in the Editor view re-indents the YAML with 2 spaces,
  keeping comments, documents, anchors, aliases, tags, quotes, and the way numbers and folded text are written.
  It leaves the change unsaved as one undo step, and reports invalid YAML in a toast, with the line and column.
- **Format YAML:** the Explorer and tab context-menu command formats a YAML file the same way, opening it first when needed.
- **Convert to JSON:** the toolbar button in the Editor view replaces the file's text with the JSON conversion, unsaved, as XML's does,
  so **Save** writes JSON into the `.yaml` file.
- **Convert YAML to JSON:** the Explorer and tab context-menu command leaves the YAML alone
  and opens the JSON in a separate tab, such as `app.yaml.converted.json`, that **Save** writes next to the YAML file.
  It is left out of the menu for files from outside the workspace.
- **Convert JSON to YAML:** for a `.json` file, the context-menu command and the **Convert to YAML** toolbar button
  open the YAML in a separate tab, such as `data.json.converted.yaml`, that **Save** writes next to the JSON file;
  the toolbar button takes the editor's text, unsaved edits included.
  Both are left out for files from outside the workspace.
- **Compare with…:** the toolbar button opens a structural YAML diff in a new diff tab; see [Compare](Compare.md#yaml).
- See [YAML](Yaml.md).

## XML

- **Views:** `.xml`, `.xsd`, `.xsl`, `.xslt` and `.config` files offer four views in their toolbar,
  **Editor**, **Tree**, **XPath** and **As JSON**.
- **Tree:** the **Tree** view, a read-only tree of elements with their attributes and text;
  the `▾` twist folds an element, `⊞` expands every node and `⊟` collapses them.
  Invalid XML shows the parser message with line and column.
- **Path bar:** clicking an element, attribute or text in the tree, or `Enter` on a focused row, shows its XPath above the tree,
  such as `/orders/order[2]/@id`, with positions only for repeated elements.
  **Any position** leaves the positions out, **Copy** copies the path, and **Use in XPath** opens the XPath view with it.
- **XPath:** the **XPath** view; type an expression, such as `//order/@id`, and press `Enter`.
  The box starts with `/*`, and the expression runs whenever the view opens.
  It works like the [JSONPath](#json) view: a status line with the count and time, one card per match counted from `[1]`,
  paths and values as plain text to select and copy, `Ctrl+C` on a focused card for its value,
  and double-click, `Enter` or `↗` to show the node in the Tree view, where it is selected and flashed.
  Elements show as indented, coloured XML, attributes as `name="value"` and text as the text.
  The copy icon copies elements as XML and attributes and text as their values, one per block.
  `?` offers examples built from the document's own element names, attributes and text.
  An invalid expression says why and at which character, and marks it.
  The last expression is kept while the studio is open.
- **As JSON:** the **As JSON** view, a read-only JSON tree of the document converted to JSON, marked **converted from XML**.
  Attributes become `@name` keys, an element's text goes under `#text` beside them or beside its child elements,
  an element of text alone becomes its text, an empty one `null`, and repeated elements become arrays.
  **Save** is disabled in this view.
- **Convert to JSON:** the toolbar button in the Editor view replaces the file's text with the JSON conversion, unsaved,
  so **Save** writes JSON into the `.xml` file.
- **Convert XML to JSON:** the Explorer and tab context-menu command leaves the XML alone
  and opens the JSON in a separate tab, such as `orders.xml.converted.json`, that **Save** writes next to the XML file.
  It is left out of the menu for files from outside the workspace.
- **Compare with…:** the toolbar button opens a structural XML diff in a new diff tab;
  **Compare XML with…** in the Explorer and tab context menus compares with a file picked from disk.
  See [Compare](Compare.md#xml).
- See [XML](Xml.md).

## Markdown

- **Formatting:** the editor bar above **Editor**, **Interactive** and **Split** adds 11 buttons after **Undo** and **Redo**:
  bold, italic, strikethrough, inline code, link, heading level, quote, code block, bulleted, numbered and task lists.
  They act on the selection, or on the word at the caret, and show as pressed while the caret is in their format.
  **Heading level** opens a menu of normal text and headings 1 to 6;
  **Code block** opens a menu of **No language**, languages from `bash` to `yaml` in alphabetical order, `mermaid` included,
  and **Remove code block** inside a block; `Esc` or a click outside closes a menu.
  `Ctrl+B`, `Ctrl+I`, `Ctrl+Shift+X`, `Ctrl+E` and `Ctrl+K` apply the inline formats; see [Markdown](Markdown.md#formatting).
  In **Interactive**, `Ctrl+K` and **Link** edit the link's address in a popover instead.
- **List keys:** `Enter` continues a list, task list or quote and ends the list on an empty item,
  `Backspace` at the start of an item removes its marker, and `Tab` and `Shift+Tab` nest and un-nest items.
- **Interactive:** edits the document like a word processor while the file stays Markdown;
  the syntax is never shown, wherever the caret is.
  Markers, link addresses, heading and quote marks, escapes and setext underlines are hidden;
  lists show bullets, numbers and checkboxes that tick the task in the text, and rules show as lines.
  Hidden syntax is one unit for the arrow keys, clicks, `Backspace` and `Delete`,
  the caret takes the formatting of the character before it, and a formatted run that loses its last character loses its markers.
  A space at the edge of a bold, italic or struck run goes outside its markers, and text typed on after it stays in the run.
  `Ctrl+K` or **Link** opens a popover for the link's address.
  Code blocks and front matter are boxes edited in place, with a language label that opens the language menu;
  a `mermaid` block shows its diagram, and its source beside a live drawing while the caret is in it.
  Tables are grids of cells with `Tab`, the arrow keys and a right-click menu for rows and columns.
  Pasting from a web page, Word or Google Docs inserts Markdown; `Ctrl+Shift+V` pastes plain text.
  Files over 500,000 characters show as plain source there; see [Markdown](Markdown.md#interactive-view).
- **Split:** source on the left, live preview on the right.
  Drag the divider to change the ratio, from 10% to 90%; it lasts while you edit,
  and switching views or tabs puts it back at half and half.
  At 720 px wide or less, the preview sits under the source.
- **Preview:** the rendered document alone.
- **Rendering:** CommonMark with tables, strikethrough and auto-linked URLs.
  Raw HTML renders, sanitised with DOMPurify as GitHub does:
  `<img>`, `<p align>`, `<div align>`, `<details>` and `<summary>`, `<kbd>`, `<sub>`, `<sup>`, `<mark>`, `<ins>`, `<del>`,
  `<picture>` and tables show, while scripts, event handlers, styles, frames, objects, forms and `javascript:` addresses are dropped.
  **Interactive** keeps raw HTML as text.
- **Workspace images:** an image with a relative path, such as `images/chart.png`, comes from the Markdown file's folder,
  and one starting with `/` from the workspace folder, in **Preview**, **Split** and **Interactive**.
  PNG, JPEG, GIF, SVG, WebP, AVIF and the other formats the browser draws show from the file;
  TIFF pictures are decoded in the studio and show as PNG,
  and a HEIC picture shows `Nib Studio doesn't decode HEIC pictures.` in its place.
  A missing one shows `Image not found:` and its path.
- **Workspace links:** a link to a workspace file opens it in a permanent tab and reveals it in the tree;
  `guide.md#setup` opens a Markdown or HTML file in **Preview** at that heading,
  and a link to a folder expands and selects it in the Explorer, which comes into view, even when hidden.
  A missing target says so in a toast, such as `docs/guide.md isn't in the workspace.`
  Hovering a link shows its path from the workspace folder.
- **Web links:** a link to a web address, `mailto:` or `tel:` opens in a new browser tab, and the studio stays open.
- **Heading ids:** every heading gets an id from its text, so `[link](#section-name)` jumps within the document.
- **Mermaid:** ` ```mermaid ` blocks render as diagrams; a broken diagram shows its error in place.
  **Copy Mermaid** copies the diagram source, **Enlarge** opens the diagram in a new tab.
- **Images:** `data:` images show; images with a web address show a placeholder with the address instead,
  so nothing loads from the network.
- **Files from outside the workspace:** a dropped Markdown file has no workspace folder,
  so its relative images show a placeholder that says so, and its relative links say so in a toast.
- **Copy code:** in **Preview** and **Split**, each fenced code block has a `⎘` button in its corner,
  **Copy code**, shown on hover; it copies the code exactly, without the line break that ends the block.
  Exported HTML and PDF pages and **Copy formatted** have no such button.
- **Copy formatted:** the toolbar's button copies the rendered document as HTML with its text,
  so it pastes into Word, Outlook or Google Docs with its headings, lists, tables, links and pictures.
  Workspace pictures go inside it, up to 10 MB in all,
  and Mermaid diagrams go in as pictures, drawn as for **Export HTML**;
  a diagram that can't be drawn goes in as its source in a code block.
- **Export HTML:** downloads `name.md.html`, a standalone page with its own styles that works offline:
  workspace images travel inside it as `data:` addresses, TIFF as PNG and HEIC as its placeholder,
  and web images keep their addresses.
  Mermaid diagrams travel inside it as pictures: a PNG at twice their size on white, whatever the studio's theme,
  or the SVG itself when no PNG can be made; a diagram that can't be drawn shows the preview's error text.
  The page takes at most 25 MB of workspace images in all;
  an image past that shows `Image too large to embed:` with the limit and its path.
- **Export PDF:** opens the print dialog for the rendered document once its images have loaded,
  waiting 10 seconds at most, with its diagrams drawn as in **Export HTML** and web images as their placeholder;
  pick **Save as PDF**.
- **Compare with…:** a document-style diff in a new diff tab; see [Compare](Compare.md).
- See [Markdown](Markdown.md).

## HTML

- **Views:** `.html` and `.htm` files offer **Editor**, **Interactive**, **Split** and **Preview**, as Markdown does,
  with an `HTML` badge, and open in **Preview**.
- **Editor:** the source with HTML highlighting, and the editor bar with **Bold**, **Italic**, **Link**, **Heading level**,
  **Bulleted list** and **Numbered list**, which wrap or unwrap the selection in `<strong>`, `<em>`, `<a href>`, `<h1>` to `<h6>`,
  `<ul>` and `<ol>`; `Ctrl+B`, `Ctrl+I` and `Ctrl+K` too, and **Link** and `Ctrl+K` ask for the address in a popover.
- **Interactive:** the page edited like a document while the file stays HTML, byte for byte apart from the edits:
  tags are hidden and the caret passes over them, text takes the look of its elements, list items show bullets or numbers,
  images show from the workspace, and `<head>`, styles, scripts, comments and other elements with no text to edit are small boxes.
  `Backspace` and `Delete` never remove a tag, `Enter` adds a paragraph or list item, `Shift+Enter` a `<br>`,
  and typed or pasted `<`, `>` and `&` are escaped; the same formatting bar works there.
- **Split:** the source beside its page, drawn again 300 ms after typing stops.
- **Preview:** the page as a browser draws it, with its scripts running: `<script>` elements, event handlers,
  `javascript:` links, timers and dialogs, so buttons, tabs and menus a script drives work,
  such as those of a page saved by a Markdown compare's **Export HTML**.
  A form's `submit` handlers run too, while the submission goes nowhere.
  The page runs in the extension's sandbox page, with an origin of its own and no network:
  it can't reach the studio, the workspace, the extension or the web, and its styles stay apart from the studio's.
  WebRTC is taken away from it, and it has no frames or workers of its own.
- **Workspace files:** style sheets linked with `<link rel="stylesheet">`, scripts linked with `<script src>` and images
  come from the workspace, resolved against the page's folder;
  nothing loads from the web, so web images show a placeholder and web style sheets and scripts are left out.
  A style sheet or script open in a tab with unsaved edits is drawn from that tab's text.
  TIFF and HEIC pictures show as they do in Markdown.
- **Links:** a link to a workspace file or folder opens it as a link in a Markdown preview does;
  a web, `mailto:` or `tel:` link opens in a new browser tab, a missing file says so in a toast,
  and `#id` links and `location.hash` move within the page.
  Only a click or a key press opens a link, never the page's script by itself.
- **Updates:** the preview draws the page again 300 ms after the text changes,
  and when a style sheet, script or image it uses changes on disk, running its scripts afresh and keeping the scroll.
- **Copy formatted:** the toolbar's button copies the page as written, as HTML with its text,
  its workspace pictures inside it, and without its scripts, style sheets, forms and controls.
- See [Editor](Editor.md#html).

## Compare

- **Diff tabs:** every compare opens its own tab, titled `left ↔ right` with a `⇄` glyph; the file's own tab never turns into a diff.
  A new compare is titled by its kind, such as `JSON compare` or `Table compare 2`.
  Asking for a pair that a diff tab other than a new compare already compares, in either order, focuses that tab.
- **Engines:** JSON, YAML, XML, Markdown and table files get their own diff; any other text gets the line diff.
  Clipboard and pasted text follow the file they are compared with.
- **Compare with… button:** in the toolbar of a text, JSON, YAML, XML, Markdown or table file, opens a chooser for the other side:
  an open tab, a workspace file with search, **File from disk…**, **Clipboard** or **Paste text…**.
  The workspace files listed are those of the same kind, at most 200 shown,
  found among the first 5,000 files outside `.git` and `node_modules`.
- **Context menus:** **Compare with…** in the Explorer and tab menus lists **Compare with clipboard**, **Compare with a file…**
  and **Compare with open tab: name**.
  A clipboard with no text, or one the browser refuses to read, says so in a toast, and no diff tab opens.
  **Compare these two files** in the Explorer menu compares two selected files of the same type, the upper one as the original.
  **Compare XML with…** compares an XML file with a file picked from disk.
  A file that isn't text, or that opens only as a preview, is refused with a toast, whether it is chosen in the Explorer
  or picked from disk, and a file of an unknown type is read first to tell; see [Explorer](Explorer.md#context-menu).
- **New compare:** `+` at the end of the tab bar, **Start a compare** on the start screen,
  or **New compare** in a tab's context menu opens an empty compare of a chosen kind:
  **Compare text**, **Compare JSON**, **Compare YAML**, **Compare XML**, **Compare Markdown** or **Compare tables (CSV/TSV)**,
  with no folder needed.
  **Compare as** in its toolbar switches the kind; new compares last for the session only.
- **Left and right:** an **Original** and a **Modified** header over each side, with the name and where it comes from.
- **Swap:** the **Swap** toolbar button, or **Swap sides** in the diff tab's context menu.
- **Change a side:** **Change original…** and **Change modified…** in the toolbar,
  which read **Pick original…** and **Pick modified…** while their side is empty,
  or **Choose file…** in a side header open the chooser for that side.
- **Side actions:** every side header offers **Paste**, **Edit** and **Choose file…**, and **Clear** once the side has something.
- **Paste:** `Ctrl+V` replaces the side under the pointer or with focus, or fills the first empty side; a pasted file fills it as a file.
- **Edit a side:** **Edit** opens the side's text in an editor; **Apply**, `Ctrl+Enter` or `Ctrl+S` puts it on the side,
  and **Cancel** goes back.
- **Drop zone:** an empty side, titled **Choose what to compare with**, takes a file dragged from the Explorer,
  a file dropped from the computer, pasted text, **Paste from clipboard**, or a click, `Enter` or `Space` to choose a file.
- **Invalid input:** a JSON, YAML or XML side that doesn't parse shows the parser message with line and column above its text.
- **Live sides:** a side open in a file tab follows its unsaved edits; a closed workspace file is read again when it changes on disk.
- **Reveal in Explorer:** activating a diff tab, or **Reveal in Explorer** in its context menu, reveals the modified side's workspace file;
  the menu item also selects its row and focuses the tree, as on a file tab.
- **Diff tab context menu:** **Swap sides**, **Reveal in Explorer**, **Export JSON**, **Export HTML**, **New compare**, **Close**,
  **Close others**, **Close to the right** and **Close all**.
  The exports show once both sides are chosen, and **Reveal in Explorer** when the modified side is a workspace file.
  `Ctrl+S` does nothing in a diff tab.
- **Exports:** **Export JSON** downloads the diff document, plain JSON with the sides, the rules, every change and both sides aligned row for row;
  **Export HTML** downloads a page of its own with the same side-by-side diff, light or dark as the system prefers,
  and its own **Diff**, **Before**, **After** bar with `p`, `n`, `↑` and `↓`;
  a Markdown diff's page is the Markdown diff page itself, in light,
  whose `↑` and `↓` are buttons, with `n` and `p` for keys.
  Both work for every kind, Markdown included, named such as `orders-vs-orders-v2.diff.json`,
  and show the diff as the tab does, rules and all.
  The page fetches nothing and opens from disk offline; nothing is written into the workspace.
- **Printing an exported page:** the page leaves out its bar.
  A Markdown diff's page also leaves out **Copy Mermaid**, **Copy table**, **Enlarge**
  and the **Before** and **After** tab labels,
  prints both **Before** and **After** of a changed diagram or table, each labelled,
  and prints the **Changes** list in full.
- **State per tab:** sides, rules, the bar's view, the current change, scroll, expanded nodes
  and the computed result survive leaving the tab and coming back.
- **Saved with the workspace:** diff tabs between two workspace files reopen with the workspace, at their place among the tabs;
  diffs with no workspace file side, of the clipboard, pasted text or files from disk,
  stay open when another workspace opens and last until the studio tab closes.
- **Diff bar:** a floating bar at the bottom right of the text, JSON, YAML, XML and row diffs, like the Markdown diff's:
  **Diff**, **Before** and **After** views, the position of the current change such as `3 / 12`,
  **Previous change (p)** and **Next change (n)** that scroll to each change and flash it, `↑` and `↓` keys,
  and `↻` **Recompute**; a click on a highlighted change makes it the current one.
- **Text diff:** both sides side by side at full width, aligned line for line with hatched placeholders,
  and line numbers per side.
  **Compare rules** in the toolbar, such as `Compare rules · 2` while two rules differ from the defaults,
  opens a popover for whitespace, case, blank lines, line endings, trimming, sorting, unique lines
  and ignore patterns added with **+ Add pattern**;
  each change applies at once and the diff updates behind it.
  `Esc`, a click outside or the button again closes it, and `Tab` and the arrow keys move inside it.
  Lines a rule leaves out stay greyed in italics.
- **Aligned grid:** the JSON, YAML and XML diffs show both documents as one full-width grid with a shared scroll,
  with hatched placeholder rows where a side lacks a key; a twist opens or closes a node on both sides.
- **Change kinds:** the JSON, YAML and XML diffs class each change as added, removed, changed or type changed,
  and the row diff as added, removed or changed;
  in the first three `null` counts as a missing value,
  so a value in place of `null` is added and `null` in place of a value removed.
- **Recompute on change:** changing a rule or an option compares again;
  large inputs wait a moment first, with **Comparing…** in the bar.
- **Sort toggles:** **Sort keys** is on by default in the JSON and YAML diffs; **Sort by name** in the XML diff and **Sort columns** in the row diff
  are off by default.
- **JSON diff:** array rules with **Match items by** and **Sort items by**, set by clicking an array's `[` in the grid
  and listed under **Rules (n)** in the toolbar, with **Edit** and **Remove**.
- **YAML diff:** both sides read as JSON data, by the [conversion rules](Yaml.md#conversion-rules), in the JSON diff,
  with its sorted keys, array rules, change kinds, bar and exports; the exports name the kind YAML.
- **XML diff:** the converted document in the same grid, labelled as **XML** or **JSON names**,
  with options for whitespace-only text and trimming, both on by default, namespace prefixes and case, each with a tooltip,
  and **Element rules** for repeated elements, set by clicking an element's `[` in the grid and listed under **Rules (n)**.
- **Rules picker:** array rules, element rules and row matching share one dialog with **Match … by** and **Sort … by** field lists,
  an **Order** list to rank the picked fields, **Save rule** and **Cancel**, and **Remove** on an existing rule.
- **Markdown diff:** a rendered document with insertions and deletions, a **Changes** index that jumps to each change,
  a **Diff**, **Before**, **After** view bar, change stepping with its `↑` and `↓` buttons or the `n` and `p` keys,
  a side-by-side modal from `⇄` or a click on a change, with `←`, `→`, `Esc` and a magnifier for diagrams,
  **Before** and **After** tabs on changed Mermaid diagrams, and **Copy Mermaid**, **Copy table** and **Enlarge**.
- **Row diff:** CSV, TSV, Excel and OpenDocument spreadsheet rows paired by key columns in one full-width aligned table, with placeholder rows and columns
  and highlighted changed cells; the bar steps row by row, and through each changed cell.
  The `Match: id · Sort rows: none` toolbar button picks the key and sort columns;
  CSV and TSV files over 2 MB are refused with a message.
  A workbook with more than one sheet gets an **Original sheet** or **Modified sheet** picker in the toolbar;
  the modified side follows the original's sheet when it has one of the same name, and the exports name the sheets compared.
- See [Compare](Compare.md).

## Tables

- **Formats:** `.csv`, `.tsv`, and the workbooks `.xlsx`, `.xls`, `.xlsm`, `.xltx`, `.xltm`, `.xlsb` and `.ods`,
  open in the **Table** view.
  CSV and TSV go through Papa Parse, and those over 2 MB through the studio's own reader,
  each guessing the delimiter (`,`, `;`, tab, `|`); workbooks go through SheetJS.
  The first row of each table and sheet is the header.
- **Sheets:** a workbook with more than one sheet has a strip of sheet tabs under its rows, as in Excel,
  in workbook order with the active one highlighted, and `‹` and `›` to scroll it when the tabs don't fit.
  A click, `Ctrl+PageDown` and `Ctrl+PageUp` while the table has the focus,
  or the arrow keys, `Home` and `End` on the tabs move between sheets;
  `Ctrl+Shift+PageDown` and `Ctrl+Shift+PageUp` do the same, since Chrome keeps the plain keys for its own tabs.
  Hidden sheets have no tab: **⋯ 1 hidden** says how many there are and shows one to view.
  The status bar names the sheet on screen, such as `Sheet 2 of 4 · Q2`.
  The workbook is read once per version of the file, so switching sheets is instant.
- **Macros:** the macros of a macro-enabled workbook or template never run; its sheets show like any other workbook's.
- **Type:** the status bar names the kind of workbook, such as `Excel macro-enabled workbook` or `OpenDocument spreadsheet`.
- **Locked workbooks:** a workbook encrypted with a password asks for it in the table area, with the PDF's password box;
  a wrong one says so, **Cancel** leaves a clear message, and switching tabs doesn't ask again.
  XLSX, XLSM, XLTX, XLTM and XLSB: Agile and Standard encryption; `.xls`: RC4, RC4 CryptoAPI and XOR obfuscation.
  A workbook locked with Excel's own password, `VelvetSweatshop`, opens without asking, as in Excel.
- **View only:** a **View only** badge; tables cannot be edited or saved, and have no Editor view.
- **Paging:** in CSV and TSV files up to 2 MB, and in Excel files, rows render 200 at a time as you scroll to the bottom.
  Sort, filters and search always cover every row of the file.
- **Row numbers:** a `#` column numbering the rows as shown; in large files, each row's number in the file.
- **Sort:** click a header to cycle ascending, descending, none; the header shows `↑` or `↓`.
  `Shift+click` adds a column to the sort.
  Numbers and ISO dates sort by value.
- **Filters:** the `⚑` button on a header opens the filter: contains, does not contain, equals, starts with, ends with, `=`, `≠`, `<`, `>`,
  between (numbers), one of (pick from up to 50 distinct values, from the first 2,000 rows of a large file),
  is empty, is not empty.
  **Apply** and **Clear**; `Esc` or a click outside closes it, and the status line counts active filters.
- **Search:** type in the **Search visible columns** box and press `Enter` to match across visible columns, ignoring case;
  clearing the box shows every row.
- **Columns:** the **Columns** button lists every column to show, hide or **pin** to the left;
  **Reset** in the list shows all columns, unpins them and restores the original order and widths.
- **Reorder:** drag a header onto another.
- **Resize:** drag a header's right edge, from 60 px; double-click it to fit the content, up to 600 px,
  measured over the first 5,000 rows, or the rows drawn in a large file.
- **Copy formatted:** the file toolbar's button copies the table as shown, the sheet, sort, filters, search,
  query result and visible columns included, as an HTML table and tab-separated text, so it pastes as cells;
  past 10,000 rows as tab-separated text only, and past 100,000 rows only the first 100,000, which the toast says.
  **Copy raw** copies a CSV or TSV file's text; see [Tables](Tables.md#copy).
- **Reset view:** clears filters, sort, search, column order, visibility, pins and widths.
- **Memory per tab:** sort, filters, search, columns and scroll come back when you return to the table's tab, until it closes;
  a workbook keeps them for each sheet, with the sheet on screen, and each sheet keeps its own query result.
- **Status line:** `visible of total rows`, counted over the whole file, and the number of active filters.
- **Large files:** a CSV or TSV over 2 MB is indexed by byte offset and read on demand, never loaded whole.
  Only the rows on screen are drawn, from an LRU cache of parsed 2,000-row blocks.
  Search, filters and sort run as background scans with progress, a new one stopping the one before,
  and **Go to row** jumps to a row number.
  A sort that would need more than 256 MB keeps the file order and says so; **Copy formatted** copies at most 100,000 rows.
  A **Large file** badge marks these files; a row diff tab refuses them with a message.
- **Query:** the **Query** button in the table toolbar opens a query panel to the right of the table,
  below it on narrow screens; the button, the panel's `×` or a double click on the divider closes it.
  Write LINQ-style queries that read like SQL, such as
  `from * where status == "delivered" group by city select city, count(), sum(total) orderby city`,
  and run them with **Run** or `Ctrl+Enter`.
  After `from`, the clauses are `where`, `let`, `group by`, `select`, `orderby` with `asc` or `desc`,
  `distinct`, `skip` and `take`.
  In a workbook with more than one sheet, a query names its sheet, as in `from Q2` or `from 'North Region'`,
  ignoring case; `from *` is refused with the list of sheets, a misspelt name gets `Did you mean`,
  and the result shows on the sheet it read.
  Filter with `like` (`city like "ath*"`, `note like "*gift*"`; `*` matches any run of characters and case is ignored),
  `in ("shipped", "delivered")`, `between 100 and 500` and `is [not] null`,
  and their opposites with `not like`, `not in` and `not between`.
  The editor highlights the syntax and completes sheet names, column names, keywords and functions, also with `Ctrl+Space`.
  The result takes the place of the main table's rows, with its search, sort, filters, columns and copy,
  under a `Query applied · 240 rows · Clear` bar; **Clear** or closing the panel brings the full table back.
  A single value shows large with a **Copy** button, and a status line under **Run** gives the row count,
  the time taken and the rows read.
  Errors give their line and column and underline the part at fault.
  **Cancel** stops a running query, **Clear** empties the editor and brings the full table back,
  the **History…** list keeps the last 20 queries per file,
  and the **?** syntax help offers example queries built from the table's columns and the workbook's sheet names.
  Large files are scanned in chunks with progress, and `take` stops the scan early.
  The panel's width and open state are remembered.
  See [Querying](Tables.md#querying).
- **Row diff:** the **Compare with…** toolbar button compares the table with another table row by row in a new diff tab;
  see [Compare](Compare.md#row-diff).
- See [Tables](Tables.md).

## Documents

- **Word preview:** `.docx`, `.docm`, `.dotx`, `.dotm` and `.doc` open as a view-only preview on a white page
  of the document's paper width, on grey like PDF pages, with the **Info** panel; they are never read as text.
- **DOCX:** mammoth converts the document and DOMPurify sanitises it;
  embedded pictures show from `data:` URLs at their document size,
  and Title, Subtitle, Quote and Intense Quote styles show as such.
- **Word 97–2003:** the studio's own reader shows the text, tables, lists and headings of `.doc` files,
  with bold, italic, underlined, struck-through, superscript and subscript text, and fields as their result.
- **`.doc` pictures:** PNG, JPEG, GIF and BMP pictures show at their document size, inline ones in the text
  and floating ones as a block at their anchor paragraph; TIFF pictures are decoded in the studio and show as PNG;
  EMF, WMF and PICT pictures show a placeholder that names them, such as **Picture (EMF)**.
- **Word 6.0 and Word 95:** older `.doc` files show their text, tables and bold and italic text, with a note above the page.
- **Copy formatted:** the toolbar's button copies the page as HTML with its text,
  so it pastes into Word, Outlook or Google Docs with its headings, lists, tables and pictures.
- **By content:** a DOCX with a `.doc` name shows as a DOCX,
  and RTF, a web page or plain text with a Word name shows its text with a note.
- **Zoom:** `Ctrl`+wheel or a pinch zooms at the pointer and the plain wheel scrolls;
  `−`, `+` and **Reset**, which fits the page width but never above 100%, ease to their zoom.
- **Find:** the **Find in document…** box, in a bar under the toolbar, highlights every match, ignoring case and accents,
  and shows the count, such as `2 of 5` or `1,204 of 3,310`;
  `Enter` and `Shift`+`Enter`, or the `↑` and `↓` buttons, step through them, wrapping around.
  It is the same box as the PDF preview's, with the same keys.
- **Info:** title, subject, author, keywords, comments, category, manager, company, dates, who last saved it,
  revision, application, pages, words and characters, and a `.doc`'s pictures.
- **Passwords:** a `.docx` or `.doc` encrypted with a password asks for it in the preview, as a PDF does,
  with **Info** showing what the file tells without it; a wrong one says so, **Cancel** leaves a clear message,
  and switching tabs doesn't ask again.
  DOCX: Agile and Standard encryption; `.doc`: RC4 and RC4 CryptoAPI.
- **Can't show:** encryption it can't open, a Word for Windows 1.0 or 2.0 file, or one that isn't a Word document,
  says why in the preview, and an older file's Info names its version.
- **View only:** a **View only** badge; select text and press `Ctrl+C` to copy it.
- **PDF:** opens in its own preview; see [PDF preview](#pdf-preview).
- See [Documents](Documents.md).

## Previews

- **What opens as a preview:** images, `.png`, `.apng`, `.jpg`, `.jpeg`, `.jfif`, `.pjpeg`, `.pjp`, `.gif`, `.webp`, `.avif`,
  `.bmp`, `.ico`, `.cur`, `.svg`, `.heic`, `.heif`, `.hif`, `.tif` and `.tiff`;
  audio, `.mp3`, `.wav`, `.ogg`, `.oga`, `.opus`, `.flac`, `.m4a`, `.aac` and `.weba`;
  video, `.mp4`, `.m4v`, `.webm`, `.ogv`, `.mov` and `.mkv`;
  fonts, `.ttf`, `.otf`, `.woff`, `.woff2`, `.ttc` and `.otc`;
  archives, `.zip`, `.7z`, `.rar`, `.tar`, `.tar.gz`, `.tgz`, `.tar.bz2`, `.tbz2`, `.tar.xz`, `.txz`, `.tar.zst`,
  `.gz`, `.bz2`, `.xz`, `.zst`, `.cab` and `.iso`;
  presentations, `.ppt`, `.pptx`, `.pptm`, `.pps`, `.ppsx`, `.ppsm`, `.pot`, `.potx`, `.potm` and `.odp`, and OpenDocument `.odt` and `.odg`;
  and a file of an unknown type whose first bytes aren't text.
- **View only:** the toolbar shows an **Image**, **Audio**, **Video**, **Font**, **Archive**, **Presentation**, **Document**,
  **Drawing** or **Binary** badge and **View only**;
  there is no Editor view, **Save**, dirty state, **Compare with…** or editor bar, and the file is never read as text.
- **Zoom:** `−`, the zoom level, `+` and **Reset**, from 10% to 800%.
  **Reset** fits the image to the window and never enlarges a small one, which then shows 100%.
- **Wheel and keys:** the mouse wheel or a pinch zooms the image at the pointer, smoothly;
  `+`, `-` and `0` zoom in, out and reset while the preview has focus.
- **Browser zoom kept out:** in every preview that zooms, `Ctrl` with `+`, `-` or `0` zooms the preview,
  and `Ctrl`+wheel over the toolbar, the controls or the **Info** panel does nothing; neither zooms the browser page.
  In a preview that doesn't zoom, such as audio, video or an archive, and over a message or a password box,
  they do nothing at all, and `Ctrl+F` never opens the browser's find bar in any preview.
- **Pan:** drag an image larger than the window, with the mouse, a pen or a finger; the scroll bars work too.
- **Fonts:** a sample text box, the sample at 12, 16, 24, 36, 48 and 72 px,
  the font's characters as selectable text, the first 2,000 at most,
  and a slider for each variable axis the font doesn't hide; the wheel scrolls, and `Ctrl`+wheel and the buttons zoom.
- **Memory:** each tab's zoom and scroll come back when you return to it, until the tab closes.
- **TIFF:** decoded by UTIF in a background worker; a TIFF shows its first page.
- **HEIC:** not decoded, so a HEIC shows **This picture can't be shown here**
  with "Nib Studio doesn't decode HEIC pictures. Its details are under Info.",
  its File, Camera and Location details in **Info**, and its dimensions and megapixels,
  read from the file's own properties and turned as it is shown; zoom and **Copy image** stay hidden.
  See [Preview](Preview.md#heic).
- **Upright photos:** the EXIF orientation is respected.
- **SVG:** drawn as a picture, so its scripts never run.
- **Transparency:** a checkerboard shows behind transparent pixels.
- **Copy image:** the button, or `Ctrl+C` in the image, puts it on the clipboard as PNG and confirms with a toast.
- **Info:** a panel beside the content, below it at 720 px or less, with File, Image, Camera and Location rows as selectable text:
  dimensions, megapixels, frames, pages, SVG size and `viewBox`, camera, lens, date taken, exposure, aperture, ISO,
  focal length, flash, orientation, software and GPS coordinates and altitude as plain text.
  Audio and video list their duration and picture size;
  fonts list their names, version, faces, glyphs, characters, units per em, weight, width, variable axes and named styles,
  designer, foundry, copyright, licence and its address, and embedding.
  Whether it is open is remembered.
- **Player:** audio and video play with the browser's own controls, straight from disk.
- **Errors:** a damaged image shows **This image can't be shown**, and a file Chrome can't play shows **This audio file can't be played** or **This video can't be played**,
  each with the reason.
- **Live refresh:** a preview reloads when its file changes on disk.
- **Archives:** an archive shows **This archive has no preview**, saying to open it with an archive tool,
  and its Info names the format, such as `ZIP archive` or `Gzip-compressed tar archive`; the file is never read.
- **Presentations and OpenDocument files:** a presentation shows **This presentation has no preview**,
  OpenDocument text **This document has no preview** and a drawing **This drawing has no preview**,
  each saying which kind of app opens it; Info names the kind, such as `PowerPoint presentation`,
  and the file is never read.
- **Files that aren't text:** a file of an unknown type is read as text only when its first 8 KB are:
  a UTF-16 byte order mark, UTF-8 without NULs that is mostly free of invalid bytes and control characters,
  or, when they aren't UTF-8, text in a single-byte code page, such as Greek in Windows-1253:
  no NULs, next to no control characters, and words that read well.
  Any other shows **This file isn't text**, with Info naming it a `Binary file`;
  it can't be edited, saved or compared, and the status bar names it `Binary`.
  Files of a known text type, such as `.txt` or `.json`, always open as text.
- **Messages:** a message is centred in the preview, and the zoom controls, the actions and the controls bar hide while it shows.
- **Dropped files:** images, audio, video, fonts, archives, presentations and files that aren't text,
  dropped from outside the workspace, preview the same way.
- See [Preview](Preview.md).

## PDF preview

- **Opens as a preview:** `.pdf` files open in the preview frame with a **PDF** badge and **View only**;
  there is no Editor view, **Save**, dirty state or **Compare with…**, and the file is never read as text.
- **Pages:** one under another on grey, drawn by bundled pdf.js as they come near the view, sharp on high-density screens;
  pages far from the view are let go to save memory.
  Up to 100 pages, the scroll bar is right from the start;
  a longer PDF shows at once, its pages sized as the first, and corrects them as it measures them.
- **Zoom:** `−`, the zoom menu, `+` and **Reset**, from 10% to 800%.
  The menu offers **Fit page**, **Fit width**, **Actual size**, 50%, 75%, 125%, 150% and 200%,
  and its button names the mode, such as **Fit page**, **Fit width** or `125%`.
  **Reset** is **Fit width**: the page width, never above 100%, at the page being read.
- **Fit page:** the page being read shows whole and centred, its full height in the view.
  One wheel gesture, `PageDown` or `PageUp`, `↓` or `↑`, or a tap of `Space` or `Shift+Space` moves exactly one page
  in an eased scroll, a trackpad flick or a fast wheel included; the first and last pages stop.
  `Home` and `End` go to the first and last page.
  `Ctrl`+wheel, the buttons or the menu leave it, and the wheel scrolls again.
- **Wheel and keys:** `Ctrl`+wheel or a pinch zooms smoothly at the pointer, and the plain wheel scrolls;
  `+`, `-` and `0`, with or without `Ctrl`, zoom in, out and reset, and the browser page never zooms.
- **Smooth, then sharp:** a zoom scales the pages already drawn and draws them again sharp once it rests.
- **Page box:** `3 / 12` follows the scroll; type a page number and press `Enter` to go there smoothly.
- **Save pages…:** beside the page box, and in the Explorer's and the tab's menus of a PDF,
  saves chosen pages as a new PDF, in any order and with repeats, such as `1, 2, 6-8, 1`;
  `8-6` runs backwards, `6-` to the last page and `-3` from the first.
  The dialog counts the pages, explains an entry it can't read with **Save** off,
  and previews the new PDF's pages as thumbnails in their order, labelled with their original pages, such as `p. 6`,
  the first 500 of them at most.
  A choice takes at most 10,000 pages, or as many as the PDF has when it has more.
  The new PDF, `<name>-pages.pdf` or the next free name, goes next to the original, says **Saved …**, and opens;
  for a PDF from outside the workspace a file picker asks where.
  It keeps the title, author, subject, keywords, creating application and creation date;
  a password-protected PDF says **Pages of a password-protected PDF can't be saved.**
- **Find:** **Find in document…**, in a bar under the toolbar, searches the whole document, ignoring case and accents,
  highlights every match on the pages drawn, and shows the count, such as `2 of 5` or `1,204 of 3,310`.
  `Enter` and `Shift`+`Enter`, or the `↑` and `↓` buttons, step through the matches, wrapping around,
  each brought smoothly into view;
  `Ctrl+F` goes to the box and `Escape` clears it.
  A PDF with no text on any page, such as a scan, says **This PDF has no text to search** once the search reaches the end.
- **Text:** drag to select text and copy it with `Ctrl+C`; `Ctrl+A` selects the pages' text.
- **Pan:** hold `Space` and drag, or drag with the middle button.
- **Links:** links within the document jump there; links to web pages, files and programs are not followed.
- **Info:** File, Document, History, PDF and Security rows: title, subject, author, keywords, dates, application, producer,
  version, pages, page size in mm and inches with the paper name, tagged, fast web view, language, forms, signatures,
  encryption, password and restrictions.
- **Passwords:** a protected PDF asks for its password in the preview, with the zoom, the page box, Save pages… and Find hidden;
  a wrong one says so, **Cancel** or `Esc` leaves a clear message with **Enter password** to ask again,
  and switching tabs doesn't ask again:
  the password stays in memory while its tab is open, and is never saved or written anywhere.
- **Errors:** a damaged file or one that isn't a PDF shows **This PDF can't be shown** with the reason;
  a page that can't be drawn says so while the rest show.
- **Live refresh and memory:** a PDF reloads when it changes on disk,
  and each tab keeps its zoom or **Fit page**, its place, and its Find query and match.
- **Nothing runs:** no scripts, form actions or links out; forms and annotations show but can't be edited.
- See [Documents](Documents.md#pdf).

## Hash & encode

- **Open it:** the **Hash & encode** tab in the header; it needs no workspace, and the Explorer is hidden while it is open.
- **Cards:** **Hash**, **Verify**, **HMAC**, **Encode / Decode** and **JWT decode**.
  On a wide window **Hash** sits beside **Verify** and **HMAC**,
  and **Encode / Decode** and **JWT decode** take the full width; at 720 px or less the cards are in one column.
- **Enter runs a card:** nothing is computed while you type; Enter, or `Ctrl+Enter`, runs it,
  and Shift+Enter adds a new line.
  Enter on an empty input clears the card; **HMAC** with a key signs the empty message.
- **Results are text:** digests, the converted side of **Encode / Decode** and the JWT header and payload
  copy like any text, by selecting and pressing `Ctrl+C`.
  `Ctrl+C` on a digest row or JWT block reached with `Tab` copies the whole value.
- **Hash:** MD5, SHA-1, SHA-256, SHA-384 and SHA-512 of the text, as UTF-8, or of a file
  dropped on the card or picked with **Choose file…**; a progress bar shows while a file is read,
  and a dropped folder says `Could not read name: it is a folder, not a file.`
  **Format** shows the digests as hex, HEX or Base64.
  The text starts as `Nib Studio`.
- **Verify:** paste a published checksum and press Enter; it is checked against every digest on the page,
  in hex or Base64, ignoring case and surrounding spaces for hex,
  and also as a `sha256sum` or BSD line or with a `sha256-`, `sha256=` or `SHA256:` prefix.
  It says **Matches SHA-256** or **No match**, with the algorithm the length or the prefix suggests,
  and, on **No match**, what that algorithm gives.
- **HMAC:** HMAC-SHA-1, -256, -384 and -512 of a message, with the key as text, hex or Base64, through Web Crypto;
  its own **Format** shows them as hex, HEX or Base64.
- **Encode / Decode:** two text areas; Enter in **Text** encodes, Enter in the other side decodes.
  Codecs: Base64 with **URL-safe** and **Padding**, URL components, hex of the UTF-8 bytes and HTML entities.
  Errors show under the side that failed, with the position.
- **JWT decode:** the header and payload as formatted JSON, `exp`, `nbf` and `iat` as local dates,
  and whether the token has expired; a leading `Bearer ` and line breaks are skipped.
  The signature is not verified, and the card says so.
- **Nothing stored:** inputs stay while the studio tab is open and are never written to disk or storage.
- See [Hash and encode](HashAndEncode.md).

## Dialogs and feedback

- **One dialog style:** every prompt, confirmation and name input uses the same dialog, with a title, a message and the paths involved,
  such as `From`, `To`, `Delete` or `Unsaved`.
  Workspace paths start at the workspace root, which itself shows as `(workspace root)`.
- **Keys:** `Enter` runs the primary button, `Esc` or a click outside cancels, `Tab` stays inside the dialog.
- **Validation:** name inputs show the problem under the field and keep the dialog open,
  such as `A file named notes.md already exists.` for a new file, a new folder, a rename or a duplicate.
- **Focus:** when a dialog closes, the focus goes back where it was, such as the Explorer,
  unless the action moves it on: a new file's editor, the renamed row, or the row after a deleted one.
- **Toasts:** short messages at the bottom right, just above the status bar, for saves, copies, errors and warnings;
  they fade after a few seconds, and clicks go through them to what is under them.

## Status bar

- **Without a workspace:** a hint to pick a folder, and the About button.
- **With a workspace:** the active file's name, or the diff tab's `left ↔ right` title with `Compare`,
  its language or kind, such as `Markdown`, `OpenDocument spreadsheet`, `PowerPoint presentation` or `Binary`,
  archives and media named as their Info panel names them, such as `ZIP archive` or `MP3 audio`,
  the sheet on screen in a workbook of more than one sheet, such as `Sheet 2 of 4 · Q2`,
  the encoding of a file read as text, such as `UTF-8` or `Windows-1253`, CSV and TSV included but not workbooks,
  the number of unsaved files, such as `2 unsaved`, or `clean`,
  the workspace name, as `Workspace: name`, and the About button.

## About

- **About & third-party licences:** the `⚙` button at the right of the status bar, whose tooltip says the same,
  opens a dialog of that title that says how many third-party
  packages the build ships and lists each one, every package bundled into the extension and every package whose files
  it copies, sorted by name and version, with its version and licence; expand one to read the full licence text.
  The same list, with every licence text, ships as `THIRD_PARTY_NOTICES.txt` at the root of the extension.
  Each row has a chevron that turns as it opens.
  Focus moves to **Close** and stays in the dialog; `Esc`, **Close**, `×` or a click outside closes it,
  and focus goes back where it was.

## Theme

- **Light and dark:** the header toggle switches the whole studio, the editor surface, file icons and diff colours included.
  Syntax colours in the file editor, Mermaid diagrams, the Markdown diff page and the Markdown exports look the same in both themes;
  the **Export HTML** page of any other diff follows the system's light or dark setting.
- **Remembered:** the choice is stored and used the next time the studio opens.
  The first run starts in light.
- See [Theme](Theme.md).

## Privacy and offline

- **No network:** the extension has no host permissions and sends nothing anywhere; every library is bundled.
  The TIFF decoder runs in a worker loaded from the extension's own files,
  and so does pdf.js, with its CMaps, fonts and image decoders.
  Exports, such as a diff's **Export JSON** and **Export HTML**, are downloads made only when you ask.
- **Offline content security policy:** pages may load scripts and connect only to the extension itself,
  and images only from the extension, `data:` and `blob:`.
  The HTML preview's sandbox page connects nowhere and loads nothing from the web.
- **Remote images:** Markdown and HTML images with a web address show a placeholder with the address instead of loading.
- **Sanitised Markdown:** raw HTML in Markdown is sanitised with DOMPurify; nothing in it runs.
- **Sandboxed HTML:** an HTML file's preview runs the page's scripts in the extension's sandbox page,
  with an origin of its own, no extension API, no network and no WebRTC,
  and no frame or worker of its own to get them back,
  so the page reaches neither the studio, its files, the extension nor the web.
- **Only the folders you pick:** files are read and written only inside workspaces you choose.
- **Clipboard on your click:** the clipboard is read only when you pick **Paste from clipboard**, a compare's clipboard side
  or **Paste**, and written only when you copy; what is read stays in the tab.
- See [Privacy](Privacy.md).

## Not supported

- Word's page layout: a Word document shows as one tall sheet,
  and its headers, footers, text boxes and comments are left out.
- Footnotes and endnotes in `.doc` files, and Word 2003 XML.
- EMF, WMF and PICT pictures in `.doc` files, which show a placeholder,
  and the wrapping and position of floating pictures, which show as a block at their anchor paragraph.
- Office files under Information Rights Management (IRM) or other rights management (DRM),
  and encryption other than a password's: for a certificate, from a third-party provider (extensible encryption),
  with a cipher other than AES or RC4, with AES-192, or of an unknown version.
  They say their encryption isn't supported, with the reason.
- Remembering passwords: a locked file asks again in every new studio tab and after a change on disk.
- The XOR obfuscation of older Word versions, Word 6.0 and Word 95 encryption, and Excel 5.0 and Excel 95 encryption.
- Styles, lists, page size and pictures in Word 6 and Word 95 files, and Word for Windows 1.0 and 2.0 files.
- `.dot` as a Word template: `.dot` files open as text in the Editor, since they are far more often Graphviz graphs;
  a Word 97–2003 template saved as `.dot` opens as text too.
- In a PDF: print, download, rotating pages, thumbnails, the outline or bookmarks panel, attachments and layers.
- Filling in PDF forms, adding or editing annotations, checking signatures and XFA forms.
- Following links out of a PDF or a Word document: links to web pages, mail, files or other programs are not followed;
  only links to places inside the document work.
- Merging PDFs, saving the pages of a password-protected PDF, and keeping bookmarks in a PDF made by **Save pages…**.
- Editing Office files: Word documents and workbooks are view only.
- Previews of presentations, PowerPoint and OpenDocument, and of OpenDocument text and drawings:
  they open as a message with their File details.
- Running macros: a macro-enabled workbook's macros never run.
- Text recognition (OCR): a scanned PDF has no text to select or find.
- Decoding HEIC pictures: a HEIC shows a message and its details under **Info**,
  and a placeholder in Markdown or HTML.
- More than 25 MB of images in an **Export HTML** page: an image past that becomes a placeholder.
- Past the limits of a copy: more than 10 MB of pictures in a **Copy formatted** document, where a picture past that
  becomes a line that says so, more than 100,000 table rows, and **Copy raw** or **Copy content to clipboard**
  of a file over 64 MB read from disk.
- What an HTML page's scripts draw, in its **Copy formatted**: the page copies as written.
- A keyboard shortcut for the copy buttons: `Ctrl+C` copies the selection.
- Choosing where a diff export goes: **Export JSON** and **Export HTML** save to Chrome's downloads, as Chrome is set to.
- Keeping the Word preview's **Find in document…** query when you come back to the tab, as the PDF preview does.
- Editing or comparing images, audio, video, fonts and archives: they are view only.
- Other faces of a font collection: only the first one shows.
- Other TIFF pages: only the first page shows.
- Camera raw files, Photoshop files and JPEG XL: not recognised; they open as a file that isn't text.
- Text in a code page of two bytes a character, such as Japanese Shift_JIS, in the editor: it is read in a single-byte code page,
  so its letters show wrongly.
  Lookup reads it in that code page when it is the one of Chrome's languages.
- Choosing a file's encoding by hand: it is found from the bytes, and **Save** offers only UTF-8, when a character won't fit.
  Single-byte code pages other than Greek, Western European, Cyrillic and the one of Chrome's languages are never weighed.
- The encoding of a CSV or TSV file over 2 MB: it is read as UTF-8.
- Video codecs Chrome can't decode on the machine, such as HEVC on some systems: the preview says the file can't be played.
- Editing CSV and TSV in the table: the Table view is view only, and these files have no Editor view.
- Row diff of CSV or TSV files over 2 MB, and **Compare these two files** for Excel workbooks.
- On large CSV files, a sort needing more than 256 MB keeps the file order,
  and **Copy formatted** copies at most 100,000 rows.
- Table queries over other sources or over more than one sheet at a time, or joins:
  a query reads one table or sheet.
- What an archive holds: archives open as a message with their File details, and their contents are not listed.
- Syntax highlighting beyond JSON, YAML, Markdown and HTML; XML opens without highlighting,
  and `.jsonc` and `.json5` carry the JSON icon but open as plain text.
- YAML comments, anchors and tags in the **Tree** and diff views, which show the data only,
  and aliases that expand an anchor to more than 1,000 copies, which are refused as an alias bomb.
- Formatting YAML in other ways than re-indenting: **Format** doesn't sort keys, change quotes or fold long lines.
- Save as for workspace files: **Save** writes back to the same path.
  Only a dropped file the browser gave no link for asks where to save.
- Dragging files out of the studio onto the desktop or into other programs.
- Rich-text paste in **Editor** and **Split**: they always paste plain text; only **Interactive** turns HTML into Markdown.
- Pasting files copied on the desktop, or the formatting of copied text, with **Paste from clipboard**:
  it opens the plain text, or else a picture.
- Checkboxes for Markdown task lists in **Preview**, **Split**, the exports and **Copy formatted**:
  `[ ]` and `[x]` stay as text there; only **Interactive** draws them.
- A **Split** ratio kept across views and tabs: switching views or tabs puts it back at half and half.
- An undo history list: the editor bar has only the **Undo** and **Redo** buttons.
- A warning before leaving: closing the studio tab with unsaved edits doesn't ask.
- Checking a JWT's signature: **JWT decode** only reads the token, and says so.
- XPath beyond the documented subset, such as `count()`, unions with `|`, named axes,
  and comparisons other than `=`.
- JSON Schemas from files or URLs: `$ref` works only within the pasted schema.
- Network access: the extension has no host permissions, its content security policy blocks network requests,
  Word documents show only the pictures stored in the file, and Markdown and HTML images with a web address show a placeholder;
  see [Privacy](Privacy.md).
- Scripts in Markdown's raw HTML: they never run.
- In an HTML file's preview: anything from the web, such as a script, style sheet, font, image, `fetch`, WebSocket or WebRTC,
  and scripts, images and style sheets outside the workspace folder;
  one workspace script that `import`s another, since each script is read in on its own;
  pages that use their own iframes, objects or embeds, which are left out, and web workers, which are refused;
  Trusted Types policies of the page's own, which the sandbox page keeps to itself;
  sending a form anywhere: its `submit` handlers run, but the submission goes nowhere;
  opening a new window or tab from the page's script;
  the page's own storage, such as `localStorage`, `IndexedDB` and cookies, which the sandbox page has none of;
  and moving the page to another address from its script, which draws it again instead.
- Raw HTML in Markdown's **Interactive** view, which stays as text, and following links in either **Interactive** view:
  a click places the caret.
- In HTML's **Interactive** view: editing attributes, the `<head>`, styles, scripts, forms and media, which are done in **Editor**;
  tables as a grid, which show as rows of cells set off by `│`; strikethrough, code and quote buttons;
  and pasting formatted text, which pastes as plain text.
- Syncing workspaces between machines; put the folder in a synced drive instead.
- Folders Chrome refuses itself: a drive root, the user folder, or the Desktop or Documents folder themselves,
  can't be picked as a workspace; pick a folder inside them.
- Two studio tabs on the same workspace: the last one to change its tabs writes the configuration file.
- Following the Windows theme: the studio keeps its own choice,
  and may show light for a moment before a saved dark theme applies;
  only an exported diff page, other than a Markdown diff's, follows the system's light or dark setting.
- Other interface languages: the studio is in English only.
- Keyboard shortcuts to open the studio, to hide the Explorer or to open a table's query panel.
- A date range in Lookup, such as files changed since a day, and keeping Lookup's index across reloads.
- Typos in Lookup: a name with one letter wrong or two letters swapped isn't found.
- The contents of PowerPoint 97–2003 files in Lookup, which finds them by name only.
