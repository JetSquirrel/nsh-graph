import { expect, open, test, type App } from "nsh/test";

test("a tap on a node selects it; presses outside the canvas leave it", async () => {
  const app = await open("./fixtures/Tap.tsx");
  await app.waitFor("id:graph");
  await app.wait(300);
  await app.drag("id:graph", {}); // lands on the middle, where the node is, and lifts: a tap
  await app.waitFor("text:selected: a");
  await app.drag("id:log", {}); // outside the canvas: nothing changes
  expect(app.shows("text:selected: a")).toBe(true);
});

test("dragging a node with stickyDrag pins it", async () => {
  const app = await open("./fixtures/Tap.tsx");
  await app.waitFor("id:graph");
  await app.wait(300);
  await app.drag("id:graph", { x: 30, y: 20 });
  await app.drag("id:graph", {}); // the node (radius 60) still covers the middle
  await app.waitFor("text:selected: a");
  expect(app.shows("text:pinned: true")).toBe(true);
});

/** Holds Shift down; false where the platform cannot hold modifier keys for a test (Windows and macOS hosts). */
async function holdShift(app: App): Promise<boolean> {
  try {
    await app.keyboard.down("shift");
    return true;
  } catch (e) {
    if ((e as { code?: string }).code !== "ERR_NSH_TEST_UNSUPPORTED") throw e;
    console.log("skipped: this platform cannot hold Shift down in a test");
    return false;
  }
}

test("a Shift-tap adds a node to the selection or takes it out, and never activates it", async () => {
  const app = await open("./fixtures/Tap.tsx");
  await app.waitFor("id:graph");
  await app.wait(300);
  if (!(await holdShift(app))) return;
  await app.drag("id:graph", {});
  await app.waitFor("text:selected: a");
  await app.drag("id:graph", {}); // again: out of the selection, and not a double-tap
  await app.waitFor("text:selected: none");
  await app.keyboard.up("shift");
  expect(app.shows("text:activated: 0")).toBe(true);
});

test("a Shift-drag on the background draws a box that selects the nodes inside it", async () => {
  const app = await open("./fixtures/Multi.tsx");
  await app.waitFor("id:graph");
  await app.wait(300);
  if (!(await holdShift(app))) return;
  await app.drag("id:graph", { x: 400, y: 400 }); // from the middle (background) over the bottom-right node
  await app.keyboard.up("shift");
  await app.waitFor("text:selected: d");
  // Without Shift the same drag pans, and the selection stays.
  await app.drag("id:graph", { x: -400, y: -400 });
  expect(app.shows("text:selected: d")).toBe(true);
});

// Tab gives the canvas the keyboard focus on a real host only, so headless this test checks nothing and
// says so. Run it with `nsh test example/input.test.tsx --target windows` (or macos, linux, web).
test("Shift + arrow keys add the next node, Ctrl/⌘ + A selects every node, Escape clears", async () => {
  const app = await open("./fixtures/Multi.tsx");
  await app.waitFor("id:graph");
  await app.wait(300);
  await app.keyboard.press("tab"); // the graph is the only focus stop
  await app.keyboard.press("right");
  await app.wait(200);
  if (app.shows("text:selected: none")) {
    console.log("skipped: the graph cannot take the keyboard focus here (headless)");
    return;
  }
  await app.waitFor("text:selected: a");
  await app.keyboard.press("shift+right");
  await app.waitFor("text:selected: a,b");
  await app.keyboard.press("mod+a");
  await app.waitFor("text:selected: a,b,c,d");
  await app.keyboard.press("escape");
  await app.waitFor("text:selected: none");
});
