# Privacy Policy

**Last updated:** 2026-11-26

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
  - **Paste from clipboard** in the `+` menu at the end of the tab bar reads the clipboard's text,
    or a picture when it holds no text, and opens it in a tab of its own;
    the formatted HTML a copy also carries is never read.
  - **Compare with clipboard** in a context menu, **Clipboard** in the **Compare with…** chooser,
    **Paste** on a compare side and **Paste from clipboard** on an empty compare side read the clipboard's text.
  - Each of these reads the clipboard once, on your click, after the browser asks for your permission;
    what it reads stays in the tab and is never sent anywhere.
  - A paste you make yourself with `Ctrl+V` hands the browser's paste to the place it lands, as on any page:
    the editors and text boxes, where it pastes as usual;
    a compare, where it fills or replaces a side;
    and the Interactive Markdown view, where formatted text from a web page or a document is turned into Markdown.
    Nothing reads the clipboard without such a paste.
- Text, keys and tokens you type or paste into the **Hash & encode** cards.
  They stay in the tab's memory and are never written to disk or to the browser's storage.

All of it is processed inside the Nib Studio tab, in your browser.  
Nib Studio writes to the clipboard only when you copy:
with `Ctrl+C`, a copy button such as **Copy raw**, **Copy formatted**, **Copy content** or **Copy image**,
a copy item in a context menu, such as **Copy path to clipboard**,
or a copy button of an HTML page in its **Preview**, on your click; see [Markdown and HTML](#markdown-and-html).

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
- **Save** in the tab that **Convert XML to JSON**, **Convert YAML to JSON**, **Convert JSON to YAML**,
  **Convert HTML to Markdown** or **Convert Markdown to HTML** opens writes `name.xml.converted.json`,
  `name.yaml.converted.json`, `name.json.converted.yaml`, `name.html.converted.md` or `name.md.converted.html`
  next to its source file.
- **Save** in a tab that **Paste from clipboard** opened writes a new file under the name you give it,
  in the folder selected in the Explorer or at the workspace root, never over an existing file;
  with no workspace open, it writes where you pick in the browser's save dialog.
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
  the Explorer width and visibility, the query panel's width, open state and query box height, the last Markdown diff view,
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
`data:` and `blob:` URLs, and lets them connect to nothing but the extension itself and `data:` and `blob:` URLs,
so no page of Nib Studio can reach the network.  
**Export HTML** keeps web image addresses as written, because the exported file is opened outside the extension.  
Word documents show only the pictures stored in the file, from `data:` and `blob:` URLs;
pictures linked from the web or the disk never load, and links in a Word document are never followed outside it.

Images with a relative path, such as `images/chart.png`, are read from the open workspace folder,
through the same folder access as the rest of the workspace, and never from anywhere else:
a path that climbs above the workspace folder is never read, and nor is a disk path such as `C:\`.  
They are shown from `blob:` URLs that live in the tab's memory and are released when the preview draws without them or closes;
an HTML file's **Preview** puts them inside the page as `data:` URLs instead.  
**Export HTML** puts those images inside the exported page as `data:` URLs, up to 25 MB, so it works offline,
and **Export PDF** prints them from the same `data:` URLs.  
Both draw Mermaid diagrams as pictures inside the Nib Studio tab, so the exported page carries no script.  
Links to workspace files only open them in the studio; nothing is fetched to follow them.

Raw HTML in a Markdown file is sanitised with DOMPurify before it is shown:
scripts, event handlers, frames, objects, embeds, forms, `<base>`, `<meta>` and `javascript:` addresses are dropped.  
Markdown keeps only the HTML a README uses, such as `<img>`, `<details>`, `<kbd>` and tables, with no styles,
and nothing in it runs.

An HTML file's **Preview** runs the page's own scripts, so its buttons and other controls work,
inside the extension's sandbox page, `nib-studio/sandbox.html`, which keeps the page apart from everything else:

- **No network.** The sandbox page has a content security policy of its own, set in the extension's manifest,
  that allows no connection to the network: `fetch` and `XMLHttpRequest` reach only `data:` and `blob:` URLs,
  which the page holds itself, and web addresses, WebSockets, beacons and the like are refused,
  and scripts, style sheets, images, fonts and media load only from the page itself, as inline content,
  `data:` or `blob:` URLs, never from the web.
  A form's submission goes nowhere: its `submit` handlers run, and the policy refuses anything sent.
  The page can't open windows or tabs.
- **No WebRTC.** WebRTC sends its own packets, which no content security policy governs,
  so every WebRTC interface is taken off the page's window before its scripts run.
  The page can't get it back from a frame or a worker of its own:
  the policy refuses every worker, and every frame with an address, `data:`, `blob:` and the extension's own pages included;
  a frame's `srcdoc` is refused as it is set, a `javascript:` address in a frame never runs,
  and a frame with no address stays empty, with an origin of its own that the page can't reach into.
  Frames, objects and embeds in the file are left out of the page.
- **No leaving.** A move of the page to another address is stopped by the studio's own policy,
  which lets its frames show only the extension's pages, and the page is drawn again as written.
- **No access to the studio, your files or the extension.** The sandbox page runs in an origin of its own,
  so the page's scripts can't read or change the studio's page, its storage, the workspace folder or other files,
  and have no access to the extension's `chrome` API or its storage.
  The page talks to the studio only through a few messages the studio checks:
  that it has loaded, a link to follow, something to copy, `Ctrl+S`, and its scroll.
  A link opens only after a click or a key press in the page, and only as a link in a preview opens:
  a workspace file in a tab, or a web address in a new browser tab.
- **Copies on your click only.** The page's script can't reach the clipboard itself,
  so its copies, such as a **Copy** button's, go through the studio:
  text, formatted text and PNG pictures, during a click or a key press in the page,
  with a `Copied from the page.` toast.
  A copy the page's script makes by itself copies nothing, and the page can never read the clipboard.
- **Remote scripts are blocked.** A script, style sheet, image or font from the web is left out of the page,
  and the policy refuses one the page's own script tries to add.
- **Workspace scripts are inlined.** A script the page links with `<script src="app.js">` is read from the workspace,
  through the same folder access as the rest of the workspace,
  and put inside the page as a `data:` URL, as its style sheets and images are;
  a script open in a tab with unsaved edits comes from that tab's text.
  Nothing outside the workspace folder is read.

What runs in the preview is the code of the HTML file and of the scripts it links in your workspace,
never code from anywhere else.  
The studio's own pages keep the content security policy above, which stays as strict as it says.

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
A locked file's content is searched only while its tab keeps it unlocked:
a Word document or workbook from the decrypted copy its tab holds,
and a PDF by pdf.js in the Nib Studio tab, with the password its tab holds, which never reaches the Lookup worker.

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
  Images from the workspace, and Mermaid diagrams drawn as pictures, go inside them; see [Markdown and HTML](#markdown-and-html).
- **Export JSON** and **Export HTML** in a diff tab's context menu download the comparison,
  as a JSON file or as a page of its own, to the browser's downloads.
  The files hold the names of both sides, the path of a workspace file, the sheet compared in a workbook,
  and the compared text and values; never the time a text was pasted.
  Nothing is written into the workspace.
  The exported page carries its own styles and script, fetches nothing, and opens from disk with no network.  
  An exported Markdown diff page remembers its last view, Diff, Before or After, in the browser's `localStorage` for that page.

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
