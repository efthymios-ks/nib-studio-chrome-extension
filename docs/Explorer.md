# Explorer

The Explorer shows the folder tree of the active workspace on the **Files** surface.  
It opens files, selects them, and runs every file operation: create, rename, duplicate, delete, move, copy, import and compare.  
On **Hash & encode** it is hidden.

## Tree

- Folders come first, then files, each group sorted by name with numbers in natural order, so `file2` sorts before `file10`.
- Every file and folder shows, hidden ones and `.nib-studio-configuration.json` included.
  Chrome's temporary `.crswap` swap files, there only while a file is written, are never listed.
- Each row carries a type glyph and colour, the same as on its tab.
  The type comes from the longest matching suffix, case-insensitive, so `archive.tar.gz` is an archive and `notes.MD` is Markdown.
  A folder shows a folder outline, drawn open while the folder is expanded.
- Hovering a row shows its path from the workspace root, such as `docs/readme.md`.
- A file with unsaved edits gets a dot after its name.
- Only expanded folders are read from disk; a closed folder is read when it opens.

| Type | Suffixes |
| --- | --- |
| JSON | `json`, `jsonc`, `json5` |
| XML | `xml`, `xsd`, `xsl`, `xslt`, `config` |
| CSV | `csv`, `tsv` |
| Excel | `xlsx`, `xls`, `xlsm`, `xltx`, `xltm`, `xlsb`, `ods` |
| Word | `docx`, `docm`, `dotx`, `dotm`, `doc` |
| Presentation | `ppt`, `pptx`, `pptm`, `pps`, `ppsx`, `ppsm`, `pot`, `potx`, `potm`, `odp` |
| OpenDocument | `odt`, `odg` |
| Text | `txt`, `log` |
| Markdown | `md`, `markdown`, `mdx` |
| HTML | `html`, `htm` |
| CSS | `css`, `scss`, `sass`, `less` |
| JavaScript | `js`, `mjs`, `cjs` |
| TypeScript | `ts`, `tsx` |
| YAML | `yml`, `yaml` |
| HAR | `har` |
| PDF | `pdf` |
| Image | `png`, `apng`, `jpg`, `jpeg`, `jfif`, `pjpeg`, `pjp`, `gif`, `svg`, `webp`, `avif`, `bmp`, `ico`, `cur`, `heic`, `heif`, `hif`, `tif`, `tiff` |
| Archive | `zip`, `gz`, `tar`, `tar.gz`, `tgz`, `bz2`, `tar.bz2`, `tbz2`, `xz`, `tar.xz`, `txz`, `zst`, `tar.zst`, `7z`, `rar`, `cab`, `iso` |
| Audio | `mp3`, `wav`, `ogg`, `oga`, `opus`, `flac`, `m4a`, `aac`, `weba` |
| Video | `mp4`, `m4v`, `webm`, `ogv`, `mov`, `mkv` |
| Font | `woff`, `woff2`, `ttf`, `otf`, `ttc`, `otc` |

Anything else shows as a plain file.  
The colours come from the `--ft-*` tokens of the [theme](Theme.md), one set for light and one for dark.

## Header

- `⊟` **Collapse all folders** closes every folder.
- `⊞` **Expand all folders** opens every folder in the workspace, however deep.
  On a large tree it reads every folder from disk.

## Lookup

**Look up files…**, under the header and above the tree, finds files by name and by content as you type;
see [Lookup](Lookup.md).  
It shows while a workspace is open.  
While it has focus, the arrow keys move its own selection, never the tree's;
`Enter` opens the file, `Ctrl+E` reveals it in the tree, and a second `Esc` gives the keyboard back to the tree.

## Clicks

| Action | Effect |
| --- | --- |
| Click a file | selects it and opens it in the preview tab |
| Double-click a file | opens it in a permanent tab |
| Click a folder | selects it and opens or closes it |
| `Ctrl+click` | adds the row to the selection, or removes it |
| `Shift+click` | selects every visible row from the last clicked row to this one |
| Right-click | opens the context menu |

`Ctrl+click` and `Shift+click` only change the selection; they don't open files or toggle folders.  
See [Editor](Editor.md) for preview and permanent tabs.

