#!/bin/bash
# Opens a blank diagram in the real draw.io (app.diagrams.net) in the agent browser session $1,
# captures its Graph as window.__graph, and loads the harness (window.tam, window.TAMLIB).
set -e
export AGENT_BROWSER_SESSION="$1"
R=$(python3 -c '
import zlib,base64,urllib.parse
xml="<mxGraphModel><root><mxCell id=\"0\"/><mxCell id=\"1\" parent=\"0\"/></root></mxGraphModel>"
c=zlib.compressobj(9, zlib.DEFLATED, -15); d=c.compress(urllib.parse.quote(xml, safe="~()*!.\x27").encode())+c.flush()
print(urllib.parse.quote(base64.b64encode(d).decode(), safe=""))')
URL="https://app.diagrams.net/?splash=0&ui=kennedy#R$R"
# A fresh tab every time: the agent browser is shared, and a tab bound before may have been closed.
agent-browser --isolated tab new "$URL" >/dev/null
agent-browser --isolated set viewport 1400 900 >/dev/null
agent-browser --isolated wait 8000 >/dev/null
agent-browser --isolated eval '(() => {
  for (const [proto, name] of [[mxGraphView.prototype, "validate"], [mxGraphView.prototype, "setScale"], [mxGraph.prototype, "zoomIn"], [mxGraph.prototype, "refresh"]]) {
    const orig = proto[name];
    proto[name] = function () { window.__graph = this.graph || this; return orig.apply(this, arguments); };
  }
  return "patched";
})()' >/dev/null
# Zoom until the editor's own graph (not a sidebar preview) has been captured.
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  agent-browser --isolated find role button click --name "Zoom In" >/dev/null 2>&1 || true
  ready=$(agent-browser --isolated eval '!!(window.__graph && window.__graph.container && window.__graph.container.classList.contains("geDiagramContainer"))' 2>/dev/null | tail -1)
  [ "$ready" = "true" ] && break
  sleep 1
done
agent-browser --isolated eval "$(cat "$(dirname "$0")/harness.js")"
