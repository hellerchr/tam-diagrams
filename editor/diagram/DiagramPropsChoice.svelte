<!-- A list to choose one of in the diagram's Properties (DiagramProperties.svelte), as tam-diagrams' old inspector had
     it: a native select offering what the notation allows here and what is set; elements that differ show `none`
     ("Mixed"), as does a value that is none of the list. -->
<script lang="ts" generics="V extends string">
  type Option = { value: V; name: string };
  type Props = {
    options: readonly Option[];
    value: V | "";
    none?: string;
    label?: string;
    onpick: (value: V) => unknown;
  };
  let { options, value, none = "Mixed", label, onpick }: Props = $props();
</script>

<select
  class="field"
  aria-label={label}
  {value}
  onchange={(e) => value !== e.currentTarget.value && onpick(e.currentTarget.value as V)}
>
  {#if value === ""}<option value="" disabled>{none}</option>{/if}
  {#each options as option (option.value)}
    <option value={option.value}>{option.name}</option>
  {/each}
</select>