## Keyboard

The keys work while focus is in the tree; click a row or `Tab` into it first.

| Key | Effect |
| --- | --- |
| `↓`, `↑` | move to the next or previous visible row, selecting it |
| `→` | open a closed folder; on an open folder, move to its first child |
| `←` | close an open folder; otherwise move to the parent folder |
| `Enter` | open a file in a permanent tab; open or close a folder |
| `F2` | rename the focused file or folder |
| `Delete` | delete the selection, after confirmation |
| `Ctrl+D` | duplicate the focused item |
| `Ctrl+A` | select every visible row |
| `Esc` | clear the selection |

The keys keep the browser's own shortcuts away, such as `Ctrl+D` bookmarking the page,
with a second keyboard layout such as Greek too, where the place of the key counts.  
When a dialog the keys or the context menu opened closes, by its buttons, `Esc`, `×` or a click outside,
the focus goes back to the tree, so the next key works at once; the menu itself never takes the focus.

## Context menu

Right-click a row, or the empty area under the rows; on a touch screen, press and hold a row for half a second.  
A right-click on a row that isn't selected selects it alone first; a right-click inside a selection keeps it,
so commands act on every selected row.  
The menu opens at the pointer and shifts to stay inside the window.  
Commands that don't apply are left out of the menu; dividers separate the groups.

