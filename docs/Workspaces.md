# Workspaces

A workspace is a real folder on disk, opened through the browser's File System Access API.  
Nib Studio reads and writes files only inside the workspaces you pick,
and outside them only the files you drop, pick or save to yourself; it has no storage of its own for files.

## Open a folder

- On the start screen, click **Choose folder**.
- Or open the workspace switcher in the header and pick **Open folder…**.
- Or drop a folder from the file manager anywhere but the Explorer tree, or on the tree while no workspace is open,
  and answer **Open** when asked `Open name as a workspace?`.
  Files with [unsaved changes](#unsaved-changes) in the current workspace are settled first.
  The browser must hand over a link to the dropped folder; when it doesn't, a toast points to **Open folder…** instead.
- Or right-click a folder in the Explorer and pick **Open as workspace**.

The first two open the browser's folder picker.  
The browser then asks to let the site view and edit the folder.  
Nib Studio needs read and write access, and asks for it before anything changes:

- A refused folder isn't added to the switcher or saved as the active workspace,
  so the open workspace stays as it was, and after a reload the refused folder is never offered.
- Chrome reports a prompt refused inside its folder picker the same way as a cancelled picker,
  so that refusal passes silently, as a cancel does.
- When the browser hands the folder over but edit access is refused, or blocks folder access in its site settings,
  a warning toast says so, such as `Nib Studio was not allowed to open Space2, so Space1 stays open.`

The folder becomes the active workspace and its tree loads.  
Picking a folder that is already remembered reuses its entry.

### Open as workspace

**Open as workspace** in the Explorer context menu makes one folder of the current workspace the workspace,
the same way **Open folder…** does with a picked folder:

- Workspace files with [unsaved changes](#unsaved-changes) are settled first.
- The folder is remembered in the registry under its own name, such as `reports`;
  a folder already remembered, opened before by any route, reuses its entry.
- The current workspace's tabs close and the folder's saved tabs open;
  tabs of files from outside the workspace, and compares with no workspace file side, stay open.
  With no saved active tab of the folder's own, the first tab kept is the active one.
- The folder gets its own `.nib-studio-configuration.json`, written at its root on the next change,
  and it shows in the tree as soon as it is written;
  the old workspace's configuration file is not touched.
- The old workspace stays in the switcher, to switch back to.

The browser doesn't ask for access, since the folder is inside the open workspace,
which it may already read and write.  
Later, after a restart or from the switcher, it may ask for the folder itself,
as for any [remembered workspace](#permissions-on-reopen).  
The item shows for one folder only:
it is left out for files, for a selection of several items and in the empty area under the rows.

## Registry

Every folder you open is remembered, so you can come back to it without the picker.

- The folder handles live in the studio's IndexedDB, under `nib-studio/workspace/<id>`,
  with the active one under `nib-studio/workspace-active`.
- The id is the folder name in lower case, with a hyphen for each run of characters other than `a` to `z` and `0` to `9`,
  plus a time stamp in base 36, such as `reports-mwxmdbrb`.
- The switcher lists every remembered workspace by folder name, with `(active)` after the open one.

| Switcher item | Effect |
| --- | --- |
| a workspace name | switches to it, settling [unsaved changes](#unsaved-changes) first |
| No recent workspaces | shown when the list is empty, as a line that can't be picked |
| Open folder… | opens the folder picker, then settles [unsaved changes](#unsaved-changes) before opening the folder |
| Forget "name" | removes it from the list after confirmation; files on disk are not touched |

Opening or switching to a workspace closes every tab of the previous one and opens the new one's saved tabs.  
Tabs of files from outside the workspace, and compares with no workspace file side, such as pasted or picked text,
belong to no folder and stay open.  
The new workspace's saved active tab is shown;
when it has none, such as a folder opened for the first time, the first tab kept, in tab order, is the active one,
so the editor shows **No file open** only when no tab is left.  
Forgetting the active workspace closes it and clears the tree, its tabs and its compares;
tabs of files from outside the workspace, and compares with no workspace file side, stay open.

## Unsaved changes

Before another folder replaces the workspace, by **Open folder…**, **Open as workspace**, the switcher or a dropped folder,
and before the active workspace is forgotten, after its **Forget** confirmation,
an **Unsaved changes** dialog lists every workspace file with unsaved edits by its path from the workspace root,
without the workspace folder's name, such as `reports/data/orders.json`.

| Button | Effect |
| --- | --- |
| Save all | saves the files in the listed order, then goes on; a file that fails to save stops it with a message, and the workspace stays as it was |
| Discard | goes on without saving; the edits are lost |
| Cancel | keeps the workspace, its tabs and their edits; `Esc` and a click outside do the same |

Files from outside the workspace are not listed: their tabs stay open across the change, edits included.  
Picking the open workspace's own folder with **Open folder…** says it is already open and changes nothing.

## Permissions on reopen

Browsers don't keep folder access across restarts by default.  
When the studio opens:

1. It reads the active workspace from IndexedDB.
2. It checks, without prompting, whether read and write access is still granted.
3. Granted: the workspace opens as you left it.
4. Not granted: a toast says `Click "Re-open last workspace" to resume name.`; the start screen shows.
   **Re-open last workspace** asks for access again, which needs your click.

Switching to another workspace in the switcher asks for its access the same way when needed,
before the unsaved files are settled; a refusal keeps the open workspace, and the one saved as active.  
Chrome can also offer to remember the access permanently in its own prompt.

## Configuration file

Each workspace keeps its studio state in `.nib-studio-configuration.json` at its root:

```json
{
  "openFiles": [
    "README.md",
    "data/orders.json"
  ],
  "diffTabs": [
    {
      "original": "data/orders.json",
      "modified": "data/orders-v2.json",
      "position": 2
    }
  ],
  "activePath": "data/orders.json",
  "activeDiffTab": null,
  "expandedPaths": [
    "data"
  ],
  "activeSurface": "files"
}
```

| Key | Meaning |
| --- | --- |
| `openFiles` | paths of the open file tabs, in tab order |
| `diffTabs` | diff tabs between two workspace files: the `original` and `modified` paths, and the tab's `position` among all tabs |
| `activePath` | the active file tab, or `null` |
| `activeDiffTab` | index into `diffTabs` when a diff tab is active, or `null` |
| `expandedPaths` | the open folders in the tree |
| `activeSurface` | `files` or `hash` |

- The file is written 400 ms after the last change to tabs, folders or surface.
- It is read when the workspace opens; missing or broken keys fall back to defaults, and a missing file means a fresh start.
- Opening the workspace reopens the tabs as permanent tabs, skips paths missing from the folder, and activates `activePath`.
- Diff tabs reopen at their positions and read both files again; one whose files are both gone is skipped.
  Diffs with the clipboard, pasted text or a file from disk are never written to the file.
- A read-only folder simply doesn't get the file; nothing else changes.
- The file shows in the tree like any other file.
  When the studio first writes it in a folder, such as a workspace opened for the first time,
  the tree is read again once, so the file appears without a **Refresh**.
  Commit it, ignore it, or delete it; Nib Studio writes it again on the next change, and it appears again.

## Live refresh

Changes made outside Nib Studio show up without a manual refresh:

- Where the browser has `FileSystemObserver`, it reports changes as they happen, across the whole folder.
- Elsewhere, Nib Studio takes a snapshot of every file's path and modification time every 2.5 s and compares it with the last one.
  The first snapshot is only a baseline.
  When it can't be read, the next one that can becomes the baseline,
  so existing files are never reported as created.
- Changes are batched for 150 ms, then the tree is reread.
- Open files without unsaved edits reload with the new text.
  A change of line endings alone leaves the text as it is, and later saves use the file's line ending on disk.
- Open files with unsaved edits keep them; a toast says `name changed on disk; local edits kept.`
- Changes to `.nib-studio-configuration.json` are ignored, so the studio's own writes don't loop;
  only the write that first makes the file reads the tree again, to show it.
- Chrome's temporary `.crswap` swap files are never listed, so they never reload a file, show a toast or change the tree.

**Refresh** in the Explorer context menu rereads the tree at any time.

## Several studio tabs

Each click on the toolbar button opens another studio tab.  
The tabs share the registry and the theme, but each keeps its own open files.  
Two tabs on the same workspace both write its configuration file, so the last change wins.
