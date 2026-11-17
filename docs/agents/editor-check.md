# Checking the editor in a browser

- **Serving it**:
  - `npm run editor` serves the sources with hot reload; one may already be running (`ss -ltnp | grep vite`).
  - `node dist/cli.js edit <file> --no-open --port <n>` serves the built editor on a file, and Save writes the file.
- **The agent browser is shared**:
  - Give every `agent-browser` call your own session (`AGENT_BROWSER_SESSION=<name>`).
  - Start with `agent-browser --isolated tab new <url>`: other sessions close tabs.
- **The user works in that browser too.** Their diagram and settings live in its `localStorage` under `tam-editor:*` for `localhost`. Test on `http://[::1]:<port>/`: it is another origin with storage of its own, so their diagram stays as they left it.
  - To load a test diagram there, set `localStorage["tam-editor:source"]` and reload.
- **Clicks**: the menus react to pointer events. When a scripted click on a menu item leaves no trace, send `pointerdown`, `pointerup` and `click` to the item from `agent-browser eval`. Then confirm the effect in `localStorage` or the source pane.
- **The picture**: the canvas shows the diagram as an SVG `data:` image. Read it from `img[src^="data:image/svg"]` to check what was drawn without a screenshot.
