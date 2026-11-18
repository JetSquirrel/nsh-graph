// How much a canvas call costs on a real host: draws 1000 circles a frame, as separate calls or as one
// Path2D built from SVG path data. `nsh test fixtures/CanvasBench.tsx --target windows --fps -v`.
import { Canvas, mount, Path2D, signal, Text, View } from "nsh";

function Bench() {
  const mode = signal<"calls" | "path2d" | "idle" | "text" | "measure" | "fonts">("calls");
  const frame = signal(0);
  const loop = () => {
    frame.update((n) => n + 1);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  const N = 1000;
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Text testID="calls" onPress={() => mode.set("calls")}>calls</Text>
        <Text testID="path2d" onPress={() => mode.set("path2d")}>path2d</Text>
        <Text testID="idle" onPress={() => mode.set("idle")}>idle</Text>
        <Text testID="text" onPress={() => mode.set("text")}>text</Text>
        <Text testID="measure" onPress={() => mode.set("measure")}>measure</Text>
        <Text testID="fonts" onPress={() => mode.set("fonts")}>fonts</Text>
        <Text>{mode()}</Text>
      </View>
      <Canvas
        style={{ flex: 1 }}
        draw={(cx, { width, height }) => {
          const f = frame();
          const m = mode();
          if (m === "idle") return;
          cx.fillStyle = "#2a78d6";
          if (m === "text" || m === "fonts") {
            // 100 captions with a halo, as the graph draws them; "fonts" also sets the font each time.
            for (let i = 0; i < 100; i++) {
              if (m === "fonts" || i === 0) cx.font = "11px system-ui";
              const x = (i * 97) % width;
              const y = 20 + ((i * 31) % (height - 40));
              cx.strokeStyle = "#ffffff";
              cx.lineWidth = 3;
              cx.strokeText(`Node ${i}`, x, y);
              cx.fillStyle = "#111111";
              cx.fillText(`Node ${i}`, x, y);
            }
            return;
          }
          if (m === "measure") {
            cx.font = "11px system-ui";
            let w = 0;
            for (let i = 0; i < 100; i++) w += cx.measureText(`Node ${i} ${f}`).width;
            cx.fillRect(0, 0, w % width, 4);
            return;
          }
          if (m === "calls") {
            cx.beginPath();
            for (let i = 0; i < N; i++) {
              const x = (i * 37 + f) % width;
              const y = (i * 53) % height;
              cx.moveTo(x + 3, y);
              cx.arc(x, y, 3, 0, Math.PI * 2);
            }
            cx.fill();
          } else {
            let d = "";
            for (let i = 0; i < N; i++) {
              const x = (i * 37 + f) % width;
              const y = (i * 53) % height;
              d += `M${(x + 3).toFixed(1)} ${y.toFixed(1)}a3 3 0 1 0-6 0a3 3 0 1 0 6 0`;
            }
            cx.fill(new Path2D(d));
          }
        }}
      />
    </View>
  );
}

mount(Bench);
