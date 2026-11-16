(() => {
  const t = window.tam; t.clear();
  const g = t.graph;
  // Elements, dropped from TAM-BD and named by typing.
  const shop = t.vertex("TAM-BD", "Agent", 200, 40, "Web Shop", [420, 260]);
  t.style([shop], "verticalAlign", "top");
  t.style([shop], "fillColor", "#E6E6E6");
  const api = t.vertex("TAM-BD", "Agent", 240, 110, "Order API");
  const cart = t.vertex("TAM-BD", "Storage", 470, 110, "Cart");
  t.style([cart], "fillColor", "#dae8fc");
  const customer = t.vertex("TAM-BD", "Human Agent", 40, 110, "Customer");
  const orders = t.vertex("TAM-BD", "Storage", 240, 400, "Orders");
  const payment = t.vertex("TAM-BD", "Agent", 720, 330, "Payment");
  // A stack: the agent copied, its name cleared, moved a little and sent behind.
  const [back] = g.importCells([payment], 6, 6, g.getDefaultParent());
  g.cellLabelChanged(back, "", false);
  const worker1 = t.vertex("TAM-BD", "Agent", 700, 520, "Worker");
  const worker2 = t.vertex("TAM-BD", "Agent", 900, 520, "Worker");
  t.insert("TAM-BD", "Multiple Dots", 838, 548);
  // The container behind what it holds, the stack outline behind its agent.
  t.toBack([shop]);
  g.orderCells(true, [back]);
  // A request channel to the API: R points right, toward the API.
  t.connect("TAM-BD", "N hor. Channel", customer, api, "place order");
  // A request channel from the API to the payment service, R pointing right.
  t.connect("TAM-BD", "N hor. Channel", api, payment);
  // Accesses: the API writes the orders, the payment service reads them.
  t.connect("TAM-BD", "Z vert. Arrow", api, orders);
  t.connect("TAM-BD", "N hor. Arrow", orders, payment);
  // A modifying access: the TAM-BD symbol dropped between the API and the cart.
  t.insert("TAM-BD", "mod. Access hor.", 395, 120);
  // A data flow channel: a circle with a line in and an arrow out.
  const circle = t.vertex("TAM-BD", "Channel", 770, 450);
  t.connect("TAM-BD", "Z vert. Connector", payment, circle);
  t.connect("TAM-BD", "Z vert. Arrow", circle, worker1);
  // The protocol of the customer's channel: a border through its circle, named by a text.
  const [border] = t.insert("TAM-Ann", "Border Vertical", 150, 60);
  t.vertex("TAM-Ann", "Text", 155, 50, "HTTPS");
  // A note, joined to the orders by a dashed line drawn with draw.io's own connector.
  const note = t.vertex("TAM-Ann", "Note", 40, 400, "Remember VAT");
  g.insertEdge(g.getDefaultParent(), null, "", note, orders, "endArrow=none;dashed=1;html=1;rounded=0;");
  return "built " + t.model.getChildCount(g.getDefaultParent());
})()
