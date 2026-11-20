// Syntax themes: the colors code is drawn in (the editor, diffs, chat code blocks, the canvas), as the `--syn-*`
// variables styles/base.css colors the `tok-*` classes with. Each is a well-known editor theme's token colors, drawn on
// the app theme's background, so a syntax theme only pairs with app themes of its own scheme. "match" picks the one
// named like the app theme, else colors taken from the theme's ANSI colors. Claude Dark and Light are hand-made.
import type { Theme } from "./themes.ts";

export const SYNTAX_ROLES = [
  "keyword",
  "string",
  "number",
  "comment",
  "function",
  "type",
  "property",
  "operator",
  "tag",
  "heading",
] as const;
export type SyntaxRole = (typeof SYNTAX_ROLES)[number];
export type SyntaxTheme = {
  id: string;
  name: string;
  dark: boolean;
  colors: Record<SyntaxRole, string>;
};

/** The syntax setting's value that follows the app theme. */
export const MATCH = "match";

const S = (id: string, name: string, dark: boolean, c: string): SyntaxTheme => {
  const values = c.split(" ");
  return {
    id,
    name,
    dark,
    colors: Object.fromEntries(SYNTAX_ROLES.map((role, i) => [role, values[i]!])) as Record<
      SyntaxRole,
      string
    >,
  };
};

