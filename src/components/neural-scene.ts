type Point = readonly [number, number];
export type FigureId = "brain" | "bitcoin" | "wallet";
interface SceneNode {
  x: number;
  y: number;
  figure: FigureId;
  phase: number;
  emphasis: boolean;
}
interface SceneEdge {
  a: number;
  b: number;
  structural: boolean;
}
export interface NeuralScene {
  nodes: SceneNode[];
  edges: SceneEdge[];
  centers: Point[];
  bridges: [number, number][];
}

export const SCENE_WIDTH = 600;
export const SCENE_HEIGHT = 450;
export const FIGURE_COLORS: Record<FigureId, string> = {
  brain: "99,87,221",
  bitcoin: "185,127,31",
  wallet: "24,132,112",
};

function sampledLine(points: Point[], spacing = 10): Point[] {
  const result: Point[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const [x, y] = points[i - 1];
    const [endX, endY] = points[i];
    const steps = Math.max(
      1,
      Math.ceil(Math.hypot(endX - x, endY - y) / spacing),
    );
    for (let step = 1; step <= steps; step++)
      result.push([
        x + ((endX - x) * step) / steps,
        y + ((endY - y) * step) / steps,
      ]);
  }
  return result;
}

// Catmull–Rom curves keep the brain's lobes smooth while every vertex remains a node.
function curve(points: Point[]): Point[] {
  const result: Point[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[Math.max(0, i - 1)],
      b = points[i],
      c = points[i + 1],
      d = points[Math.min(points.length - 1, i + 2)];
    const steps = Math.max(
      2,
      Math.ceil(Math.hypot(c[0] - b[0], c[1] - b[1]) / 9),
    );
    for (let step = 0; step < steps; step++) {
      const t = step / steps;
      const coordinate = (axis: 0 | 1) =>
        0.5 *
        (2 * b[axis] +
          (-a[axis] + c[axis]) * t +
          (2 * a[axis] - 5 * b[axis] + 4 * c[axis] - d[axis]) * t * t +
          (-a[axis] + 3 * b[axis] - 3 * c[axis] + d[axis]) * t * t * t);
      result.push([coordinate(0), coordinate(1)]);
    }
  }
  result.push(points[points.length - 1]);
  return result;
}

function circle(x: number, y: number, radius: number, count: number): Point[] {
  return Array.from({ length: count + 1 }, (_, i) => [
    x + Math.cos((i / count) * Math.PI * 2) * radius,
    y + Math.sin((i / count) * Math.PI * 2) * radius,
  ]);
}

function roundedRect(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): Point[] {
  const centers: Point[] = [
    [x + width - radius, y + radius],
    [x + width - radius, y + height - radius],
    [x + radius, y + height - radius],
    [x + radius, y + radius],
  ];
  const points: Point[] = [];
  centers.forEach(([cx, cy], corner) => {
    for (let step = 0; step <= 4; step++) {
      const angle = (-0.5 + corner * 0.5 + (step / 4) * 0.5) * Math.PI;
      points.push([
        cx + Math.cos(angle) * radius,
        cy + Math.sin(angle) * radius,
      ]);
    }
  });
  return sampledLine([...points, points[0]]);
}

