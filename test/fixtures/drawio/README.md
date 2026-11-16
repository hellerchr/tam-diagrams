# draw.io files made in draw.io

The `.drawio` files here were made in the real draw.io (app.diagrams.net) with the shapes of the
TAMshapes libraries for draw.io (https://github.com/f-m-c/TAMshapes, Apache License 2.0), the way
a user makes them: library entries dropped onto the page, edges dragged onto shapes, labels typed,
shapes moved and sent to the back. They are saved as draw.io writes them, and the tests check that
each imports as the diagram its picture shows.

`make/` has what made them: `open.sh <session>` opens draw.io in the agent browser
(`agent-browser`), takes hold of its graph and loads `harness.js`, which drops library entries and
connects edges through draw.io's own code (`importCells`, `connectCell`, `cellLabelChanged`).
`make/<type>-*.js` build the diagrams of each type (`tam`, `activity`, `state`, `sequence`); run
one with `agent-browser eval "$(cat make/<file>)"` and save the page with `tam.file(<name>)`.

`tam-drawio-plugin-channels.drawio.svg` is the sample `samples/smartChannels.drawio.svg` of the
tam-drawio plugin (https://github.com/ariel-bentu/tam-drawio, Apache License 2.0), a file saved by
draw.io with the plugin's own TAM shapes.

`drawio-points.json` holds the points draw.io itself computes for every edge of these files
(`view.getState(edge).absolutePoints`): `make/points.js`, run in draw.io with a file's XML, gives
them. A test checks that the import traces each edge from and to where draw.io draws it.
