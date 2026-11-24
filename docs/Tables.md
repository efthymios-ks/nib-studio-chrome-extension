# Tables

`.csv` and `.tsv` files, and the workbooks `.xlsx`, `.xls`, `.xlsm`, `.xltx`, `.xltm`, `.xlsb` and `.ods`,
open in the **Table** view, with a **Compare with…** button in the toolbar for a row diff.  
Tables are view only: the toolbar shows a **View only** badge and there is no **Save** or Editor view.

## Loading

- **CSV and TSV:** parsed with Papa Parse, which detects the delimiter from the text, such as a comma, semicolon, tab or pipe.
  A file over 2 MB is read by Nib Studio's own reader instead: a `.tsv` file splits on tabs,
  and any other on a comma, semicolon, tab or pipe, whichever splits its first lines most consistently.
  A file up to 2 MB is decoded as the editor decodes it, with its [code page](Editor.md#text-encodings) found;
  a larger one is read as UTF-8.
- **Workbooks:** read with SheetJS, with cells as the workbook formats them.
  The first sheet is shown; other sheets are not reachable.

  | Extension | Type |
  | --- | --- |
  | `.xlsx` | Excel workbook |
  | `.xls` | Excel 97–2003 workbook |
  | `.xlsm` | Excel macro-enabled workbook |
  | `.xltx` | Excel template |
  | `.xltm` | Excel macro-enabled template |
  | `.xlsb` | Excel binary workbook |
  | `.ods` | OpenDocument spreadsheet |

  The status bar shows the type.
- **Macros never run:** a macro-enabled workbook or template shows its sheets like any other;
  its macros are neither read nor run.
- The first row is the header.
  In Excel files, and in CSV and TSV files over 2 MB, an empty header cell is named `Column 1`, `Column 2`, and so on.
- A CSV or TSV file up to 2 MB, and an Excel file of any size, is read whole when it opens.
  A larger CSV or TSV is read on demand; see [Large files](#large-files).
  A workbook that can't be read shows **This workbook can't be shown** with the reason,
  and any other table file **Preview not available**.
- An Excel file that changes on disk is read again.

## Locked workbooks

- A workbook encrypted with a password asks for it in the table area, with the same box as a locked PDF or Word document:
  **This workbook is protected with a password**, the file name, a password box, **Open** and **Cancel**.
- `Enter` opens, `Escape` cancels, and **Unlocking…** shows while the password is tried.
- A wrong password says **That password is incorrect. Try again.**
- **Cancel** leaves **It stays closed until its password is entered.**, with **Enter password** to ask again.
- A workbook locked with Excel's own password, `VelvetSweatshop`, which Excel uses to protect a workbook against changes,
  opens without asking, as it does in Excel.
- **Schemes:**
  - XLSX, XLSM, XLTX, XLTM and XLSB: Agile encryption (AES-128 or AES-256, with SHA-1, SHA-256, SHA-384 or SHA-512)
    and Standard encryption (AES-128 or AES-256 with SHA-1).
  - `.xls` from Excel 97 to 2003: RC4, RC4 CryptoAPI and XOR obfuscation.
    The workbook is decrypted inside the studio and read by SheetJS, which can't decrypt these files itself.
- The decrypted workbook stays in the tab's memory only while its tab is open, so switching tabs doesn't ask again;
  it is never saved, written to disk or sent anywhere, and closing the tab, or a change to the file on disk, lets it go.
  The password itself is not kept.
  See [Privacy](Privacy.md#locked-files).
  **Compare with…** reads a locked workbook once its tab has opened it.
- Encryption it can't open shows **This workbook's encryption isn't supported**, with the reason:
  rights management, a certificate rather than a password, third-party encryption, other ciphers, AES-192,
  unknown versions, and Excel 5.0 and Excel 95 encryption.

## Grid

- A pinned header row and a `#` column numbering the rows as they are shown.
- Rows appear 200 at a time; scrolling near the bottom adds the next 200.
- The status line under the toolbar reads `visible of total rows`, such as `1,240 of 5,000 rows`,
  and the number of active filters, such as `2 filters`.

The whole file is in memory once it opens, so sorting, filtering and search cover every row,
and `visible of total rows` counts matches across the whole file.
Only the drawing of rows is paged: matches past the first 200 appear as you scroll.

## Sort

- Click a header to sort by that column: ascending, then descending, then off.
  A plain click replaces any other sort, and the header shows `↑` or `↓`.
- `Shift+click` another header to add it as a further sort key.
- Numbers compare as numbers and ISO dates, such as `2024-05-01`, as dates;
  everything else compares as text in the browser's locale.
  Empty cells come first in ascending order and last in descending order.

## Filters

Click the `⚑` button on a header to open its filter, titled such as `Filter city`.  
`Esc` or a click outside closes it without changes.

| Operator | Keeps rows where the cell |
| --- | --- |
| contains | contains the value |
| does not contain | doesn't contain it |
| equals | equals it |
| starts with | starts with it |
| ends with | ends with it |
| = (number) | equals the number |
| ≠ (number) | differs from the number |
| < (number) | is less than the number |
| > (number) | is greater than the number |
| between (number) | lies between the value and the upper bound |
| one of (distinct values) | is one of the ticked values, from the first 50 distinct values |
| is empty | is empty |
| is not empty | isn't empty |

Text operators ignore case.  
Number operators read the cell as a number; a cell that isn't one never matches.  
**between** takes the value and an **Upper bound**, both included.  
In the **one of** list, an empty cell shows as `(empty)`.  
**Apply** sets the filter, **Clear** removes it.  
Filters on several columns all apply.

## Search

Type in the **Search visible columns** box above the grid and press `Enter`
to keep the rows where any visible column contains the text, ignoring case.  
Clearing the box, with its `×` or by deleting the text, shows every row again at once.  
Showing or hiding a column changes what the search covers.

## Columns

- **Columns** lists every column with a checkbox to show or hide it and a **pin** checkbox to pin it to the left.
  Pinned columns come first.
  **Reset** at the bottom of the list shows every column, unpins them all and restores the original order and widths;
  the list stays open.
  `Esc` or a click outside closes the list.
- Drag a header onto another to move the column there.
- Drag a header's right edge to resize the column, from 60 px; double-click the edge to fit it to its content, up to 600 px.

## Copy as TSV

**Copy as TSV** copies the visible columns, in their order, and the visible rows, after filters, sort and search,
as tab-separated text with a header line.  
Paste it into a spreadsheet or a text file.

## Reset view

**Reset view** clears filters, sort and search, and restores the original column order, visibility, pins and widths.

Sort, filters, search, columns and scroll belong to the file's tab:
switching to another tab and back restores them, and closing the tab forgets them.

## Querying

Query a table with LINQ-style query expressions that read like SQL:
`from`, `where`, `let`, `group by`, `select`, `orderby`, `distinct`, `skip`, `take`,
with `count`, `sum`, `average`, `min` and `max`.
Queries run inside the page, with no network and no code generation.

### Query panel

- **Open it:** the **Query** button in the table toolbar.
  The panel opens to the right of the table, 420 px wide at first; on screens 720 px wide or less it sits below the table.
  Press the button again, or the panel's `×`, to close it.
- **Resize it:** drag the divider between the table and the panel, down to 280 px, while the table keeps at least 200 px;
  double-click the divider to close the panel.
  Whether the panel is open and its width are remembered.
- **Query editor:** syntax highlighting, and completion of column names, keywords and functions as you type,
  or with `Ctrl+Space`.
  An empty editor shows a sample query in grey.
- **Run:** the **Run** button or `Ctrl+Enter`.
  While a query runs, **Cancel** stops it; **Clear** empties the editor and shows the full table again.
- **History:** the **History…** list holds the last 20 queries run on the file, kept between sessions;
  pick one to put it in the editor.
- **Help:** the **?** button opens the syntax reference below inside the panel,
  headed by **Examples for this table**: queries built from the table's own columns,
  such as **First 20 rows**, **Count per value** and **Summary of the table**, each with **Copy** and **Insert**.
  **Close help** or **?** closes it.
- **Results:** the result replaces the rows of the main table, with its columns, order, groups, `skip` and `take`,
  and the usual search, sort, filters, **Columns** and **Copy as TSV** work on it.
  Columns that hold only numbers are aligned right.
  A bar above the table reads `Query applied · 240 rows · Clear`;
  **Clear** there, or closing the panel, shows the full table again and keeps the query in the editor.
  A single value, such as `from * select count()`, shows large in place of the table, under its name, with a **Copy** button.
  Under **Run**, the status line shows the row count, the time taken and the rows read, such as `240 rows · 35 ms · 5,000 rows read`,
  and the progress while a large file is scanned, such as `Scanning… 40% (8,000 of 20,000 rows)`.
  If a later query fails, the last result stays on screen.
- **Errors:** shown with their line and column, such as `Line 2, column 7: Unknown column 'totl'. Did you mean 'total'?`,
  and the part of the query at fault is underlined in the editor.
  An unknown column suggests the closest name.
  Running an empty editor says `Write a query first, like 'from * take 20'.`

### Examples

The examples use the columns of an orders file:
`order_id`, `customer`, `city`, `product`, `quantity`, `unit_price`, `total`, `status`, `ordered_at`, `note`.

Delivered orders over 100, largest first:

```
from order in table
where order.status == "delivered" && order.total > 100
orderby order.total descending
take 20
```

Revenue per city:

```
from order in table
where order.status != "cancelled"
group order by order.city into cities
select new { City = cities.Key, Orders = count(cities), Revenue = sum(cities.total), AveragePrice = average(cities.unit_price) }
orderby Revenue descending
take 10
```

The same in the `from *` form, with bare column names:

```
from *
where status != "cancelled"
group by city
select city, Orders = count(), Revenue = sum(total), AveragePrice = avg(unit_price)
orderby Revenue descending
take 10
```

Orders per year and status:

```
from *
group by new { Year = ordered_at.Year, status }
select Year, status, count()
orderby Year, status
```

Orders from cities starting with Ath, shipped or delivered, between 100 and 500:

```
from *
where city like "ath*" and status in ("shipped", "delivered") and total between 100 and 500
select order_id, city, total, note
```

Orders with a note:

```
from * where note is not null and note not like "*test*"
```

The whole table as one value:

```
from * where city == "Patras" select sum(total)
```

The third page of 20 rows:

```
from * orderby ordered_at descending skip 40 take 20
```

### How a query reads

- A query starts with `from row in table` or `from *` and reads the open table, the only source.
  There are no joins.
- Clauses run in the order written.
  After `select`, only `where`, `orderby`, `distinct`, `skip` and `take` may follow,
  and they refer to the selected names, as in `orderby Revenue descending`.
- Columns can always be written bare, like `total`.
  In the `from row in table` form `row.total` works too,
  and `row["unit price"]` or `` `unit price` `` reads a column whose name has spaces or is a keyword.
- Keywords and function names ignore case; column names match exactly first, then ignoring case.
- `//` starts a comment that runs to the end of the line.
- After `group by`, use the key outside aggregates: the grouped expression itself (`city`, `order.city`),
  a member of a `new { … }` key by name, or `g.Key` with `into g`.
  Any other column must sit inside an aggregate, like `sum(total)`.
  Inside an aggregate, names refer to the rows of the group, and `g.total` reads `total` from each of them.
- A `select` with aggregates and no `group by` summarises the whole table into one row.
  With a single unnamed value, like `select sum(total)`, the result is that one value.
- A query that ends with `group by` lists each key with its `Count`.
  A query without `select` returns every column.
- `select` names columns after the member read (`order.city` gives `city`), or the text of the value (`sum(total)`),
  unless named with `Name = value` or `value as Name`.
  A repeated name gets a number: `city 2`.

### Values

- Each column gets one type from its first 1,000 rows: number, date, true/false, or text.
  A column of ISO dates, like `2024-05-01` or `2024-05-01T10:30:00Z`, holds dates.
- An empty cell is `null`.
  Comparisons with `null` are false except `== null`, `!= null`, `is null` and `is not null`,
  arithmetic on it gives `null`, and aggregates skip it.
  A method or property on `null` gives `null`.
- Numbers compare by value, dates in time order, text alphabetically in the browser's locale.
  A number or date compared with text reads the text as one, so `ordered_at >= "2025-01-01"` works.
- Sorting puts empty values last, ascending or descending.
- Numbers show at most 12 significant digits.

### Syntax reference

The same reference opens from the **?** button in the panel.

Source:

- `from row in table`: names each row; read columns as `row.total`, `row["unit price"]` or just `total`.
- `from *`: no row name; read columns by name, like `total`.
  `from table` means the same.

Clauses:

- `where condition`: keeps the rows where the condition is true.
- `let name = value`: names a computed value for the clauses after it.
- `orderby value [ascending|descending], …`: sorts by one or more values; `asc`, `desc` and `order by` work too.
- `group [row] by key [into g]`: collects rows with the same key.
- `group by new { a, b }`: groups by several values; read them by name or as `g.Key.a`.
- `select value, …`: picks the output columns; `*` keeps every column.
- `select new { Name = value, … }`: the same as a select list, written as an object.
- `distinct`: drops repeated rows.
- `skip n`: leaves out the first n rows.
- `take n`: keeps the first n rows.
- `skip n take m`: pages through rows; `skip 40 take 20` is the third page of 20.

Aggregates:

- `count() or count(value)`: `count()` counts rows, `count(value)` the rows where the value is not empty;
  `count(g)` and `count(*)` count rows too.
- `sum(value)`: the total of the non-empty values, 0 when there are none.
- `average(value)`, `avg(value)`: the mean of the non-empty values, empty when there are none.
- `min(value)`, `max(value)`: the smallest and largest non-empty value: number, date or text.

Operators, loosest first:

- `a ? b : c`: `b` when `a` is true, `c` otherwise.
- `a ?? b`: `a`, or `b` when `a` is empty.
- `a || b, a or b`: either is true.
- `a && b, a and b`: both are true.
- `== != = <>`: equal and not equal; `=` and `<>` are the SQL spellings.
- `< <= > >=`: numbers by value, dates in time order, text alphabetically.
- `a like "text*", a not like "*text*"`: matches text against a pattern, ignoring case.
  Each `*` stands for any run of characters, even none, and the rest must match exactly,
  so `city like "ath*"` finds Athens and `note like "*gift*"` any note mentioning a gift.
  An empty value never matches, with or without `not`.
- `a in (x, y, …), a not in (…)`: equal to one of the values, compared as `==` does,
  as in `status in ("shipped", "delivered")`.
- `a between low and high, a not between …`: within the range, both ends included: numbers, dates or text,
  as in `total between 100 and 500`.
  The first `and` after `between` belongs to it, so `total between 100 and 500 and city == "Patras"` reads as expected.
- `a is null, a is not null`: the value is empty, or is not, as in `note is not null`.
- `like`, `in`, `between` and `is` bind like `<` and `>`; their keywords ignore case.
- `+ -`: add and subtract; `+` joins text.
- `* / %`: multiply, divide and remainder; dividing by 0 gives an empty value.
- `!a, not a, -a`: negation; `not a == b` means `not (a == b)`, while `!` binds tightly, as in C#.
- `"text", 'text', 12.5, true, false, null`: literal values.
- `` `odd name` ``: a column whose name has spaces or is a keyword.

Text, called on a value like `city.ToUpper()`.
To test whether text contains, starts or ends with something, use `like`:

- `.ToLower()`, `.ToUpper()`, `.Trim()`: the text in lower case, in upper case, or without leading and trailing spaces.
- `.Substring(start[, length])`: part of the text from a 0-based start, optionally of a given length.
- `.Replace(find, replacement)`: the text with every occurrence of `find` replaced.
- `.IndexOf(value)`: the 0-based position of the value in the text, or -1.
- `.ToString()`: the value as text.
- `.Length`: the number of characters.

Dates:

- `.Year`, `.Month`, `.Day`: the parts of the date; months run from 1 to 12.
- `.Hour`, `.Minute`: the time of day.
- `.DayOfWeek`: the weekday name, like `Monday`.
- `.Date`: the date without its time.

Functions:

- `Math.Round(value[, digits])`: rounds half away from zero, optionally to a number of decimals.
- `Math.Abs(value)`, `Math.Floor(value)`, `Math.Ceiling(value)`, `Math.Sqrt(value)`.
- `Math.Min(value, other)`, `Math.Max(value, other)`, `Math.Pow(value, other)`.
- `date(value)`: reads ISO text like `"2024-05-01"` as a date.
- `number(value)`: reads text as a number, or `null` when it is not one.

### Large files and memory

- A CSV or TSV over 2 MB is scanned from disk in chunks of 20,000 rows; it is never loaded whole.
  The query waits for indexing to finish first, and the status line shows `Waiting for indexing… 45%`.
- A table held in memory is read in chunks of 5,000 rows, so the page stays responsive.
- `where`, `let`, `select`, `skip` and `take` stream: rows pass through one chunk at a time.
  Without an `orderby`, `group by` or `distinct` before it, `take` stops the scan as soon as it has its rows,
  so `from * take 10` reads one chunk.
- `group by` and whole-table aggregates keep one running total per group and aggregate, not the rows.
- `orderby` and `distinct` hold the rows or values they need, and the result holds its rows.
  Groups, sorting, `distinct` and the result together may use about 256 MB; past that the query stops with a message such as
  `The query needs more than 256.0 MB of memory to sort. Narrow it with where, or select fewer columns first.`
- **Cancel** stops the scan between chunks, and the status line reads `Cancelled.`

## Large files

A CSV or TSV over 2 MB is never loaded whole.
The toolbar shows a **Large file** badge: the file is too large to edit here and shows as a table.

- **Index:** the file is read once, in chunks, to note where each row starts.
  Quoted commas and line breaks stay inside their row; LF, CRLF and CR line endings all work.
  The index costs 8 bytes per row, about 2 MB for 250,000 rows.
  Rows can be scrolled while indexing runs; the status line shows `Indexing… n rows so far (x%)`.
- **Scrolling:** rows have a fixed height and only the rows on screen, plus a few above and below, are drawn.
  Rows are read from the file in blocks of 2,000 as you scroll, and the last 20 blocks stay cached.
  The `#` column shows each row's number in the file.
- **Go to row:** type a row number in **Go to row** and press `Enter` to jump to it and highlight it.
  A row outside the file, or outside the current results, gets a note in the status line instead.
- **Search and filters:** run as a scan over the file in the background.
  Matches appear as they are found, with `n matches, scanning… x%`.
  Changing the search or a filter cancels the scan in progress and starts a new one.
- **Sort:** a scan collects only the sorted columns, then orders the row numbers, with `Sorting… x%` in the status line.
  A column whose filled cells are all numbers, or all ISO dates, sorts by value; any other sorts as text in the browser's locale.
  Empty cells go last in either direction.
  When the sorted columns would need more than 256 MB, the rows stay in file order and the status line says so.
- **One of (distinct values):** the values to tick come from the first 2,000 rows.
- **Double-click to fit:** measures the rows on screen.
- **Copy as TSV:** copies at most the first 100,000 visible rows, and says so when it stops there.
- **Row diff:** not available; it loads both files into memory, so it takes CSV and TSV files up to 2 MB.

The index, the block cache and the view settings last while the tab stays open.
When the file changes on disk it is indexed again.
Text is read as UTF-8.

## Row diff

**Compare with…** compares two tables row by row in a new diff tab, keyed by the columns you pick.  
The button opens a chooser for the other side: an open table tab, a CSV, TSV or workbook file in the workspace,
a file from disk, the clipboard or pasted text.  
**Compare these two files** in the Explorer context menu compares two selected CSV or TSV files.  
CSV and TSV files over 2 MB are refused with a message.  
See [Compare](Compare.md#row-diff).
