/*
 * Pen Snap
 *
 * I turn a rough pen stroke into a clean shape. I do it when you hold the pen
 * still at the end of the stroke and then lift it.
 *
 * I can make: straight lines, arrows, rectangles (also tilted), ellipses or
 * circles, and triangles.
 *
 * Run me once to switch me on, and run me again to switch me off.
 */

// ==== GEOMETRY START ====
// (Everything between GEOMETRY START and GEOMETRY END only does maths.
//  I never touch Excalidraw in there, so I can test it on its own.)

// ============================================================
// 1. SETTINGS: the numbers I tune by hand
// ============================================================
let HOLD_MS = 500; // how long you must hold still before I snap (milliseconds)
let JITTER_PX = 3; // pen movement smaller than this still counts as "holding still"
let CLOSED_GAP = 0.25; // I call a stroke closed if its ends are within 25% of the shape's size
let CORNER_EPS = 0.06; // how much wobble I forgive when I look for corners (fraction of size)
let TILT_SNAP_DEG = 10; // rectangles tilted less than this become perfectly upright
let AXIS_SNAP_DEG = 10; // lines and arrows within this angle of horizontal/vertical become exact
let LINE_DEVIATION = 0.07; // a line may wander sideways by up to 7% of its length
let ARROW_SHAFT_DEVIATION = 0.1; // an arrow's shaft may wander by up to 10% of its length

// ============================================================
// 2. GEOMETRY: how I look at a stroke
// ============================================================

// I make a point. I use plain {X, Y} objects so I don't depend on any library.
function pt(x, y) {
  return { X: x, Y: y };
}

// I measure the straight distance between two points.
function dist(a, b) {
  return Math.hypot(b.X - a.X, b.Y - a.Y);
}

// I find the smallest upright box that contains every point of the stroke.
function boundingBox(pts) {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.X);
    maxX = Math.max(maxX, p.X);
    minY = Math.min(minY, p.Y);
    maxY = Math.max(maxY, p.Y);
  }
  return { X: minX, Y: minY, Width: maxX - minX, Height: maxY - minY };
}

// I measure how far the point p is from the line segment a-b.
function distToSegment(p, a, b) {
  const dx = b.X - a.X,
    dy = b.Y - a.Y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(p, a);
  // I find the closest spot on the segment, and I clamp it so it can't run past the ends.
  const t = Math.max(
    0,
    Math.min(1, ((p.X - a.X) * dx + (p.Y - a.Y) * dy) / len2),
  );
  return Math.hypot(p.X - (a.X + t * dx), p.Y - (a.Y + t * dy));
}

// I measure how far a stroke strays sideways from the straight line between
// its two ends, as a fraction of that line's length. 0 means perfectly straight.
// I use this instead of comparing path lengths, because a pen's tiny wobbles add
// extra path even on a line that looks straight.
function deviation(pts) {
  const a = pts[0],
    b = pts[pts.length - 1];
  const chord = dist(a, b);
  if (chord === 0) return Infinity;
  let worst = 0;
  for (const p of pts) worst = Math.max(worst, distToSegment(p, a, b));
  return worst / chord;
}

// I keep only the points where the stroke really bends and throw away the ones
// on straight stretches (Ramer-Douglas-Peucker). eps is how much wobble I forgive.
function simplify(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const a = pts[0],
    b = pts[pts.length - 1];
  // I look for the point that sticks out the furthest from the line a-b.
  let worst = 0,
    idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distToSegment(pts[i], a, b);
    if (d > worst) {
      worst = d;
      idx = i;
    }
  }
  // If nothing sticks out more than eps, this whole piece is one straight edge.
  if (worst <= eps) return [a, b];
  // Otherwise I split at the furthest point and simplify each half.
  const left = simplify(pts.slice(0, idx + 1), eps);
  const right = simplify(pts.slice(idx), eps);
  return left.slice(0, -1).concat(right);
}

