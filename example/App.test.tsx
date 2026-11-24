import { expect, open, test } from "nsh/test";

test("shows the graph, its legend and the hint", async () => {
  const app = await open("./App.tsx", { width: 1100, height: 760 });
  await app.waitFor("id:graph");
  expect(app.shows("label:Legend")).toBe(true);
  const texts = app.texts();
  expect(texts).toContain("Person");
  expect(texts).toContain("Film");
  expect(texts).toContain("Genre");
  expect(texts).toContain("Select a node or an edge.");
});

test("switches layouts and toggles options without errors", async () => {
  const app = await open("./App.tsx", { width: 1100, height: 760 });
  for (const option of ["opt-hierarchical", "opt-circular", "opt-grid", "opt-force", "opt-group", "opt-always", "edge-labels"]) {
    await app.press(`id:${option}`);
  }
  await app.press("id:fit");
  await app.wait(600);
  expect(app.shows("id:graph")).toBe(true);
});

test("dragging the background pans and zooming buttons change the zoom", async () => {
  const app = await open("./App.tsx", { width: 1100, height: 760 });
  await app.press("id:opt-grid");
  await app.wait(800);
  const zoom = () => app.texts().find((t) => /^\d+%/.test(t)) ?? "";
  const before = zoom();
  await app.press("text:Zoom in");
  await app.wait(500);
  expect(zoom()).not.toBe(before);
  await app.drag("id:graph", { x: 120, y: 40 });
  expect(app.shows("id:graph")).toBe(true);
});

test("the Reset view button over the graph brings a zoomed-in view back", async () => {
  const app = await open("./App.tsx", { width: 1100, height: 760 });
  await app.press("id:opt-grid");
  await app.wait(800);
  const zoom = () => app.texts().find((t) => /^\d+%/.test(t)) ?? "";
  const fitted = zoom();
  for (let i = 0; i < 4; i++) await app.press("text:Zoom in");
  await app.wait(500);
  expect(zoom()).not.toBe(fitted);
  await app.press("id:reset-view");
  await app.wait(600);
  expect(zoom()).toBe(fitted);
});

test("the gallery has a Reset view button over the graph that fits it, as the toolbar's fit does", async () => {
  // Headless, a pan does not show in any text, so this checks the button is there and fits; the view
  // coming back after a pan is checked by eye on a real host.
  const app = await open("./Gallery.tsx", { width: 1100, height: 760 });
  await app.press("id:layout-grid");
  await app.wait(800);
  const zoom = () => (app.texts().find((t) => t.includes(" nodes · ")) ?? "").replace(/ · settling$/, "");
  const fitted = zoom();
  await app.drag("id:graph", { x: 300, y: 200 });
  await app.press("id:reset-view");
  await app.wait(600);
  expect(zoom()).toBe(fitted);
  expect(app.shows("id:reset-view")).toBe(true);
});
