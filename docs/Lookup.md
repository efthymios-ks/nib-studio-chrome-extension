# Lookup

Lookup finds files in the workspace by name and by content, as you type.  
Type in **Look up files…** at the top of the Explorer:
the files found show in a panel under the box, with a preview of where each one matched.  
It reads text, Word, Excel, PowerPoint, OpenDocument and PDF files, on your device, and searches them in memory.

## The box

- **Look up files…** sits at the top of the Explorer, under its header and above the tree.
  It shows while a workspace is open, and is hidden with no workspace open and whenever the Explorer is hidden.
- At 720 px wide or less it sits at the top of the [drawer](Explorer.md#narrow-screens).
- Typing opens the panel under the box.
  It reaches to the right over the editor, with the list of files on the left and the preview of the selected one on the right.
- At 720 px wide or less the panel takes the drawer's width, with the preview under the list.
- The results change with every key.
  Keys typed together are searched together, so fast typing never queues up searches.
- The line at the bottom of the panel counts the matches, such as `3 matches`,
  and says `Reading contents… 120 of 480` while the files' contents are still being read;
  the list fills in as they arrive.

## Keys

The keys work while the box has focus.

| Key | Effect |
| --- | --- |
| `↓`, `↑` | select the next or previous file; with the panel closed, open it |
| `PageDown`, `PageUp` | select the file a page further down or up |
| `Enter` | open the selected file; the panel closes and the query stays in the box |
| `Ctrl+E` | reveal the selected file in the Explorer, as **Reveal in Explorer** does |
| `Esc` | clear the query and close the panel |
| `Esc` again, on an empty box | leave the box for the tree |
| `Home`, `End`, `Backspace`, `Ctrl+Backspace` | edit the query as in any text box |

- The arrows and the page keys move the Lookup selection only, never the caret or the tree's selection.
- Moving the pointer over a file in the list selects it and shows its preview, as the arrows do; the keyboard stays in the box.
  Results redrawn under a pointer that isn't moving don't change the selection.
- A click on a file in the list opens it, as `Enter` does.
- A click outside the box and the panel closes the panel and keeps the query;
  the panel opens again with it when the box takes focus.
- `Esc` in the box never closes the drawer around it.
- `Ctrl+F` isn't a Lookup key: it finds in the editor and in the Word and PDF previews, and elsewhere opens the browser's find bar.

## How it matches

Case, accents and Greek tones are ignored everywhere, and a final `ς` counts as `σ`,
so `συναντηση` and `ΣΥΝΑΝΤΗΣΗ` find `Σημειώσεις Συνάντησης.txt`.  
The separators space, `_`, `-`, `.` and `,` may come and go between the letters typed,
so `my name` finds `MyName.txt`, `my_name.md` and `My-Name.txt`, and `total 1250` finds `Total 1,250`.

Each file is tried against these rules in order, and the first that matches places it:

1. **Phrase in the name:** `my name` in `MyName.txt`.
2. **Words in the name, in any order:** `name my` in `MyName.txt`.
3. **Phrase in the content:** `anna smith` in a file that holds `Anna Smith`.
4. **Scattered letters in the name**, only when they are close together:
   `mnm` in `MyName.txt`.
   The letters may spread over at most three characters for each letter typed.
5. **Words in the content, in any order:** `total 1250` in `Total: 1,250.00`.

- Within a rule, an earlier match comes first, then a shorter name.
- Contents never match by scattered letters, which would match almost any text.
- The list holds the best 500 files, and the count says how many matched in all.
- Each file shows at most 50 highlighted matches.

## The list and the preview

- Each row shows the file's type icon, its name with the matched letters highlighted, and its folder, dimmed.
  A file at the workspace root shows no folder.
- For a match in the name, the preview shows the name highlighted and the folder, and no content.
- For a match in the content, the preview shows the text flattened to one line,
  from about 20 characters before the first match, cut back to the start of a word, with every match in view highlighted.
  `…` marks text cut off at either end.
- For a text file, such as plain text, code, Markdown, HTML, CSV or JSON, the preview also says the line of the first match,
  such as `Line 12`.

## Opening a file

- `Enter`, or a click on the row, opens the file in a permanent tab and reveals its row in the tree.
- A match in the content of a text file opens in **Editor**, Markdown and HTML included,
  with the first match selected, scrolled into view and the editor focused.
- A match in a Word document or a PDF puts the first match's text into **Find in document…** and steps to it;
  see [Documents](Documents.md#find).
- A match in the name, or in a file with no Editor, such as a workbook or a presentation,
  opens the file as a click in the tree would, in its usual view.
- `Ctrl+E` reveals the file in the Explorer instead: its folders open, its row is selected and the tree takes the keyboard.

## What is read

The contents are read with the studio's own readers.

| Files | What Lookup searches |
| --- | --- |
| Text: `txt`, `log`, `md`, `csv`, `json`, `xml`, `yaml`, code, and files of no or an unknown type whose first bytes are text | the text |
| HTML: `html`, `htm`, `xhtml` | the text without its tags, scripts, styles and comments |
| Word: `docx`, `docm`, `dotx`, `dotm` | the body, headers, footers, footnotes and endnotes, without field codes or deleted text |
| Word 97–2003: `doc` | the text of its paragraphs and tables |
| Workbooks: `xlsx`, `xls`, `xlsm`, `xlsb`, `xltx`, `xltm`, `ods` | every sheet, row by row, so a match reads with its row |
| Presentations: `pptx`, `pptm`, `ppsx`, `ppsm`, `potx`, `potm` | the slides in order, then their notes |
| OpenDocument: `odt`, `odp`, `odg` | the document's content |
| PDF | the text of every page, as **Find in document…** reads it |
| Images, audio, video, fonts, archives, PowerPoint 97–2003 files, and files over 20 MB | the name only |

- Text is read in the encoding the editor finds for it; see [Text encodings](Editor.md#text-encodings).
  Text that isn't UTF-8 or UTF-16 is read in the single-byte code page its letters make most sense in,
  so a Greek file in Windows-1253 is found whatever Chrome's languages are.
  A tie goes to the code page of the first language in Chrome's language settings that has one of its own, then Windows-1252.
  When that language writes two bytes a character, such as Japanese, text that isn't UTF-8 is read in its code page.
- A scanned PDF has no text, so it is found by its name only.
- Lookup keeps at most 2,000,000 characters of each file, and 64,000,000 characters in all;
  files past that are found by their names.
- Files in folders named `.git`, `node_modules`, `bin` or `obj`, and `.nib-studio-configuration.json`, are left out.
  Hidden files are searched, as the tree shows them.

### Protected files

A Word document, workbook or PDF with a password is found by its name only.  
Once it is opened in its tab and unlocked with its password, Lookup searches its content too,
for as long as that tab keeps it unlocked: while the tab stays open, and until the file changes on disk.  
The content comes from the copy the tab unlocked; the password is never kept, and nothing is written anywhere.

## The index

- The index starts the first time the box takes focus: every file's name is listed at once,
  the top of the workspace first, so names are searchable from the first key.
- The contents are then read in the background, one file at a time, and PDFs one at a time beside them.
- Every key searches the index in memory, never the disk.
- It runs in a worker of its own, `nib-studio/lookupWorker.js`, so reading and searching never hold up typing or scrolling;
  PDF text comes from pdf.js, which parses in its own worker too.
- The index lasts for the session and knows each file by its path, size and last change.
  Each time the box takes focus, the workspace is listed again and only the files that changed are read again.
- The [live refresh](Workspaces.md#live-refresh) keeps it up to date while the studio is open:
  a changed file is read again, a new one is added and a deleted one is dropped.
- Open files with unsaved edits are searched by their text as it is in the editor.
- Switching or forgetting the workspace drops the index; the next workspace gets its own.

## Not supported

- A date range, such as files changed since a day: Lookup matches names and contents only.
- Keeping the index across reloads: it is built again in each session.
- Typos: a name with one letter wrong or two letters swapped isn't found.
- The contents of PowerPoint 97–2003 files, which are found by their names only.
- Text in scanned PDFs and in pictures; there is no text recognition.
