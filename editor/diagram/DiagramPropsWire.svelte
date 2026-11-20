<!-- The Properties of one connection of a block diagram (DiagramProperties.svelte), as tam-diagrams' old inspector had
     them: its kind (the plain ones its ends take, and its own), the ids it joins, both ways where it goes so or may;
     its label, which side of its line the label stands on (above or below, left or right: mirrored across it), and the
     protocol of a channel (a dependency's keyword is its kind; a note's line says nothing); turning it
     round where it may go so, and deleting it. A provided or required interface's line has only its removal. Each
     change is one edit of the source. -->
<script lang="ts">
  import Button from "../ui/Button.svelte";
  import type { Model } from "./diagram-edit.ts";
  import { ICONS } from "./diagram-icons.ts";
  import type { Kit } from "./diagram-props-kit.ts";
  import type { Workbench } from "./diagram-workbench.svelte.ts";
  import DiagramPropsChoice from "./DiagramPropsChoice.svelte";
  import DiagramPropsGroup from "./DiagramPropsGroup.svelte";
  import { labelSide } from "./diagram-labels.ts";
  import DiagramPropsRow from "./DiagramPropsRow.svelte";
  import DiagramPropsSegments from "./DiagramPropsSegments.svelte";
  import DiagramPropsSubject from "./DiagramPropsSubject.svelte";
  import DiagramPropsText from "./DiagramPropsText.svelte";

  let { ws, P, m, id }: { ws: Workbench; P: Kit; m: Model; id: string } = $props();
  const ed = $derived(ws.ed);
  const layout = $derived(ws.layout);

  const connection = $derived(P.connectionAt(m.source, id));
  const value = $derived(connection ? P.wireValue(connection) : "");
  const kinds = $derived(P.wireKinds(m.source, id));
  const fields = $derived(connection && P.wireFields(m.source, id, connection));
  const set = (change: Parameters<typeof P.wireWith>[2]) =>
    ed.apply((model) => P.wireWith(model.source, id, change));
  /** Where the label stands now, from the picture: its side of the line, and where the other side is. */
  const placed = $derived.by(() => {
    const label = m.hits.wires.find(
      (wire) => wire.id.replace(/#\d+$/, "") === id && wire.label,
    )?.label;
    return label && labelSide(label);
  });
  const across = $derived(placed?.side === "above" || placed?.side === "below");
  const sides = $derived(
    across
      ? [
          { value: "above", name: "Above", tip: "The label over its line" },
          { value: "below", name: "Below", tip: "The label under its line" },
        ]
      : [
          { value: "left", name: "Left", tip: "The label left of its line" },
          { value: "right", name: "Right", tip: "The label right of its line" },
        ],
  );
  /** The label to the other side of its line, mirrored across it. */
  const flip = (side: string) =>
    !!placed &&
    side !== placed.side &&
    ed.apply((model, edits) => edits.labelMoved(model, id, placed.flipped));
  const pick = (kind: string) => {
    const wire = P.WIRES.find((w) => w.value === kind);
    return !!wire && set(wire.change);
  };
</script>

{#if connection && fields}
  <DiagramPropsSubject icon={ICONS.connect} title="Connection" />
  <DiagramPropsGroup title="Identity" {layout}>
    <DiagramPropsRow label="Kind">
      <DiagramPropsChoice options={kinds} {value} onpick={pick} />
    </DiagramPropsRow>
    <DiagramPropsRow label="From" tag="div"
      ><code class="id">{connection.from}</code></DiagramPropsRow
    >
    <DiagramPropsRow label="To" tag="div"><code class="id">{connection.to}</code></DiagramPropsRow>
    {#if fields.both}
      <DiagramPropsRow label="Both ways" check>
        <input
          type="checkbox"
          checked={connection.both}
          onchange={(e) => set({ both: e.currentTarget.checked })}
        />
      </DiagramPropsRow>
    {/if}
  </DiagramPropsGroup>
  {#if fields.text}
    <DiagramPropsGroup title="Text" {layout}>
      {#key id}
        {#if fields.label}
          <DiagramPropsRow label="Label">
            <DiagramPropsText
              multiline
              placeholder="What is sent or asked"
              value={(connection.label ?? "").replace(/<br\s*\/?>/gi, "\n")}
              oncommit={(label) => set({ label })}
            />
          </DiagramPropsRow>
          {#if placed}
            <DiagramPropsRow label="Stands" tag="div">
              <DiagramPropsSegments options={sides} value={placed.side} onpick={flip} />
            </DiagramPropsRow>
          {/if}
        {/if}
        {#if fields.protocol}
          <DiagramPropsRow label="Protocol">
            <DiagramPropsText
              placeholder="HTTPS, RFC, …"
              value={connection.protocol ?? ""}
              oncommit={(protocol) => set({ protocol })}
            />
          </DiagramPropsRow>
        {/if}
      {/key}
    </DiagramPropsGroup>
  {/if}
  <div class="actions end">
    <Button
      disabled={!fields.reverse}
      title={fields.reverse ? undefined : "This connection only goes this way"}
      onclick={() => set({ reverse: true })}
    >
      Reverse
    </Button>
    <Button variant="danger" onclick={ed.remove}>Delete</Button>
  </div>
{:else}
  <DiagramPropsSubject icon={ICONS.link} title="Interface" />
  <p class="note">A provided or required interface of an element. Its name is set in the source.</p>
  <div class="actions end"><Button variant="danger" onclick={ed.remove}>Delete</Button></div>
{/if}
