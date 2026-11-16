// Builds the page of ../sequence-checkout.drawio in draw.io (after harness.js); the first part adds a few helpers to window.tam.
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
  // The customer: the TAM-BD Human figure, its name in a text below, a dashed border down as its lifeline.
  t.insert("TAM-BD", "Human", 90, 40);
  t.text(60, 82, "Customer", 80);
  const [line] = t.insert("TAM-Ann", "Border Vertical", 100, 106);
  t.ends(line, [100, 106], [100, 560]);
  // Lifelines from TAM-SeqD, renamed and stretched.
  t.lifeline(200, 40, "Web Shop", 520);
  t.lifeline(360, 40, "Payment", 520);
  t.lifeline(560, 40, "Stock", 520);
  // Activations dropped on the lifelines (by eye: Stock's is 2px off).
  t.bar(100, 130, 250);
  t.bar(260, 140, 340);
  t.bar(622, 280, 50);
  // checkout: a TAM-BD arrow, its ends dropped at the bars' sides.
  t.loose("TAM-BD", "N hor. Arrow", [110, 140], [250, 140], "checkout");
  // A synchronous exchange dropped between Web Shop and Payment; call and reply typed in.
  const [sync] = t.insert("TAM-SeqD", "Sync. Message Exchange", 250, 155);
  g.cellLabelChanged(sync, "authorize(card)", false);
  const dots = m.getChildren(sync).find((c) => m.getValue(c) === "...");
  g.cellLabelChanged(dots, "approved", false);
  // reserve: draw.io's plain connector, its text in a separate Text above it.
  t.loose(null, null, [270, 280], [612, 280]);
  t.text(390, 258, "reserve(items)", 100);
  const reply = t.loose(null, null, [612, 330], [270, 330], "reserved");
  t.style([reply], "dashed", "1");
  t.style([reply], "endArrow", "open");
  t.vertex("TAM-Ann", "Note", 650, 350, "checks stock levels", [110, 40]);
  // An asynchronous mail back to the customer: the R2L exchange.
  const [mail] = t.insert("TAM-SeqD", "R2L Async. Message Exchange", 90, 375);
  g.cellLabelChanged(mail, "mail sent", false);
  // done: a dashed TAM-AD arrow whose end was dropped near the customer's line, its text above it.
  const done = t.loose("TAM-AD", "N hor. Arrow", [250, 476], [106, 476]);
  t.style([done], "dashed", "1");
  t.style([done], "endArrow", "open");
  t.style([done], "endFill", "0");
  t.text(150, 455, "done", 60);
  g.fit();
  return m.getChildCount(g.getDefaultParent());
})();
