/** Class diagrams: measuring classes and laying them out with ELK, with notes, lollipops and self-relations. */

import { bestScene, STRATEGIES } from "./best";
import {
  type ElkLayout,
  type Graph,
  type GraphEdge,
  type GraphNode,
  layoutGraph,
  type LayoutOptions,
} from "./elk";
import { dodgeTitles, hugLabels, smallSize, wrapSmall } from "./labels";
import { MARKER_LENGTH, type MarkerKind } from "./markers";
import { emptyScene, type Scene, type SceneShape } from "./scene";
import {
  addText,
  addTitleLines,
  drawNote,
  finishBounds,
  FONT,
  LINE,
  type Measure,
  SMALL,
  wrap,
} from "./text";
import { addWire, attachEnds, straightenScene } from "./wires";
import {
  type ClassDiagram,
  type ClassMember,
  type ClassNote,
  generics,
  type Relation,
  type UmlClass,
} from "./uml-class";
import { type EndLabel, layoutPackages, mergeTrees, placeEndLabels } from "./uml-class-packages";

const PAD = 10,
  MEMBER_LINE = 16,
  BALL = 12,
  FOLDER_TAB = 12;

interface ClassBox {
  /** Room above the name: the tab of a collapsed package's folder. */
  top: number;
  width: number;
  height: number;
  header: number;
  stereotypes: string[];
  name: string[];
  attributes: number;
  methods: number;
}

function measureClass(item: UmlClass, measure: Measure): ClassBox {
  const stereotypes = item.annotations.map((annotation) => `«${annotation}»`);
  const label = `${item.label}${item.generic ? `<${generics(item.generic)}>` : ""}`;
  const name = wrap(label, 260, FONT, 600, measure);
  const top = item.id.startsWith("ns:") ? FOLDER_TAB : 0;
  const header = top + 8 + stereotypes.length * 15 + name.length * LINE + 8;
  const members = [...item.attributes, ...item.methods];
  const width = Math.ceil(
    Math.max(
      80,
      ...name.map((line) => measure(line, FONT, 600) + 2 * PAD),
      ...stereotypes.map((line) => measure(line, SMALL, 400) + 2 * PAD),
      ...members.map((member) => measure(member.text, SMALL, 400) + 2 * PAD + 2),
    ),
  );
  const compartment = (count: number) => (count ? 6 + count * MEMBER_LINE + 6 : 0);
  // An empty attribute compartment above operations, so each list is in its own place.
  const attributes =
      item.methods.length && !item.attributes.length ? 8 : compartment(item.attributes.length),
    methods = compartment(item.methods.length);
  return {
    width,
    height: header + attributes + methods,
    top,
    header,
    stereotypes,
    name,
    attributes,
    methods,
  };
}

/** How much further a self association's loop reaches: its longest end marker and end label. */
function loopRoom(relation: Relation, measure: Measure): number {
  const marker = Math.max(
    0,
    ...[relation.startMarker, relation.endMarker].map((kind) => (kind ? MARKER_LENGTH[kind] : 0)),
  );
  const label = Math.max(
    0,
    ...[relation.startLabel, relation.endLabel].map((text) =>
      text ? Math.max(smallSize(text, measure).width, smallSize(text, measure).height) + 6 : 0,
    ),
  );
  return marker + label;
}

