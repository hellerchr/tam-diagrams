<!-- A text field of the diagram's Properties (DiagramProperties.svelte), as tam-diagrams' old inspector had it: typing
     changes nothing until Enter or leaving the field takes it, as one edit of the source (so a name never lays the
     diagram out per key); Escape puts back what it showed. What was taken shows until the new source says it (its
     picture takes a moment). A field of several lines is one line high and grows with its lines, which Shift+Enter
     types; in a `list` (one entry a line) Enter types them, and Ctrl/Cmd+Enter or leaving the field takes it. -->
<script lang="ts">
  type Props = {
    value: string;
    placeholder?: string;
    multiline?: boolean;
    list?: boolean;
    label?: string;
    inputmode?: "decimal";
    oncommit: (value: string) => unknown;
  };
  let {
    value,
    placeholder = "",
    multiline = false,
    list = false,
    label,
    inputmode,
    oncommit,
  }: Props = $props();

  /** What is typed, while the field has the focus; else it shows `value`. */
  let draft = $state<string>();
  /** What was taken, until `value` changes; an edit refused (false) is dropped. */
  let committed = $state<string>();
  const shown = $derived(draft ?? committed ?? value);
  $effect(() => {
    void value;
    committed = undefined;
  });

  function commit() {
    if (draft !== undefined && draft !== value && oncommit(draft) !== false) committed = draft;
    draft = undefined;
  }

  function key(e: KeyboardEvent & { currentTarget: HTMLInputElement | HTMLTextAreaElement }) {
    if (e.key === "Enter") {
      const line = (list && !e.ctrlKey && !e.metaKey) || (multiline && e.shiftKey);
      if (line) return;
      e.preventDefault();
      e.currentTarget.blur();
    } else if (e.key === "Escape") {
      draft = undefined;
      e.currentTarget.blur();
    }
  }
</script>

{#if multiline || list}
  <textarea
    class="field"
    rows={(shown || placeholder).split("\n").length}
    aria-label={label}
    {placeholder}
    spellcheck="false"
    value={shown}
    oninput={(e) => (draft = e.currentTarget.value)}
    onkeydown={key}
    onblur={commit}
  ></textarea>
{:else}
  <input
    class="field"
    type="text"
    aria-label={label}
    {placeholder}
    {inputmode}
    spellcheck="false"
    value={shown}
    oninput={(e) => (draft = e.currentTarget.value)}
    onkeydown={key}
    onblur={commit}
  />
{/if}
