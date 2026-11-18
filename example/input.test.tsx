import { expect, open, test } from "nsh/test";

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