export async function layoutClassDiagram(
  diagram: ClassDiagram,
  measure: Measure,
  options: { layout?: ElkLayout } = {},
): Promise<Scene> {
  const vertical = diagram.direction === "TB" || diagram.direction === "BT";
  const boxes = new Map(
    [...diagram.classes.values()].map((item) => [item.id, measureClass(item, measure)]),
  );
  const noteSize = (note: ClassNote) => {
    const size = smallSize(note.text, measure);
    return { width: size.width + 2 * 8 + 6, height: size.height + 12 };
  };
  // Namespaces become containers; classes and notes go into the innermost one around them.
  const containers = new Map<string, GraphNode>();
  const roots: GraphNode[] = [];
  const titleLines = new Map<string, string[]>();
  for (const space of diagram.namespaces.values()) {
    const lines = wrap(space.label, 300, FONT, 600, measure);
    titleLines.set(space.id, lines);
    containers.set(space.id, {
      id: `ns:${space.id}`,
      children: [],
      padding: { top: lines.length * LINE + 18, side: 14 },
      minWidth: Math.ceil(Math.max(...lines.map((line) => measure(line, FONT, 600))) + 28),
    });
  }
  for (const space of diagram.namespaces.values())
    (space.parent ? containers.get(space.parent)!.children! : roots).push(
      containers.get(space.id)!,
    );
  // A class with many relations grows along the sides where they arrive, so their ends keep apart.
  const degree = new Map<string, number>();
  for (const relation of diagram.relations)
    if (relation.source !== relation.target)
      for (const end of [relation.source, relation.target])
        degree.set(end, (degree.get(end) ?? 0) + 1);
  for (const item of diagram.classes.values()) {
    const box = boxes.get(item.id)!,
      room = ((degree.get(item.id) ?? 0) + 1) * 14 + 8;
    (item.namespace ? containers.get(item.namespace)!.children! : roots).push({
      id: item.id,
      width: vertical ? Math.max(box.width, room) : box.width,
      height: vertical ? box.height : Math.max(box.height, room),
    });
  }
  for (const note of diagram.notes)
    (note.namespace ? containers.get(note.namespace)!.children! : roots).push({
      id: note.id,
      ...noteSize(note),
    });
  for (const ball of diagram.lollipops) {
    const size = smallSize(ball.label, measure);
    roots.push({
      id: ball.id,
      width: BALL,
      height: BALL,
      centered: true,
      labels: [
        {
          ...size,
          placement: vertical ? "OUTSIDE H_RIGHT V_CENTER" : "OUTSIDE V_TOP H_CENTER",
          gap: 5,
        },
      ],
    });
  }
  // Empty namespaces still show: give them a placeholder child.
  for (const [id, node] of containers)
    if (!node.children!.length)
      node.children!.push({ id: `ns:${id}#empty`, width: 60, height: 10, passable: true });

  // Generalizations and wholes sit above their specializations and parts, whichever way the arrow is written.
  const upper = (marker?: MarkerKind) =>
    marker === "triangle" || marker === "diamond" || marker === "filled-diamond";
  const labels = new Map(
    diagram.relations
      .filter((relation) => relation.label)
      .map((relation) => [relation.id, wrapSmall(relation.label!, measure)]),
  );
  const edges: GraphEdge[] = diagram.relations.map((relation) => ({
    id: relation.id,
    source: relation.source,
    target: relation.target,
    reversed: upper(relation.endMarker) && !upper(relation.startMarker),
    label: labels.has(relation.id) ? smallSize(labels.get(relation.id)!, measure) : undefined,
    // A self association's loop holds its markers and multiplicities.
    room: relation.source === relation.target ? loopRoom(relation, measure) : undefined,
  }));
  for (const note of diagram.notes)
    if (note.target) edges.push({ id: `${note.id}:link`, source: note.id, target: note.target });

  const build = async ({
    elk,
    scale,
    packages,
  }: {
    elk: Record<string, string>;
    scale: number;
    packages?: boolean;
  }) => {
    const graph: Graph = { direction: diagram.direction, children: roots, edges };
    const layoutOptions: LayoutOptions = {
      layout: options.layout,
      elk,
      // Room beside the ends for multiplicities and between layers for them and the labels.
      spacing: { port: 28 * scale, layer: 52 * scale, node: 36 * scale, edgeNode: 22 * scale },
    };
    const placement =
      (packages && (await layoutPackages(graph, layoutOptions))) ||
      (await layoutGraph(graph, layoutOptions));
    const scene = emptyScene();
    const depthOf = (id: string) => placement.ancestors.get(id)?.length ?? 0;
    for (const space of diagram.namespaces.values()) {
      const id = `ns:${space.id}`,
        box = placement.boxes.get(id);
      if (!box) continue;
      scene.shapes.push({
        id,
        kind: "rect",
        box,
        container: true,
        depth: depthOf(id),
        fill: "shade",
      });
      addTitleLines(
        scene,
        measure,
        titleLines.get(space.id)!,
        id,
        box.x + box.width / 2,
        box.y + 9,
      );
    }
    for (const item of diagram.classes.values()) {
      const box = placement.boxes.get(item.id),
        size = boxes.get(item.id)!;
      if (!box) continue;
      // A class without members is just its name, centred in the box.
      const bare = !item.attributes.length && !item.methods.length;
      const dividers = bare
        ? []
        : [
            box.y + size.header,
            ...(size.methods ? [box.y + size.header + size.attributes] : []),
          ].filter((y) => y < box.y + box.height - 0.5);
      // A collapsed package is a folder: its tab above the name, its class count below.
      const shape: SceneShape = {
        id: item.id,
        kind: size.top ? "folder" : "rect",
        box,
        container: false,
        depth: depthOf(item.id),
        fill: "page",
        dividers,
        ...(size.top ? { tab: { width: Math.min(40, box.width / 2), height: size.top } } : {}),
      };
      scene.shapes.push(shape);
      const cx = box.x + box.width / 2;
      let y = box.y + size.top + 8 + (bare ? (box.height - size.header) / 2 : 0);
      for (const stereotype of size.stereotypes) {
        addText(scene, measure, stereotype, cx, y + 7.5, {
          size: SMALL,
          tone: "secondary",
          role: "stereotype",
          owner: item.id,
        });
        y += 15;
      }
      const abstract = item.annotations.some((annotation) => /^abstract$/i.test(annotation));
      for (const line of size.name) {
        addText(scene, measure, line, cx, y + LINE / 2, {
          size: FONT,
          weight: 600,
          italic: abstract,
          role: "node",
          owner: item.id,
        });
        y += LINE;
      }
      const list = (members: ClassMember[], top: number) =>
        members.forEach((member, index) =>
          addText(
            scene,
            measure,
            member.text,
            box.x + PAD,
            top + 6 + MEMBER_LINE / 2 + index * MEMBER_LINE,
            {
              size: SMALL,
              anchor: "start",
              italic: member.italic,
              underline: member.underline,
              role: "member",
              owner: item.id,
            },
          ),
        );
      list(item.attributes, box.y + size.header);
      list(item.methods, box.y + size.header + size.attributes);
    }
    for (const note of diagram.notes) {
      const box = placement.boxes.get(note.id);
      if (!box) continue;
      drawNote(scene, measure, note.id, note.text, box, { depth: depthOf(note.id), inset: 8 });
    }
    for (const ball of diagram.lollipops) {
      const box = placement.boxes.get(ball.id),
        label = placement.nodeLabels.get(ball.id)?.[0];
      if (!box) continue;
      scene.shapes.push({
        id: ball.id,
        kind: "circle",
        box,
        container: false,
        depth: 0,
        fill: "page",
      });
      if (label)
        addText(
          scene,
          measure,
          ball.label,
          vertical ? label.x : label.x + label.width / 2,
          label.y + label.height / 2,
          {
            size: SMALL,
            anchor: vertical ? "start" : "middle",
            tone: "secondary",
            role: "label",
            owner: ball.id,
          },
        );
    }
    const shapes = new Map(scene.shapes.map((shape) => [shape.id, shape]));
    const ends: EndLabel[] = [];
    for (const relation of diagram.relations) {
      addWire(
        scene,
        placement,
        {
          id: relation.id,
          source: relation.source,
          target: relation.target,
          dashed: relation.dashed,
          startMarker: relation.startMarker,
          endMarker: relation.endMarker,
          label: labels.get(relation.id),
        },
        shapes,
        measure,
      );
      if (relation.startLabel)
        ends.push({ wire: relation.id, text: relation.startLabel, atStart: true });
      if (relation.endLabel)
        ends.push({ wire: relation.id, text: relation.endLabel, atStart: false });
    }
    for (const note of diagram.notes)
      if (note.target)
        addWire(
          scene,
          placement,
          { id: `${note.id}:link`, source: note.id, target: note.target, dashed: true },
          shapes,
          measure,
        );
    attachEnds(scene);
    straightenScene(scene);
    // Generalizations (and realizations) of one parent share one triangle.
    const trees = new Map<string, { parent: string; wires: string[] }>();
    for (const relation of diagram.relations) {
      const atStart = relation.startMarker === "triangle",
        atEnd = relation.endMarker === "triangle";
      if (atStart === atEnd || relation.startLabel || relation.endLabel || relation.label) continue;
      const parent = atStart ? relation.source : relation.target,
        key = `${parent}\u0000${relation.dashed}`;
      if (!trees.has(key)) trees.set(key, { parent, wires: [] });
      trees.get(key)!.wires.push(relation.id);
    }
    mergeTrees(scene, [...trees.values()]);
    hugLabels(scene);
    placeEndLabels(scene, ends, measure);
    dodgeTitles(scene, measure);
    finishBounds(scene, measure, diagram.title);
    return scene;
  };
  // Each strategy at normal spacing, then again with more room for dense diagrams whose labels
  // found no free spot; with two or more top-level packages, also them side by side as on the TAM flyer.
  const variants: { elk: Record<string, string>; scale: number; packages?: boolean }[] = [
    ...STRATEGIES.map((elk) => ({ elk, scale: 1 })),
    ...STRATEGIES.slice(0, 2).map((elk) => ({ elk, scale: 1.6 })),
  ];
  if (roots.filter((node) => node.children?.length).length > 1)
    variants.splice(
      STRATEGIES.length,
      0,
      ...STRATEGIES.slice(0, 2).map((elk) => ({ elk, scale: 1, packages: true })),
    );
  return bestScene(build, variants);
}
