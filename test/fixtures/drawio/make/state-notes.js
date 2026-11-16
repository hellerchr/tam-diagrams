(() => {
  const t = window.tam;
  t.clear();
  const g = t.graph,
    m = t.model,
    P = g.getDefaultParent();
  const EDGE = "edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;";
  /**
   * A line from a note: an end dragged onto a cell, or dropped at a point beside it. draw.io keeps
   * a dropped end as a terminal point.
   */
  const line = (from, to, style) => {
    let c;
    m.beginUpdate();
    try {
      c = g.insertEdge(P, null, "", null, null, style);
      const geo = m.getGeometry(c).clone();
      for (const [end, source] of [
        [from, true],
        [to, false],
      ])
        if (end instanceof mxPoint) geo.setTerminalPoint(end, source);
      m.setGeometry(c, geo);
      for (const [end, source] of [
        [from, true],
        [to, false],
      ])
        if (!(end instanceof mxPoint)) g.connectCell(c, end, source, null);
    } finally {
      m.endUpdate();
    }
    return c;
  };
  const start = t.vertex("TAM-AD", "Start of Activity", 90, 20);
  const idle = t.vertex("SD", "State", 40, 80, "Idle");
  const busy = t.vertex("SD", "State", 40, 220, "Busy");
  const error = t.vertex("SD", "State", 300, 220, "Error");
  const done = t.vertex("SD", "State", 40, 360, "Done");
  const [end] = t.insert("TAM-AD", "End of Activity", 85, 480);
  t.connect("TAM-AD", "Arrow", start, idle);
  t.connect("TAM-AD", "Arrow", idle, busy, "work");
  t.connect("TAM-AD", "Arrow", busy, error, "fail");
  t.connect("TAM-AD", "Arrow", error, idle, "reset", [
    [0.5, 0],
    [1, 0.5],
  ]);
  t.connect("TAM-AD", "Arrow", busy, done, "finish");
  t.connect("TAM-AD", "Arrow", done, end);
  // Beside Idle, but joined by a dashed line to Error, both ends dragged onto the shapes.
  const checked = t.vertex("TAM-Ann", "Note", 190, 60, "Checked every minute", [100, 50]);
  line(checked, error, "endArrow=none;dashed=1;html=1;");
  // Nearest to Error, but its line, draw.io's default edge, ends dropped just right of Busy.
  const logs = t.vertex("TAM-Ann", "Note", 440, 150, "Logs the failure", [100, 50]);
  line(logs, new mxPoint(168, 250), EDGE);
  // Nearer to Busy, but a dashed line, both ends dropped, runs from inside it to beside Done.
  t.vertex("TAM-Ann", "Note", -150, 250, "Kept for a week", [100, 50]);
  line(new mxPoint(-100, 290), new mxPoint(34, 390), "endArrow=none;dashed=1;html=1;");
  // Nearer to Error, but a draw.io Line dragged from Done ends dropped inside it.
  t.vertex("TAM-Ann", "Note", 300, 370, "Archived nightly", [100, 50]);
  line(done, new mxPoint(330, 395), "endArrow=none;html=1;");
  // No line: the nearest state.
  t.vertex("TAM-Ann", "Note", -150, 85, "Ready for work", [100, 50]);
  return "built " + m.getChildCount(P);
})();