// keyword string number comment function type property operator tag heading
export const SYNTAX_THEMES: SyntaxTheme[] = [
  S(
    "claude-dark",
    "Claude Dark",
    true,
    "#e08a6d #a8c084 #e0b36e #7c7973 #8fb3e0 #c9a1d6 #d9bc9c #bfb1a3 #e08a6d #d97757",
  ),
  S(
    "github-dark",
    "GitHub Dark",
    true,
    "#ff7b72 #a5d6ff #79c0ff #8b949e #d2a8ff #ffa657 #79c0ff #ff7b72 #7ee787 #79c0ff",
  ),
  S(
    "github-dark-dimmed",
    "GitHub Dark Dimmed",
    true,
    "#f47067 #96d0ff #6cb6ff #768390 #dcbdfb #f69d50 #6cb6ff #f47067 #8ddb8c #6cb6ff",
  ),
  S(
    "one-dark",
    "One Dark",
    true,
    "#c678dd #98c379 #d19a66 #7f848e #61afef #e5c07b #e06c75 #56b6c2 #e06c75 #e06c75",
  ),
  S(
    "vscode-dark-modern",
    "VS Code Dark+",
    true,
    "#569cd6 #ce9178 #b5cea8 #6a9955 #dcdcaa #4ec9b0 #9cdcfe #d4d4d4 #569cd6 #569cd6",
  ),
  S(
    "dracula",
    "Dracula",
    true,
    "#ff79c6 #f1fa8c #bd93f9 #6272a4 #50fa7b #8be9fd #ffb86c #ff79c6 #ff79c6 #bd93f9",
  ),
  S(
    "monokai",
    "Monokai",
    true,
    "#f92672 #e6db74 #ae81ff #75715e #a6e22e #66d9ef #fd971f #f92672 #f92672 #a6e22e",
  ),
  S(
    "monokai-pro",
    "Monokai Pro",
    true,
    "#ff6188 #ffd866 #ab9df2 #727072 #a9dc76 #78dce8 #fc9867 #ff6188 #ff6188 #ffd866",
  ),
  S(
    "darcula",
    "Darcula (JetBrains)",
    true,
    "#cc7832 #6a8759 #6897bb #808080 #ffc66d #b5b6e3 #9876aa #a9b7c6 #e8bf6a #cc7832",
  ),
  S(
    "xcode-dark",
    "Xcode Dark",
    true,
    "#fc5fa3 #fc6a5d #d0bf69 #6c7986 #67b7a4 #5dd8ff #41a1c0 #dfdfe0 #fc5fa3 #5dd8ff",
  ),
  S(
    "tokyo-night",
    "Tokyo Night",
    true,
    "#bb9af7 #9ece6a #ff9e64 #565f89 #7aa2f7 #2ac3de #73daca #89ddff #f7768e #7aa2f7",
  ),
  S(
    "tokyo-night-storm",
    "Tokyo Night Storm",
    true,
    "#bb9af7 #9ece6a #ff9e64 #5f6996 #7aa2f7 #2ac3de #73daca #89ddff #f7768e #7aa2f7",
  ),
  S(
    "catppuccin-mocha",
    "Catppuccin Mocha",
    true,
    "#cba6f7 #a6e3a1 #fab387 #9399b2 #89b4fa #f9e2af #b4befe #89dceb #89b4fa #f38ba8",
  ),
  S(
    "catppuccin-macchiato",
    "Catppuccin Macchiato",
    true,
    "#c6a0f6 #a6da95 #f5a97f #939ab7 #8aadf4 #eed49f #b7bdf8 #91d7e3 #8aadf4 #ed8796",
  ),
  S(
    "catppuccin-frappe",
    "Catppuccin Frappe",
    true,
    "#ca9ee6 #a6d189 #ef9f76 #949cbb #8caaee #e5c890 #babbf1 #99d1db #8caaee #e78284",
  ),
  S(
    "nord",
    "Nord",
    true,
    "#81a1c1 #a3be8c #b48ead #6d7a96 #88c0d0 #8fbcbb #8fbcbb #81a1c1 #81a1c1 #88c0d0",
  ),
  S(
    "gruvbox-dark",
    "Gruvbox Dark",
    true,
    "#fb4934 #b8bb26 #d3869b #928374 #8ec07c #fabd2f #83a598 #fe8019 #fb4934 #fabd2f",
  ),
  S(
    "solarized-dark",
    "Solarized Dark",
    true,
    "#859900 #2aa198 #d33682 #657b83 #268bd2 #b58900 #93a1a1 #859900 #268bd2 #cb4b16",
  ),
  S(
    "ayu-dark",
    "Ayu Dark",
    true,
    "#ff8f40 #aad94c #d2a6ff #646b73 #ffb454 #59c2ff #f07178 #f29668 #39bae6 #ffb454",
  ),
  S(
    "ayu-mirage",
    "Ayu Mirage",
    true,
    "#ffad66 #d5ff80 #dfbfff #6e7c8f #ffd173 #73d0ff #f28779 #f29e74 #5ccfe6 #ffd173",
  ),
  S(
    "night-owl",
    "Night Owl",
    true,
    "#c792ea #ecc48d #f78c6c #637777 #82aaff #ffcb8b #7fdbca #c792ea #caece6 #82b1ff",
  ),
  S(
    "kanagawa-wave",
    "Kanagawa Wave",
    true,
    "#957fb8 #98bb6c #d27e99 #727169 #7e9cd8 #7aa89f #e6c384 #c0a36e #e46876 #7e9cd8",
  ),
  S(
    "everforest-dark",
    "Everforest Dark",
    true,
    "#e67e80 #a7c080 #d699b6 #859289 #83c092 #dbbc7f #7fbbb3 #e69875 #e69875 #e67e80",
  ),
  S(
    "material-deep-ocean",
    "Material Deep Ocean",
    true,
    "#c792ea #c3e88d #f78c6c #717cb4 #82aaff #ffcb6b #80cbc4 #89ddff #f07178 #82aaff",
  ),
  S(
    "material-palenight",
    "Material Palenight",
    true,
    "#c792ea #c3e88d #f78c6c #676e95 #82aaff #ffcb6b #80cbc4 #89ddff #f07178 #82aaff",
  ),
  S(
    "rose-pine",
    "Rose Pine",
    true,
    "#31748f #f6c177 #eb6f92 #6e6a86 #ebbcba #9ccfd8 #c4a7e7 #908caa #9ccfd8 #c4a7e7",
  ),
  S(
    "rose-pine-moon",
    "Rose Pine Moon",
    true,
    "#3e8fb0 #f6c177 #eb6f92 #6e6a86 #ea9a97 #9ccfd8 #c4a7e7 #908caa #9ccfd8 #c4a7e7",
  ),
  S(
    "tomorrow-night",
    "Tomorrow Night",
    true,
    "#b294bb #b5bd68 #de935f #969896 #81a2be #f0c674 #cc6666 #8abeb7 #cc6666 #81a2be",
  ),
  S(
    "claude-light",
    "Claude Light",
    false,
    "#b8532f #5c7a2e #a1660a #8f8d86 #2f62a8 #8a4c9e #8a5a34 #6b5f55 #b8532f #c96442",
  ),
  S(
    "github-light",
    "GitHub Light",
    false,
    "#cf222e #0a3069 #0550ae #6e7781 #8250df #953800 #0550ae #cf222e #116329 #0550ae",
  ),
  S(
    "one-light",
    "One Light",
    false,
    "#a626a4 #50a14f #986801 #a0a1a7 #4078f2 #c18401 #e45649 #0184bc #e45649 #e45649",
  ),
  S(
    "vscode-light-modern",
    "VS Code Light+",
    false,
    "#0000ff #a31515 #098658 #008000 #795e26 #267f99 #001080 #3b3b3b #800000 #800000",
  ),
  S(
    "intellij-light",
    "IntelliJ Light",
    false,
    "#0033b3 #067d17 #1750eb #8c8c8c #00627a #0e4f5c #871094 #080808 #0033b3 #0033b3",
  ),
  S(
    "xcode-light",
    "Xcode Light",
    false,
    "#9b2393 #c41a16 #1c00cf #5d6c79 #326d74 #0b4f79 #326d74 #262626 #9b2393 #0b4f79",
  ),
  S(
    "tokyo-night-light",
    "Tokyo Night Light",
    false,
    "#5a4a78 #385f0d #965027 #848cb5 #2959aa #0f4b6e #33635c #006c86 #8c4351 #2959aa",
  ),
  S(
    "catppuccin-latte",
    "Catppuccin Latte",
    false,
    "#8839ef #40a02b #fe640b #7c7f93 #1e66f5 #df8e1d #7287fd #04a5e5 #1e66f5 #d20f39",
  ),
  S(
    "gruvbox-light",
    "Gruvbox Light",
    false,
    "#9d0006 #79740e #8f3f71 #928374 #427b58 #b57614 #076678 #af3a03 #9d0006 #b57614",
  ),
  S(
    "solarized-light",
    "Solarized Light",
    false,
    "#859900 #2aa198 #d33682 #93a1a1 #268bd2 #b58900 #586e75 #859900 #268bd2 #cb4b16",
  ),
  S(
    "ayu-light",
    "Ayu Light",
    false,
    "#fa8d3e #86b300 #a37acc #8a9199 #eba400 #399ee6 #f07171 #ed9366 #55b4d4 #eba400",
  ),
  S(
    "kanagawa-lotus",
    "Kanagawa Lotus",
    false,
    "#624c83 #6f894e #b35b79 #8a8980 #4d699b #597b75 #77713f #836f4a #c84053 #4d699b",
  ),
  S(
    "everforest-light",
    "Everforest Light",
    false,
    "#f85552 #8da101 #df69ba #939f91 #35a77c #dfa000 #3a94c5 #f57d26 #f57d26 #f85552",
  ),
  S(
    "rose-pine-dawn",
    "Rose Pine Dawn",
    false,
    "#286983 #ea9d34 #b4637a #9893a5 #d7827e #56949f #907aa9 #797593 #56949f #907aa9",
  ),
  S(
    "tomorrow",
    "Tomorrow",
    false,
    "#8959a8 #718c00 #f5871f #8e908c #4271ae #c99e00 #c82829 #3e999f #c82829 #4271ae",
  ),
];

/** App themes whose own syntax theme has another id. */
const OWN: Record<string, string> = { repli: "github-dark" };

/** Colors from the app theme's ANSI colors, for a theme without a syntax theme of its own. */
const fromAnsi = ({ ansi, colors }: Theme): Record<SyntaxRole, string> => ({
  keyword: ansi[5]!,
  string: ansi[2]!,
  number: ansi[3]!,
  comment: colors.muted,
  function: ansi[4]!,
  type: ansi[6]!,
  property: ansi[12]!,
  operator: ansi[6]!,
  tag: ansi[1]!,
  heading: ansi[4]!,
});

/** The colors code is drawn in under app theme `theme` with syntax choice `choice` (an id, or MATCH); `id` is the
 *  syntax theme used (empty: the theme's ANSI colors). A choice of the other scheme counts as MATCH. */
export function syntaxOf(
  theme: Theme,
  choice: string,
): { id: string; colors: Record<SyntaxRole, string> } {
  const chosen = SYNTAX_THEMES.find((s) => s.id === choice && s.dark === theme.dark);
  const own = chosen ?? SYNTAX_THEMES.find((s) => s.id === (OWN[theme.id] ?? theme.id));
  return own ?? { id: "", colors: fromAnsi(theme) };
}
