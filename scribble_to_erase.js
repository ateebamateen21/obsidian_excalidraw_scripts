// ============================================================
// SCRIBBLE TO ERASE (statistical signature, no $1)
// ============================================================

const el = ea.targetView.containerEl;

if (window.__scribbleEraser) {
  const old = window.__scribbleEraser;
  ["pointerdown", "pointermove", "pointerup"].forEach((t) =>
    old.el.removeEventListener(t, old.handler, true),
  );
  window.__scribbleEraser = null;
  new Notice("Scribble eraser off");
  return;
}

// ============================================================
// TUNING
// ============================================================
const SCRIBBLE = {
  minPoints: 20, // fewer points = probably not a scribble
  minDiagonal: 10, // too small to mean anything
  pathOverBbox: 5, // path length / bbox diagonal — scribbles are high
  netOverPath: 0.3, // net displacement / path length — scribbles are low
  proximity: 10, // how close (px) scribble must pass to a stroke
};

// ============================================================
// DETECTOR
// ============================================================
function isScribble(el) {
  const pts = el.points;
  if (!pts || pts.length < SCRIBBLE.minPoints) return false;

  let path = 0;
  for (let i = 1; i < pts.length; i++) {
    path += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }

  const net = Math.hypot(
    pts[pts.length - 1][0] - pts[0][0],
    pts[pts.length - 1][1] - pts[0][1],
  );

  const diag = Math.hypot(el.width, el.height);
  if (diag < SCRIBBLE.minDiagonal) return false;

  const pathOverBbox = path / diag;
  const netOverPath = net / path;

  return (
    pathOverBbox > SCRIBBLE.pathOverBbox && netOverPath < SCRIBBLE.netOverPath
  );
}

// Function to check whether the scribble line intersects with the strokes below it and only erase the intersecting strokes instead of BBOX strategy
function polylineDistance(p1, p2) {
  // minimum distance between two polylines
  let min = Infinity;
  for (const a of p1) {
    for (const b of p2) {
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (d < min) min = d;
    }
  }
  return min;
}

// ============================================================
// STATE + HANDLER
// ============================================================
const state = {
  down: false,
  idsBefore: new Set(),
};

const handler = (e) => {
  if (e.pointerType !== "pen") return;

  if (e.type === "pointerdown") {
    state.down = true;
    try {
      state.idsBefore = new Set(ea.getViewElements().map((el) => el.id));
    } catch (_) {
      state.idsBefore = new Set();
    }
    return;
  }

  if (e.type === "pointerup") {
    if (!state.down) return;
    state.down = false;

    setTimeout(async () => {
      try {
        const all = ea.getViewElements();
        const newEls = all.filter((el) => !state.idsBefore.has(el.id));
        if (newEls.length === 0) return;

        const last = newEls.find((el) => el.type === "freedraw");
        if (!last) return;
        const scribblePath = last.points.map((p) => [
          last.x + p[0],
          last.y + p[1],
        ]);

        // Debug info
        const pts = last.points || [];
        let path = 0;
        for (let i = 1; i < pts.length; i++) {
          path += Math.hypot(
            pts[i][0] - pts[i - 1][0],
            pts[i][1] - pts[i - 1][1],
          );
        }
        const net = pts.length
          ? Math.hypot(
              pts[pts.length - 1][0] - pts[0][0],
              pts[pts.length - 1][1] - pts[0][1],
            )
          : 0;
        const diag = Math.hypot(last.width, last.height);
        const ratio = diag > 0 ? path / diag : 0;
        const netRatio = path > 0 ? net / path : 1;

        console.log("[scribble-check]", {
          points: pts.length,
          path: Math.round(path),
          net: Math.round(net),
          diag: Math.round(diag),
          pathOverBbox: +ratio.toFixed(2),
          netOverPath: +netRatio.toFixed(2),
          verdict: isScribble(last) ? "SCRIBBLE" : "not scribble",
        });

        if (!isScribble(last)) return;

        // --- SCRIBBLE DETECTED ---
        const sx = last.x;
        const sy = last.y;
        const sw = last.width;
        const sh = last.height;

        // Find overlapping freedraw/text elements
        // const toDelete = all.filter((el2) => {
        //   if (el2.id === last.id) return false;
        //   if (el2.type === "frame") return false; // don't delete frames

        //   const overlapX = el2.x < sx + sw && el2.x + el2.width > sx;
        //   const overlapY = el2.y < sy + sh && el2.y + el2.height > sy;
        //   return overlapX && overlapY;
        // });

        // const toDelete = all.filter((el2) => {
        //   if (el2.id === last.id) return false;
        //   if (el2.type === "frame") return false;

        //   const cx = el2.x + el2.width / 2;
        //   const cy = el2.y + el2.height / 2;

        //   const insideX = cx >= sx && cx <= sx + sw;
        //   const insideY = cy >= sy && cy <= sy + sh;
        //   return insideX && insideY;
        // });

        // the intersecting points way of deletion
        const toDelete = all.filter((el2) => {
          if (el2.id === last.id) return false;
          if (el2.type === "frame") return false;
          if (!el2.points) return false;

          // --- cheap bbox pre-filter ---
          const scribLeft = last.x - SCRIBBLE.proximity;
          const scribRight = last.x + last.width + SCRIBBLE.proximity;
          const scribTop = last.y - SCRIBBLE.proximity;
          const scribBottom = last.y + last.height + SCRIBBLE.proximity;

          const elLeft = el2.x;
          const elRight = el2.x + el2.width;
          const elTop = el2.y;
          const elBottom = el2.y + el2.height;

          const bboxOverlap =
            elLeft < scribRight &&
            elRight > scribLeft &&
            elTop < scribBottom &&
            elBottom > scribTop;

          if (!bboxOverlap) return false; // reject cheaply — skip the expensive test

          // --- expensive polyline proximity test ---
          const elPath = el2.points.map((p) => [el2.x + p[0], el2.y + p[1]]);
          const distance = polylineDistance(scribblePath, elPath);
          return distance < SCRIBBLE.proximity;
        });

        if (toDelete.length === 0) {
          new Notice("Scribble — nothing under it");
          return;
        }

        // Delete scribble
        await ea.deleteViewElements([last, ...toDelete]);

        new Notice(`Scribbled ${1 + toDelete.length} element(s)`);
      } catch (err) {
        console.error("[scribble-error]", err);
        new Notice("Scribble erase failed — see console");
      }
    }, 50);
  }
};

["pointerdown", "pointermove", "pointerup"].forEach((t) =>
  el.addEventListener(t, handler, true),
);

window.__scribbleEraser = { el, handler, state };
new Notice("Scribble eraser on");

// ------ Register this script for autostart ------
try {
  const autostartStatus = await ea.registerAutostart(
    "Automatically start the Scribble to Erase Script whenever an Excalidraw drawing opens.",
  );

  console.log("[scribble-to-erase] autostart status:", autostartStatus);
} catch (e) {
  console.error("[scribble-to-erase] failed to register autostart:", e);
}
