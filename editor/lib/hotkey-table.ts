// The keymap: every shortcut of the app and the editor, by id, with its default keys on Linux / Windows (`pc`) and on
// macOS (`mac`, IntelliJ's macOS keymap). Keys use CodeMirror's spelling: `Mod` is Cmd on a Mac and Ctrl elsewhere,
// `Ctrl` is Ctrl on both, `Alt` is Option; each action has one key. Code binds a run function to an id
// (commands.svelte.ts by command id, the editor's action tables); hotkeys.svelte.ts applies the person's overrides.
// An editor key may take a key the app uses elsewhere (it wins while the editor has focus, as in IntelliJ); within
// one scope (`scopeOf`) a key does one thing. On a Mac, Go to line is IntelliJ's ⌘L, Add to chat ⌘⇧L, and ⌘G stays
// Find next; Ctrl+W never reaches a browser tab, so on Linux and Windows Close tab is Ctrl+F4, and Next / Previous
// session are Alt+↓ / Alt+↑ rather than Ctrl+Tab.

export type HotkeyGroup = "General" | "Files" | "Editing" | "Navigation" | "Refactoring";
export type HotkeyDef = { label: string; group: HotkeyGroup; pc: string[]; mac?: string[] };

/** Where a key acts: the editor (focused buffer) inside the files panel inside the app. */
export const scopeOf = (id: string) =>
  /^(editor|code|refactor)\./.test(id) ? "editor" : id.startsWith("files.") ? "files" : "app";

const both = (label: string, group: HotkeyGroup, keys: string[], mac?: string[]): HotkeyDef => ({
  label,
  group,
  pc: keys,
  mac,
});

const projects = Object.fromEntries(
  Array.from({ length: 9 }, (_, i) => [
    `project-${i + 1}`,
    both(`Switch to project ${i + 1}`, "General", [`Alt-${i + 1}`]),
  ]),
);