// I find the corners of a closed stroke.
function corners(pts, eps) {
  const v = simplify(pts, eps);
  // If the start and end are nearly the same spot, I keep only one of them.
  if (v.length > 2 && dist(v[0], v[v.length - 1]) < eps * 4) v.pop();

  let changed = true;
  while (changed && v.length > 3) {
    changed = false;

    // I merge two vertices that sit almost on top of each other. A rounded
    // corner or a wobble at the stroke's start comes out as two nearby vertices,
    // and they really are just one corner.
    for (let i = 0; i < v.length; i++) {
      const j = (i + 1) % v.length;
      if (dist(v[i], v[j]) < eps * 2.5) {
        const mid = pt((v[i].X + v[j].X) / 2, (v[i].Y + v[j].Y) / 2);
        if (j === 0) {
          v[i] = mid;
          v.shift();
        } else {
          v.splice(i, 2, mid);
        }
        changed = true;
        break;
      }
    }
    if (changed) continue;

    // I drop vertices where the outline barely turns, because they sit on a straight edge.
    for (let i = 0; i < v.length; i++) {
      if (turnAt(v, i) < (20 * Math.PI) / 180) {
        v.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return v;
}

// I measure how sharply the outline turns at vertex i, in radians.
// A straight continuation is 0 and a right-angle corner is about 1.57.
function turnAt(v, i) {
  const p = v[(i + v.length - 1) % v.length],
    c = v[i],
    n = v[(i + 1) % v.length];
  const cross = (c.X - p.X) * (n.Y - c.Y) - (c.Y - p.Y) * (n.X - c.X);
  const dot = (c.X - p.X) * (n.X - c.X) + (c.Y - p.Y) * (n.Y - c.Y);
  return Math.abs(Math.atan2(cross, dot));
}

// I keep only the vertices where the outline turns sharply (60 degrees or more).
// Those are the real corners. A round outline has many vertices but each turns
// gently, so it ends up with none.
function sharpCorners(v) {
  return v.filter((_, i) => turnAt(v, i) >= (60 * Math.PI) / 180);
}

// I compute the area enclosed by the stroke (the shoelace formula).
// I compare it with the bounding box to tell ellipses (about 0.79) from rectangles (about 1.0).
function polygonArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i],
      b = pts[(i + 1) % pts.length];
    s += a.X * b.Y - b.X * a.Y;
  }
  return Math.abs(s) / 2;
}

// If the line from a to b is close to horizontal or vertical, I return an end point
// that makes it exactly so. Otherwise I return b unchanged.
function axisSnap(a, b) {
  const dx = b.X - a.X,
    dy = b.Y - a.Y;
  const off =
    (Math.atan2(
      Math.min(Math.abs(dx), Math.abs(dy)),
      Math.max(Math.abs(dx), Math.abs(dy)),
    ) *
      180) /
    Math.PI;
  if (off >= AXIS_SNAP_DEG) return b;
  return Math.abs(dx) > Math.abs(dy) ? pt(b.X, a.Y) : pt(a.X, b.Y);
}

// I decide whether a stroke is an arrow: a straight shaft, then a short trip
// back near the tip, which is the arrowhead. If it isn't, I say why in "why"
// and "note" so the notice can show you which check failed.
function detectArrow(pts) {
  const n = pts.length;

  // I keep a running total of the path length up to each point.
  const run = [0];
  for (let i = 1; i < n; i++) run.push(run[i - 1] + dist(pts[i - 1], pts[i]));

  // I take the tip to be the point farthest from where the stroke started.
  let best = 0;
  for (let i = 0; i < n; i++) best = Math.max(best, dist(pts[0], pts[i]));
  // The pen may visit the tip twice (tip, one barb, tip, other barb). I use the
  // FIRST time it gets there, so both barbs count as the head and the shaft
  // stays clean. "There" means within 3% of the farthest distance.
  let tipIdx = 0;
  for (let i = 0; i < n; i++) {
    if (dist(pts[0], pts[i]) >= best * 0.97) {
      tipIdx = i;
      break;
    }
  }
  const tip = pts[tipIdx];

  // I measure the head: how long a path it draws and how far it strays from the tip.
  const headPath = run[n - 1] - run[tipIdx];
  let headReach = 0;
  for (let i = tipIdx; i < n; i++)
    headReach = Math.max(headReach, dist(pts[i], tip));

  // I measure how straight the shaft is (the part before the tip).
  const shaftDev = deviation(pts.slice(0, tipIdx + 1));

  const note =
    "tip " +
    tipIdx +
    "/" +
    n +
    ", shaft wander " +
    (shaftDev * 100).toFixed(1) +
    "%" +
    ", head/shaft " +
    (headPath / best).toFixed(2) +
    ", reach/shaft " +
    (headReach / best).toFixed(2);

  if (tipIdx < 3 || n - tipIdx < 3)
    return { ok: false, why: "no clear tip", note };
  if (shaftDev > ARROW_SHAFT_DEVIATION)
    return { ok: false, why: "shaft not straight enough", note };
  if (headPath < 0.08 * best) return { ok: false, why: "head too short", note };
  if (headPath > 1.0 * best) return { ok: false, why: "head too long", note };
  if (headReach > 0.6 * best)
    return { ok: false, why: "head strays too far from the tip", note };

  return { ok: true, from: pts[0], to: tip };
}

