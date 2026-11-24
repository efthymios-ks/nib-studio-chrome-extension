# Theme

Nib Studio has a light and a dark theme.  
The header button switches between them, a moon (`☾`) in the light theme and a sun (`☀`) in the dark one;
the whole studio follows at once.

## Choice

- The first run starts in light.
- The choice is saved in `chrome.storage.local` under `nib-studio/session` as `{ "theme": "dark" }`
  and applied the next time the studio opens.
- The theme is set as `data-theme="light"` or `data-theme="dark"` on the root element.
  The page loads as `light` and switches once the saved choice is read.
- The studio doesn't follow the system theme.

## Tokens

Almost every colour in `styles.scss` comes from a CSS custom property.  
Each palette defines the same 74 tokens under `:root[data-theme="light"]` or `:root[data-theme="dark"]`:

| Group | Tokens |
| --- | --- |
| Surfaces | `--bg`, `--surface`, `--surface-sunken`, `--surface-raised` |
| Text | `--text`, `--muted`, `--faint`, `--text-inverse` |
| Lines | `--border`, `--border-strong`, `--divider` |
| Accent | `--accent`, `--accent-soft`, `--accent-text`, `--selection-bg` |
| Status | `--ok`, `--warn`, `--fail`, `--info`, each with a `-soft` background |
| Diff | `--diff-add-bg`, `--diff-add-text`, `--diff-del-bg`, `--diff-del-text`, `--diff-change-bg` |
| File types | `--ft-json`, `--ft-xml`, `--ft-csv`, … `--ft-folder`, `--ft-unknown`, one per file type |
| Syntax | `--syntax-keyword`, `--syntax-string`, `--syntax-number`, … `--syntax-attr-value` |
| Shape | `--radius`, `--radius-small`, `--shadow`, `--shadow-strong` |
| Mono aliases | `--mono-key`, `--mono-string`, `--mono-number`, `--mono-boolean` |

`styles.scss` sets a few colours directly, the same in both themes:
the white text and the hover backgrounds of primary and danger buttons,
and the dimmed backdrop behind dialogs and the narrow-screen Explorer drawer.  
It also defines three tokens of its own per theme, which the shared palette has no counterpart for:
`--flash`, for the ring around the change the diff bar steps to,
and `--checker-light` and `--checker-dark`, the squares of the checkerboard behind transparent images.  
The same rules set `color-scheme` to `light` or `dark`,
so native scroll bars, form controls and the audio and video players follow the theme.

Not themed:

- Syntax colours in the file editor, for JSON, YAML, Markdown and HTML, come from CodeMirror's default highlight style in both themes.
  The JSON and XML trees use the `--mono-*` tokens, and the table query editor the `--syntax-*` ones.
- Mermaid diagrams use Mermaid's default theme in both modes, drawn on a white page so their lines read in dark too.
- The Markdown diff page and the Markdown HTML and PDF exports carry their own light styles.
- A diff's **Export HTML** page carries its own light and dark styles, and follows the system's setting rather than the studio's.
- Word and PDF pages stay white paper in both themes, with the colours a printed page would have,
  and so do the highlights of Find on a Word page.

## Source

The palette lives in `src/nib-studio/theme/`:

- `index.scss` forwards both palettes.
- `palette-light.scss` and `palette-dark.scss` hold the tokens.

`styles.scss` loads them with `@use 'theme/index'`.

These three files are a verbatim copy of the shared palette in `C:\Repos\DevToolbox\Css\Theme`.  
The build never reads that folder, and no script syncs the two.  
Don't edit the local copy; change the shared palette and copy it over.

## Refresh by hand

When the shared palette changes:

1. Copy `index.scss`, `palette-light.scss` and `palette-dark.scss` from `C:\Repos\DevToolbox\Css\Theme` into `src/nib-studio/theme/`,
   replacing the files there.
   Leave out the other files in that folder, such as `preview.html` and `Update-Preview.ps1`.
2. Check that every token `styles.scss` uses still exists.
3. Rebuild and look at both themes.

From the repository root:

```powershell
$sharedTheme = 'C:\Repos\DevToolbox\Css\Theme'
Copy-Item "$sharedTheme\index.scss", "$sharedTheme\palette-light.scss", "$sharedTheme\palette-dark.scss" -Destination .\src\nib-studio\theme\
```
