import { createRoot } from "react-dom/client";
import {
  DefaultToolbar,
  type TLComponents,
  type TLUiOverrides,
  Tldraw,
  TldrawUiMenuToolItem,
  useValue,
} from "tldraw";
import "tldraw/tldraw.css";
import { model, STARTER } from "./model.ts";
import { KINDS, TamShapeUtil, TOOLS } from "./TamShape.tsx";

/** The picture the library draws from the source, on the page under tldraw's boxes. */
function PictureLayer() {
  const picture = useValue("picture", () => model.picture.get(), []);
  if (!picture) return null;
  const { x, y, width, height } = picture.bounds;
  return (
    <img
      alt=""
      src={picture.url}
      draggable={false}
      style={{ position: "absolute", left: x, top: y, width, height, pointerEvents: "none", maxWidth: "none" }}
    />
  );
}

const icon = (body: React.ReactNode) => (
  <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5">
    {body}
  </svg>
);

const ICONS: Record<string, React.ReactElement> = {
  agent: icon(<rect x="2.5" y="5" width="15" height="10" />),
  human: icon(
    <>
      <rect x="2.5" y="2" width="15" height="16" />
      <circle cx="10" cy="6.5" r="1.8" />
      <path d="M10 8.3v4M7 10h6M8 15l2-2.7 2 2.7" />
    </>,
  ),
  storage: icon(<rect x="2.5" y="5.5" width="15" height="9" rx="4.5" />),
  group: icon(<rect x="2.5" y="4" width="15" height="12" rx="2" strokeDasharray="2.5 2.5" />),
  component: icon(
    <>
      <rect x="4.5" y="4" width="13" height="12" />
      <rect x="2" y="6.5" width="5" height="2.5" fill="white" />
      <rect x="2" y="11" width="5" height="2.5" fill="white" />
    </>,
  ),
};

const KEYS: Record<string, string> = { agent: "a", human: "u", storage: "s", group: "g" };

const overrides: TLUiOverrides = {
  // Undo and redo step through the sources: the boxes only follow them.
  actions(_editor, actions) {
    actions.undo = { ...actions.undo, onSelect: () => model.undo() };
    actions.redo = { ...actions.redo, onSelect: () => model.redo() };
    return actions;
  },
  tools(editor, tools) {
    for (const kind of KINDS)
      tools[`tam-${kind}`] = {
        id: `tam-${kind}`,
        label: kind[0].toUpperCase() + kind.slice(1),
        icon: ICONS[kind] as never,
        kbd: KEYS[kind],
        onSelect: () => editor.setCurrentTool(`tam-${kind}`),
      };
    return tools;
  },
};

const components: TLComponents = {
  OnTheCanvas: PictureLayer,
  // The boxes carry no styles of tldraw's: what an element looks like is the notation's.
  StylePanel: null,
  Toolbar: () => (
    <DefaultToolbar>
      <TldrawUiMenuToolItem toolId="select" />
      <TldrawUiMenuToolItem toolId="hand" />
      {KINDS.map((kind) => (
        <TldrawUiMenuToolItem key={kind} toolId={`tam-${kind}`} />
      ))}
      <TldrawUiMenuToolItem toolId="arrow" />
    </DefaultToolbar>
  ),
};

function SourcePane() {
  const source = useValue("source", () => model.source.get(), []),
    problem = useValue("problem", () => model.problem.get(), []);
  return (
    <aside className="side">
      <h2>Source</h2>
      <p className="note">
        tldraw moves, sizes and nests the boxes; the picture and the wires are drawn by tam-diagrams from
        this text. Draw an arrow between two elements to connect them.
      </p>
      <textarea
        spellCheck={false}
        value={source}
        onChange={(event) => void model.setSource(event.target.value)}
      />
      {problem && <div className="problem">{problem}</div>}
    </aside>
  );
}

function App() {
  return (
    <div className="app">
      <div className="canvas">
        <Tldraw
          shapeUtils={[TamShapeUtil]}
          tools={TOOLS}
          overrides={overrides}
          components={components}
          onMount={(editor) => {
            model.attach(editor);
            editor.updateInstanceState({ isGridMode: true });
            void model
              .setSource(localStorage.getItem("tam-tldraw:source") ?? STARTER)
              .then(() => editor.zoomToFit({ animation: { duration: 0 } }));
            Object.assign(window, { tlEditor: editor, tamModel: model });
          }}
        />
      </div>
      <SourcePane />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
