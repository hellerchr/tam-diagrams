<!-- The diagram's own Properties (DiagramProperties.svelte), while nothing is selected, as tam-diagrams' old inspector
     had them: its title and whether it is drawn, the corners of its connections, and the direction, level and numbered messages its type has (a level the diagram refuses is
     off, its tooltip saying why). A UML diagram edited by its structure (`structural`) adds what it is and how to edit
     it; one edited as text says that. While the source does not read, what it said last stays. -->
<script lang="ts">
  import { ICONS } from "./diagram-icons.ts";
  import type { Header, HeaderChange } from "./diagram-props.ts";
  import type { Kit } from "./diagram-props-kit.ts";
  import { typeOf } from "./diagram-types.ts";
  import type { Workbench } from "./diagram-workbench.svelte.ts";
  import DiagramPropsGroup from "./DiagramPropsGroup.svelte";
  import DiagramPropsRow from "./DiagramPropsRow.svelte";
  import DiagramPropsSegments from "./DiagramPropsSegments.svelte";
  import DiagramPropsSubject from "./DiagramPropsSubject.svelte";
  import DiagramPropsText from "./DiagramPropsText.svelte";

  let { ws, P, structural = false }: { ws: Workbench; P: Kit; structural?: boolean } = $props();
  const layout = $derived(ws.layout);

  let kept: Header | undefined;
  const header = $derived.by(() => {
    const read = P.headerOf(ws.source, ws.notation);
    if (read) return (kept = read);
    return kept && (kept.kind === "tam") === (ws.notation === "tam") ? kept : undefined;
  });
  const type = $derived(header && typeOf(header.kind));
  const levels = $derived(header && header.kind !== "tam" ? P.LEVELS[header.kind] : undefined);

  /** Changes the diagram's settings, as one edit; a UML diagram placed by hand turns its places with its direction. */
  const setHeader = (change: HeaderChange) =>
    ws.ed.amend((text, picture) =>
      P.withHeader(
        text,
        ws.notation,
        change,
        new Map(picture?.scene.shapes.map((shape) => [shape.id, shape.box])),
      ),
    );
  const refusal = (change: HeaderChange) => P.headerRefusal(ws.source, ws.notation, change);
</script>

{#if header}
  {#if header.kind === "tam"}
    <DiagramPropsSubject icon={ICONS.logo} title="Diagram" />
  {:else}
    <DiagramPropsSubject icon={ICONS[header.kind]} title="Diagram" detail={type?.name} />
  {/if}
  <DiagramPropsGroup title="Identity" {layout}>
    <DiagramPropsRow label="Title">
      <DiagramPropsText
        value={header.title}
        placeholder="Untitled"
        oncommit={(title) => setHeader({ title: title.trim() })}
      />
    </DiagramPropsRow>
    <DiagramPropsRow
      label="Show title"
      check
      title="Draws the title above the diagram; off, it still names it: `%% @title hidden`"
    >
      <input
        type="checkbox"
        checked={header.titleShown}
        disabled={!header.title}
        onchange={(e) => setHeader({ titleShown: e.currentTarget.checked })}
      />
    </DiagramPropsRow>
  </DiagramPropsGroup>
  <DiagramPropsGroup title="Layout" {layout}>
    <DiagramPropsRow
      label="Corners"
      tag="div"
      title="How connections bend: square, or round (`%% @corners round`)"
    >
      <DiagramPropsSegments
        options={[
          { value: "square", name: "Square", tip: "Connections bend at right angles" },
          { value: "round", name: "Round", tip: "Connections bend round: `%% @corners round`" },
        ]}
        value={header.rounded ? "round" : "square"}
        onpick={(corners) => setHeader({ rounded: corners === "round" })}
      />
    </DiagramPropsRow>
    {#if header.has.direction}
      <DiagramPropsRow label="Direction" tag="div">
        <DiagramPropsSegments
          options={[
            { value: "TB", icon: ICONS["arrow-down"], tip: "Top to bottom" },
            { value: "LR", icon: ICONS["arrow-right"], tip: "Left to right" },
          ]}
          value={header.direction}
          onpick={(direction) => setHeader({ direction })}
        />
      </DiagramPropsRow>
    {/if}
    {#if header.has.level && levels}
      <DiagramPropsRow label="Level" tag="div">
        <DiagramPropsSegments
          options={[
            { value: "", name: "Any", tip: levels.any },
            { value: "conceptual", name: "Conceptual", tip: levels.conceptual },
            { value: "design", name: "Design", tip: levels.design },
          ]}
          value={header.level ?? ""}
          refusal={(level) => refusal({ level })}
          onpick={(level) => setHeader({ level })}
        />
      </DiagramPropsRow>
    {/if}
  </DiagramPropsGroup>
  {#if header.has.numbering}
    <DiagramPropsGroup title="Messages" {layout}>
      <DiagramPropsRow label="Numbered" check title="Numbers the messages, from 1: `autonumber`">
        <input
          type="checkbox"
          checked={!!header.numbered}
          onchange={(e) => setHeader({ numbered: e.currentTarget.checked })}
        />
      </DiagramPropsRow>
    </DiagramPropsGroup>
  {/if}
  {#if type && header.kind !== "tam"}
    <p class="note">{type.about}.</p>
    {#if structural}
      <p class="note">
        Click a shape on the left to add it, or drag it onto a part to join it there. Drag from a
        dot beside a part to connect. Double-click to name. The layout is automatic.
      </p>
    {:else if ws.textual}
      <p class="note">
        {type.name}s are edited as text: type in the source or add a snippet from the left, and the
        picture follows.
      </p>
    {/if}
  {/if}
{:else}
  <DiagramPropsSubject icon={ICONS.logo} title="Diagram" />
  <p class="note">The source does not read: fix it to change the diagram's settings.</p>
{/if}
