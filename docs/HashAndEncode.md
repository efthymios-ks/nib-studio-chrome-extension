# Hash and encode

The **Hash & encode** surface, in the header,
holds five cards: **Hash**, **Verify**, **HMAC**, **Encode / Decode** and **JWT decode**.  
It works on what you type, paste or drop, not on the workspace, and needs no workspace;
the Explorer is hidden while it is open.

The cards sit two to a row on a wide window: **Hash** on the left,
**Verify** and **HMAC** on the right, then **Encode / Decode** and **JWT decode** across the full width.  
At 720 px wide or less they stack in one column.

## How the cards work

- **Enter runs the card.**
  Typing changes nothing until you press Enter; `Ctrl+Enter` works too.
- **Shift+Enter** adds a new line in a text area.
- **An empty input clears.**
  Pressing Enter in an empty field clears that card's results.
- **Results are text to select.**
  Digests, the converted side of **Encode / Decode** and the JWT header and payload
  copy like any text: select them and press `Ctrl+C`.  
  `Tab` reaches each digest row that has a digest, and the JWT header and payload;
  `Ctrl+C` there, with nothing selected in it, selects the whole value and copies it.
- **Each card has one muted hint** under its input with its keys.
- **Errors say where.**
  Input that can't be read shows a message under the field that failed,
  with the position, or the line and column when the input has several lines,
  and the characters at fault are selected.

Inputs and results stay while the studio tab is open, also across a theme change.  
Nothing is written to disk or to the browser's storage,
because keys, tokens and texts can be sensitive; closing or reloading the tab clears them.

## Hash

Type text in **Text** and press Enter, or drop a file anywhere on the card, or click **Choose file…**.  
**Text** starts with `Nib Studio`, and its digests show on first view.

| Algorithm | Engine |
| --- | --- |
| MD5 | built-in implementation |
| SHA-1 | Web Crypto |
| SHA-256 | Web Crypto |
| SHA-384 | Web Crypto |
| SHA-512 | Web Crypto |

- Text is hashed as UTF-8.
- A line under the hint says what the digests are of, such as **Digests of the text · 3 bytes as UTF-8**
  or **Digests of release.zip · 12 MB**.
- Editing the text after Enter dims the digests and adds **edited, press Enter to hash again**.
- A file is hashed from its bytes.
  While it is read, a progress bar and **Hashing release.zip · 12 MB… 45%** show.  
  Dropping or choosing another file, or pressing Enter in **Text**, cancels a file still being hashed.
- Dragging a file over the card outlines it; dropping it there hashes it instead of opening it.
  A file dropped elsewhere on the surface still opens in **Files**, as anywhere in the studio.
- Only the first of several dropped files is hashed.
  A folder, or a file that can't be read, shows **Could not read …** with the reason, in red,
  such as `Could not read logs: it is a folder, not a file.`; Chrome hands a dropped folder over as an empty file,
  so it is told apart before anything is hashed.
- **Format** picks how the digests show: **hex**, the default, **HEX** in upper case, or **Base64**.

MD5 and SHA-1 are there to check old checksums; neither is safe for security use.

## Verify

Paste a published checksum into **Expected digest** and press Enter.  
It is checked against every digest on the page: the five in **Hash** and the four in **HMAC**.

- **Matches SHA-256**, in green, names the algorithm that matches,
  and that row in **Hash** or **HMAC** is outlined.
- **No match**, in red, comes with the digest that the length suggests, written the same way as the expected one,
  so the two can be compared by eye, such as **SHA-256 of the text: ba7816bf…**.
- A second line gives the encoding, the length and the algorithm with that length,
  such as **Hex · 32 bytes, the length of SHA-256**.

What it reads:

- Hex in either case, with spaces around it ignored; `:` between bytes is allowed.
- Base64 in either alphabet, with or without padding.
  Text made only of hex digits is read as hex.
- A whole line from a checksum file: `9f86…  release.zip` from `sha256sum`,
  or `SHA256 (release.zip) = 9f86…` from BSD and OpenSSL.
