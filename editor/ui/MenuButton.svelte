<!-- A button that opens a menu: its label and a chevron. `items` is read when the menu opens; `open()`
     opens it from elsewhere (a shortcut). A mouse opens it on press, as a native menu; a key opens it with the first
     row highlighted. `expanded` is bound while the menu is open. -->
<script lang="ts">
  import type { IconNode } from "lucide";
  import { type MenuEntry, openMenu } from "../lib/overlays.svelte.ts";
  import Button from "./Button.svelte";

  type Props = {
    label: string;
    items: () => MenuEntry[];
    variant?: "default" | "primary" | "ghost";
    size?: "sm" | "md";
    icon?: IconNode;
    expanded?: boolean;
    title?: string;
    id?: string;
    class?: string;
  };
  let { label, items, size = "sm", expanded = $bindable(false), ...rest }: Props = $props();
  let element = $state<HTMLButtonElement>();

  export const open = (first = false) => {
    if (!element) return;
    openMenu(element, items(), { first, closed: () => (expanded = false) });
    expanded = true;
  };

  /** The last press was the mouse's: the menu opened then, and the click after it is not another. */
  let byMouse = false;

  function press(e: PointerEvent) {
    byMouse = e.pointerType === "mouse" && e.button === 0;
    if (!byMouse) return;
    e.preventDefault();
    open();
  }

  function click(e: MouseEvent) {
    if (e.detail === 0) open(true);
    else if (!byMouse) open();
  }
</script>

<Button
  {size}
  menu
  bind:element
  {...rest}
  aria-haspopup="menu"
  aria-expanded={expanded}
  onpointerdown={press}
  onclick={click}>{label}</Button
>
