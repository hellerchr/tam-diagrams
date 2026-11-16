(xml) => {
  const g = window.__graph, model = g.getModel();
  const doc = mxUtils.parseXml(xml);
  const node = doc.documentElement.nodeName === "mxGraphModel" ? doc.documentElement : doc.getElementsByTagName("mxGraphModel")[0];
  model.beginUpdate();
  try { new mxCodec(node.ownerDocument).decode(node, model); } finally { model.endUpdate(); }
  g.refresh();
  const s = g.view.scale, t = g.view.translate, out = {};
  for (const id in model.cells) {
    const cell = model.cells[id];
    if (!model.isEdge(cell)) continue;
    const state = g.view.getState(cell);
    if (state && state.absolutePoints) out[id] = state.absolutePoints.filter(Boolean).map((p) => [Math.round((p.x / s - t.x) * 10) / 10, Math.round((p.y / s - t.y) * 10) / 10]);
  }
  return JSON.stringify(out);
}