- A digest with its algorithm in front: `sha256-…` as in Subresource Integrity,
  `sha256=…` as in webhook signature headers, or `SHA256:…`.
  The named algorithm is the one suggested on **No match**.

Text that is neither hex nor Base64 shows where it goes wrong,
such as **Not hex or Base64: Invalid Base64 character '!' at position 4.**  
Until something is hashed, Verify says **Nothing to check against yet**.  
When the digests change, for example after a file is dropped on **Hash**, the result is checked again.

## HMAC

Enter a **Key** and a **Message**, then press Enter in either.  
The card signs the message, as UTF-8, with HMAC-SHA-1, HMAC-SHA-256, HMAC-SHA-384 and HMAC-SHA-512, through Web Crypto.

- The select next to **Key** reads the key as **Text**, the default, as UTF-8,
  or as **Hex** or **Base64** bytes.  
  A key that isn't valid in that encoding shows the error with its position,
  such as **Key: Invalid hex character 'x' at position 3.**
- With a message but no key, the card asks for a key.
- **Format** works as in **Hash**.

## Encode / Decode

Two text areas side by side, stacked on a narrow window: **Text** on the left, the encoded side on the right.

- **Enter in Text** encodes it into the right side.
- **Enter in the right side** decodes it into **Text**.
- **Codec** picks the encoding:

| Codec | Encodes | Decodes |
| --- | --- | --- |
| Base64 | the UTF-8 bytes of the text | either alphabet, with or without padding, ignoring whitespace |
| URL | as `encodeURIComponent` | as `decodeURIComponent`; `+` stays a plus sign |
| Hex | the UTF-8 bytes, as lower-case hex | either case; spaces, line breaks, `:`, `-` and `0x` are skipped |
| HTML entities | `&`, `<`, `>`, `"` and `'` | named references, `&#169;` and `&#xA9;` |

- **URL-safe** and **Padding**, shown for Base64 only, apply to encoding:
  **URL-safe**, off by default, uses `-` and `_`; **Padding**, on by default, keeps the trailing `=`.
- Changing the codec or an option converts again from the side you last typed in.
- The side a conversion wrote has a shaded background until you edit it.
- The card opens with a sample sentence in **Text** and its Base64 on the right.

Errors show under the side that failed, with the place, for example:

- **Invalid Base64 character '\*' at position 5.**
- **Malformed % sequence: '%' must be followed by two hex digits at position 6.**
- **%FF is not part of valid UTF-8 at position 9.**
- **Odd number of hex digits; 'e' has no pair at position 7.**
- **Unknown entity '&bogus;' at position 12.**

Base64 or hex that decodes to bytes that aren't UTF-8 text still decodes,
with the bad bytes shown as `�` and a warning that names the first one.  
A bare `&`, as in `AT&T`, stays as it is when decoding HTML.

## JWT decode

Paste a token into **Token** and press Enter.  
A leading `Bearer ` and line breaks are skipped.

- **Header** and **Payload** show as formatted JSON.
- `exp`, `nbf` and `iat` show as local dates with the UTC offset and how long ago or ahead they are,
  such as **2026-11-16 21:30:05 UTC+02:00 · in 2 hours**.  
  A claim that isn't a number shows **Not a number:** with its value.
- A badge says whether the token holds now:
  **Expired 3 days ago**, **Not valid yet · starts in 5 minutes**,
  **Not expired · expires in 2 hours** or **No expiry**.
- The algorithm and signature length show, such as **HS256 · 32-byte signature, not verified**,
  or **Unsigned (alg none)**.

**The signature is not verified.**
The card header says so on a **Signature not verified** badge:
checking it needs the key, and this card is for reading what a token says.

A token that can't be read says why, and where:

- **A JWT has three parts separated by '.', this has 2.**
- An encrypted token, with five parts, can't be read without its key.
- **Payload: Invalid Base64 character '\*' at position 40.**
  JWT parts use Base64URL, so `+` and `/` are reported too.
- **Header is not JSON: …**, **Header is JSON but not an object** or **Payload is not UTF-8 text (byte 3)**,
  each followed by the position of the part at fault.
