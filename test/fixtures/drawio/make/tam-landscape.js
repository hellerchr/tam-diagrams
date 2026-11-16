(() => {
  const t = window.tam; t.clear();
  const g = t.graph;
  const text = (x, y, value) => t.vertex("TAM-Ann", "Text", x, y, value, [90, 20]);
  // Three levels: a landscape holding a server holding a runtime with a worker and a cache.
  const landscape = t.vertex("TAM-BD", "Agent", 300, 20, "Landscape", [520, 330]);
  t.style([landscape], "verticalAlign", "top");
  const server = t.vertex("TAM-BD", "Agent", 330, 60, "App Server", [300, 260]);
  t.style([server], "verticalAlign", "top");
  const runtime = t.vertex("TAM-BD", "Agent", 350, 100, "Runtime", [260, 190]);
  t.style([runtime], "verticalAlign", "top");
  const worker = t.vertex("TAM-BD", "Agent", 370, 150, "Worker", [100, 50]);
  const cache = t.vertex("TAM-BD", "Storage", 490, 150, "Cache", [100, 50]);
  t.toBack([runtime]); t.toBack([server]); t.toBack([landscape]);
  // A storage that holds storages.
  const db = t.vertex("TAM-BD", "Storage", 660, 60, "Database", [140, 250]);
  t.style([db], "verticalAlign", "top");
  const tables = t.vertex("TAM-BD", "Storage", 680, 110, "Tables", [100, 50]);
  const index = t.vertex("TAM-BD", "Storage", 680, 230, "Index", [100, 50]);
  t.insert("TAM-Ann", "3 Dots vert.", 715, 175);
  t.toBack([db]); t.toBack([landscape]);
  // An admin: the standalone figure dropped onto an agent box.
  const admin = t.vertex("TAM-BD", "Agent", 40, 40, "Admin", [80, 70]);
  t.style([admin], "verticalAlign", "bottom");
  t.insert("TAM-BD", "Human", 70, 45);
  // A user: the figure alone, named by a text below it.
  const [user] = t.insert("TAM-BD", "Human", 70, 300);
  text(35, 345, "End User");
  // Requests down from the admin to the worker? No: the admin calls the runtime's worker, R pointing right.
  t.connect("TAM-BD", "N hor. Channel", admin, worker, "deploy");
  // The worker reads and writes the cache: two arrows drawn by hand.
  t.connect("TAM-BD", "N hor. Arrow", worker, cache);
  t.connect("TAM-BD", "N hor. Arrow", cache, worker);
  // The runtime writes the tables: the arrow pinned at fixed points, its label a text beside it.
  t.connect("TAM-BD", "N hor. Arrow", runtime, tables, undefined, [[1, 0.2], [0, 0.5]]);
  text(612, 100, "store rows");
  // A loose arrow: dropped next to the index, not on it; its label a cell of its own on the edge.
  const [loose] = t.insert("TAM-BD", "Z vert. Arrow", 0, 0);
  g.connectCell(loose, runtime, true, null);
  loose.geometry.setTerminalPoint(new mxPoint(675, 255), false);
  g.refresh();
  g.insertVertex(loose, null, "update index", -0.3, 0, 0, 0, "edgeLabel;html=1;align=center;verticalAlign=middle;resizable=0;points=[];", true);
  // The user calls the server, R pointing up (the channel drawn from the server down to the user).
  t.connect("TAM-BD", "Z vert. Channel up", server, user);
  // A queue and a structure variance, which the syntax has no word for.
  const queue = t.vertex("TAM-BD", "Queue", 300, 420, "Jobs");
  t.connect("TAM-BD", "Z vert. Arrow", runtime, queue);
  t.vertex("TAM-BD", "Structure Variance", 500, 420, "Plugins");
  t.vertex("TAM-BD", "L Shape", 860, 400, "Monitor", [160, 160]);
  return "built " + t.model.getChildCount(g.getDefaultParent());
})()
