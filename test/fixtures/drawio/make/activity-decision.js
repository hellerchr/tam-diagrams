(() => {
  const t = window.tam;
  t.clear();
  const g = t.graph,
    m = t.model;
  // An order process top to bottom, no lanes.
  const start = t.vertex("TAM-AD", "Start of Activity", 250, 20);
  const receive = t.vertex("TAM-AD", "Action", 200, 70, "Receive order");
  // An action dropped with a first name, renamed later by typing.
  const check = t.vertex("TAM-AD", "Action", 200, 170, "Action");
  g.cellLabelChanged(check, "Check stock", false);
  const decide = t.vertex("TAM-AD", "Decision or Merge", 250, 270);
  // The question beside the diamond, a Text of TAM-Ann.
  t.vertex("TAM-Ann", "Text", 275, 268, "In stock?", [70, 24]);
  const ship = t.vertex("TAM-AD", "Action", 60, 330, "Ship goods");
  const cancel = t.vertex("TAM-AD", "Action", 340, 330, "Cancel order");
  const merge = t.vertex("TAM-AD", "Decision or Merge", 250, 430);
  const invoice = t.vertex("TAM-AD", "Action", 200, 490, "Close order");
  const [end] = t.insert("TAM-AD", "End of Activity", 245, 600);
  // Flows: floating, and some at fixed points.
  t.connect("TAM-AD", "Z vert. Arrow", start, receive);
  t.connect("TAM-AD", "Z vert. Arrow", receive, check, undefined, [
    [0.5, 1],
    [0.5, 0],
  ]);
  t.connect("TAM-AD", "Z vert. Arrow", check, decide);
  // Guards typed on the arrows.
  t.connect("TAM-AD", "N hor. Arrow", decide, ship, "[yes]", [
    [0, 0.5],
    [0.5, 0],
  ]);
  t.connect("TAM-AD", "N hor. Arrow", decide, cancel, "[no]", [
    [1, 0.5],
    [0.5, 0],
  ]);
  t.connect("TAM-AD", "Arrow", ship, merge);
  t.connect("TAM-AD", "Arrow", cancel, merge);
  t.connect("TAM-AD", "Z vert. Arrow", merge, invoice);
  // The last arrow: its end dropped just above the end node, not connected.
  const [last] = t.insert("TAM-AD", "Z vert. Arrow", 0, 0);
  m.beginUpdate();
  try {
    g.connectCell(last, invoice, true, null);
    const geo = m.getGeometry(last).clone();
    geo.setTerminalPoint(new mxPoint(260, 597), false);
    m.setGeometry(last, geo);
  } finally {
    m.endUpdate();
  }
  return "built " + m.getChildCount(g.getDefaultParent());
})();