export const HOTKEYS: Record<string, HotkeyDef> = {
  // General (commands)
  palette: both("Search sessions and commands", "General", ["Mod-k"]),
  "find-files": both("Find files", "General", ["Mod-p"]),
  "find-symbols": both("Find symbols", "General", ["Mod-Alt-Shift-n"], ["Mod-Alt-o"]),
  "find-text": both("Search text in files", "General", ["Mod-Shift-f"]),
  "replace-text": both("Replace in files", "General", ["Mod-Shift-r"]),
  "new-chat": both("New chat", "General", ["Mod-Alt-n"]),
  sidebar: both("Toggle sidebar", "General", ["Mod-b"]),
  panel: both("Toggle panel", "General", ["Mod-\\"]),
  conversation: both("Toggle conversation", "General", ["Mod-Shift-\\"]),
  terminal: both("Toggle terminal", "General", ["Ctrl-`"]),
  "next-session": both("Next session", "General", ["Alt-ArrowDown"]),
  "previous-session": both("Previous session", "General", ["Alt-ArrowUp"]),
  "settle-session": both("Settle or unsettle session", "General", ["Alt-e"], ["Ctrl-Alt-e"]),
  "snooze-session": both("Snooze or unsnooze session", "General", ["Alt-z"], ["Ctrl-Alt-z"]),
  settings: both("Settings", "General", ["Mod-,"]),
  dictate: both("Dictate (hold to talk)", "General", ["F8"]),
  ...projects,

  // Files panel and editor tabs
  "files.new": both("New file", "Files", ["Alt-Insert"], []),
  "files.close": both("Close tab", "Files", ["Mod-F4"], ["Mod-w"]),
  "files.markdownMode": both("Markdown or diagram: source / view", "Files", ["Mod-Shift-v"]),
  "files.diagramGuide": both("Diagram syntax guide", "Files", ["F1"]),
  "editor.save": both("Save", "Files", ["Mod-s"]),
  "editor.addToChat": both("Add to chat", "Files", ["Mod-l"], ["Mod-Shift-l"]),
  "editor.recentFiles": both("Recent files…", "Files", ["Mod-e"]),
  "editor.findAction": both("Find action…", "Files", ["Mod-Shift-a"]),

  // Editing
  "editor.undo": both("Undo", "Editing", ["Mod-z"]),
  "editor.redo": both("Redo", "Editing", ["Mod-Shift-z"]),
  "editor.deleteLine": both("Delete line", "Editing", ["Mod-y"], ["Mod-Backspace"]),
  "editor.duplicate": both("Duplicate line or selection", "Editing", ["Mod-d"]),
  "editor.moveLineUp": both("Move line up", "Editing", ["Alt-Shift-ArrowUp"]),
  "editor.moveLineDown": both("Move line down", "Editing", ["Alt-Shift-ArrowDown"]),
  "editor.moveStatementUp": both("Move statement up", "Editing", ["Mod-Shift-ArrowUp"]),
  "editor.moveStatementDown": both("Move statement down", "Editing", ["Mod-Shift-ArrowDown"]),
  "editor.startNewLine": both("Start new line", "Editing", ["Shift-Enter"]),
  "editor.startNewLineBefore": both("Start new line before current", "Editing", ["Mod-Alt-Enter"]),
  // macOS keeps ⌃Space for switching the input source, so there it is ⌥Space.
  "editor.complete": both(
    "Code completion and parameter info",
    "Editing",
    ["Ctrl-Space"],
    ["Alt-Space"],
  ),
  "editor.completeStatement": both("Complete current statement", "Editing", ["Mod-Shift-Enter"]),
  "editor.joinLines": both("Join lines", "Editing", ["Mod-Shift-j"], ["Ctrl-Shift-j"]),
  "editor.lineComment": both("Comment with line comment", "Editing", ["Mod-/"]),
  "editor.blockComment": both(
    "Comment with block comment",
    "Editing",
    ["Mod-Shift-/"],
    ["Mod-Alt-/"],
  ),
  "editor.extendSelection": both(
    "Extend selection",
    "Editing",
    ["Alt-Shift-ArrowRight"],
    ["Alt-ArrowUp"],
  ),
  "editor.shrinkSelection": both(
    "Shrink selection",
    "Editing",
    ["Alt-Shift-ArrowLeft"],
    ["Alt-ArrowDown"],
  ),
  "editor.selectNext": both("Select next occurrence", "Editing", ["Alt-j"], ["Ctrl-g"]),
  "editor.unselectOccurrence": both(
    "Unselect occurrence",
    "Editing",
    ["Alt-Shift-j"],
    ["Ctrl-Shift-g"],
  ),
  "editor.selectAll": both(
    "Select all occurrences",
    "Editing",
    ["Mod-Alt-Shift-j"],
    ["Ctrl-Mod-g"],
  ),
  "editor.surroundWith": both("Surround with…", "Editing", ["Mod-Alt-t"]),
  "editor.toggleCase": both("Toggle case", "Editing", ["Mod-Shift-u"]),
  "editor.indent": both("Indent", "Editing", []),
  "editor.unindent": both("Unindent", "Editing", ["Shift-Tab"]),
  "editor.smartHome": both("Smart home", "Editing", ["Home"]),
  "editor.fold": both("Fold", "Editing", ["Mod--"]),
  "editor.unfold": both("Unfold", "Editing", ["Mod-="]),
  "editor.foldAll": both("Fold all", "Editing", ["Mod-Shift--"]),
  "editor.unfoldAll": both("Unfold all", "Editing", ["Mod-Shift-="]),
  "editor.toggleBlame": both("Toggle blame", "Editing", []),
  "code.actions": both("Show actions", "Editing", ["Alt-Enter"]),
  "code.format": both("Format", "Editing", ["Mod-Alt-l"]),
  "code.optimizeImports": both("Optimize imports", "Editing", ["Mod-Alt-o"], ["Ctrl-Alt-o"]),

  // Navigation
  "editor.find": both("Find in file", "Navigation", ["Mod-f"]),
  "editor.replace": both("Replace in file", "Navigation", ["Mod-r"]),
  "editor.goToLine": both("Go to line…", "Navigation", ["Mod-g"], ["Mod-l"]),
  "code.definition": both("Go to definition", "Navigation", ["F12"], ["F12"]),
  "code.typeDefinition": both("Go to type definition", "Navigation", []),
  "code.implementations": both("Go to implementations", "Navigation", ["Mod-Alt-b"]),
  "code.references": both("Find references", "Navigation", ["Alt-F7"]),
  "code.callHierarchy": both("Call hierarchy", "Navigation", ["Ctrl-Alt-h"]),
  "code.symbols": both("Go to symbol…", "Navigation", ["Mod-F12"]),
  "code.nextMethod": both("Next method", "Navigation", ["Mod-Alt-ArrowDown"], ["Ctrl-ArrowDown"]),
  "code.previousMethod": both(
    "Previous method",
    "Navigation",
    ["Mod-Alt-ArrowUp"],
    ["Ctrl-ArrowUp"],
  ),
  "code.back": both("Back", "Navigation", ["Alt-ArrowLeft"], ["Mod-["]),
  "code.forward": both("Forward", "Navigation", ["Alt-ArrowRight"], ["Mod-]"]),

  // Refactoring
  "refactor.this": both("Refactor this…", "Refactoring", ["Ctrl-Alt-Shift-t"], ["Ctrl-t"]),
  "code.rename": both("Rename…", "Refactoring", ["Shift-F6"]),
  "refactor.variable": both("Introduce variable…", "Refactoring", ["Mod-Alt-v"]),
  "refactor.constant": both("Introduce constant…", "Refactoring", ["Mod-Alt-c"]),
  "refactor.method": both("Extract method…", "Refactoring", ["Mod-Alt-m"]),
  "refactor.inline": both("Inline…", "Refactoring", ["Mod-Alt-n"]),
  "refactor.move": both("Move…", "Refactoring", ["F6"]),
};
