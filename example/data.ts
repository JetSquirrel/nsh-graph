/**
 * A small fictional film graph (people, films, genres, studios), with communities set as Louvain would
 * set them, plus a fake "load neighbors" query for exploring by double-click.
 */
import type { GraphData, GraphEdge, GraphNode } from "nsh-graph";

export interface Props {
  kind: string;
  year?: number;
  born?: number;
}

const people: [string, string, number][] = [
  ["p-ada", "Ada Marlow", 1971],
  ["p-ben", "Ben Okafor", 1980],
  ["p-cleo", "Cleo Varga", 1986],
  ["p-dev", "Dev Raman", 1975],
  ["p-eli", "Eli Strand", 1964],
  ["p-fay", "Fay Lindqvist", 1990],
  ["p-gus", "Gus Moreau", 1958],
  ["p-hana", "Hana Ito", 1983],
  ["p-ivo", "Ivo Petrov", 1977],
  ["p-june", "June Castillo", 1992],
  ["p-kai", "Kai Brennan", 1969],
  ["p-lena", "Lena Hartmann", 1981],
  ["p-milo", "Milo Achebe", 1988],
  ["p-nora", "Nora Quinn", 1974],
];

const films: [string, string, number, string][] = [
  ["f-tide", "Low Tide", 2011, "harbor"],
  ["f-glass", "Glass Orchard", 2014, "harbor"],
  ["f-north", "North of Quiet", 2016, "harbor"],
  ["f-signal", "Signal Fires", 2018, "summit"],
  ["f-paper", "Paper Moons", 2019, "summit"],
  ["f-iron", "Iron Lullaby", 2021, "summit"],
  ["f-salt", "Salt & Static", 2022, "delta"],
  ["f-hollow", "The Hollow Year", 2023, "delta"],
];

const genres = ["Drama", "Thriller", "Sci-Fi", "Comedy"];
const studios: [string, string][] = [
  ["s-harbor", "Harbor Pictures"],
  ["s-summit", "Summit Lane"],
  ["s-delta", "Delta Nine"],
];

const roles: [string, string, string][] = [
  ["p-ada", "f-tide", "ACTED_IN"],
  ["p-ada", "f-glass", "ACTED_IN"],
  ["p-ben", "f-tide", "ACTED_IN"],
  ["p-ben", "f-north", "ACTED_IN"],
  ["p-cleo", "f-glass", "ACTED_IN"],
  ["p-cleo", "f-north", "ACTED_IN"],
  ["p-cleo", "f-signal", "ACTED_IN"],
  ["p-dev", "f-signal", "ACTED_IN"],
  ["p-dev", "f-paper", "ACTED_IN"],
  ["p-eli", "f-tide", "DIRECTED"],
  ["p-eli", "f-glass", "DIRECTED"],
  ["p-eli", "f-north", "PRODUCED"],
  ["p-fay", "f-paper", "ACTED_IN"],
  ["p-fay", "f-iron", "ACTED_IN"],
  ["p-gus", "f-signal", "DIRECTED"],
  ["p-gus", "f-iron", "DIRECTED"],
  ["p-gus", "f-paper", "PRODUCED"],
  ["p-hana", "f-iron", "ACTED_IN"],
  ["p-hana", "f-salt", "ACTED_IN"],
  ["p-ivo", "f-salt", "ACTED_IN"],
  ["p-ivo", "f-hollow", "ACTED_IN"],
  ["p-june", "f-hollow", "ACTED_IN"],
  ["p-june", "f-north", "ACTED_IN"],
  ["p-kai", "f-salt", "DIRECTED"],
  ["p-kai", "f-hollow", "DIRECTED"],
  ["p-lena", "f-paper", "WROTE"],
  ["p-lena", "f-signal", "WROTE"],
  ["p-milo", "f-hollow", "ACTED_IN"],
  ["p-nora", "f-north", "DIRECTED"],
  ["p-nora", "f-glass", "WROTE"],
];

const filmGenres: [string, string][] = [
  ["f-tide", "Drama"],
  ["f-glass", "Drama"],
  ["f-north", "Drama"],
  ["f-north", "Thriller"],
  ["f-signal", "Thriller"],
  ["f-paper", "Comedy"],
  ["f-iron", "Sci-Fi"],
  ["f-iron", "Thriller"],
  ["f-salt", "Sci-Fi"],
  ["f-hollow", "Drama"],
];

/** Which community each person mostly works in. */
const personGroup: Record<string, string> = {
  "p-ada": "harbor", "p-ben": "harbor", "p-cleo": "harbor", "p-eli": "harbor", "p-nora": "harbor",
  "p-june": "harbor", "p-dev": "summit", "p-fay": "summit", "p-gus": "summit", "p-lena": "summit",
  "p-hana": "delta", "p-ivo": "delta", "p-kai": "delta", "p-milo": "delta",
};

export function filmGraph(): GraphData<Props> {
  const nodes: GraphNode<Props>[] = [
    ...people.map(([id, caption, born]) => ({
      id, caption, category: "Person", group: personGroup[id], data: { kind: "Person", born },
    })),
    ...films.map(([id, caption, year, group]) => ({
      id, caption, category: "Film", group, data: { kind: "Film", year },
    })),
    ...genres.map((g) => ({ id: `g-${g}`, caption: g, category: "Genre", data: { kind: "Genre" } })),
  ];
  const edges: GraphEdge[] = [
    ...roles.map(([from, to, caption]) => ({ from, to, caption })),
    ...filmGenres.map(([from, g]) => ({ from, to: `g-${g}`, caption: "IN_GENRE" })),
  ];
  return { nodes, edges };
}

/** Pretends to query the neighbors of `id` that are not shown yet: studios for films, awards for people. */
export function loadNeighbors(id: string): GraphData<Props> {
  const film = films.find(([f]) => f === id);
  if (film) {
    const [sid, name] = studios.find(([s]) => s === `s-${film[3]}`)!;
    return {
      nodes: [{ id: sid, caption: name, category: "Studio", group: film[3], data: { kind: "Studio" } }],
      edges: [{ from: id, to: sid, caption: "MADE_BY" }],
    };
  }
  const person = people.find(([p]) => p === id);
  if (person) {
    const award = `a-${id}`;
    return {
      nodes: [{ id: award, caption: `${person[1].split(" ")[0]}'s award`, category: "Award", group: personGroup[id], data: { kind: "Award" } }],
      edges: [{ from: id, to: award, caption: "WON" }],
    };
  }
  return { nodes: [], edges: [] };
}