// I turn four corners into a clean rectangle that keeps the tilt you drew.
// I return its centre, size and tilt angle (in radians).
function fitRectangle(v) {
  // I average the four edge directions. Multiplying each angle by 4 makes
  // edges that are 90 degrees apart point the same way, so they add up
  // instead of cancelling out.
  let s4 = 0,
    c4 = 0;
  for (let i = 0; i < 4; i++) {
    const a = v[i],
      b = v[(i + 1) % 4];
    const ang = Math.atan2(b.Y - a.Y, b.X - a.X);
    s4 += Math.sin(4 * ang);
    c4 += Math.cos(4 * ang);
  }
  let theta = Math.atan2(s4, c4) / 4; // somewhere between -45 and +45 degrees
  // A rectangle that is only slightly tilted was probably meant to be upright.
  if (Math.abs(theta) < (TILT_SNAP_DEG * Math.PI) / 180) theta = 0;

  // I measure the corners along the rectangle's own two directions to get its width and height.
  const ux = Math.cos(theta),
    uy = Math.sin(theta); // "across" direction
  const vx = -uy,
    vy = ux; // "down" direction
  let minU = Infinity,
    maxU = -Infinity,
    minV = Infinity,
    maxV = -Infinity;
  for (const p of v) {
    const pu = p.X * ux + p.Y * uy,
      pv = p.X * vx + p.Y * vy;
    minU = Math.min(minU, pu);
    maxU = Math.max(maxU, pu);
    minV = Math.min(minV, pv);
    maxV = Math.max(maxV, pv);
  }
  const w = maxU - minU,
    h = maxV - minV;
  const cu = (minU + maxU) / 2,
    cv = (minV + maxV) / 2;
  return { cx: cu * ux + cv * vx, cy: cu * uy + cv * vy, w, h, theta };
}
// I find the true short side of the shape, measured along its own tilt. I turn
// the stroke a little at a time and keep the smallest box that fits it. The
// ordinary upright box would make a tilted thin rectangle look almost square.
function shortSide(pts) {
  let bestArea = Infinity,
    side = 0;
  for (let deg = 0; deg < 90; deg += 2) {
    const a = (deg * Math.PI) / 180,
      c = Math.cos(a),
      s = Math.sin(a);
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const p of pts) {
      const x = p.X * c - p.Y * s,
        y = p.X * s + p.Y * c;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const w = maxX - minX,
      h = maxY - minY;
    if (w * h < bestArea) {
      bestArea = w * h;
      side = Math.min(w, h);
    }
  }
  return side;
}

