/* 
#exclude
```js*/
console.log("[pen-cursor] CSS cursor script loaded");

// --- Settings, exposed via Excalidraw's script settings UI ---
let settings;

try {
  settings = ea.getScriptSettings();

  if (!settings || settings["Enable for touch"] === undefined) {
    settings = {
      "Enable for touch": {
        value: false,
        description:
          "Show the pen dot and hide the system cursor for touch/finger input too, not just pen and mouse.",
      },
    };

    ea.setScriptSettings(settings);
  }
} catch (e) {
  console.log(
    "[pen-cursor] script settings unavailable, using default:",
    e.message
  );

  settings = {
    "Enable for touch": {
      value: false,
    },
  };
}

const ACTIVE_POINTER_TYPES =
  settings["Enable for touch"].value
    ? new Set(["pen", "mouse", "touch"])
    : new Set(["pen", "mouse"]);

const DOT_TOOLS = new Set([
  "freedraw",
  "autoshape",
  "rectangle",
  "ellipse",
  "diamond",
  "arrow",
  "line",
]);

function widthFromKey(key, tool) {
  try {
    if (
      key &&
      window.ExcalidrawLib &&
      typeof ExcalidrawLib.getStrokeWidthByKey === "function"
    ) {
      const width = ExcalidrawLib.getStrokeWidthByKey(tool, key);
      if (typeof width === "number") return width;
    }
  } catch {}

  switch (key) {
    case "extraThin":
      return 0.25;
    case "thin":
      return 0.5;
    case "medium":
      return 1;
    case "bold":
      return 2;
    case "extraBold":
      return 4;
    default:
      return 1;
  }
}

function buildDotCursor(color, strokeWidth, zoom, canvasFilter) {
  const diameter = Math.max(
    1,
    strokeWidth * 3 * zoom
  );

  const margin = 4;
  const size = Math.ceil(diameter + margin * 2);

  const cx = size / 2;
  const cy = size / 2;
  const radius = diameter / 2;

  const svg = `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="${size}"
      height="${size}"
      viewBox="0 0 ${size} ${size}"
    >
      <circle
        cx="${cx}"
        cy="${cy}"
        r="${radius}"
        fill="${color}"
		style="filter:${canvasFilter}"
      />
    </svg>
  `.trim();

  const encodedSvg = encodeURIComponent(svg);

  return `url("data:image/svg+xml,${encodedSvg}") ${cx} ${cy}, crosshair`;
}

/*
 * State belonging to OUR cursor on each Excalidraw canvas.
 *
 * cursor = the currently generated CSS cursor string
 * signature = the Excalidraw state used to generate it
 */
const cursorStateByCanvas = new WeakMap();

function getCanvasForEventTarget(target) {
  if (!(target instanceof Element)) return null;

  if (target.matches(".excalidraw__canvas.interactive")) {
    return target;
  }

  const excalidraw = target.closest(".excalidraw");

  if (!excalidraw) return null;

  return excalidraw.querySelector(
    ".excalidraw__canvas.interactive"
  );
}

/*
 * Force Chromium to refresh the actual cursor.

 * This is deliberately remove → set rather than simply assigning
 * the same value again. If the browser's displayed cursor has
 * become stale after a pen proximity transition, changing the
 * inline style gives it an explicit cursor-state transition.
 */
function refreshOurCursor(canvas) {
  const state = cursorStateByCanvas.get(canvas);

  if (!state?.cursor) return;

  canvas.style.removeProperty("cursor");
  canvas.style.setProperty(
    "cursor",
    state.cursor
  );
}

/*
 * Pointer hover refresh.
 *
 * We deliberately accept BOTH pen and mouse pointer events.
 *
 * The physical touchpad does not need special handling here;
 * its browser pointer events simply refresh the same cursor.
 *
 * Capture phase is used so this happens before Excalidraw's
 * own pointer handlers get a chance to change state.
 */
function handlePointerHover(event) {
  if (
    event.pointerType !== "pen" &&
    event.pointerType !== "mouse"
  ) {
    return;
  }

  const canvas = getCanvasForEventTarget(event.target);

  if (!canvas) return;

  const state = cursorStateByCanvas.get(canvas);

  if (!state?.active || !state.cursor) return;

  refreshOurCursor(canvas);
}

