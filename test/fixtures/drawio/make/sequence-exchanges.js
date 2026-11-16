// Builds the page of ../sequence-exchanges.drawio in draw.io (after harness.js); the first part adds a few helpers to window.tam.
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
    m = t.model;
  t.clear();
  /** A message exchange dropped at a point and its texts typed in; stretched by its handles to a size. */
  const exchange = (title, x, y, call, reply, size) => {
    const [group] = t.insert("TAM-SeqD", title, x, y);
    g.cellLabelChanged(group, call, false);
    const dots = m.getChildren(group).find((c) => m.getValue(c) === "...");
    if (dots) g.cellLabelChanged(dots, reply, false);
    if (size) {
      const geo = m.getGeometry(group);
      g.resizeCells(
        [group],
        [new mxRectangle(geo.x, geo.y, size[0], size[1])],
        g.isRecursiveVertexResize(g.view.getState(group)),
      );
    }
    return group;
  };
  t.lifeline(40, 40, "Shop", 520);
  t.lifeline(240, 40, "Billing", 520);
  t.lifeline(640, 40, "Warehouse", 520);
  // A synchronous exchange from the shop, whose lifeline has no bar: the white bar is its activation.
  // Stretched down, it holds a second exchange stretched across to the warehouse, 400px away.
  exchange("Sync. Message Exchange", 90, 120, "invoice(order)", "invoice", [200, 200]);
  exchange("Sync. Message Exchange", 290, 160, "check(stock)", "in stock", [400, 60]);
  // The warehouse calls back the shop across the page, from a white bar on its own.
  exchange("R2L Sync. Message Exchange", 90, 360, "ready(order)", "ok", [600, 60]);
  // An asynchronous exchange stretched from the shop to the warehouse.
  exchange("Async. Message Exchange", 90, 460, "picked up", undefined, [600, 50]);
  g.fit();
  return m.getChildCount(g.getDefaultParent());
})();
