<!-- The Properties of one join of a Mermaid UML diagram (DiagramProperties.svelte), as tam-diagrams' old inspector had
     them: its kind (the kinds of join its type has; "Other" for a relationship whose cardinalities are no usual pair),
     its label where its kind has one, a class relation's multiplicities, an ER relationship's cardinalities and whether
     it identifies; turning it round, a sequence message's reply and activation, and deleting it. Each change is one
     edit of the source through the UML editor. -->
<script lang="ts">
  import Button from "../ui/Button.svelte";
  import { ICONS } from "./diagram-icons.ts";
  import type { Kit } from "./diagram-props-kit.ts";
  import type { UmlModel } from "./diagram-uml-model.ts";
  import type { Workbench } from "./diagram-workbench.svelte.ts";
  import DiagramPropsChoice from "./DiagramPropsChoice.svelte";
  import DiagramPropsGroup from "./DiagramPropsGroup.svelte";
  import DiagramPropsRow from "./DiagramPropsRow.svelte";
  import DiagramPropsSubject from "./DiagramPropsSubject.svelte";
  import DiagramPropsText from "./DiagramPropsText.svelte";

  let { ws, P, m, id }: { ws: Workbench; P: Kit; m: UmlModel; id: string } = $props();
  const uml = $derived(ws.ed.umlEd);
  const part = $derived({ type: "wire" as const, id });
  const ENDS = [
    ["from", "At source"],
    ["to", "At target"],
  ] as const;
  const kinds = $derived(P.joinKinds(m, id));
  const labelled = $derived(uml.nameable(part));
  const multiplicities = $derived(P.tried(() => P.multiplicities(m, id)));
  const cardinalities = $derived(P.tried(() => P.cardinalities(m, id)));
  const sequence = $derived(m.kind === "sequence");
</script>

<DiagramPropsSubject icon={ICONS.connect} title="Connection" />
{#key id}
  <DiagramPropsGroup title="Identity" layout={ws.layout}>
    {#if kinds}
      <DiagramPropsRow label="Kind">
        <DiagramPropsChoice
          options={kinds.kinds}
          value={kinds.value}
          none="Other"
          onpick={(kind) => uml.relink(id, kind)}
        />
      </DiagramPropsRow>
    {/if}
    {#if labelled}
      <DiagramPropsRow label="Label">
        <DiagramPropsText
          multiline
          placeholder="What it says"
          value={uml.labelOf(part).replace(/<br\s*\/?>/gi, "\n")}
          oncommit={(label) => uml.rename(part, label)}
        />
      </DiagramPropsRow>
    {/if}
    {#if multiplicities}
      {#each ENDS as [end, label] (end)}
        <DiagramPropsRow {label}>
          <DiagramPropsText
            placeholder="1, 0..1, *"
            value={multiplicities[end]}
            oncommit={(text) => uml.apply((model) => P.withMultiplicity(model, id, end, text))}
          />
        </DiagramPropsRow>
      {/each}
    {/if}
    {#if cardinalities}
      {#each ENDS as [end, label] (end)}
        <DiagramPropsRow {label}>
          <DiagramPropsChoice
            options={P.CARDINALITIES}
            value={cardinalities[end]}
            onpick={(c) => uml.apply((model) => P.withCardinality(model, id, end, c))}
          />
        </DiagramPropsRow>
      {/each}
      <DiagramPropsRow
        label="Identifying"
        check
        title="Identifying relationship, a solid line: the target entity type is existence-dependent on the source"
      >
        <input
          type="checkbox"
          checked={cardinalities.identifying}
          onchange={(e) =>
            uml.apply((model) => P.withIdentifying(model, id, e.currentTarget.checked))}
        />
      </DiagramPropsRow>
    {/if}
  </DiagramPropsGroup>
{/key}
<div class="actions end">
  {#if uml.can("reverse")}<Button onclick={() => uml.reverse(id)}>Reverse</Button>{/if}
  {#if sequence}
    <Button onclick={() => uml.apply((model) => P.withReply(model, id))}>Reply</Button>
    <Button onclick={() => uml.apply((model) => P.withActivation(model, id))}>Activation</Button>
  {/if}
  <Button variant="danger" onclick={ws.ed.remove}>Delete</Button>
</div>
