// Builds the page of ../sequence-floating.drawio in draw.io (after harness.js); the first part adds a few helpers to window.tam.
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
  // draw.io's own lifelines and activation bars, as its UML library makes them, among TAM-SeqD ones.
  const LL =
    'shape=umlLifeline;perimeter=lifelinePerimeter;whiteSpace=wrap;html=1;container=1;dropTarget=0;collapsible=0;recursiveResize=0;outlineConnect=0;portConstraint=eastwest;newEdgeStyle={"curved":0,"rounded":0};';
  const BAR =
    'html=1;points=[[0,0,0,0,5],[0,1,0,0,-5],[1,0,0,0,5],[1,1,0,0,-5]];perimeter=orthogonalPerimeter;outlineConnect=0;targetShapes=umlLifeline;portConstraint=eastwest;newEdgeStyle={"edgeStyle":"sequenceEdgeStyle","libavoidRouting":0,"curved":0,"rounded":0};';
  // Edges drawn from those bars take their newEdgeStyle: draw.io's sequence router.
  const MESSAGE =
    "html=1;verticalAlign=bottom;edgeStyle=sequenceEdgeStyle;libavoidRouting=0;curved=0;rounded=0;";
  const SYNC = MESSAGE + "endArrow=block;";
  const REPLY = MESSAGE + "endArrow=open;dashed=1;endSize=8;";
  const STRAIGHT = "html=1;";
  const browser = g.insertVertex(p, null, "Browser", 40, 40, 100, 460, LL);
  const api = g.insertVertex(p, null, "API", 240, 40, 100, 460, LL);
  t.lifeline(390, 40, "Cache", 460);
  const db = g.insertVertex(p, null, "DB", 640, 40, 100, 460, LL);
  const browserBar = g.insertVertex(browser, null, "", 45, 60, 10, 380, BAR);
  const apiBar = g.insertVertex(api, null, "", 45, 80, 10, 320, BAR);
  const dbBar = g.insertVertex(db, null, "", 45, 200, 10, 90, BAR);
  /** A message connected to two bars without fixed points, dragged by its middle to a point. */
  const message = (style, label, from, to, at) => {
    const edge = g.insertEdge(p, null, label, from, to, style);
    if (at) {
      // draw.io puts an edge in the cell that holds both its ends; its points are relative to it.
      const holder = m.getGeometry(m.getParent(edge));
      const geo = m.getGeometry(edge).clone();
      geo.points = [new mxPoint(at[0] - (holder ? holder.x : 0), at[1] - (holder ? holder.y : 0))];
      m.setGeometry(edge, geo);
    }
    return edge;
  };
  message(SYNC, "GET /page", browserBar, apiBar, [190, 120]);
  // A TAM-SeqD exchange from the API's bar to the cache.
  const [sync] = t.insert("TAM-SeqD", "Sync. Message Exchange", 280, 145);
  g.cellLabelChanged(sync, "get(key)", false);
  g.cellLabelChanged(
    m.getChildren(sync).find((c) => m.getValue(c) === "..."),
    "miss",
    false,
  );
  const cacheBar = m.getChildren(sync).filter((c) => m.isVertex(c))[1];
  // evicted: a straight dashed edge from the cache's bar of the exchange to the API's bar.
  message(STRAIGHT + "dashed=1;endArrow=open;endFill=0;", "evicted", cacheBar, apiBar);
  message(SYNC, "query", apiBar, dbBar, [490, 240]);
  // rows: left where draw.io puts it, halfway between the middles of the bars.
  message(REPLY, "rows", dbBar, apiBar);
  message(REPLY, "page", apiBar, browserBar, [190, 440]);
  // render: a self call from the browser's bar to its lifeline, dragged down to a height.
  message(SYNC, "render", browserBar, browser, [130, 450]);
  g.fit();
  return m.getChildCount(g.getDefaultParent());
})();
