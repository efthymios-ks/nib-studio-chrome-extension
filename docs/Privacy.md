# Privacy Policy

**Last updated:** 2026-11-23

## Summary

Nib Studio is a file tool that runs entirely on your device.  
It does not collect, store on remote servers, sell, share, or transmit any user data.  
It has no server, no analytics, and no remote code.

## What data Nib Studio handles

Nib Studio reads and writes only the files in folders you pick yourself through the browser's folder picker,
and only after you grant access in the browser's own prompt.  
It also reads:

- Files you pick with the browser's file picker, to compare them or compute their hashes,
  and files you drop on the **Hash** card to hash them.
- Files and folders you drop onto the studio from your desktop.
  A dropped folder becomes a workspace only when you confirm it.
- The clipboard, only when you ask for it:
  - **Compare with clipboard** in a context menu, **Clipboard** in the **Compare with…** chooser,
    **Paste** on a compare side and **Paste from clipboard** on an empty compare side
    read the clipboard's text directly, after the browser asks for your permission.
  - A paste you make yourself with `Ctrl+V` hands the browser's paste to the place it lands, as on any page:
    the editors and text boxes, where it pastes as usual;
    a compare, where it fills or replaces a side;
    and the Interactive Markdown view, where formatted text from a web page or a document is turned into Markdown.
    Nothing reads the clipboard without such a paste.
- Text, keys and tokens you type or paste into the **Hash & encode** cards.
  They stay in the tab's memory and are never written to disk or to the browser's storage.

All of it is processed inside the Nib Studio tab, in your browser.  
Nib Studio writes to the clipboard only when you copy:
with `Ctrl+C`, a copy button such as **Copy**, **Copy as TSV** or **Copy image**,
or a copy item in a context menu, such as **Copy path to clipboard**.

## What Nib Studio writes to your files

Nib Studio changes files on disk only when you ask it to, and only in these cases:

- **Save** or `Ctrl+S` writes the open file's text over the same file in the workspace.
- **New file**, **New folder**, **Rename**, **Duplicate**, **Delete**, and **Move** or **Copy** after a drag in the tree
  create, rename, copy or delete the entries you chose, inside the workspace.
- A drop of files or folders on the Explorer tree copies them into the workspace folder you dropped them on,
  after you confirm the **Import into the workspace** dialog.  
  **Replace** in a name clash deletes the existing entry first.
- **Save** in the tab of a dropped file from outside the workspace writes over that original file,
  after you allow editing in the browser's own prompt.  
  When the browser gave no link to the original, **Save as…** writes to the file you pick in the browser's save dialog.  
  Nothing from such a tab is ever written into the workspace.
- **Save** in the tab that **Convert XML to JSON**, **Convert YAML to JSON** or **Convert JSON to YAML** opens
  writes `name.xml.converted.json`, `name.yaml.converted.json` or `name.json.converted.yaml` next to its source file.
- **Save pages…** writes a new PDF of the pages you chose, `name-pages.pdf` or the next free name, next to the original;
  for a PDF from outside the workspace, it writes where you pick in the browser's save dialog.
- `.nib-studio-configuration.json` at the workspace root is rewritten 400 ms after a change to the open tabs,
  the active tab, the open folders or the surface; see below.

A file dropped anywhere but the Explorer tree is only read, until you save its tab.  
Format, minify, table views, queries and compares change nothing on disk by themselves,
and a compare's exports go to the browser's downloads, never into the workspace.

## What Nib Studio stores

On your device only:

- **Folder access handles**, in the extension's IndexedDB:
  one per workspace you opened, so the workspace switcher can reopen it.  
  Forgetting a workspace deletes its handle.
- **Theme choice**, light or dark, in `chrome.storage.local`.
- **Layout preferences**, in the extension's `localStorage`:
  the Explorer width and visibility, the query panel width and open state, the last Markdown diff view,
  and whether the preview's **Info** panel is open.
- **Query history**, in the extension's `localStorage`: the last 20 table queries that ran on each file,
  keyed by the file's path in the workspace, or by its name for a file from outside the workspace.
- **Workspace state**, in `.nib-studio-configuration.json` at the root of each workspace folder:
  the paths of the open tabs, the active tab, the expanded folders, the active surface,
  and the two paths of each diff tab between workspace files.  
  It holds no file contents, and nothing about files opened from outside the workspace.  
  You can delete it at any time.

Open files, unsaved edits, comparisons, hashes, HMAC keys, decoded tokens and table views
stay in the tab's memory and are gone when the tab closes.  
So are the links to dropped files: their tabs last for the session only.

## What Nib Studio does not do

- No network requests.
  The extension has no host permissions, and every library is bundled into the extension at build time.
- No telemetry, no analytics, no usage tracking.
- No accounts, no logins.
- No remote code execution.
- No transmission of file contents, file names or any other data off your device.
- No sharing or selling of any data.

## Markdown and HTML

A Markdown document can point an image at a web address, such as `![chart](https://example.com/chart.png)`.  
The Interactive view, the Preview, Split and PDF export never fetch it: the image shows as a placeholder with its address.  
An image in HTML pasted into the Interactive view becomes such a Markdown image link, also never fetched.  
On top of that, the extension's content security policy only lets its pages load images from the extension itself,
`data:` and `blob:` URLs, and only lets them connect to the extension itself, so no page of Nib Studio can reach the network.  
**Export HTML** keeps web image addresses as written, because the exported file is opened outside the extension.  
Word documents show only the pictures stored in the file, from `data:` URLs;
pictures linked from the web or the disk never load, and links in a Word document are never followed outside it.

