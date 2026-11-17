# The draw.io export and import

- **Shapes**:
  - The export draws with the TAMshapes styles (f-m-c/TAMshapes, Apache 2.0) in `src/drawio-shapes.ts`. Every cell it writes carries `tam=<role>` in its style.
  - The import reads a page by its picture first, and lets the role decide where there is one. So a page drawn by hand reads as well as one exported here.
  - The tam-drawio plugin's shapes (`shape=agent`, `useedge`, `updateedge`, …) are read as well.
- **Edges are traced where draw.io draws them**:
  - `Drawing.path` in `src/drawio-file.ts` follows draw.io's own routing: perimeter points, the elbow router and the orthogonal router. Fix a routing difference there, not in one type's module.
  - `test/fixtures/drawio/drawio-points.json` holds the points draw.io computes for every edge of the fixtures, and a test holds the import to them.
- **A fixture from draw.io is made in draw.io**:
  - `test/fixtures/drawio/make/open.sh <session>` opens app.diagrams.net in the agent browser. It loads `harness.js`, which drops library entries and connects edges through draw.io's own code.
  - A `make/<type>-*.js` script builds a diagram the way a user would. `tam.file(<name>)` returns the page as draw.io saves it.
  - After adding a fixture, run `make/points.js` in draw.io on it and add its points to `drawio-points.json`.
  - `test/fixtures/drawio/README.md` has the details.
- **Looking at an export**: draw.io's viewer (`https://viewer.diagrams.net/js/viewer-static.min.js`) renders a file on a local page, through a `<div class="mxgraph" data-mxgraph='{"xml": …}'>`. Screenshot that page.