// I look at a stroke and decide what shape it is. I only decide. I never draw
// anything here. I return an object whose "kind" says what I found:
//   dot, line, arrow, triangle, rectangle, ellipse, or none (with a reason).
function classify(abs) {
  const box = boundingBox(abs);
  const diag = Math.hypot(box.Width, box.Height);
  if (diag < 15) return { kind: "dot" }; // too small to be a shape

  const first = abs[0],
    last = abs[abs.length - 1];
  const gap = dist(first, last); // how far apart the ends are
  const fill = polygonArea(abs) / Math.max(box.Width * box.Height, 1);
  let v = null; // the corners, once I have found them

  // This is the summary the notice shows, so you can see what I measured.
  const describe = () =>
    "wander " +
    (Math.min(deviation(abs), 9.99) * 100).toFixed(0) +
    "%" +
    ", corners " +
    (v ? sharpCorners(v).length + " sharp of " + v.length : "-") +
    ", fill " +
    fill.toFixed(2) +
    ", gap " +
    Math.round((100 * gap) / diag) +
    "%" +
    ", size " +
    Math.round(box.Width) +
    "x" +
    Math.round(box.Height);

  // 1. An arrow: a straight shaft followed by a short head. I check this before
  //    "line" on purpose: a small arrowhead barely strays from the shaft, so
  //    without this order I would mistake it for a plain line. A plain line
  //    fails this test (it has no head), so it still reaches the line check.
  const arrow = detectArrow(abs);
  if (arrow.ok) {
    return {
      kind: "arrow",
      from: arrow.from,
      to: axisSnap(arrow.from, arrow.to),
      info: describe(),
    };
  }

  // 2. A line: long enough and it hardly strays from the straight path.
  if (gap > 40 && deviation(abs) < LINE_DEVIATION) {
    return {
      kind: "line",
      from: first,
      to: axisSnap(first, last),
      info: describe(),
    };
  }

  // 3. Everything else has to be a closed shape.
  if (gap > CLOSED_GAP * diag) {
    return {
      kind: "none",
      why: "not closed (arrow test: " + arrow.why + ", " + arrow.note + ")",
      info: describe(),
    };
  }

  // 4. I count the sharp corners: 3 is a triangle and 4 is a rectangle.
  //    I forgive wobble in proportion to the shape's size, but never more than a
  //    quarter of its shorter side, or a thin rectangle would lose a corner.
  const eps = Math.max(
    3,
    // Math.min(CORNER_EPS * diag, 0.25 * Math.min(box.Width, box.Height)),
    Math.min(CORNER_EPS * diag, 0.15 * shortSide(abs)),
  );
  v = corners(abs, eps);
  const sharp = sharpCorners(v);
  // A triangle fills at most half of its bounding box, so if this one fills
  // more, it isn't a triangle and I refuse to guess.
  if (sharp.length === 3 && fill < 0.65) {
    return { kind: "triangle", pts: sharp, info: describe() };
  }
  if (sharp.length === 4) {
    return Object.assign(
      { kind: "rectangle", info: describe() },
      fitRectangle(sharp),
    );
  }

  // 5. A round outline: I use the fill ratio to recognise an ellipse.
  if (fill > 0.6 && fill < 0.88) {
    let x = box.X,
      y = box.Y,
      w = box.Width,
      h = box.Height;
    // If it's nearly round I make it a true circle.
    if (Math.abs(w - h) / Math.max(w, h) < 0.15) {
      const s = (w + h) / 2;
      x += (w - s) / 2;
      y += (h - s) / 2;
      w = h = s;
    }
    return { kind: "ellipse", x, y, w, h, info: describe() };
  }

  return { kind: "none", why: "unclear shape", info: describe() };
}
// ==== GEOMETRY END ====

// ============================================================
// SETTINGS PANEL: the numbers above, editable in Obsidian's settings
// ============================================================
const RESET_KEY = "Reset all to defaults";

// Each row is one setting: the name shown in settings, its default value, the
// allowed range, a plain-language description, and a function that puts the
// value into the matching variable in section 1.
const SETTING_DEFS = [
  {
    name: "Hold time (ms)",
    value: 500,
    min: 100,
    max: 2000,
    description:
      "How long I must hold the pen still at the end of a stroke before it snaps.",
    apply: (v) => (HOLD_MS = v),
  },
  {
    name: "Hold jitter tolerance (px)",
    value: 3,
    min: 0,
    max: 20,
    description:
      "Pen movement smaller than this still counts as holding still.",
    apply: (v) => (JITTER_PX = v),
  },
  {
    name: "Closed-shape gap",
    value: 0.25,
    min: 0.05,
    max: 0.6,
    description:
      "How far apart a stroke's ends may be and still count as a closed shape (fraction of its size).",
    apply: (v) => (CLOSED_GAP = v),
  },
  {
    name: "Corner tolerance",
    value: 0.06,
    min: 0.01,
    max: 0.15,
    description:
      "How much wobble I forgive when looking for corners (fraction of size). Lower is stricter.",
    apply: (v) => (CORNER_EPS = v),
  },
  {
    name: "Straighten rectangles tilted under (deg)",
    value: 10,
    min: 0,
    max: 45,
    description: "Rectangles tilted less than this become perfectly upright.",
    apply: (v) => (TILT_SNAP_DEG = v),
  },
  {
    name: "Straighten lines and arrows within (deg)",
    value: 10,
    min: 0,
    max: 45,
    description:
      "Lines and arrows this close to horizontal or vertical become exactly so.",
    apply: (v) => (AXIS_SNAP_DEG = v),
  },
  {
    name: "Line wobble allowed",
    value: 0.07,
    min: 0.01,
    max: 0.2,
    description:
      "How far a line may wander sideways (fraction of its length) and still count as straight.",
    apply: (v) => (LINE_DEVIATION = v),
  },
  {
    name: "Arrow shaft wobble allowed",
    value: 0.1,
    min: 0.02,
    max: 0.3,
    description:
      "How far an arrow's shaft may wander sideways (fraction of its length).",
    apply: (v) => (ARROW_SHAFT_DEVIATION = v),
  },
];

