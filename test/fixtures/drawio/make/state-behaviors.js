(() => {
  const t = window.tam;
  t.clear();
  const g = t.graph,
    m = t.model,
    P = g.getDefaultParent();
  const EDGE = "edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;";
  const v = (label, x, y, w, h, style, parent) => {
    let c;
    m.beginUpdate();
    try {
      c = g.insertVertex(parent ?? P, null, label, x, y, w, h, style);
    } finally {
      m.endUpdate();
    }
    return c;
  };
  const e = (from, to, label) => {
    let c;
    m.beginUpdate();
    try {
      c = g.insertEdge(P, null, label ?? "", from, to, EDGE);
    } finally {
      m.endUpdate();
    }
    return c;
  };
  /** Cells made as the sidebar makes them, dropped at x, y. */
  const drop = (cells, x, y) => {
    m.beginUpdate();
    try {
      return g.importCells(cells, x, y, P);
    } finally {
      m.endUpdate();
    }
  };
  const cell = (value, w, h, style) => {
    const c = new mxCell(value, new mxGeometry(0, 0, w, h), style);
    c.vertex = true;
    return c;
  };
  // The labels below are what draw.io's label editor writes: Enter starts a <div>, Shift+Enter
  // a <br>, and Insert Horizontal Rule an <hr id="null">.
  const start = t.vertex("TAM-AD", "Start of Activity", 110, 20);
  // TAMshapes States, the name typed first and the behaviors on lines after it.
  const idle = t.vertex(
    "SD",
    "State",
    60,
    80,
    "Idle<div>entry / reset</div><div>exit / save</div>",
  );
  const counting = t.vertex(
    "SD",
    "State",
    60,
    200,
    'Counting<hr id="null">entry / start<div>do / count<br>exit / stop</div>',
    [120, 90],
  );
  // A name on two lines.
  const waiting = t.vertex("SD", "State", 260, 80, "Waiting for<br>payment");
  // draw.io's UML 2.5 state with the collapse symbol.
  const printing = v(
    "Printing<div>do / print</div>",
    260,
    200,
    140,
    60,
    "shape=umlState;rounded=1;verticalAlign=top;spacingTop=5;umlStateSymbol=collapseState;absoluteArcSize=1;arcSize=10;html=1;whiteSpace=wrap;points=[[0.5,0,0],[0.5,1,0],[0,0.5,0],[1,0.5,0],[0,0,0,2.93,2.93],[1,0,0,-2.93,2.93],[1,1,0,-2.93,-2.93],[0,1,0,2.93,-2.93]];",
  );
  // The older UML palette's Composite State: a swimlane whose subtitle was typed over.
  const lockedLane = cell(
    "Locked",
    160,
    60,
    "swimlane;fontStyle=1;align=center;verticalAlign=middle;childLayout=stackLayout;horizontal=1;startSize=30;horizontalStack=0;resizeParent=0;resizeLast=1;container=0;fontColor=#000000;collapsible=0;rounded=1;arcSize=30;strokeColor=#ff0000;fillColor=#ffffc0;swimlaneFillColor=#ffffc0;dropTarget=0;",
  );
  lockedLane.insert(
    cell(
      "entry / lock<br>exit / unlock",
      200,
      26,
      "text;html=1;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;spacingLeft=4;spacingRight=4;whiteSpace=wrap;overflow=hidden;rotatable=0;fontColor=#000000;",
    ),
  );
  const [locked] = drop([lockedLane], 40, 330);
  // The UML 2.5 palette's State with compartments, its name typed into the header and its
  // inner region taken out: a line, a behavior, a line, an internal transition.
  const RULE =
    "line;strokeWidth=1;fillColor=none;align=left;verticalAlign=middle;spacingTop=-1;spacingLeft=3;spacingRight=3;rotatable=0;labelPosition=right;points=[];portConstraint=eastwest;";
  const COMPARTMENT =
    "fillColor=none;strokeColor=none;align=left;verticalAlign=middle;spacingLeft=5;whiteSpace=wrap;html=1;";
  const sendingLane = cell(
    "Sending",
    140,
    126,
    "swimlane;fontStyle=4;align=center;verticalAlign=top;childLayout=stackLayout;horizontal=1;startSize=60;horizontalStack=0;resizeParent=1;resizeParentMax=0;resizeLast=0;collapsible=0;marginBottom=0;html=1;rounded=1;absoluteArcSize=1;arcSize=50;whiteSpace=wrap;",
  );
  sendingLane.insert(cell("", 140, 8, RULE));
  sendingLane.insert(cell("entry / connect", 140, 25, COMPARTMENT));
  sendingLane.insert(cell("", 140, 8, RULE));
  sendingLane.insert(cell("timeout / resend", 140, 25, COMPARTMENT));
  const [sending] = drop([sendingLane], 260, 310);
  // A State with its name at the top, a Horizontal Line dropped across it under the name and a
  // TAM-Ann Text typed under the line.
  const ringing = t.vertex("SD", "State", 60, 480, "Ringing", [120, 80]);
  t.style([ringing], "verticalAlign", "top");
  v("", 60, 500, 120, 10, "line;strokeWidth=2;html=1;");
  t.vertex("TAM-Ann", "Text", 70, 515, "ring bell<br>flash light", [100, 36]);
  // A State whose second line holds no slash, parted from the name by a draw.io Line drawn
  // across it from side to side, its ends dropped on the outline.
  const muted = t.vertex("SD", "State", 280, 480, "Muted<div>volume zero</div>", [120, 60]);
  t.style([muted], "verticalAlign", "top");
  m.beginUpdate();
  try {
    const rule = g.insertEdge(P, null, "", null, null, "endArrow=none;html=1;");
    const geo = m.getGeometry(rule).clone();
    geo.setTerminalPoint(new mxPoint(280, 497), true);
    geo.setTerminalPoint(new mxPoint(400, 497), false);
    m.setGeometry(rule, geo);
  } finally {
    m.endUpdate();
  }
  // A State left empty, its name and behaviors typed into texts above and below a line.
  const paused = t.vertex("SD", "State", 60, 620, "", [120, 70]);
  t.vertex("TAM-Ann", "Text", 80, 625, "Paused", [80, 20]);
  v("", 60, 645, 120, 10, "line;strokeWidth=2;html=1;");
  t.vertex("TAM-Ann", "Text", 70, 660, "do / wait", [100, 20]);
  const [end] = t.insert("TAM-AD", "End of Activity", 105, 740);
  e(start, idle);
  e(idle, counting, "start");
  e(counting, waiting, "stop");
  e(waiting, printing, "paid");
  e(printing, sending, "printed");
  e(counting, locked, "lock");
  e(locked, ringing, "alarm");
  e(sending, muted, "sent");
  e(ringing, muted, "mute");
  e(ringing, paused, "pause");
  e(paused, end);
  return "built " + m.getChildCount(P);
})();
