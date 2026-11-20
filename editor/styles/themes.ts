// Generated from herdr's themes (~/Projects/herdr/app/themes): the 20 semantic roles (ROLES, in the order each theme
// lists its colors) and the 16 ANSI colors (0-7 normal, 8-15 bright) per theme. Claude Dark and Light are hand-made, sampled from Claude Code.

export type Theme = {
  id: string;
  name: string;
  dark: boolean;
  colors: Record<Role, string>;
  ansi: string[];
};
export const ROLES = [
  "canvas",
  "chrome",
  "surface",
  "popover",
  "raised",
  "hover",
  "selected",
  "border",
  "input",
  "foreground",
  "muted",
  "dim",
  "accent",
  "accent_foreground",
  "solid",
  "solid_foreground",
  "working",
  "blocked",
  "done",
  "idle",
] as const;
export type Role = (typeof ROLES)[number];

const T = (id: string, name: string, dark: boolean, c: string, a: string): Theme => {
  const values = c.split(" ");
  const colors = Object.fromEntries(ROLES.map((role, i) => [role, values[i]!])) as Record<
    Role,
    string
  >;
  return { id, name, dark, colors, ansi: a.split(" ") };
};

export const THEMES: Theme[] = [
  T(
    "repli",
    "GitHub Dark",
    true,
    "#010409 #010409 #161b22 #0d1117 #161b22 #1a1e24 #21252b #23272d #30363d #e6edf3 #7d8590 #545d68 #2f81f7 #ffffff #2f81f7 #ffffff #2f81f7 #d29922 #3fb950 #7d8590",
    "#484f58 #ff7b72 #3fb950 #d29922 #58a6ff #bc8cff #39c5cf #b1bac4 #6e7681 #ffa198 #56d364 #e3b341 #79c0ff #d2a8ff #56d4dd #ffffff",
  ),
  T(
    "ayu-dark",
    "Ayu Dark",
    true,
    "#0d1017 #0d1017 #141821 #10141c #141821 #1b1e25 #20232a #22252b #2e3136 #bfbdb6 #5a6673 #3c4550 #e6b450 #000000 #e6b450 #000000 #e6b450 #e6b450 #70bf56 #5a6673",
    "#1b1f29 #f06b73 #70bf56 #fdb04c #4fbfff #d0a1ff #93e2c8 #c7c7c7 #686868 #f07178 #aad94c #ffb454 #59c2ff #d2a6ff #95e6cb #ffffff",
  ),
  T(
    "ayu-mirage",
    "Ayu Mirage",
    true,
    "#1f2430 #1f2430 #282e3b #242936 #282e3b #2e333e #333743 #353944 #41444e #cccac2 #6e7c8f #505b6b #ffcc66 #000000 #ffcc66 #000000 #ffcc66 #ffcc66 #87d96c #6e7c8f",
    "#171b24 #f28273 #87d96c #fcca60 #6acdff #ddbbff #93e2c8 #c7c7c7 #686868 #f28779 #d5ff80 #ffcd66 #73d0ff #dfbfff #95e6cb #ffffff",
  ),
  T(
    "claude-dark",
    "Claude Dark",
    true,
    "#191919 #1f1f1f #2a2a2a #262626 #2a2a2a #2f2f2f #363636 #2e2e2e #3a3a3a #ececec #9a9a9a #6b6b6b #d97757 #ffffff #d97757 #ffffff #d97757 #e0a84a #7cb87c #9a9a9a",
    "#2a2a2a #e5736b #7cb87c #e0a84a #6b9bd1 #c08bd1 #5fb3b3 #c8c8c8 #6b6b6b #f08a82 #95cc95 #ebbd6a #85b0e0 #d1a3e0 #79c7c7 #ffffff",
  ),
  T(
    "catppuccin-frappe",
    "Catppuccin Frappe",
    true,
    "#232634 #292c3c #414559 #303446 #414559 #393d51 #3e4256 #3f4458 #4a4f64 #c6d0f5 #949cbb #6c728c #ca9ee6 #000000 #ca9ee6 #000000 #ca9ee6 #e5c890 #a6d189 #949cbb",
    "#51576d #e78284 #a6d189 #e5c890 #8caaee #f4b8e4 #81c8be #a5adce #626880 #e67172 #8ec772 #d9ba73 #7b9ef0 #f2a4db #5abfb5 #b5bfe2",
  ),
  T(
    "catppuccin-macchiato",
    "Catppuccin Macchiato",
    true,
    "#181926 #1e2030 #363a4f #24273a #363a4f #2e3145 #33364b #35384d #40445a #cad3f5 #939ab7 #676c85 #c6a0f6 #000000 #c6a0f6 #000000 #c6a0f6 #eed49f #a6da95 #939ab7",
    "#494d64 #ed8796 #a6da95 #eed49f #8aadf4 #f5bde6 #8bd5ca #a5adcb #5b6078 #ec7486 #8ccf7f #e1c682 #78a1f6 #f2a9dd #63cbc0 #b8c0e0",
  ),
  T(
    "catppuccin-mocha",
    "Catppuccin Mocha",
    true,
    "#11111b #181825 #313244 #1e1e2e #313244 #29293a #2e2f40 #303042 #3c3d50 #cdd6f4 #9399b2 #64687d #cba6f7 #000000 #cba6f7 #000000 #cba6f7 #f9e2af #a6e3a1 #9399b2",
    "#45475a #f38ba8 #a6e3a1 #f9e2af #89b4fa #f5c2e7 #94e2d5 #a6adc8 #585b70 #f37799 #89d88b #ebd391 #74a8fc #f2aede #6bd7ca #bac2de",
  ),
  T(
    "dracula",
    "Dracula",
    true,
    "#191a21 #21222c #343746 #282a36 #343746 #343641 #3b3d47 #3d3f49 #4b4d56 #f8f8f2 #8f9abb #666d86 #bd93f9 #000000 #bd93f9 #000000 #bd93f9 #f1fa8c #50fa7b #8f9abb",
    "#21222c #ff5555 #50fa7b #f1fa8c #bd93f9 #ff79c6 #8be9fd #f8f8f2 #6272a4 #ff6e6e #69ff94 #ffffa5 #d6acff #ff92df #a4ffff #ffffff",
  ),
  T(
    "everforest-dark",
    "Everforest Dark",
    true,
    "#232a2e #232a2e #343f44 #2d353b #343f44 #373e42 #3c4245 #3e4446 #494e4e #d3c6aa #859289 #626d6a #a7c080 #000000 #a7c080 #000000 #a7c080 #dbbc7f #a7c080 #859289",
    "#343f44 #e67e80 #a7c080 #dbbc7f #7fbbb3 #d699b6 #83c092 #d3c6aa #859289 #e67e80 #a7c080 #dbbc7f #7fbbb3 #d699b6 #83c092 #d3c6aa",
  ),
  T(
    "github-dark",
    "Github Dark",
    true,
    "#010409 #010409 #161b22 #0d1117 #161b22 #1a1e24 #21252b #23272d #32363c #e6edf3 #7d8590 #505760 #2f81f7 #ffffff #2f81f7 #ffffff #2f81f7 #d29922 #3fb950 #7d8590",
    "#484f58 #ff7b72 #3fb950 #d29922 #58a6ff #bc8cff #39c5cf #b1bac4 #6e7681 #ffa198 #56d364 #e3b341 #79c0ff #d2a8ff #56d4dd #ffffff",
  ),
  T(
    "github-dark-dimmed",
    "Github Dark Dimmed",
    true,
    "#1c2128 #1c2128 #2d333b #22272e #2d333b #2a3037 #2f343c #30363d #3a4048 #adbac7 #768390 #545e69 #539bf5 #000000 #539bf5 #000000 #539bf5 #c69026 #57ab5a #768390",
    "#545d68 #f47067 #57ab5a #c69026 #539bf5 #b083f0 #39c5cf #909dab #636e7b #ff938a #6bc46d #daaa3f #6cb6ff #dcbdfb #56d4dd #cdd9e5",
  ),
  T(
    "gruvbox-dark",
    "Gruvbox Dark",
    true,
    "#1d2021 #1d2021 #3c3836 #282828 #3c3836 #343330 #3a3834 #3c3a36 #49463f #ebdbb2 #a89984 #756c5f #fe8019 #000000 #fe8019 #000000 #fe8019 #fabd2f #b8bb26 #a89984",
    "#282828 #cc241d #98971a #d79921 #458588 #b16286 #689d6a #a89984 #928374 #fb4934 #b8bb26 #fabd2f #83a598 #d3869b #8ec07c #ebdbb2",
  ),
  T(
    "kanagawa-wave",
    "Kanagawa Wave",
    true,
    "#16161d #1a1a22 #2a2a37 #1f1f28 #2a2a37 #2a2a31 #303035 #323137 #3f3e41 #dcd7ba #77766d #545351 #7e9cd8 #000000 #7e9cd8 #000000 #7e9cd8 #ff9e3b #98bb6c #77766d",
    "#16161d #c34043 #76946a #c0a36e #7e9cd8 #957fb8 #6a9589 #c8c093 #727169 #e82424 #98bb6c #e6c384 #7fb4ca #938aa9 #7aa89f #dcd7ba",
  ),
  T(
    "material-deep-ocean",
    "Material Deep Ocean",
    true,
    "#090b10 #090b10 #1a1c25 #0f111a #1a1c25 #181a25 #1d1f2a #1e212c #292b38 #a6accd #626985 #41465a #84ffff #000000 #84ffff #000000 #84ffff #ffcb6b #c3e88d #626985",
    "#464b5d #ff5370 #c3e88d #ffcb6b #82aaff #c792ea #89ddff #a6accd #717cb4 #ff5370 #c3e88d #ffcb6b #82aaff #c792ea #89ddff #eeffff",
  ),
  T(
    "material-palenight",
    "Material Palenight",
    true,
    "#232635 #232635 #31364a #292d3e #31364a #323647 #373b4c #383c4d #434758 #bfc7d5 #7980a2 #595f7a #82aaff #000000 #82aaff #000000 #82aaff #ffca28 #9ccc65 #7980a2",
    "#676e95 #ff5572 #a9c77d #ffcb6b #82aaff #c792ea #89ddff #ffffff #676e95 #ff5572 #c3e88d #ffcb6b #82aaff #c792ea #89ddff #ffffff",
  ),
  T(
    "monokai",
    "Monokai",
    true,
    "#1e1f1c #1e1f1c #3e3d32 #272822 #3e3d32 #34342e #3a3b35 #3c3d37 #4b4b45 #f8f8f2 #90908a #666660 #66d9ef #000000 #66d9ef #000000 #66d9ef #fd971f #a6e22e #90908a",
    "#333333 #c4265e #86b42b #b3b42b #6a7ec8 #8c6bc8 #56adbc #e3e3dd #666666 #f92672 #a6e22e #e2e22e #819aff #ae81ff #66d9ef #f8f8f2",
  ),
  T(
    "night-owl",
    "Night Owl",
    true,
    "#01111d #011627 #0b2942 #011627 #0b2942 #0e2233 #142839 #162a3b #253848 #d6deeb #637777 #3c5057 #82aaff #000000 #82aaff #000000 #82aaff #e2b93d #22da6e #637777",
    "#011627 #ef5350 #22da6e #c5e478 #82aaff #c792ea #21c7a8 #ffffff #575656 #ef5350 #22da6e #ffeb95 #82aaff #c792ea #7fdbca #ffffff",
  ),
  T(
    "nord",
    "Nord",
    true,
    "#2e3440 #2e3440 #434c5e #3b4252 #434c5e #444b5b #495060 #4b5261 #565d6c #d8dee9 #99a1b0 #737b8a #88c0d0 #000000 #88c0d0 #000000 #88c0d0 #ebcb8b #a3be8c #99a1b0",
    "#3b4252 #bf616a #a3be8c #ebcb8b #81a1c1 #b48ead #88c0d0 #e5e9f0 #4c566a #bf616a #a3be8c #ebcb8b #81a1c1 #b48ead #8fbcbb #eceff4",
  ),
  T(
    "one-dark",
    "One Dark",
    true,
    "#21252b #21252b #353b45 #282c34 #353b45 #30343c #343841 #353942 #3e434c #abb2bf #828997 #5e646f #528bff #000000 #528bff #000000 #528bff #e5c07b #98c379 #828997",
    "#3f4451 #e06c75 #98c379 #e5c07b #61afef #c678dd #56b6c2 #d7dae0 #4f5666 #ff7b86 #b1e18b #efca84 #67cdff #e48bff #63d4e0 #ffffff",
  ),
  T(
    "one-monokai",
    "One Monokai",
    true,
    "#21252b #21252b #2f333d #282c34 #2f333d #30343c #343841 #353942 #3e434c #abb2bf #787e8a #585d68 #528bff #000000 #528bff #000000 #528bff #e5c07b #98c379 #787e8a",
    "#2d3139 #e06c75 #98c379 #e5c07b #528bff #c678dd #56b6c2 #d7dae0 #7f848e #f44747 #98c379 #e5c07b #528bff #c678dd #56b6c2 #d7dae0",
  ),
  T(
    "rose-pine",
    "Rose Pine",
    true,
    "#191724 #191724 #26233a #1f1d2e #26233a #2b293a #302e40 #323042 #403e50 #e0def4 #74708c #524f66 #c4a7e7 #000000 #c4a7e7 #000000 #c4a7e7 #f6c177 #9ccfd8 #74708c",
    "#26233a #eb6f92 #31748f #f6c177 #9ccfd8 #c4a7e7 #ebbcba #e0def4 #908caa #eb6f92 #31748f #f6c177 #9ccfd8 #c4a7e7 #ebbcba #e0def4",
  ),
  T(
    "rose-pine-moon",
    "Rose Pine Moon",
    true,
    "#232136 #232136 #393552 #2a273f #393552 #35324a #3a374f #3c3951 #49465e #e0def4 #85819c #615d77 #c4a7e7 #000000 #c4a7e7 #000000 #c4a7e7 #f6c177 #9ccfd8 #85819c",
    "#393552 #eb6f92 #3e8fb0 #f6c177 #9ccfd8 #c4a7e7 #ea9a97 #e0def4 #908caa #eb6f92 #3e8fb0 #f6c177 #9ccfd8 #c4a7e7 #ea9a97 #e0def4",
  ),
  T(
    "solarized-dark",
    "Solarized Dark",
    true,
    "#00212b #00212b #073642 #002b36 #073642 #09323c #0d3640 #0f3741 #193f48 #93a1a1 #6e8289 #425f68 #6c71c4 #ffffff #6c71c4 #ffffff #6c71c4 #b58900 #859900 #6e8289",
    "#073642 #dc322f #859900 #b58900 #268bd2 #d33682 #2aa198 #eee8d5 #002b36 #cb4b16 #586e75 #657b83 #839496 #6c71c4 #93a1a1 #fdf6e3",
  ),
  T(
    "tokyo-night",
    "Tokyo Night",
    true,
    "#16161e #16161e #292e42 #1a1b26 #292e42 #242632 #292b39 #2b2d3b #363949 #c0caf5 #787c99 #52556b #7aa2f7 #000000 #7aa2f7 #000000 #7aa2f7 #e0af68 #9ece6a #787c99",
    "#363b54 #f7768e #73daca #e0af68 #7aa2f7 #bb9af7 #7dcfff #787c99 #363b54 #f7768e #73daca #e0af68 #7aa2f7 #bb9af7 #7dcfff #acb0d0",
  ),
  T(
    "tokyo-night-storm",
    "Tokyo Night Storm",
    true,
    "#1f2335 #1f2335 #292e42 #24283b #292e42 #2d3246 #32374c #34384e #3f445b #c0caf5 #8089b3 #5b6283 #7aa2f7 #000000 #7aa2f7 #000000 #7aa2f7 #e0af68 #9ece6a #8089b3",
    "#414868 #f7768e #73daca #e0af68 #7aa2f7 #bb9af7 #7dcfff #8089b3 #414868 #f7768e #73daca #e0af68 #7aa2f7 #bb9af7 #7dcfff #a9b1d6",
  ),
  T(
    "vscode-dark-modern",
    "Vscode Dark Modern",
    true,
    "#181818 #181818 #313131 #1f1f1f #313131 #292929 #2f2f2f #303030 #3c3c3c #cccccc #868686 #5d5d5d #4daafc #000000 #4daafc #000000 #4daafc #cca700 #2ea043 #868686",
    "#000000 #cd3131 #0dbc79 #e5e510 #2472c8 #bc3fbc #11a8cd #e5e5e5 #666666 #f14c4c #23d18b #f5f543 #3b8eea #d670d6 #29b8db #e5e5e5",
  ),
  T(
    "winter-is-coming-dark-blue",
    "Winter Is Coming Dark Blue",
    true,
    "#010e1a #010e1a #0b2942 #011627 #0b2942 #0e2233 #142839 #162a3b #253848 #d6deeb #5f7e97 #39546a #219fd5 #000000 #219fd5 #000000 #219fd5 #ffca28 #22da6e #5f7e97",
    "#011627 #ef5350 #22da6e #f7ecb5 #219fd5 #c792ea #80cbc4 #d6deeb #5f7e97 #ef9a9a #addb67 #ffcb6b #82aaff #c792ea #7fdbca #ffffff",
  ),
  T(
    "ayu-light",
    "Ayu Light",
    false,
    "#ebeef0 #f8f9fa #f8f9fa #fcfcfc #f8f9fa #f4f4f4 #eff0f0 #eceded #e1e2e3 #5c6166 #7c8794 #afb6be #b68137 #000000 #b68137 #000000 #b68137 #f29718 #6cbf43 #7c8794",
    "#000000 #f06b6c #6cbf43 #e7a100 #21a1e2 #a176cb #4abc96 #c7c7c7 #686868 #f07171 #86b300 #eba400 #22a4e6 #a37acc #4cbf99 #d1d1d1",
  ),
  T(
    "claude-light",
    "Claude Light",
    false,
    "#faf9f5 #f5f4ed #ffffff #ffffff #ffffff #f0eee6 #e8e6dc #e8e6dc #d9d6cc #141413 #73726c #a3a29b #c96442 #ffffff #c96442 #ffffff #c96442 #b8860b #4f8a3a #73726c",
    "#141413 #c4423a #4f8a3a #a8770f #2f6db5 #8b4fa8 #2a8a8a #d9d6cc #73726c #d9584f #5f9e48 #c08a1a #4282c9 #a064bf #3a9e9e #faf9f5",
  ),
  T(
    "catppuccin-latte",
    "Catppuccin Latte",
    false,
    "#dce0e8 #e6e9ef #e6e9ef #eff1f5 #e6e9ef #e7e9ee #e2e4ea #dfe1e7 #d3d5dd #4c4f69 #6c6f85 #a0a3b2 #8839ef #ffffff #8839ef #ffffff #8839ef #df8e1d #40a02b #6c6f85",
    "#5c5f77 #d20f39 #40a02b #df8e1d #1e66f5 #ea76cb #179299 #acb0be #6c6f85 #de293e #49af3d #eea02d #456eff #fe85d8 #2d9fa8 #bcc0cc",
  ),
  T(
    "everforest-light",
    "Everforest Light",
    false,
    "#efebd4 #f4f0d9 #f4f0d9 #fdf6e3 #f4f0d9 #f5efdd #f0ebda #ede8d8 #e2ded0 #5c6a72 #7a897e #aeb5a6 #7e9123 #000000 #7e9123 #000000 #7e9123 #dfa000 #8da101 #7a897e",
    "#5c6a72 #f85552 #8da101 #dfa000 #3a94c5 #df69ba #35a77c #939f91 #5c6a72 #f85552 #8da101 #dfa000 #3a94c5 #df69ba #35a77c #f4f0d9",
  ),
  T(
    "github-light",
    "Github Light",
    false,
    "#f6f8fa #f6f8fa #f6f8fa #ffffff #f6f8fa #f4f4f4 #ededee #e9e9ea #d9dada #1f2328 #656d76 #a3a7ad #0969da #ffffff #0969da #ffffff #0969da #9a6700 #1a7f37 #656d76",
    "#24292f #cf222e #116329 #4d2d00 #0969da #8250df #1b7c83 #6e7781 #57606a #a40e26 #1a7f37 #633c01 #218bff #a475f9 #3192aa #8c959f",
  ),
  T(
    "gruvbox-light",
    "Gruvbox Light",
    false,
    "#f2e5bc #f2e5bc #f2e5bc #fbf1c7 #f2e5bc #f1e8c0 #ece2bb #e8dfb9 #dbd2ae #3c3836 #7c6f64 #afa38c #af3a03 #ffffff #af3a03 #ffffff #af3a03 #b57614 #79740e #7c6f64",
    "#fbf1c7 #cc241d #98971a #d79921 #458588 #b16286 #689d6a #7c6f64 #928374 #9d0006 #79740e #b57614 #076678 #8f3f71 #427b58 #3c3836",
  ),
  T(
    "kanagawa-lotus",
    "Kanagawa Lotus",
    false,
    "#dcd5ac #e5ddb0 #e5ddb0 #f2ecbc #e5ddb0 #eae4b8 #e5e0b5 #e2ddb3 #d7d2ad #545464 #777676 #a8a592 #4d699b #ffffff #4d699b #ffffff #4d699b #e98a00 #6f894e #777676",
    "#1f1f28 #c84053 #6f894e #77713f #4d699b #b35b79 #597b75 #545464 #8a8980 #d7474b #6e915f #836f4a #6693bf #624c83 #5e857a #43436c",
  ),
  T(
    "one-light",
    "One Light",
    false,
    "#eaeaeb #eaeaeb #eaeaeb #fafafa #eaeaeb #f0f0f1 #eaebeb #e7e7e8 #d9d9db #383a42 #818289 #b1b2b6 #4078f2 #ffffff #4078f2 #ffffff #4078f2 #c18401 #50a14f #818289",
    "#383a42 #e45649 #50a14f #c18401 #4078f2 #a626a4 #0184bc #a0a1a7 #696c77 #ca1243 #50a14f #986801 #4078f2 #a626a4 #0184bc #fafafa",
  ),
  T(
    "rose-pine-dawn",
    "Rose Pine Dawn",
    false,
    "#faf4ed #faf4ed #f2e9e1 #fffaf3 #f2e9e1 #f7f2ed #f2ede9 #eee9e7 #e2ddde #575279 #857f98 #b6b0bc #907aa9 #000000 #907aa9 #000000 #907aa9 #ea9d34 #56949f #857f98",
    "#f2e9e1 #b4637a #286983 #ea9d34 #56949f #907aa9 #d7827e #575279 #797593 #b4637a #286983 #ea9d34 #56949f #907aa9 #d7827e #575279",
  ),
  T(
    "solarized-light",
    "Solarized Light",
    false,
    "#eee8d5 #eee8d5 #eee8d5 #fdf6e3 #eee8d5 #f1ecdb #e9e7d6 #e4e3d3 #d3d5c8 #073642 #657b83 #a2aca9 #6c71c4 #ffffff #6c71c4 #ffffff #6c71c4 #b58900 #859900 #657b83",
    "#073642 #dc322f #859900 #b58900 #268bd2 #d33682 #2aa198 #eee8d5 #002b36 #cb4b16 #586e75 #657b83 #839496 #6c71c4 #93a1a1 #fdf6e3",
  ),
  T(
    "tokyo-night-light",
    "Tokyo Night Light",
    false,
    "#d6d8df #d6d8df #dadce3 #e6e7ed #dadce3 #dddee6 #d8d9e1 #d4d6de #c8cad4 #343b59 #707280 #9fa1ac #2959aa #ffffff #2959aa #ffffff #2959aa #8f5e15 #33635c #707280",
    "#343b58 #8c4351 #33635c #8f5e15 #2959aa #7b43ba #006c86 #707280 #343b58 #8c4351 #33635c #8f5e15 #2959aa #7b43ba #006c86 #707280",
  ),
  T(
    "vscode-light-modern",
    "Vscode Light Modern",
    false,
    "#f8f8f8 #f8f8f8 #f8f8f8 #ffffff #f8f8f8 #f5f5f5 #efefef #ebebeb #dedede #3b3b3b #767676 #adadad #005fb8 #ffffff #005fb8 #ffffff #005fb8 #bf8803 #2ea043 #767676",
    "#000000 #cd3131 #107c10 #949800 #0451a5 #bc05bc #0598bc #555555 #666666 #f14c4c #14ce14 #b5ba00 #3b8eea #d670d6 #29b8db #a5a5a5",
  ),
];

/** The theme with `id`, or Claude Dark (the default) when there is none. */
export const themeById = (id: string) =>
  THEMES.find((t) => t.id === id) ?? THEMES.find((t) => t.id === "claude-dark")!;
