<!-- A Lucide icon from its node data: `import { Plus } from "lucide"`, then <Icon icon={Plus} />. Its paths are markup
     built once per icon, so an icon mounts as one element and one string (no effect per path). -->
<script lang="ts" module>
  import type { IconNode } from "lucide";

  const markup = new WeakMap<IconNode, string>();
  function svgOf(icon: IconNode) {
    let found = markup.get(icon);
    if (found === undefined) {
      found = icon
        .map(
          ([tag, attrs]) =>
            `<${tag}${Object.entries(attrs)
              .map(([k, v]) => ` ${k}="${v}"`)
              .join("")}/>`,
        )
        .join("");
      markup.set(icon, found);
    }
    return found;
  }
</script>

<script lang="ts">
  let {
    icon,
    size = 16,
    class: className = "",
  }: { icon: IconNode; size?: number; class?: string } = $props();
</script>

<svg
  class="icon {className}"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.75"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {@html svgOf(icon)}
</svg>

<style>
  .icon {
    flex: none;
    display: block;
  }
</style>
