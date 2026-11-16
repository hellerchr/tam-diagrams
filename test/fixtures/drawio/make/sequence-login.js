// Builds the page of ../sequence-login.drawio in draw.io (after harness.js); the first part adds a few helpers to window.tam.
(() => {
  const t = window.tam,
    g = t.graph,
    m = t.model;
  /** An edge dropped and its two ends dragged to points, connected to nothing. */
  t.loose = (lib, title, a, b, label, style) => {
    const edge = lib
      ? t.insert(lib, title, 0, 0)[0]
      : g.insertEdge(
          g.getDefaultParent(),
          null,
          "",
          null,
          null,
          style ||
            "edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;",
        );
    t.ends(edge, a, b);
    if (label !== undefined) g.cellLabelChanged(edge, label, false);
    return edge;
  };
  /** Drags an edge's loose ends to points (null keeps a connected end). */
  t.ends = (edge, a, b) => {
    m.beginUpdate();
    try {
      const geo = m.getGeometry(edge).clone();
      if (a) {
        if (m.getTerminal(edge, true)) g.connectCell(edge, null, true);
        geo.setTerminalPoint(new mxPoint(a[0], a[1]), true);
      }
      if (b) {
        if (m.getTerminal(edge, false)) g.connectCell(edge, null, false);
        geo.setTerminalPoint(new mxPoint(b[0], b[1]), false);
      }
      geo.points = null;
      m.setGeometry(edge, geo);
    } finally {
      m.endUpdate();
    }
    return edge;
  };
  /** A lifeline renamed and stretched down to a height. */
  t.lifeline = (x, y, name, height) => {
    const [c] = t.insert("TAM-SeqD", "Lifeline", x, y);
    const box = m.getChildAt(c, 0);
    g.cellLabelChanged(box, name, false);
    g.resizeCells([c], [new mxRectangle(x, y, 120, height)], true);
    return c;
  };
  t.bar = (cx, y, h) => t.vertex("TAM-SeqD", "Activation", cx - 10, y, undefined, [20, h]);
  t.text = (x, y, label, w) => t.vertex("TAM-Ann", "Text", x, y, label, [w || 80, 20]);
  return "helpers";
})();
(() => {
  const t = window.tam,
    g = t.graph,
    m = t.model,
    p = g.getDefaultParent();
  t.clear();
  const LL =
    'shape=umlLifeline;perimeter=lifelinePerimeter;whiteSpace=wrap;html=1;container=1;dropTarget=0;collapsible=0;recursiveResize=0;outlineConnect=0;portConstraint=eastwest;newEdgeStyle={"curved":0,"rounded":0};';
  const PLAIN = "edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;";
  // draw.io's own actor lifeline and lifeline, mixed with TAM-SeqD lifelines.
  const user = g.insertVertex(
    p,
    null,
    "User",
    50,
    40,
    20,
    460,
    "shape=umlLifeline;participant=umlActor;perimeter=lifelinePerimeter;whiteSpace=wrap;html=1;container=1;collapsible=0;recursiveResize=0;verticalAlign=top;spacingTop=36;outlineConnect=0;portConstraint=eastwest;",
  );
  t.lifeline(160, 40, "App", 460);
  const auth = g.insertVertex(p, null, "Auth Service", 330, 40, 100, 460, LL);
  t.lifeline(480, 40, "User DB", 460);
  t.bar(220, 120, 296);
  // open login: a plain connector drawn from the user's lifeline, its end dropped at the App's bar.
  // Edges drawn from draw.io's lifelines take its newEdgeStyle: straight, not rounded.
  const STRAIGHT = "html=1;curved=0;rounded=0;";
  const open = g.insertEdge(
    p,
    null,
    "open login",
    null,
    null,
    STRAIGHT + "endArrow=block;endFill=1;",
  );
  t.ends(open, [60, 120], [210, 120]);
  g.connectCell(open, user, true);
  // A loop: draw.io's UML frame with its condition in a TAM-Ann text.
  const loop = g.insertVertex(
    p,
    null,
    "loop",
    190,
    135,
    420,
    175,
    "shape=umlFrame;whiteSpace=wrap;html=1;pointerEvents=0;",
  );
  t.text(250, 137, "[until valid]", 80);
  const [sync] = t.insert("TAM-SeqD", "Sync. Message Exchange", 210, 155);
  g.cellLabelChanged(sync, "verify(pw)", false);
  g.cellLabelChanged(
    m.getChildren(sync).find((c) => m.getValue(c) === "..."),
    "token",
    false,
  );
  const bar = m.getChildren(sync).filter((c) => m.isVertex(c))[1];
  // lookup: the TAM-AD arrow from Auth's bar to the DB's lifeline, its end dropped near the line.
  const lookup = t.insert("TAM-AD", "Arrow", 0, 0)[0];
  t.ends(lookup, null, [546, 200]);
  g.connectCell(lookup, bar, true, new mxConnectionConstraint(new mxPoint(1, 1 / 3), false));
  t.style([lookup], "entryX", null);
  t.style([lookup], "entryY", null);
  t.style([lookup], "entryDx", null);
  t.style([lookup], "entryDy", null);
  g.cellLabelChanged(lookup, "lookup", false);
  const row = t.loose(
    null,
    null,
    [540, 225],
    [390, 225],
    undefined,
    PLAIN + "dashed=1;endArrow=open;endFill=0;",
  );
  t.text(425, 204, "user row", 80);
  // confirm 2FA: the R2L exchange between the user and the App.
  const [r2l] = t.insert("TAM-SeqD", "R2L Sync. Message Exchange", 50, 305);
  g.cellLabelChanged(r2l, "confirm 2FA", false);
  g.cellLabelChanged(
    m.getChildren(r2l).find((c) => m.getValue(c) === "..."),
    "code",
    false,
  );
  // welcome: drawn from the App's bar to the user's lifeline.
  const welcome = g.insertEdge(
    p,
    null,
    "welcome",
    null,
    null,
    STRAIGHT + "endArrow=open;endFill=0;",
  );
  t.ends(welcome, [210, 412], [60, 412]);
  g.connectCell(welcome, user, false);
  t.vertex("TAM-Ann", "Note", 200, 440, "session stored", [200, 30]);
  g.fit();
  return m.getChildCount(p);
})();
