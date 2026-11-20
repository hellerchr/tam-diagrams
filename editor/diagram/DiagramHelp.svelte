<!-- The help sheets of the diagram editor (DiagramView.svelte), as the old editor's dialogs.ts had them: Keyboard and
     mouse (`?`, the bar's help button), what each key and gesture does in a diagram of the type on show
     (diagram-help.ts), and the type's syntax on one sheet (Help > TAM syntax; diagram-help-syntax.ts). Keys show as
     keycaps, gestures as words, code in the source's colors. `?` closes the Keyboard and mouse sheet again. -->
<script lang="ts">
  import { GESTURES, helpSheet, type StructureFacts } from "./diagram-help.ts";
  import { syntaxSheet } from "./diagram-help-syntax.ts";
  import type { Workbench } from "./diagram-workbench.svelte.ts";
  import DiagramDialog from "./DiagramDialog.svelte";

  let { ws, which, onclose }: { ws: Workbench; which: "help" | "syntax"; onclose: () => void } =
    $props();

  const kind = $derived(ws.pictures.kind ?? (ws.notation === "tam" ? "tam" : "class"));
  const name = $derived(ws.current?.name ?? "Block diagram");
  const facts = $derived.by((): StructureFacts | undefined => {
    const structure = ws.ed.umlEd.model?.structure;
    return (
      structure && {
        usual: structure.pieces[0]?.name ?? "part",
        links: structure.links.length,
        copy: !!structure.copy,
      }
    );
  });
  const syntax = $derived(which === "syntax" ? syntaxSheet(kind) : undefined);
  const groups = $derived(syntax?.groups ?? helpSheet(kind, name, facts));
  const title = $derived(
    which === "help"
      ? `Keyboard and mouse: ${name.toLowerCase()}`
      : kind === "tam"
        ? "TAM syntax"
        : `${name} syntax`,
  );

  function key(event: KeyboardEvent) {
    if (event.key === "?" && which === "help") {
      event.preventDefault();
      onclose();
    }
  }
</script>

<DiagramDialog {title} width={760} {onclose} onkeydown={key}>
  <div class="sheet" class:code={!!syntax}>
    {#each groups as [heading, rows] (heading)}
      <section>
        <h2>{heading}</h2>
        {#each rows as [how, does], i (i)}
          <p>
            <span class="keys">
              {#if typeof how === "string"}
                {#if syntax}<code>{how}</code>{:else}<span>{how}</span>{/if}
              {:else}
                {#each how as k, j (j)}{#if GESTURES.has(k)}<span>{k}</span>{:else}<kbd>{k}</kbd
                    >{/if}{/each}
              {/if}
            </span>
            <span>{does}</span>
          </p>
        {/each}
      </section>
    {/each}
  </div>
  {#if syntax}<p class="note">{syntax.note}</p>{/if}
</DiagramDialog>

<style>
  .sheet {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-6) var(--space-7);
    padding: var(--space-6);
  }
  .sheet.code {
    grid-template-columns: 1fr;
  }
  section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  h2 {
    margin-bottom: var(--space-1);
  }
  .sheet p {
    display: grid;
    grid-template-columns: 150px 1fr;
    align-items: baseline;
    gap: var(--space-4);
    margin: 0;
  }
  .code p {
    grid-template-columns: 290px 1fr;
  }
  .keys {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 3px;
    font-weight: var(--weight-medium);
  }
  kbd {
    min-width: 20px;
    padding: 1px var(--space-2);
    border: var(--border-width) solid color-mix(in srgb, var(--c-border) 70%, var(--c-foreground));
    border-bottom-width: 2px;
    border-radius: var(--radius-sm);
    background: var(--c-chrome);
    color: var(--c-foreground);
    font: var(--text-xs) var(--font-ui);
    text-align: center;
  }
  code {
    color: var(--syn-type);
    font-family: var(--font-code);
    font-size: var(--text-xs);
    font-variant-ligatures: none;
    white-space: pre-wrap;
  }
  .note {
    margin: 0;
    padding: 0 var(--space-6) var(--space-6);
    color: var(--c-muted);
  }
  @media (max-width: 640px) {
    .sheet {
      grid-template-columns: 1fr;
    }
    .code p {
      grid-template-columns: 1fr;
      gap: var(--space-1);
    }
  }
</style>
