// A large graph with the layout and drawing in Rust or in TypeScript, to compare by eye:
//   nsh run perf
import { mount, signal, Text, View } from "nsh";
import { GraphView, createGraphController, setNativeBackend, type NativeBackend } from "nsh-graph";
import * as native from "nsh-graph/native";
import { scaleFree } from "./graphs";

const SIZES = [1500, 5000, 10000] as const;

function Choice(props: { label: string; active: boolean; onPress: () => void; testID?: string }) {
  return (
    <View
      role="button"
      testID={props.testID}
      accessibilityState={{ selected: props.active }}
      onPress={props.onPress}
      class={`rounded-md px-3 py-1.5 ${props.active ? "bg-primary" : "bg-secondary hover:bg-accent"}`}
    >
      <Text class={`text-sm ${props.active ? "text-primary-foreground" : "text-secondary-foreground"}`}>{props.label}</Text>
    </View>
  );
}

/** A view whose engine is made with (or without) the Rust backend: the backend is read when it mounts. */
function Graph(props: { rust: boolean; size: number }) {
  setNativeBackend(props.rust ? (native as unknown as NativeBackend) : null);
  const graph = createGraphController();
  const view = <GraphView testID="graph" controller={graph} data={scaleFree(props.size, 2)} style={{ flex: 1 }} />;
  setNativeBackend(null);
  return (
    <View style={{ flex: 1 }}>
      {view}
      <Text class="absolute left-3 bottom-3 text-xs text-muted-foreground" testID="status">
        {`${props.rust ? "Rust" : "TypeScript"} · ${props.size} nodes · ${graph.settling() ? "laying out…" : "settled"}`}
      </Text>
    </View>
  );
}

function App() {
  const rust = signal(true);
  const size = signal<number>(5000);
  return (
    <View class="flex-1 bg-background">
      <View class="flex-row flex-wrap items-center gap-2 p-3">
        <Choice label="Rust" active={rust()} onPress={() => rust.set(true)} testID="rust" />
        <Choice label="TypeScript" active={!rust()} onPress={() => rust.set(false)} testID="ts" />
        <Each of={[...SIZES]}>{(n) => <Choice label={`${n()}`} active={size() === n()} onPress={() => size.set(n())} />}</Each>
      </View>
      <Each of={[`${rust()}:${size()}`]}>{() => <Graph rust={rust()} size={size()} />}</Each>
    </View>
  );
}

mount(App);