| Command | Shortcut | Shown when | Effect |
| --- | --- | --- | --- |
| Open | `Enter` | one file selected | opens it in a permanent tab |
| Open as workspace | | one folder, right-clicked on its row | makes the folder the workspace; see [Workspaces](Workspaces.md#open-as-workspace) |
| Compare these two files | | two files of the same comparable type selected | opens them in a new diff tab |
| Compare with… | | one file selected | lists the comparison sources; see [Compare](Compare.md) |
| New file | | a workspace is open | asks for a name, `untitled.md` by default, creates the file and opens it |
| New folder | | a workspace is open | asks for a name and creates the folder |
| Rename | `F2` | one item selected | asks for the new name |
| Duplicate | `Ctrl+D` | one item selected | asks for the copy's name and copies it |
| Delete | `Del` | one or more items selected | deletes them after confirmation |
| Copy name to clipboard | | one item selected | copies `orders.json` |
| Copy path to clipboard | | one item selected | copies `data/orders.json` |
| Copy content to clipboard | | one text file selected | copies its text, as its tab holds it when it is open, or else as saved on disk, up to 64 MB; over 10 MB asks first |
| Format JSON | | a JSON file | reformats it with 2-space indent, unsaved |
| Format YAML | | a YAML file | reformats it with 2-space indent, keeping its comments, unsaved |
| Convert XML to JSON | | an XML file in the workspace | opens the JSON in a new tab `name.xml.converted.json` |
| Convert YAML to JSON | | a YAML file in the workspace | opens the JSON in a new tab `name.yaml.converted.json` |
| Convert JSON to YAML | | a JSON file in the workspace | opens the YAML in a new tab `name.json.converted.yaml` |
| Convert HTML to Markdown | | an HTML file in the workspace | opens the page as Markdown in a new tab `name.html.converted.md`; see [Editor](Editor.md#convert-to-markdown) |
| Convert Markdown to HTML | | a Markdown file in the workspace | opens the document as an HTML page in a new tab `name.md.converted.html`; see [Markdown](Markdown.md#convert-to-html) |
| Compare XML with… | | an XML file | asks for the other file on disk and opens the diff in a new diff tab |
| Save pages… | | one PDF selected | asks which pages, previews them and saves them as a new PDF beside it; see [Documents](Documents.md#save-pages) |
| Refresh | | a workspace is open | rereads the tree from disk |

**Compare with…** shows as a header with its choices under it:
**Compare with clipboard**, **Compare with a file…**, and **Compare with open tab: name** for each other open file tab that holds text.

With more than one item selected, the menu shows only the commands that act on a selection:
**Compare these two files** when exactly two comparable files are selected, **Delete** and **Refresh**.  
**Compare these two files** puts the upper file in the tree on the left, as the original.  
Two JSON, YAML, XML, Markdown, CSV or TSV files, or any two text files of one type, compare; workbooks don't.  
**Compare with…** is left out for a file that opens only as a preview, and for an open file that isn't text.
A file of an unknown type that isn't open is read first, as opening it would be:
when it isn't text, each **Compare with…** choice stops with the toast `name can't be compared: it isn't text.`
A file picked from disk is checked the same way before it is read,
and one that opens only as a preview, such as a PNG, gets `name can't be compared: it opens only as a preview.`

**New file** and **New folder** create the item in the selected folder, in the folder of the selected file,
or at the workspace root when nothing is selected.  
The dialog says where, such as `Will be created in data/`.  
A new file opens in **Editor** with the caret in its text, ready to type in.

**Open as workspace** shows for one folder only, at the top of the menu,
and is left out for files, for a selection of several items and in the empty area under the rows.  
It opens the folder as **Open folder…** would: unsaved workspace files are settled first,
the folder is remembered under its own name, and the current workspace stays in the switcher.

## Names

Every name dialog checks the name before it closes:

- It cannot be empty.
- It cannot contain `/` or `\`.
- It cannot be `.` or `..`.
- For **New file**, **New folder**, **Rename** and **Duplicate**, it cannot be the name of another entry already in the folder,
  compared ignoring case as Windows does: `A file named notes.md already exists.`
  or `A folder named exports already exists.`,
  so a new file never opens an old one, a rename never lands on one and a duplicate never copies over one.
- Rename and Duplicate need a name different from the current one.

Rename and Duplicate select the part before the extension, so typing replaces `report` and keeps `.json`.

## Rename

- Renames a file or a folder in place.
- A name another entry next to it takes is refused inside the dialog, as in [Names](#names);
  a change of case only, such as `readme.md` to `README.md`, is allowed.
- The renamed row keeps the focus.
- Open tabs follow the new name, including tabs of files inside a renamed folder, and expanded subfolders stay expanded.
- Uses the browser's native move when it has one; otherwise the entry is copied byte for byte, recursively for a folder,
  and the original is removed.

## Duplicate

- Suggests the first free name of `name-copy.ext`, `name-copy-2.ext`, `name-copy-3.ext`, and so on.
- The dialog shows the `From` and `To` paths.
- Copies files byte for byte and folders with everything in them.
- The copy lands next to the original.

## Delete

- Deletes every selected item, folders with their contents.
- The confirmation lists each path on its own `Delete` line.
- Tabs of deleted files close, unsaved edits included.
- The row after the deleted ones, or the one before them at the end of the tree, takes the focus and the selection.

## Drag and drop inside the tree

Drag a row onto a folder, or onto the empty area of the tree to target the workspace root.  
Dragging a selected row drags the whole selection; dragging an unselected row drags it alone.

- The target folder is highlighted while you drag; dropping on a file targets that file's folder.
- Hold over a closed folder for 0.7 s to open it.
- Drag near the top or bottom edge to scroll.
- A folder can't be dropped into itself or one of its own subfolders.
- Items dropped on the folder they are already in stay where they are:
  on their own folder, on a file beside them, or, for items at the root, on the empty area.
  Such a drop does nothing, with no dialog and no message.

On drop, a **Move or copy** dialog lists each `From` path and the `To` folder, written with its slash, such as `logs/`,
or `(workspace root)`.  
When a selection mixes items already in the target folder with items from elsewhere,
it lists, and moves or copies, only the items from elsewhere.

- **Move** moves the items.
  When a name already exists in the target, a **Name already exists** dialog offers **Replace**, **Keep both** or **Skip**;
  with several clashes, **Apply to all** answers the rest at once.
  **Keep both** gives the moved item a free name such as `name-copy.ext`.
  Closing the clash dialog cancels the whole move.
- **Copy** copies the items, renaming copies that clash to `name-copy.ext`, `name-copy-2.ext`, and so on.
- `×`, `Esc` or a click outside cancels.

Open tabs of moved files, and of files inside moved folders, follow them to the new path.  
A move to another folder is a copy followed by a delete.  
Moves and copies copy the file's bytes, so binary files such as `.xlsx`, `.docx` or images arrive intact.

## Drop from the desktop

Drag files or folders from the desktop or a file manager onto the tree to import them:

- **Onto a folder:** imports into that folder.
  A drop on a file imports into that file's folder.
- **Onto the tree's empty area:** imports into the workspace root.

A drop anywhere else, the header and the status bar included, opens the files instead;
see [Editor](Editor.md#drop-to-open).  
With no workspace open the tree has nothing to import into, so a drop on it opens the files too.

While files are dragged over the window, the editor area shows a dashed outline with **Drop to open**.  
With a workspace open, a box at the bottom of the Explorer also reads **Drop on a folder to import**,
and the tree highlights the folder under the pointer, or the whole tree for the workspace root.  
Over an empty diff side the outline steps back, since that side takes the drop.  
The hints disappear on drop, when the pointer leaves the window, when the drag ends, and on `Esc`.

An **Import into the workspace** dialog, such as `Import 1 file and 1 folder into docs/?`,
lists the path each dropped file and folder gets in the workspace, before anything is written.

- Folders are copied with everything in them.
- When a name already exists, a **Name already exists** dialog offers **Replace**, **Keep both** or **Skip**,
  for the files inside dropped folders too.
  With several clashes, **Apply to all** answers the rest at once.
  **Keep both** gives the imported item a free name such as `name-copy.ext`.
- A dropped folder whose name matches a folder already there is merged into it,
  so only the files that clash inside it are asked about.
- Every question comes before the first write, so closing a dialog imports nothing.

After the import, the tree refreshes, the first imported file opens in a permanent tab and its row is revealed,
or, with no file among them, the first imported folder is revealed;
a toast sums it up, such as `3 files and 1 folder imported.`  
Imports write the file's bytes, so binary files such as `.xlsx` or images arrive intact.

An item that already lives in the workspace, such as one dragged from the workspace folder in the file manager,
is matched by its real location on disk and gets the **Move or copy** dialog of a drag inside the tree instead;
dropped on the folder it is already in, it stays where it is and nothing happens.  
A folder can't be dropped into itself or one of its own subfolders; a toast says so and nothing moves.

## Hide and resize

- Drag the divider between the Explorer and the editor to resize it, from 160 px to 560 px.
- Drag it narrower than 100 px to hide the Explorer.
- Double-click the divider to hide or show it.
- A hidden Explorer leaves a narrow `›` strip at the left edge; click the strip, or drag it out, to show the Explorer again.
- Width and hidden state are kept in `localStorage` and survive reloads.

There is no keyboard shortcut to hide or show the Explorer.

## Narrow screens

At 720 px wide or less the Explorer leaves the layout and becomes a drawer:

- The `›` strip at the left edge opens it over the editor, up to 320 px wide.
- **Look up files…** sits at the top of the drawer, and its results take the drawer's width.
- `×` in the Explorer header, `Esc`, or a tap on the dimmed editor closes it,
  and so does opening a file from the tree or from **Look up files…**.
  `Esc` in **Look up files…** never closes it: it clears the box,
  or, when the box is empty, gives the keyboard to the tree.
- The stored desktop width and hidden state don't apply; widening the window closes the drawer and brings the desktop layout back.
- On touch screens, press and hold a row or a tab to open its context menu; rows are not draggable there,
  so the hold isn't taken for a drag.

## Reveal in tree

Clicking a tab opens every parent folder of its file and scrolls its row into view.  
Switching tabs this way keeps the tree in step with the editor.

**Reveal in Explorer**, at the top of a file tab's context menu, does the same without switching tabs,
then selects the row and moves the keyboard focus to the tree, so the arrow keys carry on from it.  
A hidden Explorer comes back at its last width,
and at 720 px wide or less the Explorer slides in as the drawer.  
The item is left out for a file from outside the workspace, which has no row,
and while no workspace is open.  
**Reveal in Explorer** in a diff tab's menu does the same for the modified side's workspace file.

A click on a link to a workspace file in a Markdown or HTML preview reveals the file the same way and selects its row.  
A link to a folder opens it and its parent folders, selects it and scrolls it into view,
and brings the Explorer into view as **Reveal in Explorer** does:
a hidden Explorer comes back at its last width, and at 720 px wide or less the Explorer slides in as the drawer.  
See [Markdown](Markdown.md#links-1).