document.addEventListener(
  "pointerover",
  handlePointerHover,
  true
);

document.addEventListener(
  "pointerenter",
  handlePointerHover,
  true
);

document.addEventListener(
  "pointermove",
  handlePointerHover,
  true
);

function tick() {
  try {
    const app = window.app;

    if (!app?.workspace) return;

    const leaves =
      app.workspace.getLeavesOfType("excalidraw");

    for (const leaf of leaves) {
      const view = leaf.view;
      const api = view?.excalidrawAPI;

      if (!api?.getAppState) continue;

      const state = api.getAppState();

      if (!state) continue;

      const tool = state.activeTool?.type || "";

      const canvas = (
        view.containerEl || document
      ).querySelector(
        ".excalidraw__canvas.interactive"
      );

      if (!canvas) continue;

      const active = DOT_TOOLS.has(tool);

      /*
       * Not one of our drawing tools.
       *
       * Only remove a cursor that belongs to us.
       * Excalidraw's own eraser cursor is therefore left alone.
       */
      if (!active) {
        const ours =
          cursorStateByCanvas.get(canvas);

        if (ours?.cursor &&
            canvas.style.cursor === ours.cursor) {
          canvas.style.removeProperty("cursor");
        }

        cursorStateByCanvas.delete(canvas);

        continue;
      }

      const color =
        state.currentItemStrokeColor ||
        "#1e1e1e";

      const strokeWidth =
        typeof state.currentItemStrokeWidth === "number" &&
        state.currentItemStrokeWidth > 0
          ? state.currentItemStrokeWidth
          : widthFromKey(
              state.currentItemStrokeWidthKey,
              tool
            );

      const zoom =
        typeof state.zoom?.value === "number"
          ? state.zoom.value
          : 1;

      const signature =
        `${color}|${strokeWidth}|${zoom}|${tool}`;

      const previous =
        cursorStateByCanvas.get(canvas);

      /*
       * Only regenerate the SVG when something that affects
       * its appearance has actually changed.
       */
      if (
        previous?.signature !== signature
      ) {
      
	    const canvasFilter = getComputedStyle(canvas).filter || "none";
        const cursor = buildDotCursor(
          color,
          strokeWidth,
          zoom,
          canvasFilter
        );

        cursorStateByCanvas.set(canvas, {
          active: true,
          cursor,
          signature,
        });

        canvas.style.setProperty(
          "cursor",
          cursor
        );
      } else if (
        !previous?.active ||
        canvas.style.cursor !== previous.cursor
      ) {
        /*
         * The cursor disappeared or Excalidraw changed it.
         * Restore ours without regenerating the SVG.
         */
        canvas.style.setProperty(
          "cursor",
          previous.cursor
        );
      }
    }
  } catch {
    /*
     * Excalidraw views can mount/unmount while the workspace
     * is changing. Keep the polling loop alive.
     */
  }
}

const intervalId =
  window.setInterval(tick, 150);

tick();

/*
 * Excalidraw Automate cleanup.
 */
try {
  const eaGlobal =
    window.ExcalidrawAutomate ||
    window.app?.plugins?.plugins?.[
      "obsidian-excalidraw-plugin"
    ]?.ea;

  if (
    eaGlobal &&
    typeof eaGlobal.registerCleanup ===
      "function"
  ) {
    eaGlobal.registerCleanup(() => {
      window.clearInterval(intervalId);

      document.removeEventListener(
        "pointerover",
        handlePointerHover,
        true
      );

      document.removeEventListener(
        "pointerenter",
        handlePointerHover,
        true
      );

      document.removeEventListener(
        "pointermove",
        handlePointerHover,
        true
      );
    });
  }
} catch {}

console.log(
  "[pen-cursor] CSS cursor active, interval:",
  intervalId
);

new Notice("Pen dot cursor active");

// Register this script for autostart
try {
  const autostartStatus = await ea.registerAutostart(
    "Automatically start the Pen Dot Cursor whenever an Excalidraw drawing opens."
  );

  console.log(
    "[pen-cursor] autostart status:",
    autostartStatus
  );
} catch (e) {
  console.error(
    "[pen-cursor] failed to register autostart:",
    e
  );
}