export function createNeuralScene(): NeuralScene {
  const scene: NeuralScene = {
    nodes: [],
    edges: [],
    centers: [
      [153, 139],
      [447, 139],
      [304, 350],
    ],
    bridges: [],
  };
  const figures: FigureId[] = ["brain", "bitcoin", "wallet"];
  const addPath = (figure: FigureId, points: Point[], structural = true) => {
    const [cx, cy] = scene.centers[figures.indexOf(figure)];
    const indices = points.map(([x, y], i) => {
      const existing = scene.nodes.findIndex(
        (node) =>
          node.figure === figure &&
          Math.hypot(node.x - cx - x, node.y - cy - y) < 2,
      );
      if (existing >= 0) return existing;
      scene.nodes.push({
        x: cx + x,
        y: cy + y,
        figure,
        phase: scene.nodes.length * 2.39996,
        emphasis: structural && i % 4 === 0,
      });
      return scene.nodes.length - 1;
    });
    for (let i = 1; i < indices.length; i++) {
      if (indices[i - 1] !== indices[i])
        scene.edges.push({ a: indices[i - 1], b: indices[i], structural });
    }
    return indices;
  };

  const hemisphere: Point[] = [
    [0, -60],
    [-14, -72],
    [-31, -68],
    [-42, -55],
    [-57, -50],
    [-67, -35],
    [-66, -18],
    [-74, -3],
    [-70, 17],
    [-59, 29],
    [-57, 43],
    [-43, 57],
    [-28, 57],
    [-13, 65],
    [0, 54],
  ];
  const folds: Point[][] = [
    [
      [-42, -55],
      [-37, -39],
      [-21, -36],
      [-13, -19],
      [-20, -3],
      [-37, 1],
    ],
    [
      [-66, -18],
      [-50, -23],
      [-39, -15],
      [-40, 1],
      [-54, 11],
    ],
    [
      [-59, 29],
      [-41, 24],
      [-28, 33],
      [-28, 57],
    ],
    [
      [0, -34],
      [-12, -40],
      [-21, -36],
    ],
    [
      [0, 10],
      [-14, 12],
      [-20, 26],
      [-13, 41],
      [0, 42],
    ],
    [
      [-41, 24],
      [-37, 1],
    ],
  ];
  for (const direction of [1, -1]) {
    const mirror = (points: Point[]): Point[] =>
      points.map(([x, y]) => [x * direction, y]);
    addPath("brain", curve(mirror(hemisphere)));
    folds.forEach((points) => addPath("brain", curve(mirror(points))));
  }
  addPath(
    "brain",
    curve([
      [0, -60],
      [2, -39],
      [-2, -17],
      [1, 7],
      [-1, 29],
      [0, 54],
    ]),
  );
  const brainCount = scene.nodes.length;
  for (let a = 0; a < brainCount; a++)
    for (let b = a + 1; b < brainCount; b++) {
      const distance = Math.hypot(
        scene.nodes[a].x - scene.nodes[b].x,
        scene.nodes[a].y - scene.nodes[b].y,
      );
      if (distance > 16 && distance < 29 && (a + b) % 4 === 0)
        scene.edges.push({ a, b, structural: false });
    }

  const outer = addPath("bitcoin", circle(0, 0, 72, 40));
  const inner = addPath("bitcoin", circle(0, 0, 60, 40));
  for (let i = 0; i < 40; i += 2)
    scene.edges.push({ a: outer[i], b: inner[i], structural: false });
  addPath(
    "bitcoin",
    sampledLine([
      [-22, -35],
      [-22, 35],
    ]),
  );
  addPath(
    "bitcoin",
    curve([
      [-31, -35],
      [-4, -35],
      [19, -32],
      [29, -22],
      [26, -10],
      [14, -3],
      [-22, -3],
    ]),
  );
  addPath(
    "bitcoin",
    curve([
      [-22, -3],
      [12, -3],
      [32, 5],
      [33, 21],
      [20, 33],
      [-5, 35],
      [-31, 35],
    ]),
  );
  for (const x of [-12, 2]) {
    addPath(
      "bitcoin",
      sampledLine([
        [x, -48],
        [x, -35],
      ]),
    );
    addPath(
      "bitcoin",
      sampledLine([
        [x, 35],
        [x, 48],
      ]),
    );
  }

  addPath("wallet", roundedRect(-80, -39, 160, 95, 13));
  addPath(
    "wallet",
    curve([
      [-76, -35],
      [-74, -47],
      [-57, -57],
      [55, -57],
      [68, -47],
      [68, -39],
    ]),
  );
  addPath(
    "wallet",
    sampledLine([
      [-65, -24],
      [60, -24],
    ]),
  );
  addPath("wallet", roundedRect(26, -9, 64, 37, 9));
  addPath("wallet", circle(43, 9.5, 4.5, 6));
  addPath(
    "wallet",
    sampledLine([
      [-65, 40],
      [-28, 40],
    ]),
  );
  addPath(
    "wallet",
    sampledLine([
      [-60, -7],
      [-39, 7],
      [-17, -7],
      [7, 9],
      [-12, 28],
      [-39, 7],
      [-55, 25],
      [-60, -7],
    ]),
    false,
  );
  addPath(
    "wallet",
    sampledLine([
      [-55, 25],
      [-31, 31],
      [-12, 28],
      [-17, -7],
    ]),
    false,
  );

  for (const [left, right] of [
    ["brain", "bitcoin"],
    ["bitcoin", "wallet"],
    ["wallet", "brain"],
  ]) {
    let best: [number, number] = [0, 0];
    let shortest = Infinity;
    scene.nodes.forEach((a, ai) => {
      if (a.figure !== left) return;
      scene.nodes.forEach((b, bi) => {
        if (b.figure !== right) return;
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (distance < shortest) {
          shortest = distance;
          best = [ai, bi];
        }
      });
    });
    scene.bridges.push(best);
  }
  return scene;
}