// I build a full settings object with every default in it.
function buildDefaults() {
  const s = {};
  for (const d of SETTING_DEFS) {
    s[d.name] = {
      value: d.value,
      description:
        d.description +
        " Default " +
        d.value +
        ", allowed " +
        d.min +
        " to " +
        d.max +
        ".",
    };
  }
  s[RESET_KEY] = {
    value: false,
    description:
      "Turn this on to put every setting above back to its default. It switches itself off again.",
  };
  return s;
}

// I make sure every setting exists. I run this only when I start, and I only add
// what is missing, so I never overwrite a value you have changed.
function seedSettings() {
  const s = ea.getScriptSettings() || {};
  const defaults = buildDefaults();
  let changed = false;
  for (const key of Object.keys(defaults)) {
    if (!s[key]) {
      s[key] = defaults[key];
      changed = true;
    }
  }
  if (changed) ea.setScriptSettings(s);
}

// I read the settings and put them into my variables. A value that is not a
// number falls back to its default, and a value outside its range is pulled back inside.
function refreshSettings() {
  let s = ea.getScriptSettings();
  // If my reset switch isn't there, these aren't my settings, so I leave everything alone.
  if (!s || !s[RESET_KEY]) return;
  if (s[RESET_KEY].value === true) {
    s = buildDefaults();
    ea.setScriptSettings(s);
    new Notice("Shape snapper: settings reset to defaults");
  }
  for (const d of SETTING_DEFS) {
    if (!s[d.name]) continue;
    const n = Number(s[d.name].value);
    d.apply(Number.isFinite(n) ? Math.min(d.max, Math.max(d.min, n)) : d.value);
  }
}

// ============================================================
// 3. SWITCHING ON AND OFF
// ============================================================
const view = ea.targetView; // the drawing I was started in
const el = view.containerEl; // the pane I listen to
const EVENTS = ["pointerdown", "pointermove", "pointerup"];

window.__penSnaps = window.__penSnaps || new Map(); // one entry per drawing I'm watching
if (window.__penSnaps.has(el)) {
  const old = window.__penSnaps.get(el);
  EVENTS.forEach((t) =>
    el.removeEventListener(t, old.handler, { capture: true }),
  );
  clearTimeout(old.state.timer);
  window.__penSnaps.delete(el);
  new Notice("Shape snapper off");
  return;
}

// ============================================================
// 4. WATCHING THE PEN
// ============================================================

// This is what I remember while you draw.
const state = {
  down: false, // is the pen touching right now?
  held: false, // have you held still long enough to snap?
  lastX: 0, // the last position where the pen really moved
  lastY: 0,
  timer: null, // my "held still" countdown
  knownIds: new Set(), // the pen strokes that existed before this stroke began
};

// I list every pen stroke currently on the canvas.
const freedraws = () =>
  ea.getViewElements().filter((e) => e.type === "freedraw" && !e.isDeleted);

