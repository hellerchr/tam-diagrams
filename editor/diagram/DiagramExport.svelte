<!-- The export dialog of the diagram on show (DiagramView's toolbar; loaded when first opened): SVG, PNG at 1 to 3 pixels
     per unit, or a draw.io file (src/drawio.ts, its own chunk). A picture is in the light colors on white or on
     nothing, or in the theme's colors on its page; a preview shows it. It downloads, named after the source
     (order.tam → order.svg), or goes to the clipboard. The choices last until the page reloads. -->
<script lang="ts" module>
  import type { Backdrop, Format } from "./diagram-export.ts";

  const last = { format: "svg" as Format, scale: 2, backdrop: "white" as Backdrop };
</script>

<script lang="ts">
  import { Copy } from "lucide";
  import { colors, type Picture } from "../lib/diagrams.ts";
  import { basename } from "../lib/format.ts";
  import { toast } from "../lib/overlays.svelte.ts";
  import { errorText } from "../shared/errors.ts";
  import Button from "../ui/Button.svelte";
  import Dialog from "../ui/Dialog.svelte";
  import Segmented from "../ui/Segmented.svelte";
  import { exportedPicture, type Exported } from "./diagram-export.ts";
  import { besidePath, stemOf } from "./diagram-files.ts";

  type Props = {
    /** The name of the source's file, which the export is named after. */
    path: string;
    picture: Picture;
    /** The format it opens with (File > Export PNG…); else the last one chosen. */
    format?: Format;
    onclose: () => void;
  };
  let { path, picture, format: asked, onclose }: Props = $props();

  const FORMATS = [
    { value: "svg", label: "SVG" },
    { value: "png", label: "PNG" },
    {
      value: "drawio",
      label: "draw.io",
      title: "A .drawio file, drawn with the TAMshapes shapes; it opens in draw.io",
    },
  ] as const;
  const SCALES = [1, 2, 3].map((n) => ({
    value: String(n),
    label: `${n}×`,
    title: `${n} pixels per unit`,
  }));
  const BACKDROPS = [
    { value: "white", label: "White", title: "Light colors on white" },
    { value: "none", label: "None", title: "Light colors on nothing (transparent)" },
    { value: "theme", label: "Theme", title: "The theme's colors on its page color" },
  ] as const;

  // svelte-ignore state_referenced_locally: the format it opens with; the person changes it from there.
  let format = $state(asked ?? last.format);
  let scale = $state(last.scale);
  let backdrop = $state(last.backdrop);
  let busy = $state(false);
  $effect(() => void Object.assign(last, { format, scale, backdrop }));

  const name = $derived(basename(stemOf(path)));
  const drawn = $derived<Exported>(exportedPicture(picture.scene, backdrop, colors(), name));
  const preview = $derived(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(drawn.svg)}`);
  const target = $derived(besidePath(path, format));
  const MIME: Record<Format, string> = {
    svg: "image/svg+xml",
    png: "image/png",
    drawio: "application/vnd.jgraph.mxfile",
  };

  /** The picture drawn on a canvas at the scale, as PNG. */
  async function png(): Promise<Blob> {
    const image = new Image();
    image.src = preview;
    await image.decode();
    const sheet = document.createElement("canvas");
    sheet.width = Math.ceil(drawn.width * scale);
    sheet.height = Math.ceil(drawn.height * scale);
    sheet.getContext("2d")!.drawImage(image, 0, 0, sheet.width, sheet.height);
    return new Promise((done, fail) =>
      sheet.toBlob(
        (blob) => (blob ? done(blob) : fail(new Error("The picture is too large for a PNG."))),
        "image/png",
      ),
    );
  }

  /** The draw.io file of the source, laid out as on show. */
  async function drawio(): Promise<string> {
    const { exportDrawio } = await import("../../src/drawio.ts");
    return exportDrawio(picture.source, { scene: picture.scene, rounded: !!picture.scene.rounded });
  }

  const text = () => (format === "drawio" ? drawio() : Promise.resolve(drawn.svg));
  const blob = async () =>
    format === "png" ? png() : new Blob([await text()], { type: MIME[format] });

  /** Runs an export, then closes with what it did; a failure is said, and the dialog stays (also when `work` says
   *  nothing). */
  async function run(work: () => Promise<string | undefined>) {
    busy = true;
    try {
      const done = await work();
      if (!done) return;
      toast(done);
      onclose();
    } catch (error) {
      toast(errorText(error), "error");
    } finally {
      busy = false;
    }
  }

  async function download() {
    const url = URL.createObjectURL(await blob());
    const link = Object.assign(document.createElement("a"), {
      href: url,
      download: basename(target),
    });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return `Downloaded ${basename(target)}`;
  }

  async function copy() {
    if (format === "png")
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png() })]);
    else await navigator.clipboard.writeText(await text());
    return `Copied the ${format === "drawio" ? "draw.io file" : format.toUpperCase()}`;
  }
</script>

<Dialog
  title="Export diagram"
  submit="Download"
  disabled={busy}
  onsubmit={() => void run(download)}
  {onclose}
>
  <div class="options">
    <Segmented options={FORMATS} value={format} onselect={(value) => (format = value)} />
    {#if format !== "drawio"}
      <Segmented options={BACKDROPS} value={backdrop} onselect={(value) => (backdrop = value)} />
    {/if}
    {#if format === "png"}
      <Segmented
        options={SCALES}
        value={String(scale)}
        onselect={(value) => (scale = Number(value))}
      />
    {/if}
  </div>
  {#if format === "drawio"}
    <p class="meta">
      Laid out as on show and drawn with the TAMshapes shapes of draw.io; it opens there and comes
      back here.
    </p>
  {:else}
    <div class="preview" class:checks={backdrop === "none"}>
      <img src={preview} alt="Preview of the export" />
    </div>
    <p class="meta">
      {Math.round(drawn.width * (format === "png" ? scale : 1))} × {Math.round(
        drawn.height * (format === "png" ? scale : 1),
      )} px
    </p>
  {/if}
  <div class="actions">
    <Button size="sm" icon={Copy} disabled={busy} onclick={() => void run(copy)}>Copy</Button>
  </div>
</Dialog>

<style>
  .options,
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }
  .preview {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 240px;
    padding: var(--space-3);
    border: var(--border-width) solid var(--c-border);
    border-radius: var(--radius-md);
  }
  .checks {
    background: repeating-conic-gradient(var(--c-hover) 0 25%, transparent 0 50%) 0 0 / 16px 16px;
  }
  img {
    max-width: 100%;
    max-height: 100%;
  }
  p {
    margin: 0;
  }
</style>
