(() => {
  const t = window.tam;
  t.clear();
  const g = t.graph,
    m = t.model;
  // A loose arrow end: the source dragged onto a state, the target dropped at a point.
  const dangle = (from, x, y, label) => {
    const [edge] = t.insert("TAM-AD", "Arrow", 0, 0);
    m.beginUpdate();
    try {
      g.connectCell(edge, from, true, null);
      const geo = m.getGeometry(edge).clone();
      geo.setTerminalPoint(new mxPoint(x, y), false);
      m.setGeometry(edge, geo);
      if (label) g.cellLabelChanged(edge, label, false);
    } finally {
      m.endUpdate();
    }
    return edge;
  };
  const start = t.vertex("TAM-AD", "Start of Activity", 90, 20);
  const idle = t.vertex("SD", "State", 40, 80, "Idle");
  t.vertex("TAM-Ann", "Note", 210, 85, "Waits for the customer", [120, 50]);
  // The composite: a big State, its name typed and set at the top.
  const checkout = t.vertex("SD", "State", 20, 200, "Checkout", [440, 300]);
  t.style([checkout], "verticalAlign", "top");
  const inner = t.vertex("TAM-AD", "Start of Activity", 90, 240);
  const address = t.vertex("SD", "State", 40, 290, "Address");
  const payment = t.vertex("SD", "State", 260, 290, "Payment");
  const check = t.vertex("TAM-AD", "Decision or Merge", 310, 430);
  const [innerEnd] = t.insert("TAM-AD", "End of Activity", 85, 425);
  const shipped = t.vertex("SD", "State", 40, 580, "Shipped");
  const [end] = t.insert("TAM-AD", "End of Activity", 85, 720);
  t.connect("TAM-AD", "Arrow", start, idle);
  t.connect("TAM-AD", "Arrow", idle, checkout, "checkout [cart not empty] / reserve", [
    [0.5, 1],
    [0.25, 0],
  ]);
  t.connect("TAM-AD", "Arrow", inner, address);
  t.connect("TAM-AD", "Arrow", address, payment, "next [valid] / save", [
    [1, 0.5],
    [0, 0.5],
  ]);
  t.connect("TAM-AD", "Arrow", payment, payment, "decline / retry", [
    [1, 0.25],
    [1, 0.75],
  ]);
  t.connect("TAM-AD", "Arrow", payment, check, "submit");
  t.connect("TAM-AD", "Arrow", check, innerEnd, "[paid]");
  t.connect("TAM-AD", "Arrow", check, address, "[failed]");
  t.connect("TAM-AD", "Arrow", checkout, shipped, undefined, [
    [0.25, 1],
    [0.5, 0],
  ]);
  // The label of the arrow above as a text of its own, beside it.
  t.vertex("TAM-Ann", "Text", 105, 530, "ship / notify", [90, 20]);
  // The last arrow's end dropped just above the final state, not on it.
  dangle(shipped, 100, 716, "deliver");
  return "built " + m.getChildCount(g.getDefaultParent());
})();
