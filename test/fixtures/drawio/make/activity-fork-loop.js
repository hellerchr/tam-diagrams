(() => {
  const t = window.tam;
  t.clear();
  const g = t.graph,
    m = t.model;
  // A release: plan, three branches at once, join, test, loop back on failure.
  const start = t.vertex("TAM-AD", "Start of Activity", 290, 10);
  const plan = t.vertex("TAM-AD", "Action", 240, 60, "Plan release");
  const fork = t.vertex("TAM-AD", "Fork or Join", 120, 170, undefined, [360, 10]);
  const build = t.vertex("TAM-AD", "Action", 60, 220, "Action");
  const notes = t.vertex("TAM-AD", "Action", 240, 220, "Write notes");
  const docs = t.vertex("TAM-AD", "Action", 420, 220, "Update docs");
  // The first branch renamed by typing.
  g.cellLabelChanged(build, "Build app", false);
  const object = t.vertex("TAM-AD", "Object Node", 240, 310, "Release notes", [120, 40]);
  const join = t.vertex("TAM-AD", "Fork or Join", 120, 390, undefined, [360, 10]);
  const test = t.vertex("TAM-AD", "Action", 240, 430, "Run tests");
  const passed = t.vertex("TAM-AD", "Decision or Merge", 290, 530);
  t.vertex("TAM-Ann", "Text", 315, 515, "Tests passed?", [90, 20]);
  const publish = t.vertex("TAM-AD", "Action", 240, 590, "Publish");
  const [end] = t.insert("TAM-AD", "End of Activity", 285, 700);
  const note = t.vertex("TAM-Ann", "Note", 500, 420, "Tests run on CI", [100, 60]);
  t.connect("TAM-AD", "Z vert. Arrow", start, plan);
  t.connect("TAM-AD", "Z vert. Arrow", plan, fork);
  // The branches leave the fork at fixed points along the bar.
  t.connect("TAM-AD", "Z vert. Arrow", fork, build, undefined, [
    [0.1, 1],
    [0.5, 0],
  ]);
  t.connect("TAM-AD", "Z vert. Arrow", fork, notes, undefined, [
    [0.5, 1],
    [0.5, 0],
  ]);
  t.connect("TAM-AD", "Z vert. Arrow", fork, docs, undefined, [
    [0.9, 1],
    [0.5, 0],
  ]);
  t.connect("TAM-AD", "Z vert. Arrow", notes, object);
  t.connect("TAM-AD", "Z vert. Arrow", object, join);
  t.connect("TAM-AD", "Z vert. Arrow", build, join, undefined, [
    [0.5, 1],
    [0.1, 0],
  ]);
  t.connect("TAM-AD", "Z vert. Arrow", docs, join, undefined, [
    [0.5, 1],
    [0.9, 0],
  ]);
  t.connect("TAM-AD", "Z vert. Arrow", join, test);
  t.connect("TAM-AD", "Z vert. Arrow", test, passed);
  t.connect("TAM-AD", "Z vert. Arrow", passed, publish, "[yes]");
  // The loop back: from the diamond's left round to the left of the plan, with bends.
  const back = t.connect("TAM-AD", "Arrow", passed, plan, undefined, [
    [0, 0.5],
    [0, 0.5],
  ]);
  m.beginUpdate();
  try {
    const geo = m.getGeometry(back).clone();
    geo.points = [new mxPoint(20, 540), new mxPoint(20, 90)];
    m.setGeometry(back, geo);
  } finally {
    m.endUpdate();
  }
  // Its guard is a Text beside it.
  t.vertex("TAM-Ann", "Text", 200, 520, "no", [30, 20]);
  // The last arrow dropped onto the black dot inside the end node.
  t.connect("TAM-AD", "Z vert. Arrow", publish, m.getChildAt(end, 1));
  return "built " + m.getChildCount(g.getDefaultParent());
})();
