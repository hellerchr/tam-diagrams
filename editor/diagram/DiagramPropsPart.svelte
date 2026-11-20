<!-- The Properties of one part of a Mermaid UML diagram (DiagramProperties.svelte), as tam-diagrams' old inspector had
     them: its name and id (an id to change where the type renames it at every mention), what its type adds (a class's
     stereotype and members, a state's description, an entity's attributes; a list takes one entry a line), and
     duplicating, ungrouping or deleting it. Each change is one edit of the source through the UML editor. -->
<script lang="ts">
  import Button from "../ui/Button.svelte";
  import type { Kit } from "./diagram-props-kit.ts";
  import { pieceIcon } from "./diagram-uml-icons.ts";
  import type { UmlModel } from "./diagram-uml-model.ts";
  import type { Workbench } from "./diagram-workbench.svelte.ts";
  import DiagramPropsGroup from "./DiagramPropsGroup.svelte";
  import DiagramPropsRow from "./DiagramPropsRow.svelte";
  import DiagramPropsSubject from "./DiagramPropsSubject.svelte";
  import DiagramPropsText from "./DiagramPropsText.svelte";

  let { ws, P, m, id }: { ws: Workbench; P: Kit; m: UmlModel; id: string } = $props();
  const uml = $derived(ws.ed.umlEd);
  const layout = $derived(ws.layout);
  const part = $derived({ type: "element" as const, id });
  const node = $derived(m.parts.get(id));
  const kind = $derived(node?.kind ?? "");
  const nameable = $derived(uml.nameable(part));
  const members = $derived(P.tried(() => uml.edits?.membersOf(m, id)));
  const attributes = $derived(
    kind === "entity" ? P.tried(() => uml.edits?.attributesOf(m, id)) : undefined,
  );
  const stereotype = $derived(
    m.kind === "class" && members ? P.tried(() => P.stereotypeOf(m, id)) : undefined,
  );
  const does = $derived(
    m.kind === "state" && kind === "state" ? P.tried(() => P.doesOf(m, id)) : undefined,
  );
  const lines = (text: string) =>
    text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
</script>

<DiagramPropsSubject icon={pieceIcon(kind)} title={P.pieceName(m, id) ?? "Part"} />
{#key id}
  <DiagramPropsGroup title="Identity" {layout}>
    {#if nameable}
      <DiagramPropsRow label="Name">
        <DiagramPropsText
          multiline
          placeholder="Name"
          value={uml.labelOf(part).replace(/<br\s*\/?>/gi, "\n")}
          oncommit={(label) => uml.rename(part, label)}
        />
      </DiagramPropsRow>
    {/if}
    {#if uml.can("reid") && nameable}
      <DiagramPropsRow label="Id">
        <DiagramPropsText value={P.shownId(id)} oncommit={(next) => uml.reid(id, next)} />
      </DiagramPropsRow>
    {:else}
      <DiagramPropsRow label="Id" tag="div"><code class="id">{P.shownId(id)}</code></DiagramPropsRow
      >
    {/if}
    {#if stereotype !== undefined}
      <DiagramPropsRow label="Stereotype">
        <DiagramPropsText
          placeholder="interface, abstract, …"
          value={stereotype}
          oncommit={(text) => uml.apply((model) => P.withStereotype(model, id, text))}
        />
      </DiagramPropsRow>
    {/if}
    {#if does !== undefined}
      <DiagramPropsRow label="Does">
        <DiagramPropsText
          multiline
          placeholder="entry / do something"
          value={does}
          oncommit={(text) => uml.apply((model) => P.withDoes(model, id, text))}
        />
      </DiagramPropsRow>
    {/if}
  </DiagramPropsGroup>
  {#if members}
    <DiagramPropsGroup title="Members" {layout}>
      <DiagramPropsText
        list
        label="Members"
        placeholder={"+name: type\n+method()"}
        value={members.join("\n")}
        oncommit={(text) => uml.apply((model, edits) => edits.withMembers(model, id, lines(text)))}
      />
    </DiagramPropsGroup>
  {/if}
  {#if attributes}
    <DiagramPropsGroup title="Attributes" {layout}>
      <DiagramPropsText
        list
        label="Attributes"
        placeholder={'int id PK\nstring name "a comment"'}
        value={attributes.join("\n")}
        oncommit={(text) =>
          uml.apply((model, edits) => edits.withAttributes(model, id, lines(text)))}
      />
    </DiagramPropsGroup>
  {/if}
{/key}
<p class="note">
  Click a shape on the left to add it at this one, or drag a dot beside it to another.
</p>
<div class="actions end">
  {#if uml.can("copy") && !node?.group}<Button onclick={ws.ed.duplicate}>Duplicate</Button>{/if}
  {#if uml.can("ungroup") && node?.group}<Button onclick={() => uml.ungroup(id)}>Ungroup</Button
    >{/if}
  <Button variant="danger" onclick={ws.ed.remove}>Delete</Button>
</div>
