export type TileType = "EMPTY" | "LADDER" | "SNAKE" | "TRUTH" | "DARE";
export const ladders: Record<number, number> = {
  3: 22,
  8: 30,
  16: 37,
  24: 45,
  32: 52,
  40: 61,
  48: 67,
  57: 76,
  65: 86,
  73: 94,
};
export const snakes: Record<number, number> = {
  27: 9,
  38: 18,
  46: 25,
  55: 34,
  64: 43,
  72: 51,
  81: 60,
  89: 68,
  95: 75,
  98: 79,
};
const empty = [1, 7, 14, 21, 28, 35, 42, 49, 56, 63, 70, 77, 84, 91, 100];
const truth = [
  2, 5, 9, 11, 13, 17, 19, 22, 25, 29, 31, 34, 37, 41, 44, 47, 51, 53, 58, 60,
  62, 67, 69, 74, 76, 79, 82, 85, 87, 90, 93, 96, 99,
];
export const board = Array.from({ length: 100 }, (_, i) => {
  const n = i + 1;
  return {
    number: n,
    type: (empty.includes(n)
      ? "EMPTY"
      : ladders[n]
        ? "LADDER"
        : snakes[n]
          ? "SNAKE"
          : truth.includes(n)
            ? "TRUTH"
            : "DARE") as TileType,
    destination: ladders[n] || snakes[n],
  };
});
export function validateBoard() {
  const expected = { EMPTY: 15, LADDER: 10, SNAKE: 10, TRUTH: 33, DARE: 32 };
  if (
    board.length !== 100 ||
    new Set(board.map((t) => t.number)).size !== 100 ||
    board.some((t, i) => t.number !== i + 1)
  )
    throw Error("Invalid board numbering");
  for (const [type, count] of Object.entries(expected))
    if (board.filter((t) => t.type === type).length !== count)
      throw Error("Invalid distribution for " + type);
  if (board[99].type !== "EMPTY") throw Error("Finish must be neutral");
  for (const t of board)
    if (
      t.destination &&
      (t.destination < 1 ||
        t.destination > 99 ||
        (t.type === "LADDER"
          ? t.destination <= t.number
          : t.destination >= t.number))
    )
      throw Error("Invalid connection");
  return true;
}
validateBoard();
export function move(position: number, dice: number) {
  if (position + dice > 100)
    return { position, type: "OVERSHOOT" as const, landed: position };
  const landed = position + dice,
    tile = board[landed - 1];
  return { position: tile.destination || landed, type: tile.type, landed };
}
export function coordinate(n: number) {
  const row = Math.floor((n - 1) / 10);
  return {
    x: (row % 2 === 0 ? (n - 1) % 10 : 9 - ((n - 1) % 10)) * 10 + 5,
    y: (9 - row) * 10 + 5,
  };
}
