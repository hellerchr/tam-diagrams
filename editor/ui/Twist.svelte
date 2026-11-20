<!-- The disclosure mark of a line that unfolds: a chevron that turns down when `open`, a spinner while `busy` (its
     contents loading or streaming). -->
<script lang="ts">
  import { ChevronRight } from "lucide";
  import Icon from "./Icon.svelte";
  import Spinner from "./Spinner.svelte";

  let {
    open = false,
    busy = false,
    class: className = "",
  }: { open?: boolean; busy?: boolean; class?: string } = $props();
</script>

{#if busy}<Spinner size={11} />{:else}<Icon
    icon={ChevronRight}
    size={12}
    class="{open ? 'turned' : ''} {className}"
  />{/if}
