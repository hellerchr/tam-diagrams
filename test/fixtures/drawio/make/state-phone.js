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
  const start = t.vertex("TAM-AD", "Start of Activity", 110, 20);
  const dialing = t.vertex("SD", "State", 60, 80, "Dialing");
  t.vertex(
    "TAM-Ann",
    "Note",
    230,
    70,
    "Digits are collected until the number is complete",
    [150, 60],
  );
  // The composite with two concurrent regions, parted by a TAM-Ann border line.
  const active = t.vertex("SD", "State", 20, 220, "Active", [520, 240]);
  t.style([active], "verticalAlign", "top");
  t.style([active], "fontStyle", "1");
  const [border] = t.insert("TAM-Ann", "Border Vertical", 280, 250);
  m.beginUpdate();
  try {
    const geo = m.getGeometry(border).clone();
    geo.setTerminalPoint(new mxPoint(280, 250), true);
    geo.setTerminalPoint(new mxPoint(280, 460), false);
    m.setGeometry(border, geo);
  } finally {
    m.endUpdate();
  }
  // Left region: draw.io's older UML start state, in red.
  const lstart = v(
    "",
    125,
    260,
    30,
    30,
    "ellipse;html=1;shape=startState;fillColor=#000000;strokeColor=#ff0000;",
  );
  const talking = t.vertex("SD", "State", 80, 330, "Talking");
  // Right region: TAM-AD start and end around a UML state.
  const rstart = t.vertex("TAM-AD", "Start of Activity", 400, 265);
  const recording = v(
    "Recording",
    340,
    320,
    140,
    60,
    "shape=umlState;rounded=1;verticalAlign=top;spacingTop=5;umlStateSymbol=collapseState;absoluteArcSize=1;arcSize=10;html=1;whiteSpace=wrap;",
  );
  const [rend] = t.insert("TAM-AD", "End of Activity", 395, 410);
  const ended = t.vertex("SD", "State", 60, 540, "Ended");
  const end = v("", 105, 660, 30, 30, "ellipse;html=1;shape=endState;fillColor=strokeColor;");
  t.connect("TAM-AD", "Arrow", start, dialing);
  t.connect("TAM-AD", "Arrow", dialing, dialing, "digit / append", [
    [1, 0.3],
    [1, 0.7],
  ]);
  t.connect("TAM-AD", "Arrow", dialing, active, "answered / start timer", [
    [0.5, 1],
    [0.2, 0],
  ]);
  e(lstart, talking);
  e(
    talking,
    talking,
    "speak",
    EDGE + "exitX=0;exitY=0.25;exitDx=0;exitDy=0;entryX=0;entryY=0.75;entryDx=0;entryDy=0;",
  );
  e(rstart, recording);
  e(recording, rend, "stop [disk full]");
  t.connect("TAM-AD", "Arrow", active, ended, "hang up", [
    [0.2, 1],
    [0.5, 0],
  ]);
  // An arrow drawn without a label, its label a text beside it.
  const busy = e(
    dialing,
    ended,
    "",
    EDGE + "exitX=0;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;",
  );
  m.beginUpdate();
  try {
    const geo = m.getGeometry(busy).clone();
    geo.points = [new mxPoint(0, 110), new mxPoint(0, 570)];
    m.setGeometry(busy, geo);
  } finally {
    m.endUpdate();
  }
  t.vertex("TAM-Ann", "Text", -50, 490, "busy", [40, 20]);
  e(ended, end);
  return "built " + m.getChildCount(P);
})();
