# Documents

Word documents and PDFs open as a view-only preview in the frame images use, with zoom and the **Info** panel;
see [Word](#word) and [PDF](#pdf).  
Both are view only: the toolbar has no view tabs, no **Compare with…** and no **Save**, only a **View only** badge,
and the file is never read as text.  
Images, audio and video open in a preview of their own; see [Preview](Preview.md).

## Word

| Format | Extensions | Read by |
| --- | --- | --- |
| Word document and template, and their macro-enabled kinds | `.docx`, `.dotx`, `.docm`, `.dotm` | mammoth, bundled |
| Word 97–2003 document and template | `.doc` | the studio's own reader |
| Word 6.0 and Word 95 document, as text | `.doc` | the studio's own reader |

- **By content:** the file's first bytes decide how it is read, so a DOCX named `.doc` shows as a DOCX,
  and a `.doc` that holds RTF, a web page or plain text shows its text, with a note above the page saying so.
- **Macros:** never run; a `.docm` or `.dotm` shows like a `.docx`.
- **Changes on disk:** the preview reloads by itself when the file changes on disk.
  Other changes in the studio never read the file again, and switching tabs and coming back doesn't either.

### Toolbar

From left to right: the **Word** badge, `−`, the zoom level, `+`, **Reset**, **Info** and **View only**.  
**Find in document…** with `↑` and `↓` sits in a bar under the toolbar,
which hides while the frame shows a message.
It is the same box as the PDF preview's, `views/findBox.ts`, with the same keys and count.  
There is no copy button: select text with the mouse and press `Ctrl+C`.

### Page

- The document shows on a white sheet on grey, as PDF pages do, in both themes,
  with the paper width and margins the document gives;
  a document that names none shows on US Letter with one-inch margins.
- A short document still fills one sheet; a longer one is one tall sheet, and its page breaks show as a dashed line.
- A DOCX shows in a Calibri-like font and a `.doc` in a Times-like one, at Word's default sizes;
  the document's own fonts, colours and spacing are not reproduced.

### Zoom

- **Opening and Reset:** the page fits the window's width, but never above 100%,
  so on a wide window it shows at its printed size.
  While you leave the zoom alone, it fits again whenever the window or the **Info** panel changes the room.
- **Ctrl+wheel:** `Ctrl`+wheel, or a trackpad pinch, zooms continuously at the pointer.
  The plain wheel scrolls.
- **Buttons and keys:** `−` and `+` step from 10% to 800% and ease over about 180 ms.
  With the page focused, `+`, `-` and `0` zoom in, out and reset,
  and so do `Ctrl`+`+`, `Ctrl`+`-` and `Ctrl`+`0` anywhere in the preview.
  Neither the wheel nor the keys ever zoom the browser page itself, not even over the toolbar or the **Info** panel.
- **Smooth, then sharp:** while you zoom, the page is scaled;
  about 150 ms after the zoom rests, it is laid out again at the new size, so the text stays crisp.
- **Resizing:** when the window or the **Info** panel changes the room, the point in the middle of the view stays there,
  across as well as down, at any zoom; fitted, the line being read stays in the middle.
  A window too narrow to show the page keeps the place for when it widens again.
- **Memory:** each tab keeps its zoom and scroll until it closes; a fitted tab comes back fitted.

### Find

- Typing in **Find in document…** highlights every match, ignoring case and accents as PDF Find does,
  so `cafe` finds `Café` and `οδος` finds `ΟΔΟΣ`, and shows the count, such as `1 of 3`;
  large counts have thousands separators, such as `1,204 of 3,310`.
- `Enter` or `↓` goes to the next match and `Shift`+`Enter` or `↑` to the previous one, wrapping around;
  each scrolls into view.
- `Escape` clears the box, and `Ctrl+F` in the preview goes to it;
  while a message or the password box shows, `Ctrl+F` does nothing, and never opens the browser's find bar.
- A match never spans two paragraphs or table cells, and spaces at either end of the text are ignored.
- **No matches** shows when nothing matches.
- A document opened from [Lookup](Lookup.md) at a match in its content opens with the match's text in the box,
  and its first match current and in view.

### DOCX

- Mammoth converts the document to HTML and DOMPurify sanitises it:
  headings, paragraphs, lists, tables, bold, italics, underline, footnotes and endnotes.
- Word's **Title**, **Subtitle**, **Quote**, **Intense Quote** and **Caption** styles show as such,
  and headings 7 to 9 as the smallest heading.
- **Pictures:** PNG, JPEG, GIF, BMP, WebP and SVG pictures stored in the file show inline from `data:` URLs,
  at the size the document gives them.
  Other kinds, such as EMF and WMF, and pictures linked from outside the file show a **Picture** placeholder.
- **Tables:** header rows are shaded, and so is a first row set in bold.
- **Links:** links to places in the document, such as footnotes and bookmarks, scroll there.
  Links to web pages, mail and phone numbers are not followed; their address shows as a tooltip.
  A middle click on a link does nothing, rather than start Chrome's autoscroll.
- Nothing loads from the network.

### Word 97–2003

- The studio reads the binary format itself, from the file's compound container:
  the text of the main document, in 8-bit Windows-1252 and Unicode pieces alike.
- **Shown:** paragraphs, tables, bold, italics, underline, strikethrough, superscript and subscript,
  the **Title**, **Subtitle** and heading styles, paragraph alignment, bulleted and numbered lists, line breaks and page breaks.
- **Fields** show their result, such as a link's text or a page number, never their code.
- **Tables:** nested tables are flattened into their outer cell.
- **Pictures:** PNG, JPEG, GIF and BMP pictures show from `blob:` URLs, which close with the preview.
  A bitmap stored as a DIB gets the file header that makes it a BMP.
  - **Inline pictures** flow with the text, at the size the document gives them, after its scale and crop.
  - **Floating pictures** show as a block at the start of the paragraph they are anchored to,
    at the size of their frame; Word's wrapping and position are not reproduced.
  - **TIFF pictures** are decoded inside the studio by UTIF, as the image preview decodes TIFF files,
    and show as PNG; one that doesn't decode shows **Picture (TIFF)**.
  - **Placeholders:** EMF, WMF and PICT pictures, which the browser can't draw, show a placeholder that names them,
    such as **Picture (EMF)**.
    Drawn shapes and text boxes, damaged picture data and pictures that don't decode show a **Picture** placeholder.
  - **Size limit:** a document shows up to 50 MB of pictures; those past it show a **Picture** placeholder.
- Hidden text and tracked deletions are left out.

### Word 6.0 and Word 95

- The studio reads these older binary files as text: paragraphs, tables, fields as their result,
  bold, italics, underline, strikethrough, superscript and subscript.
- The text is read in the code page of the document's language, such as Windows-1253 for Greek.
- Styles, lists, page size and pictures are left out: the page is US Letter, and pictures show a **Picture** placeholder.
  A note above the page says so.
- Without paragraph formatting, a table row ends at an empty cell that follows another cell,
  so an empty cell can end a row early.

### Info

| Group | Rows |
| --- | --- |
| File | name, type, size, last modified |
| Document | title, subject, author, keywords, comments, category, manager, company |
| History | created, modified, modified by, revision, application |
| Statistics | pages, words, characters, and pictures in a Word 97–2003 file |
| Security | how an encrypted file is encrypted, such as `Agile encryption, AES-256 with SHA-512`, last, as in the PDF preview |

- A DOCX gives them in `docProps/core.xml` and `docProps/app.xml`;
  a `.doc` in its SummaryInformation and DocumentSummaryInformation property sets, read in the code page the file names.
- **Pictures** counts the pictures a `.doc` stores, those that show as placeholders included.
- **Type** names the format the bytes hold, such as `Word 97–2003 document (DOC)` or `Word 6.0/95 document (DOC)`,
  or, for a file too old to show, `Word for Windows 1.0–2.0 document (DOC)`.
- A row shows only when the file holds it, and a count of zero is left out.

### Passwords

- A `.docx` or `.doc` encrypted with a password asks for it in the frame, as a PDF does:
  **This document is protected with a password**, the file name, a password box, **Open** and **Cancel**.
  The zoom and Find are hidden until it opens.
- `Enter` opens, `Escape` cancels, and **Unlocking…** shows while the password is tried.
- A wrong password says **That password is incorrect. Try again.**
- **Cancel** leaves **It stays closed until its password is entered.**, with **Enter password** to ask again.
- While it asks, the **Info** panel shows what the file tells without its password:
  its encryption under **Security**, as **Encrypted**, and, for a `.doc`, the properties it keeps in the clear.
- **Schemes:**
  - DOCX, DOCM, DOTX and DOTM: Agile encryption (AES-128 or AES-256, with SHA-1, SHA-256, SHA-384 or SHA-512)
    and Standard encryption (AES-128 or AES-256 with SHA-1), as Office 2007 and later write them.
  - `.doc` from Word 97 to 2003: RC4 and RC4 CryptoAPI encryption.
- The decrypted file stays in the tab's memory only while its tab is open, so switching tabs doesn't ask again;
  it is never saved, written to disk or sent anywhere, and closing the tab, or a change to the file on disk, lets it go.
  The password itself is not kept.
  See [Privacy](Privacy.md#locked-files).

### Files it can't show

Each shows a message in the frame, and the **Info** panel still lists the file, with its properties when they can be read.

- Encryption the preview can't open: **This document's encryption isn't supported**, with the reason.
  These are Information Rights Management, encryption for a certificate rather than a password,
  third-party (extensible) encryption, ciphers other than AES or RC4, AES-192, which the browser lacks,
  unknown versions, the XOR obfuscation of older Word versions, and Word 6.0 and Word 95 encryption.
- Word for Windows 1.0 and 2.0 files: **This document uses an older Word format**, with the version it was saved by.
- An Excel workbook or a PowerPoint presentation with a Word name: **This file isn't a Word document**.
- Word 2003 XML and flat XML: **This document is Word XML**.
- An empty file: **This document is empty**.
- A damaged file: **This document can't be read**, with the reason.

## PDF

A PDF opens in the preview frame that images use, read and drawn by pdf.js inside the studio.  
Its pages show one under another on grey, as in Chrome's own viewer.  
There is no Editor view, no **Save**, no dirty state and no **Compare with…**, and the file is never read as text.

### Toolbar

From left to right: the **PDF** badge, `−`, the zoom menu, `+`, **Reset**, the page box, **Save pages…**, **Info** and **View only**.
**Find in document…** with `↑` and `↓` sits in a bar under the toolbar, as in the Word preview.
While the password is asked for, or a message shows in place of the pages,
the zoom, the page box, **Save pages…** and Find are hidden.

### Zoom

- **Zoom menu:** the zoom level is a button that names the mode, **Fit page**, **Fit width** or a scale such as `125%`,
  with the scale in its tooltip.
  It opens a menu of **Fit page**, **Fit width** and **Actual size**, then 50%, 75%, 125%, 150% and 200%,
  with the current one ticked.
  The arrow keys move through it, and `Escape`, a click outside or a choice closes it.
- **Opening, Fit width and Reset:** the pages fit the window's width, but never above 100%,
  so on a wide window a page shows at its printed size.
  **Reset** is **Fit width**, as in the other previews: it fits again and stays at the page being read.
  While you leave the zoom alone, the pages fit the new width whenever the window or the **Info** panel changes the room.
- **Fit page:** the page being read shows whole and centred, its full height in the view,
  or its full width when that is the tighter limit; a small page is enlarged to fill the view.
  It fits again whenever the window or the **Info** panel changes the room.
- **Ctrl+wheel:** `Ctrl`+wheel, or a trackpad pinch, zooms continuously at the pointer, and the point under the pointer stays put.
  The plain wheel scrolls through the pages; in **Fit page** it turns them.
- **Buttons and keys:** `−` and `+` step from 10% to 800% and ease over about 180 ms.
  With the pages focused, `+`, `-` and `0` zoom in, out and reset,
  and so do `Ctrl`+`+`, `Ctrl`+`-` and `Ctrl`+`0` anywhere in the preview.
  Neither the wheel nor the keys ever zoom the browser page itself, not even over the toolbar or the **Info** panel.
- **Smooth, then sharp:** while you zoom, the pages already drawn are scaled;
  about 150 ms after the zoom rests, the pages in view are drawn again, sharp at the new size.
- **Actual size:** 100%, where a page shows at its printed size, a point being 96 / 72 CSS pixels, like Chrome's own viewer.
- **Leaving Fit page:** `Ctrl`+wheel, a pinch, `−`, `+`, the keys or the menu switch to that zoom,
  and the wheel scrolls continuously again.
- **Reduced motion:** with the system set to reduce motion, zooms, page jumps and page turns land at once.
- **Resizing:** when the window or the **Info** panel changes the room, the point in the middle of the view stays there,
  across as well as down, at any zoom: fitted to the width, the line being read stays in the middle,
  and at **Fit page** the same page stays whole.
  A window too narrow to show the pages keeps the place for when it widens again.
- **Memory:** each tab keeps its zoom and the place being read until it closes;
  a fitted tab comes back fitted, and a tab left at **Fit page** comes back at **Fit page** on the same page.

### Fit page paging

- **One page at a time:** one wheel gesture, `PageDown` or `PageUp`, `↓` or `↑`, or a tap of `Space` or `Shift`+`Space`
  moves exactly one page, and `Home` and `End` go to the first and last page.
- **Smooth:** each move is an eased scroll of about 320 ms that lands with the page whole in the middle of the view.
- **Trackpads and fast wheels:** the wheel's travel is collected until it reaches about half a notch, which turns one page.
  While a page moves, and until the wheel pauses, more wheel input is ignored,
  so a flick that coasts or a fast spin turns one page and never skips or bounces.
  A key pressed while a page moves heads on to the next page.
- **Ends:** the first and last pages simply stop; nothing wraps around.
- **Whole pages:** the page box, links and **Find** land on whole pages too.
- Sideways scrolling, the scroll bar and dragging with `Space` or the middle button still move the view freely.

### Pages

- **Placeholders:** every page has its place from the start, so the scroll bar is right at once.
  A document of up to 100 pages is measured before it shows; a longer one shows at once and is measured in the background.
- **Drawn as you go:** only the pages within a window's height of the view are drawn, the page being read first.
  Pages three window heights away are let go, and the drawn pages never hold more than about 80 million pixels in all.
- **Pixel density:** pages are drawn at the screen's pixel ratio, and below 150% with at least two canvas pixels to each CSS pixel,
  so the thinnest strokes of small text, such as the bars of a tiny superscript `#`, stay whole on a standard screen.
  A single page holds at most about 16.7 million pixels, so far zoomed in, beyond about 400% on a standard screen,
  a page shows a little soft rather than run out of memory.
- **A bad page:** a page pdf.js can't draw says **This page could not be drawn.**, and the other pages still show.

### Page box

- It reads like `3 / 12`: the page that fills the most of the view, and the page count.
  It follows the scroll.
- Type a page number and press `Enter` to go to that page in a short, smooth scroll; `Escape` puts the current page back.

### Save pages

**Save pages…** saves chosen pages of the PDF as a new PDF, in any order and with repeats, after a preview.
It sits in the toolbar beside the page box, and in the Explorer's and the tab's right-click menus of a PDF.

- **Pages:** the box starts with every page, such as `1-14`, and takes pages and ranges,
  separated by commas, semicolons or spaces:
  - `1, 2, 6-8, 1` is pages 1, 2, 6, 7, 8 and 1 again.
  - `8-6` runs backwards: 8, 7, 6.
  - `6-` runs to the last page, and `-3` from the first.
  - Spaces around a dash keep a range together, so `6 - 8` is `6-8`, and an en or em dash counts as a dash.
- **Count:** the number of pages shows above the preview as you type, such as `6 pages`.
- **Mistakes:** an entry that can't be read is explained under the box,
  such as **Page 20 is past the last page, 14.** or **"x7" isn't a page or a range.**,
  and **Save** stays off until it reads; `Enter` then selects the part that is wrong.
  A selection holds up to 10,000 pages, or every page of a longer document.
- **Preview:** thumbnails of the new PDF's pages in their new order, each labelled with its page in the original, such as `p. 6`.
  It follows the box about 200 ms after typing pauses,
  and while the entry can't be read the last preview stays, dimmed.
  Only the thumbnails near the view are drawn, two at a time, from the document the preview already has open;
  each page is drawn once, so a repeated page and later edits reuse it.
  A selection of more than 500 pages previews its first 500 and says so.
- **File name:** it starts as `<name>-pages.pdf`, or the next free name, such as `<name>-pages-2.pdf`.
  It must end in `.pdf`, can't contain `/` or `\`, and can't be the name of a file beside the original.
- **Save:** `Enter` or **Save** writes the new PDF next to the original and says so, such as **Saved tracemonkey-pages.pdf.**;
  the Explorer shows it and it opens in a tab.
  A file that takes the name in the meantime is never written over; the dialog says so instead.
- **From outside the workspace:** for a PDF opened from outside the workspace the button reads **Save as…**,
  and a file picker asks where the new PDF goes; closing the picker leaves the dialog open.
  The new PDF opens in a tab of its own, and the only toast is **Saved name.**
- **Closing:** `Escape`, **Cancel**, `×` or a click beside the dialog closes it without saving.
- **The new PDF:** each page is a copy of the original page, a repeated page being a page of its own,
  and the pages share their fonts and pictures.
  It keeps the original's title, author, subject, keywords, creating application and creation date,
  takes the time it is saved as its modification date, and names Nib Studio as its producer.
  A link to a page in it goes to that page's first copy; a link to a page left out is removed.
  Bookmarks, article threads and page actions are left out.
- **Password-protected PDFs:** the dialog says **Pages of a password-protected PDF can't be saved.** and shows no preview,
  even for a PDF that opened without asking for a password,
  as its pages would be copied still encrypted and come out unreadable.
- **Damaged PDFs:** the dialog says **The pages of this PDF can't be saved.**, with the reason,
  such as **The file is damaged, or it isn't a PDF.**
- The new PDF is made by pdf-lib, bundled into the extension; nothing leaves the computer.

### Text and panning

- **Select and copy:** drag across text to select it, as in Chrome's viewer, and copy it with `Ctrl+C`.
  `Ctrl+A` in the pages selects the text of the pages drawn.
  A scanned page with no text in it has nothing to select.
- **Pan:** hold `Space` and drag, or drag with the middle mouse button; the pointer shows a grabbing hand.
  A tap of `Space` scrolls one screen down, and `Shift`+`Space` one screen up; in **Fit page** they turn one page.

### Find

- **Whole document:** typing in **Find in document…** searches every page, not only the pages drawn,
  shows the count, such as `2 of 5`, or `1,204 of 3,310` with thousands separators, and brings the first match into view.
- **Case and accents:** matching ignores case and accents, so `συμβολαιο`, `Συμβόλαιο` and `ΣΥΜΒΟΛΑΙΟ` all match,
  and a final `ς` matches `σ`.
  A run of spaces counts as one, and spaces at either end of the text are ignored.
- **Lines and pages:** a match can run across the pieces of text pdf.js gives for a line,
  and on across the end of a line, read as a space, but never across two pages.
- **Highlights:** every match on the pages drawn is highlighted, the current one in a stronger colour,
  and the page's own text shows through.
  The highlights follow the pages as they are drawn or let go, and through every zoom.
- **Stepping:** `Enter` or `↓` goes to the next match and `Shift`+`Enter` or `↑` to the previous one, wrapping around.
  Each comes to the middle of the view in a short, smooth scroll, and the page box follows;
  a match on a page far away has that page's text laid out first, so it is highlighted on arrival.
  In **Fit page**, the match's page comes into view whole.
- **Long documents:** each page's text is read the first time a search needs it and kept while the PDF is open.
  A search that takes a while says how far it has got, such as `Searching… 12 of 32 pages`, and typing again starts it over.
  Page counts have thousands separators too, such as `Searching… 1,200 of 3,310 pages`.
- **Keys:** `Escape` clears the box and the highlights, and `Ctrl+F` in the preview goes to the box;
  while a message or the password box shows, `Ctrl+F` does nothing, and never opens the browser's find bar.
- **Memory:** each tab keeps its query and current match until it closes.
- **From Lookup:** a PDF opened from [Lookup](Lookup.md) at a match in its content opens with the match's text in the box,
  and its first match current and in view.
- **No matches** shows when nothing matches; a scanned page with no text has nothing to find.
- **No text at all:** a PDF with no text on any page, such as a scan, says **This PDF has no text to search**
  in place of **No matches**, once the search has read every page.
  A page with only white space counts as one with no text.

### Links

- Links to other places in the same PDF jump there, smoothly:
  named and explicit destinations, and the first, last, next and previous page actions.
- Links to web pages, files and other programs are not followed and can't be clicked; their text stays selectable.

### Info

| Group | Rows |
| --- | --- |
| File | name, type, size, last modified |
| Document | title, subject, author, keywords |
| History | created, modified, the application that made it, the PDF producer |
| PDF | version, pages, page size, tagged for accessibility, fast web view, language, forms, signatures |
| Security | encrypted, whether a password is needed to open it, what the document restricts |

- Each value comes from the document information dictionary, or from the XMP metadata when the dictionary lacks it.
- **Dates** with a time zone show in your time zone, such as `2024-03-12 10:15:22 UTC+02:00`;
  a date without one shows as written, and text that isn't a date shows as it is.
- **Page size** is the first page's, in millimetres and inches with the paper name,
  such as `210 × 297 mm (8.27 × 11.69 in), A4`; it says when the other pages differ.
- **Restricted** lists what the document's permissions forbid, such as printing or copying.
  The preview shows these restrictions but does not enforce them: text can still be selected and copied.
- A row shows only when the document holds it.

### Passwords

- A PDF that needs a password asks for it inside the preview, with **Open** and **Cancel**;
  the zoom, the page box, **Save pages…** and **Find** are hidden until it opens.
- **Unlocking…** shows while the password is tried, as it does for Word documents and workbooks.
- A wrong password says **That password is incorrect. Try again.**
- **Cancel** leaves **This PDF is protected with a password** and **It stays closed until its password is entered.**,
  with **Enter password** to ask again.
- The password stays in the tab's memory only while its tab is open, so switching tabs doesn't ask again,
  as pdf.js needs it to read the file again;
  it is never saved, written to disk or sent anywhere, and closing the tab, or a change to the file on disk, lets it go.
  See [Privacy](Privacy.md#locked-files).
- A PDF with only an owner password, which restricts printing or copying, opens without asking.

### Damaged files and changes on disk

- A damaged file, or one that isn't a PDF, shows **This PDF can't be shown** and **The file is damaged, or it isn't a PDF.**;
  an empty file says **The file is empty.**
  The **Info** panel still lists the file.
- When the file changes on disk the preview reloads by itself and stays at the same place.
- Other changes in the studio never reload or redraw the PDF.

### What runs

- pdf.js, bundled into the extension, reads the PDF in a background worker that is part of the extension.
  The worker, the CMaps for Chinese, Japanese and Korean text, the Symbol and Dingbats fonts,
  and the JBIG2 and JPEG 2000 image decoders all load from the extension; nothing loads from the network.
- Nothing in a PDF runs: no JavaScript, no form actions, no launch or web links.
  Forms show as they are filled in but can't be edited, and annotations are drawn but can't be changed.
- The content security policy allows no WebAssembly, so pdf.js uses its JavaScript image decoders,
  and colours given by ICC profiles show through their device colour spaces.

## Not handled

- Word's page layout: a document shows as one tall sheet, not split into pages as Word lays them out.
- Headers, footers, text boxes and comments; in a `.doc`, also footnotes and endnotes.
- In a `.doc`, EMF, WMF and PICT pictures, which show a placeholder,
  and the wrapping and position of floating pictures.
- Rights-managed documents, and the encryption schemes listed under **Files it can't show**.
- In a Word 6 or Word 95 file, styles, lists, page size and pictures.
- Word for Windows 1.0 and 2.0 files, and Word 2003 XML documents.
- `.dot` files: they open as text in the Editor, since a `.dot` file is far more often a Graphviz graph than a Word template.
  A Word 97–2003 template saved as `.dot` opens as text too; renamed `.doc`, it shows in the Word preview.
- Editing: none of these files can be changed in Nib Studio.
- Presentations, `.ppt`, `.pptx`, `.pptm`, `.pps`, `.ppsx`, `.ppsm`, `.pot`, `.potx`, `.potm` and `.odp`,
  and OpenDocument `.odt` and `.odg`:
  they open as a message with their File details; see [Preview](Preview.md#presentations-and-opendocument-files).
- Text recognition (OCR): a scanned PDF has no text to select or find.
- In a PDF: print, download, rotating pages, thumbnails, the outline or bookmarks panel, attachments and layers.
- Merging PDFs, saving the pages of a password-protected PDF, and keeping bookmarks in a PDF made by **Save pages…**.
- Filling in PDF forms, adding or editing annotations, checking signatures and XFA forms.