Images with a relative path, such as `images/chart.png`, are read from the open workspace folder,
through the same folder access as the rest of the workspace, and never from anywhere else:
a path that climbs above the workspace folder is never read, and nor is a disk path such as `C:\`.  
They are shown from `blob:` URLs that live in the tab's memory and are released when the preview draws without them or closes.  
**Export HTML** puts those images inside the exported page as `data:` URLs, so it works offline,
and **Export PDF** prints them from the same `data:` URLs.  
Links to workspace files only open them in the studio; nothing is fetched to follow them.

Raw HTML in a Markdown file, and an HTML file in its **Preview**, are sanitised with DOMPurify before they are shown:
scripts, event handlers, frames, objects, embeds, forms, `<base>`, `<meta>` and `javascript:` addresses are dropped.  
Markdown keeps only the HTML a README uses, such as `<img>`, `<details>`, `<kbd>` and tables, with no styles.  
An HTML file's **Preview** keeps the page's own styles, inside a sandboxed frame that runs no scripts,
so the page can't reach the studio or anything else.  
The page's style sheets and images are read from the workspace and put into the page,
and web style sheets, fonts and images are left out, so the page loads nothing from the network.  
The frame shares the studio's content security policy, which stays as strict as above.

## Previews and photo details

Images, audio, video and fonts are previewed from the file on your disk, inside the Nib Studio tab.  
A previewed font is added to the studio page only, from the file's bytes, and removed when its tab closes.  
TIFF images are decoded by UTIF in a background worker, `nib-studio/imageDecodeWorker.js`, which ships inside the extension.  
Nib Studio does not decode HEIC pictures, so it ships no HEIC decoder,
and the worker loads nothing else.  
A HEIC photo's details are still read on your device for the **Info** panel.  
The **Info** panel reads a photo's EXIF details on your device, the camera, the date taken and the GPS location included,
and shows the location as plain coordinates, with no map link and no lookup.  
Previews work within the extension's content security policy:
images and media load only from the extension, `data:` and `blob:` URLs, and no `eval` or WebAssembly is allowed.

## PDFs

PDFs are read and drawn by pdf.js inside the Nib Studio tab, from the file on your disk.  
pdf.js, its background worker `nib-studio/pdfjs/pdf.worker.min.mjs`, the CMaps for Chinese, Japanese and Korean text,
two standard fonts and its JBIG2 and JPEG 2000 image decoders all ship inside the extension, under `nib-studio/pdfjs/`,
and they load nothing from anywhere else.  
Nothing in a PDF runs: no JavaScript and no form actions,
and links to web pages, files or other programs are not followed; only links to places in the same PDF can be clicked.  
A password typed for a protected PDF is passed to pdf.js to open the file;
it is kept only as [Locked files](#locked-files) says, and never sent anywhere.  
PDFs work within the same content security policy, with no `eval` and no WebAssembly,
so pdf.js decodes images with its JavaScript decoders.

## Lookup

**Look up files…** reads the files of the open workspace on your device, to find them by name and by content.  
It reads them in a background worker that ships inside the extension, `nib-studio/lookupWorker.js`,
and PDFs through pdf.js as above; the text it finds stays in the tab's memory and is never written or sent anywhere.  
It is let go when the workspace closes or the tab does.  
A locked file's content is searched only while its tab keeps it unlocked, from the copy the tab holds,
and the password is never passed to Lookup.

## Locked files

Word documents and Excel workbooks encrypted with a password are decrypted inside the Nib Studio tab,
with the browser's own Web Crypto and the studio's code, and PDFs by pdf.js; nothing is sent anywhere.  
The password box is emptied as soon as you press **Open**.  
What reopens a locked file stays in the tab's memory only while its tab is open, so switching tabs doesn't ask again:
the decrypted bytes of a Word document or an Excel workbook, and the password of a PDF, which pdf.js needs to read it again.
It is never saved, written to disk or sent anywhere, and closing the tab, or a change to the file on disk, lets it go.  
A workbook locked with Excel's own password, `VelvetSweatshop`, is tried with that password before asking, as Excel does.  
`.doc` pictures stored as TIFF are decoded inside the tab too, by the same UTIF decoder the image preview uses.

## Exports

Exports are downloads made only when you ask for them:

- **Export HTML** and **Export PDF** of a Markdown file create files only when you click them,
  through the browser's download and print dialogs.
  Images from the workspace go inside them; see [Markdown and HTML](#markdown-and-html).
- **Export JSON** and **Export HTML** in a diff tab's context menu download the comparison,
  as a JSON file or as a page of its own, to the browser's downloads.
  The files hold the names of both sides, the paths of workspace files and files from disk,
  and the compared text and values; never the time a text was pasted.
  Nothing is written into the workspace.
  The exported page carries its own styles and script, fetches nothing, and opens from disk with no network.

Files you save stay on your disk unless you share them.

## Third-party software

Nib Studio is built with open-source packages, such as pdf.js, CodeMirror, mermaid and SheetJS,
bundled into the extension when it is built; none of them is fetched at run time,
and they run under the same content security policy, with no network access.  
`THIRD_PARTY_NOTICES.txt`, at the root of the extension, lists every package the version ships,
with its version, its licence and the full licence text.  
The About dialog, the `⚙` button at the right of the status bar, shows the same list.

## Permissions

- `storage`: keeps the theme choice.

Folder access is granted per folder by you, through the browser, and can be revoked in the browser's site settings.

## Contact

Privacy questions: Efthymios Koktsidis, efthymios.ks@gmail.com
