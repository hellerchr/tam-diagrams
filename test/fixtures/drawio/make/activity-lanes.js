(() => {
  const t = window.tam;
  t.clear();
  const g = t.graph,
    m = t.model;
  // Three lanes side by side: the first closed on both sides, the others on the right only.
  const l1 = t.vertex("TAM-AD", "Swimlane vertical l+r", 0, 0, undefined, [220, 560]);
  const l2 = t.vertex("TAM-AD", "Swimlane vertical r", 220, 0, undefined, [220, 560]);
  const l3 = t.vertex("TAM-AD", "Swimlane vertical r", 440, 0, undefined, [220, 560]);
  // The lanes' names typed over "text".
  g.cellLabelChanged(l1, "Employee", false);
  g.cellLabelChanged(l2, "Manager", false);
  g.cellLabelChanged(l3, "Purchasing", false);
  // Nodes dropped into the lanes (draw.io does not nest them in a partial rectangle).
  const start = t.vertex("TAM-AD", "Start of Activity", 100, 50);
  const fill = t.vertex("TAM-AD", "Action", 50, 100, "Fill in request");
  const review = t.vertex("TAM-AD", "Action", 270, 100, "Review request");
  const ok = t.vertex("TAM-AD", "Decision or Merge", 320, 210);
  // Guards as Text cells beside the arrows, not typed on them.
  t.vertex("TAM-Ann", "Text", 230, 196, "[rejected]", [70, 20]);
  t.vertex("TAM-Ann", "Text", 345, 240, "[approved]", [70, 20]);
  const [abort] = t.insert("TAM-AD", "End of Flow", 95, 205);
  const order = t.vertex("TAM-AD", "Action", 490, 270, "Order item");
  const receive = t.vertex("TAM-AD", "Action", 490, 370, "Receive item");
  const [end] = t.insert("TAM-AD", "End of Activity", 535, 480);
  t.connect("TAM-AD", "Z vert. Arrow", start, fill);
  t.connect("TAM-AD", "Arrow", fill, review);
  t.connect("TAM-AD", "Z vert. Arrow", review, ok, undefined, [
    [0.5, 1],
    [0.5, 0],
  ]);
  t.connect("TAM-AD", "N hor. Arrow", ok, abort, undefined, [
    [0, 0.5],
    [1, 0.5],
  ]);
  t.connect("TAM-AD", "N hor. Arrow", ok, order);
  t.connect("TAM-AD", "Z vert. Arrow", order, receive);
  t.connect("TAM-AD", "Z vert. Arrow", receive, end);
  return "built " + m.getChildCount(g.getDefaultParent());
})();
