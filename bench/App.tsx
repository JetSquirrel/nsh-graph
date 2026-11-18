// The bench is its tests (`nsh test bench`); this entry only gives the app a root.
import { mount, Text } from "nsh";

mount(() => <Text>Run `nsh test bench`.</Text>);
