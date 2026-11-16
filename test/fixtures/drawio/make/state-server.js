(() => {
  const t = window.tam;
  t.clear();
  const g = t.graph,
    m = t.model,
    P = g.getDefaultParent();
  const EDGE = "edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;";
  const v = (label, x, y, w, h, style) => {
    let c;
    m.beginUpdate();
    try {
      c = g.insertVertex(P, null, label, x, y, w, h, style);
    } finally {
      m.endUpdate();
    }
    return c;
  };
  const e = (from, to, label, style) => {
    let c;
    m.beginUpdate();
    try {
      c = g.insertEdge(P, null, label ?? "", from, to, style ?? EDGE);
    } finally {
      m.endUpdate();
    }
    return c;
  };
  // draw.io's UML 2.5 palette: an initial pseudostate, a state with the collapse symbol.
  const init = v("", 20, 135, 30, 30, "ellipse;fillColor=strokeColor;html=1;");
  const boot = v(
    "Booting",
    90,
    120,
    140,
    60,
    "shape=umlState;rounded=1;verticalAlign=top;spacingTop=5;umlStateSymbol=collapseState;absoluteArcSize=1;arcSize=10;html=1;whiteSpace=wrap;points=[[0.5,0,0],[0.5,1,0],[0,0.5,0],[1,0.5,0],[0,0,0,2.93,2.93],[1,0,0,-2.93,2.93],[1,1,0,-2.93,-2.93],[0,1,0,2.93,-2.93]];",
  );
  // TAM-AD Fork or Join turned upright.
  const fork = t.vertex("TAM-AD", "Fork or Join", 280, 90, undefined, [10, 120]);
  const load = t.vertex("SD", "State", 340, 50, "Loading config");
  const warm = t.vertex("SD", "State", 340, 190, "Warming cache");
  // draw.io's UML 2.5 Join/Fork Node.
  const join = v(
    "",
    520,
    110,
    5,
    80,
    "html=1;points=[];perimeter=orthogonalPerimeter;fillColor=strokeColor;",
  );
  const ready = v(
    "Ready",
    580,
    130,
    140,
    40,
    "html=1;align=center;verticalAlign=top;rounded=1;absoluteArcSize=1;arcSize=10;dashed=0;whiteSpace=wrap;roundedPerimeter=1;",
  );
  const choice = v("", 635, 260, 30, 30, "rhombus;");
  const serving = t.vertex("SD", "State", 790, 120, "Serving");
  // draw.io's older UML palette: the final state in red.
  const end = v(
    "",
    635,
    360,
    30,
    30,
    "ellipse;html=1;shape=endState;fillColor=#000000;strokeColor=#ff0000;",
  );
  const note = t.vertex("TAM-Ann", "Note", 560, 10, "Accepts requests", [120, 50]);
  e(init, boot);
  t.connect("TAM-AD", "Arrow", boot, fork, "start");
  e(
    fork,
    load,
    undefined,
    EDGE + "exitX=1;exitY=0.25;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;",
  );
  e(
    fork,
    warm,
    undefined,
    EDGE + "exitX=1;exitY=0.75;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;",
  );
  t.connect("TAM-AD", "Arrow", load, join);
  t.connect("TAM-AD", "Arrow", warm, join);
  e(join, ready);
  // A self transition, as draw.io loops it.
  e(
    ready,
    ready,
    "tick / refresh",
    EDGE + "exitX=0.25;exitY=0;exitDx=0;exitDy=0;entryX=0.75;entryY=0;entryDx=0;entryDy=0;",
  );
  e(ready, choice, "request");
  // A label added on the edge as a cell of its own, the way a double click on an edge does.
  const ok = e(choice, serving);
  m.beginUpdate();
  try {
    const label = new mxCell(
      "[valid]",
      new mxGeometry(-0.2, 0, 0, 0),
      "edgeLabel;html=1;align=center;verticalAlign=middle;resizable=0;points=[];",
    );
    label.geometry.relative = true;
    label.geometry.offset = new mxPoint(0, -10);
    label.vertex = true;
    label.setConnectable(false);
    g.addCell(label, ok);
  } finally {
    m.endUpdate();
  }
  e(choice, end, "[invalid] / log");
  e(serving, ready, "done");
  // The note joined to its state by a dashed line without arrows.
  e(note, ready, "", "endArrow=none;dashed=1;html=1;");
  return "built " + m.getChildCount(P);
})();