// I replace the newest pen stroke with a clean shape.
async function snapNewestStroke() {
  try {
    ea.reset();
    ea.setView(view);

    // The stroke you just drew is the pen stroke that didn't exist when you put the pen down.
    const fresh = freedraws().filter((e) => !state.knownIds.has(e.id));
    if (fresh.length === 0) return;
    const stroke = fresh[fresh.length - 1];

    // I turn the stroke's points (stored relative to the stroke) into canvas positions.
    const abs = stroke.points.map((p) => pt(stroke.x + p[0], stroke.y + p[1]));

    // I ask classify what shape this is.
    const r = classify(abs);
    if (r.kind === "dot") return;
    if (r.kind === "none") {
      new Notice("No snap: " + r.why + " | " + r.info);
      return;
    }

    // The clean shape keeps the pen's colour and thickness is multiplied by 4.25 factor because otherwise, the shape stroke is very thin.
    ea.style.strokeColor = stroke.strokeColor;
    ea.style.strokeWidth = stroke.strokeWidth * 4.25;
    ea.style.backgroundColor = "transparent";
    ea.style.roughness = 0; // 0 means clean lines, not hand-drawn wobble

    // Draw the shape that classify found.
    let label = r.kind;
 
    let id;

    if (r.kind === "line") {
      id = ea.addLine([
        [r.from.X, r.from.Y],
        [r.to.X, r.to.Y],
      ]);
    } else if (r.kind === "arrow") {
      ea.style.startArrowHead = null;
      ea.style.endArrowHead = "arrow";
      id = ea.addArrow([
        [r.from.X, r.from.Y],
        [r.to.X, r.to.Y],
      ]);
    } else if (r.kind === "triangle") {
      id = ea.addLine([...r.pts, r.pts[0]].map((p) => [p.X, p.Y]));
    } else if (r.kind === "rectangle") {
      ea.style.angle = r.theta;
      id = ea.addRect(r.cx - r.w / 2, r.cy - r.h / 2, r.w, r.h);
      label =
        "rectangle, tilt " + Math.round((r.theta * 180) / Math.PI) + "deg";
    } else if (r.kind === "ellipse") {
      id = ea.addEllipse(r.x, r.y, r.w, r.h);
    }

    const replacement = ea.getElement(id);

    replacement.frameId = stroke.frameId;
    replacement.groupIds = stroke.groupIds;
    replacement.customData = stroke.customData;
    replacement.link = stroke.link;
    replacement.index = stroke.index;

    await ea.addElementsToView(false, false, true);
    ea.addElementsToFrame(stroke.frameId, [id]);

    // --------------
    ea.deleteViewElements([stroke]);
    console.log("pen snap:", label, "|", r.info);
    new Notice("Snapped: " + label + " | " + r.info);
  } catch (err) {
    console.error("pen snap failed:", err);
  }
}
// I handle every pen event. I start a countdown each time the pen moves, and
// if it runs out while the pen is still down, you are holding still. When you
// lift the pen after that, I snap the stroke.
function onPointer(e) {
  // Only react when the freedraw (pen) tool is active
  const api = ea.getExcalidrawAPI();
  const tool = api?.getAppState?.()?.activeTool?.type;
  if (tool !== "freedraw") return;

  if (e.type === "pointerdown") {
    state.down = true;
    state.held = false;
    state.lastX = e.clientX;
    state.lastY = e.clientY;
    ea.setView(view);
    // I remember which pen strokes exist right now, so I can spot the new one later.
    state.knownIds = new Set(freedraws().map((x) => x.id));
  }

  if (e.type === "pointermove" && state.down) {
    // Pens jitter a little even when still, so I ignore tiny movements.
    if (
      Math.hypot(e.clientX - state.lastX, e.clientY - state.lastY) > JITTER_PX
    ) {
      state.lastX = e.clientX;
      state.lastY = e.clientY;
      state.held = false; // you moved again, so I cancel the hold
      clearTimeout(state.timer);
      state.timer = setTimeout(() => {
        state.held = true;
        new Notice("Holding: lift to snap");
      }, HOLD_MS);
    }
  }

  if (e.type === "pointerup") {
    state.down = false;
    clearTimeout(state.timer);
    if (state.held) {
      state.held = false;
      // I wait a moment so Excalidraw can finish saving the stroke first.
      setTimeout(snapNewestStroke, 100);
    }
  }
}

// ============================================================
// 5. START LISTENING AND CALL THE SEETINGS:

seedSettings();
refreshSettings();
// ============================================================
// "capture" makes me see the events even if Excalidraw stops them from spreading further.
EVENTS.forEach((t) => el.addEventListener(t, onPointer, { capture: true }));
window.__penSnaps.set(el, { handler: onPointer, state });
new Notice("Shape Snapper on");

// 6. Register this script for autostart
try {
  const autostartStatus = await ea.registerAutostart(
    "Automatically start the Shape Snapper whenever an Excalidraw drawing opens.",
  );

  console.log("[shape-snapper] autostart status:", autostartStatus);
} catch (e) {
  console.error("[shape-snapper] failed to register autostart:", e);
}
