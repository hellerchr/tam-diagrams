// Builds the page of ../sequence-support.drawio in draw.io (after harness.js); the first part adds a few helpers to window.tam.
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
  const PLAIN = "edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;";
  // A title typed into a TAM-Ann text above the heads.
  const title = t.text(160, 5, "Support ticket", 160);
  t.style([title], "fontStyle", "1");
  t.style([title], "fontSize", "16");
  // draw.io's UML actor with a dashed line drawn below it by hand.
  g.insertVertex(
    p,
    null,
    "Customer",
    45,
    40,
    30,
    60,
    "shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;outlineConnect=0;",
  );
  t.loose(null, null, [60, 125], [60, 560], undefined, "endArrow=none;dashed=1;html=1;");
  t.lifeline(160, 40, "Ticket System", 520);
  // A human agent: a TAM-SeqD lifeline with the TAM-BD Human dropped into its box.
  const agent = t.lifeline(320, 40, "Support Agent", 520);
  t.style([m.getChildAt(agent, 0)], "align", "right");
  t.style([m.getChildAt(agent, 0)], "spacingRight", "8");
  t.insert("TAM-BD", "Human", 332, 50);
  t.lifeline(520, 40, "Mailer", 520);
  // open ticket: the asynchronous exchange from the customer to the ticket system.
  const [open] = t.insert("TAM-SeqD", "Async. Message Exchange", 50, 125);
  g.cellLabelChanged(open, "open ticket", false);
  // assign: a TAM-BD arrow made open, both ends dropped by hand.
  const assign = t.loose("TAM-BD", "N hor. Arrow", [230, 190], [370, 190], "assign");
  t.style([assign], "endArrow", "open");
  t.style([assign], "endFill", "0");
  t.bar(380, 190, 280);
  t.vertex("TAM-Ann", "Note", 600, 200, "sends mails in batches", [120, 40]);
  // An alt frame with a TAM-Ann border across as the line between its branches.
  g.insertVertex(
    p,
    null,
    "alt",
    150,
    230,
    490,
    190,
    "shape=umlFrame;whiteSpace=wrap;html=1;pointerEvents=0;",
  );
  t.text(215, 232, "[solved]", 60);
  const [border] = t.insert("TAM-Ann", "Border Horizontal", 150, 340);
  t.ends(border, [150, 340], [640, 340]);
  t.text(155, 344, "[escalate]", 70);
  const [close] = t.insert("TAM-SeqD", "R2L Sync. Message Exchange", 210, 235);
  g.cellLabelChanged(close, "close()", false);
  g.cellLabelChanged(
    m.getChildren(close).find((c) => m.getValue(c) === "..."),
    "ok",
    false,
  );
  // notify team: drawn from the mailer back to the agent, the head put at its start.
  const notify = t.loose(
    null,
    null,
    [580, 380],
    [390, 380],
    undefined,
    PLAIN + "startArrow=classic;startFill=1;endArrow=none;",
  );
  t.text(435, 358, "notify team", 100);
  const [closed] = t.insert("TAM-SeqD", "R2L Async. Message Exchange", 50, 415);
  g.cellLabelChanged(closed, "ticket closed", false);
  g.fit();
  return m.getChildCount(p);
})();
