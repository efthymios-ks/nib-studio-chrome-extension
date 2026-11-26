# Preview

Images, audio, video, fonts and archives open as a view-only preview,
and so do presentations, OpenDocument text and drawings, and files of an unknown type that aren't text.  
There is no Editor view, no **Save**, no dirty state, no **Compare with…** and no editor bar;
the file is shown from disk and never read as text.  
None of these files, nor a PDF, has **Copy raw**, **Copy formatted** or **Copy content**;
an image has **Copy image** instead.  
The preview reloads by itself when the file changes on disk,
and a file dropped from outside the workspace previews the same way.  
PDFs open in the same frame, with selectable text, a page box, Find, a zoom menu with **Fit page**,
and **Save pages…**, which saves chosen pages as a new PDF after a preview;
see [PDF](Documents.md#pdf) and [Save pages](Documents.md#save-pages).

## The preview frame

Every preview shares one frame: a toolbar, the content, and the **Info** panel.

The toolbar holds, from left to right:

- the type badge, such as **Image**, **Audio**, **Video**, **Font**, **Archive** or **Binary**;
- for images and fonts, the zoom controls: `−`, the zoom level, `+` and **Reset**;
- the viewer's own actions, such as **Copy image**;
- **Info**, which shows or hides the details panel;
- the **View only** badge.

### Zoom

Images zoom from 10% to 800%.  
`−` and `+` step through 10%, 25%, 33%, 50%, 67%, 75%, 90%, 100%, 110%, 125%, 150%, 175%, 200%, 250%, 300%, 400%, 500%, 600% and 800%.  
**Reset** fits the image to the window and centres it.
It never enlarges an image that already fits, so a small image resets to 100%.  
An image opens fitted, and while you leave the zoom alone it fits again whenever the window or the Info panel changes its room.

- **Wheel:** the mouse wheel zooms the image at the pointer, smoothly, without `Ctrl`.
  A trackpad pinch zooms the same way.
  `Shift`+wheel and sideways scrolling still scroll.
- **Pointer kept:** the point under the pointer stays under it.
  While the image is smaller than the window it moves toward the pointer as it grows,
  but never past the frame's edge; once it is larger, the view scrolls to keep the point in place,
  from the step that takes it past the window on.
  A zoom never opens a gap beside an image that fills the window.
- **Keys:** `+` or `=` zooms in, `-` zooms out and `0` resets, while the preview has focus.
  Click the image to give it focus.
  `Ctrl` with `+`, `=`, `-` or `0` does the same anywhere in the preview, its toolbar and **Info** panel included,
  and never zooms the browser page.
- **Ctrl+wheel:** over the toolbar, the controls or the **Info** panel it does nothing, and never zooms the browser page;
  only over the content does it zoom the preview.
- **Every preview:** in every preview, one that doesn't zoom and one showing a message or a password box included,
  `Ctrl`+wheel and `Ctrl` with `+`, `=`, `-` or `0` never zoom the browser page,
  and `Ctrl+F` never opens the browser's find bar.
  They do nothing there, apart from `Ctrl+F` in the PDF and Word previews, which goes to **Find in document…** while it shows.
- **Drag:** when the image is larger than the window, the pointer shows a grabbing hand and dragging moves the image with it,
  with the mouse, a pen or a finger, never past its edges; the scroll bars scroll as usual.
  A click without a drag does nothing, and a drag never starts a file drag.
- **Smooth:** the buttons, keys and **Reset** ease to their zoom over about 180 ms,
  and pressing again while one runs heads straight for the next step.
  With the system set to reduce motion, they change at once.
- **Sharp:** during a zoom the image already drawn is scaled; about 150 ms after the zoom rests it is drawn again at that size.
  Past 200%, image pixels show as crisp squares.
- **Resizing:** at a zoom of your own, when the window or the **Info** panel changes the room,
  the point in the middle of the view stays there, across as well as down.
- **Memory:** the zoom and scroll of each tab come back when you return to it, until the tab closes.
  A tab left fitted fits the window again.

Audio and video do not zoom; their toolbar has only **Info**.  
Fonts zoom like a document: the wheel scrolls, and `Ctrl`+wheel, a pinch, the buttons and the keys zoom.  
**Reset**'s tooltip says what it fits: **Fit to the window (0)** for images, **Fit to the width (0)** for fonts and documents.

### Info

**Info** opens the details panel beside the content, or below it at 720 px wide or less.  
It lists groups of rows as plain text, so you can select and copy them with `Ctrl+C`.  
Whether it is open is remembered for every preview.

### Messages

When a file can't be shown, such as a damaged image, a PDF that can't be opened or an archive,
the frame shows a message instead of the content, centred in the room left for it, with Info open or closed.  
Long messages wrap at about 60 characters.  
While a message shows, the zoom controls, the viewer's actions, such as **Copy image** or Find,
and its controls bar are hidden; the type badge, **Info** and **View only** stay.
They come back when the content does.

## Images

| Format | Extensions | Shown by |
| --- | --- | --- |
| PNG and animated PNG | `.png`, `.apng` | Chrome |
| JPEG | `.jpg`, `.jpeg`, `.jfif`, `.pjpeg`, `.pjp` | Chrome |
| GIF, animated | `.gif` | Chrome |
| WebP | `.webp` | Chrome |
| AVIF | `.avif` | Chrome |
| BMP | `.bmp` | Chrome |
| Icon and cursor | `.ico`, `.cur` | Chrome |
| SVG | `.svg` | Chrome, as a picture |
| HEIC and HEIF, such as iPhone photos | `.heic`, `.heif`, `.hif` | not decoded: a message and the details; see [HEIC](#heic) |
| TIFF | `.tif`, `.tiff` | UTIF, bundled; the first page |

- **By content:** the format is read from the file's first bytes, so a misnamed file still opens as what it is;
  the extension decides only when the bytes say nothing.
- **Orientation:** photos show upright, as the camera's EXIF orientation says.
  TIFF files are turned by their orientation tag.
- **SVG:** drawn as a picture through an image, from the file itself, so scripts inside it never run.
- **Transparency:** a checkerboard shows through transparent pixels.
- **TIFF:** decoded in a background worker that is part of the extension, so the page stays responsive.
  Switching tabs and coming back does not decode again.
- **Copy image:** puts the image on the clipboard as PNG, at its full size and upright, whatever its format,
  and confirms with **Image copied to the clipboard as PNG.**
  `Ctrl+C` does the same while the image has focus and no text is selected.
  An animated image copies its first frame.
- **Damaged files:** a file that can't be decoded shows **This image can't be shown** with the reason,
  and the Info panel still lists the file.

### HEIC

HEIC pictures are compressed with HEVC, which is covered by patents,
so Nib Studio ships no HEIC decoder.  
A HEIC file still opens as an image preview:

- **Message:** the frame shows **This picture can't be shown here**,
  with "Nib Studio doesn't decode HEIC pictures. Its details are under Info."
- **Hidden:** as with any message, zoom and **Copy image** are hidden; the badges and **Info** stay.
- **Info:** the File group, then the Image group with the dimensions, megapixels and orientation,
  then the Camera and Location groups, date taken included; none of it needs the picture decoded.
- **Dimensions:** read from the HEIF properties of the primary image, in the file's meta box,
  which is all that is read of it: `ispe` gives the coded size, a clean aperture (`clap`) crops it,
  and a rotation (`irot`) of a quarter or three-quarter turn swaps width and height.
  A mirror (`imir`) keeps the size.
  So an iPhone photo taken upright shows `3,024 × 4,032 pixels`, as the decoded picture would.
  A file whose properties can't be read has no dimensions; its Image group still shows the orientation its EXIF gives.
- **Camera and Location:** exifr reads them from the file's EXIF.

In a Markdown or HTML document, a HEIC picture shows the placeholder "Nib Studio doesn't decode HEIC pictures." in its place;
see [Markdown](Markdown.md#images).

### Image details

| Group | Rows |
| --- | --- |
| File | name, type, size, last modified |
| Image | dimensions, megapixels, frames of an animation, pages of a TIFF, orientation, and for SVG its `width`, `height` and `viewBox` |
| Camera | camera, lens, date taken, exposure, aperture, ISO, focal length, flash, software |
| Location | coordinates and altitude |

- A row shows only when the file holds it, and a group with no rows is left out.
- EXIF is read from JPEG, HEIC, AVIF, TIFF and PNG files by exifr, reading only the parts it needs.
- **Date taken** is the time the camera wrote, with its time zone offset when there is one; it is never moved to your time zone.
- **Coordinates** are plain text, such as `48.858222° N, 2.294500° E`; there are no map links.

## Audio and video

| Kind | Extensions |
| --- | --- |
| Audio | `.mp3`, `.wav`, `.ogg`, `.oga`, `.opus`, `.flac`, `.m4a`, `.aac`, `.weba` |
| Video | `.mp4`, `.m4v`, `.webm`, `.ogv`, `.mov`, `.mkv` |

- **Player:** Chrome's own controls play the file straight from disk, without reading it into memory.
- **Details:** the File group, then the duration, rounded to the nearest tenth of a second under a minute,
  such as `0:03.0` for 2.993 s, and to the second beyond; for video, the picture size.
  A recording whose header has no length, such as one made in a browser, has it found by a quick seek;
  until then, and for a file whose length isn't known, the row is left out.
- **Can't play:** a file whose format or codec Chrome doesn't support, or a damaged one,
  shows **This audio file can't be played** or **This video can't be played** with the reason.
- **No picture:** a video whose picture Chrome can't decode, or that holds sound only, shows a note above the player.

## Fonts

| Kind | Extensions |
| --- | --- |
| TrueType and OpenType | `.ttf`, `.otf` |
| Web fonts | `.woff`, `.woff2` |
| Collections | `.ttc`, `.otc`; the first face shows |

- **Its own face:** the font is loaded from the file's bytes under a name of its own for the tab,
  and taken out of the page again when the tab closes or the file changes.
- **Sample:** a text box above the sheet, starting with a pangram; the sample shows at 12, 16, 24, 36, 48 and 72 px
  and follows what you type.
  The text stays while the studio is open, for every font, and is never stored.
- **Characters:** every character the font maps, from its `cmap`, as text you can select and copy with `Ctrl+C`;
  hovering one shows its code point.
  Spaces and control and format characters are left out,
  and the count above the grid and the Info panel's **Characters** row both count the same characters, such as `274 characters`.
  A font with more than 2,000 shows the first 2,000 and says how many it has, such as `2,831 characters, the first 2,000 shown`.
- **Variable fonts:** a slider for each axis, such as weight or optical size, changes the samples and characters as it moves.
- **Info:** the File group, whose **Type** names the format, such as `WOFF2, TrueType outlines`,
  then Font (family, style, full name, version, faces, glyphs, the characters the grid shows,
  units per em, weight and width), Variable axes (each axis with its range and default, and the number of named styles),
  and Credits (designer, foundry, copyright, licence, licence URL as plain text, and embedding permissions).
- **Reading:** a small reader built into Nib Studio reads the `name`, `cmap`, `OS/2`, `head`, `maxp` and `fvar` tables;
  WOFF tables are inflated by the browser, and WOFF2 tables by the bundled Brotli decoder.
  A font Chrome can't load shows **This font can't be shown**, and a font whose tables can't be read still shows, with a note.

## Archives

| Kind | Extensions |
| --- | --- |
| ZIP, 7-Zip and RAR | `.zip`, `.7z`, `.rar` |
| Tar, plain or compressed | `.tar`, `.tar.gz`, `.tgz`, `.tar.bz2`, `.tbz2`, `.tar.xz`, `.txz`, `.tar.zst` |
| Compressed files | `.gz`, `.bz2`, `.xz`, `.zst` |
| Cabinet and disc images | `.cab`, `.iso` |

- **No preview:** an archive opens in the frame with an **Archive** badge and the message **This archive has no preview**,
  which says to open it with an archive tool, such as File Explorer or 7-Zip.
- **Never read:** the preview reads nothing from the file, neither as text nor as bytes, so a large archive opens at once.
- **Info:** the File group, whose **Type** names the format by the longest suffix,
  such as `ZIP archive`, `7-Zip archive` or `Gzip-compressed tar archive` for `.tar.gz`.
- **No zoom:** the toolbar has only **Info**.

## Presentations and OpenDocument files

| Kind | Extensions | Badge | Message |
| --- | --- | --- | --- |
| PowerPoint and OpenDocument presentations | `.ppt`, `.pptx`, `.pptm`, `.pps`, `.ppsx`, `.ppsm`, `.pot`, `.potx`, `.potm`, `.odp` | **Presentation** | **This presentation has no preview** |
| OpenDocument text | `.odt` | **Document** | **This document has no preview** |
| OpenDocument drawings | `.odg` | **Drawing** | **This drawing has no preview** |

- **No preview:** the message says which kind of app opens the file, such as PowerPoint or LibreOffice Impress.
- **Never read:** as with an archive, nothing is read from the file, neither as text nor as bytes.
- **Info:** the File group, whose **Type** names the kind, such as `PowerPoint presentation`,
  `PowerPoint 97–2003 slide show` or `OpenDocument text document`; the status bar shows the same name.
- **No zoom:** the toolbar has only **Info**.
- OpenDocument spreadsheets, `.ods`, open in the **Table** view; see [Tables](Tables.md).

## Files that aren't text

A file whose type Nib Studio doesn't know, such as `firmware.bin` or one without an extension,
opens in the Editor only when its first 8 KB read as text:

- **Text:** a UTF-16 byte order mark, or bytes that are valid UTF-8 for the most part, without NULs,
  and mostly free of control characters other than tab, line breaks, form feed and escape.
  A character cut in two at the 8 KB mark doesn't count.
- **Text in a code page:** bytes that aren't UTF-8 but read as words in a single-byte Windows code page,
  such as Greek in Windows-1253, with next to no control characters;
  see [Text encodings](Editor.md#text-encodings).
- **Not text:** a NUL outside UTF-16 with a byte order mark,
  or bytes of which more than half are invalid UTF-8 or control characters, and that read as no code page.
  The file opens in the frame with a **Binary** badge and the message **This file isn't text**,
  and Info lists the File group with the type `Binary file`; the status bar shows `Binary` and no text encoding.
- Only the first 8 KB are read to decide; the text of a file that isn't text is never read.
- Files of a known text type, such as `.txt`, `.json` or `.md`, open as text whatever their bytes,
  and a file of any other known type opens in its own view.
- A file dropped from outside the workspace is checked the same way.

## Compare and save

- **Compare with…** is left out of the Explorer and tab menus for these files,
  their open tabs are never offered as the other side, and the compare chooser leaves them out.
- Dropping one on a compare side says it can't be compared:
  `photo.png can't be compared: it opens only as a preview.`, or for a file that isn't text,
  `firmware.bin can't be compared: it isn't text.`
- **Save** and `Ctrl+S` do nothing; the file on disk is never written, and `Ctrl+S` never opens the browser's **Save as** dialog.

## For viewers built on the frame

`views/previewFrame.ts` is shared by every preview; PDF and Word viewers use it too.

- `createPreviewFrame(options)` builds the frame; `options.wheelZoom` is `'wheel'` for images,
  where the plain wheel zooms, or `'ctrl-wheel'` for documents, where the wheel scrolls and `Ctrl`+wheel zooms the content, not the page.
- `dragToPan`, on by default, lets a drag move content larger than the window; a viewer whose text must stay selectable,
  such as the font preview, turns it off.
- `setControls(element)` puts a bar of the viewer's own inputs under the toolbar.
- `showMessage(title, message)` replaces the content with a message centred in the stage;
  it hides the zoom controls, the actions and the controls bar until `setContent` shows content again.
- `showPanel(element)` does the same with an element of the viewer's own, such as a password form,
  and sets the frame's `data-state` to `panel`.
- `views/passwordPanel.ts` is the password box every locked file shows, PDF, Word and Excel alike:
  `createPasswordForm` with **Open** and **Cancel**, `Enter` and `Escape`, and the wrong-password message,
  and `createPasswordCancelled` with **Enter password**.
  The PDF and Word previews show it with `showPanel`, and the table view in its own area.
  `views/passwordUnlock.ts` asks until a password opens the file, showing **Unlocking…** while one is tried;
  the box is emptied as soon as a password is sent, and nothing keeps it.
- `zoomMenu: { fitPage, steps }` turns the zoom level into a button with a menu of **Fit page**, Reset's fit,
  **Actual size** and the fixed `steps`; the button names the mode and its tooltip gives the scale.
  `fitPage(viewSize)` returns the scale and the content point to centre that show one whole page, or null.
  The frame keeps to Fit page through resizes and the **Info** panel, remembers it for the tab,
  and calls `onZoomModeChange(mode)` with `'fit'`, `'fit-page'` or `'scale'` whenever the mode changes;
  `getZoomMode()` and `fitPage()` read and set it.
  The PDF preview uses it, with its own paging in `views/pdfPaging.ts`.
- `setContent(element, size)` shows content whose size at 100% is `size`;
  the frame scales it with a transform while zooming, then lays it out at the new scale and calls `onZoomSettled(scale)`,
  which is the moment to redraw canvases crisply.
  The content can size itself from the `--preview-scale` custom property.
- `views/previewZoom.ts` holds the arithmetic and `views/previewZoomController.ts` the wheel, keys, drag and animation;
  the controller's `fitTo(fit)` eases to a viewer's own fit and keeps to it until the next zoom.
- `views/findBox.ts` is the **Find in document…** box with `↑`, `↓` and the count;
  the Word and PDF previews both put it in the controls bar with `setControls`.
- `views/pdfSavePagesDialog.ts` is the **Save pages…** dialog and its toolbar button, which the PDF preview puts
  among its actions and hands the document it has open.
  `common/pdf/pageSelection.ts` reads the pages typed, `common/pdf/pagesFileName.ts` suggests the name,
  and `common/pdf/pdfPagesBuilder.ts` makes the new PDF with pdf-lib, which starts only when the dialog first opens.
- `views/messagePreview.ts` shows a file with no preview of its own as a message with its File group in Info,
  reading nothing from the file; archives, presentations, OpenDocument text and drawings, and files that aren't text use it.
- `views/observeResize.ts` watches an element's size for the frame and the viewers:
  it runs the work in the next frame, once however many notifications arrive, and only for a size not yet handled,
  so work that resizes the page never sets off a ResizeObserver loop.
  The frame watches its viewport's border box, so scroll bars that a zoom brings or takes away never move the content.

## Not handled

- Editing images, audio or video, and comparing them.
- Other TIFF pages: only the first one shows; the Info panel counts them.
- HEIC pictures: they aren't decoded, so only their size and details show;
  see [HEIC](#heic).
- Camera raw files, such as `.cr2`, `.nef` and `.dng`, Photoshop `.psd` and JPEG XL: not recognised,
  they open as a file that isn't text.
- Previews of presentations and OpenDocument text and drawings: they show a message and their File details.
- Video codecs Chrome can't decode on the machine, such as HEVC on some systems.
- Subtitles and chapters.
- What an archive holds: its contents are not listed, and nothing in it can be opened.
