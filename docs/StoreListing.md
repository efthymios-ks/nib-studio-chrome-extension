# Store listing

The text for the Chrome Web Store listing.  
The short description is the `description` in `public/manifest.json`; the store reads it from the package.  
The detailed description is pasted into the dashboard as plain text, so it carries no Markdown.  
The store rejects lists of formats or search terms in either description as keyword spam,
so both are written as prose and name only a few kinds of file.  
Nib Studio doesn't decode HEIC pictures, so the listing never claims HEIC; see [Release](Release.md#build).

## Name

```text
Nib Studio
```

## Short description

At most 132 characters; this one has 131.  
`package.json` carries the same text as its `description`.

```text
Open a folder on your computer to edit, compare, search and preview its files in a browser tab. Works offline; nothing is uploaded.
```

## Detailed description

```text
Nib Studio turns a browser tab into a workspace for the files in a folder on your computer. Pick a folder, then open, edit, compare, search and preview its files, without anything leaving your device.

Click the toolbar icon to open the studio.

Work on your own folder
Pick a folder with the browser's folder picker and work on the files where they are. Create, rename, move and delete files in the tree, drag files in from your desktop, and see changes made by other programs straight away. Remember several folders and switch between them.

Find anything
Type in the Lookup box to find files by name or by what is inside them, Office documents and PDFs included, with a preview of each match.

Edit
A code editor with syntax colours, errors marked as you type, search and replace, multiple cursors, and an undo history that survives switching views. Markdown and HTML files also get an Interactive view that edits like a word processor, and a live preview with diagrams and pictures from your folder.

Compare
Compare any two files, or a file with the clipboard or pasted text, side by side. Structured data is compared by its structure, Markdown as a document and spreadsheets row by row, with a bar to step through the changes and an export to share the result.

Work with data
Sort, filter and search spreadsheets, query them with a simple SQL-like language, and browse structured data as a tree, with path queries and schema validation.

Preview
View PDFs, Word documents, images, audio, video and fonts, with smooth zoom and a details panel. PDFs add find, a page box, and saving chosen pages as a new PDF. Password-protected documents open once you enter their password.

Developer tools
Hashes, checksums, HMAC, encoding and token decoding, one tab away.

Private by design
Everything runs offline, inside the extension. No host permissions, no network requests, no accounts and no tracking. Passwords are never stored.
```

## Category

Developer Tools.

## Permission justification

`storage`:

```text
Keeps the light or dark theme choice in chrome.storage.local. No other data is stored with this permission.
```

The extension requests no host permissions and no other permissions.  
Folder access comes from the File System Access API:
the user picks each folder in the browser's own folder picker and grants access in the browser's prompt,
so the manifest declares nothing for it.

## Single purpose

```text
Nib Studio lets you view, edit and compare the files of a local folder you pick, offline, in a browser tab.
```

## Privacy practices

- **Data collection:** none.
  Nib Studio collects no personal or user data and transmits nothing off the device.
- **Remote code:** none; every library is bundled into the package.
- **Data use certification:** no user data is sold, transferred to third parties, or used for anything unrelated to the single purpose.
- **Privacy policy:** see [Privacy](Privacy.md).

## Screenshots

At 1280×800, in the light theme unless noted, in the `Space1` sample workspace.
Every shot has the same six tabs open, in this order,
`sample.json`, `app.yaml`, `orders.xml`, `quarterly-report.docx`, `tracemonkey.pdf` and `clip.mp4`,
with the shot's own tab after them.

1. **Lookup:** `anna smith` in **Look up files…**, matching inside a PDF, a CSV, a Markdown file and a Word document,
   with the match highlighted in the preview,
   over `quarterly-report.docx` in the Word preview with its table and picture.
   Caption: `Find files by name or by what is inside, and preview Word and PDF files.`
2. **YAML diff tab:** `app.yaml` against `app-v2.yaml` on the aligned grid,
   with the changed values marked, a placeholder for the added key, and the diff bar at the bottom right.
   Caption: `Compare JSON, YAML, XML, Markdown and text in their own diff tab.`
3. **Table with a query:** `orders-large.csv`, 250,000 rows, in the Table view,
   with the query panel open and the `Query applied` bar.
   Caption: `Sort, filter and query CSV and Excel files, even large ones.`
4. **Interactive Markdown:** `docs/release-plan.md`, added to the workspace for this shot, in the **Interactive** view,
   with the caret in bold text and **Bold** pressed in the formatting bar,
   a checklist, a table edited as a grid, a code box and a Mermaid diagram drawn in place.
   Caption: `Edit Markdown like a document, with tables, code and diagrams.`
5. **Dark theme, locked document:** the password box of `lookup/Protected Contract.docx` with the password typed,
   and the **Info** panel showing its encryption.
   Caption: `Open password-protected Word, Excel and PDF files, in light or dark.`

The store takes at most five screenshots,
so the PDF, image, video and font previews, the JSON, YAML and XML views, and the other diffs
appear in the tab bar and the detailed description only.
