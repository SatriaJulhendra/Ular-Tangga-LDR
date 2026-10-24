import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { board, validateBoard, move, coordinate } from "../lib/board";
import { cards } from "../lib/content";
import {
  createRoom,
  joinRoom,
  action,
  snapshot,
  applyRoll,
  reconcile,
  type Room,
  type PublicRoom,
} from "../lib/game";

const testRoot = path.join(process.cwd(), ".test-data");
mkdirSync(testRoot, { recursive: true });
const dir = mkdtempSync(path.join(testRoot, "run-"));
process.env.NJ_DATA_DIR = dir;

after(() => rmSync(dir, { recursive: true, force: true }));

function load(code: string): Room {
  return JSON.parse(readFileSync(path.join(dir, code + ".json"), "utf8"));
}

function save(r: Room) {
  writeFileSync(path.join(dir, r.code + ".json"), JSON.stringify(r));
}

async function send(
  code: string,
  token: string,
  kind: string,
  extra: Record<string, unknown> = {},
) {
  const r = load(code);
  return await action(code, token, {
    actionId: randomUUID(),
    kind,
    version: r.version,
    turnId: r.turnId,
    ...extra,
  });
}

async function setup() {
  const a = await createRoom("Rani", 0);
  const b = await joinRoom(a.room.code, "Bima", 1);
  await send(a.room.code, a.player.token, "ready");
  await send(a.room.code, b.player.token, "ready");
  await send(a.room.code, a.player.token, "start");
  return { a, b, room: load(a.room.code) };
}

test("Blueprint has 100 tiles with exact distribution and zig-zag numbering", () => {
  assert.equal(validateBoard(), true);
  assert.equal(board.filter((t) => t.type === "EMPTY").length, 15);
  assert.deepEqual(coordinate(1), { x: 5, y: 95 });
  assert.deepEqual(coordinate(100), { x: 5, y: 5 });
  assert.equal(coordinate(11).x, 95);
});

test("Ladders and snakes do not trigger destination tile cards", async () => {
  assert.deepEqual(move(0, 3), { position: 22, landed: 3, type: "LADDER" });
  assert.deepEqual(move(92, 6), { position: 79, landed: 98, type: "SNAKE" });
  const { room } = await setup();
  applyRoll(room, 3);
  assert.equal(room.players.find((p) => p.position === 22)?.position, 22);
  assert.equal(room.card, null);
});

test("Must land exactly on 100, overshoot keeps token in place", async () => {
  assert.equal(move(97, 4).position, 97);
  const { room } = await setup();
  room.players[room.active].position = 97;
  const current = room.players[room.active].id;
  applyRoll(room, 3);
  assert.equal(room.status, "FINISHED");
  assert.equal(room.winner, current);
});

test("Rolling a 6 does not grant an extra turn", async () => {
  const { room } = await setup();
  const first = room.players[room.active].id;
  applyRoll(room, 6);
  assert.equal(room.card?.type, "DARE");
  save(room);
  const token = room.players[room.active].token;
  const r = await send(room.code, token, "complete");
  assert.notEqual(r.players[r.active].id, first);
});

test("Only active player can roll and only host can start/settings/kick", async () => {
  const { room } = await setup();
  const other = room.players[(room.active + 1) % 2];
  await assert.rejects(
    async () => await send(room.code, other.token, "roll"),
    /not your turn/i,
  );
  const guest = room.players.find((p) => p.id !== room.host)!;
  await assert.rejects(
    async () =>
      await send(room.code, guest.token, "kick", { target: room.host }),
    /only the host/i,
  );
});

test("Skip penalty moves back 3 with minimum 0 and no penalty tile effects", async () => {
  const { room } = await setup();
  room.card = { id: "test", text: "test", type: "TRUTH" };
  room.players[room.active].position = 2;
  save(room);
  const token = room.players[room.active].token,
    id = room.players[room.active].id;
  let r = await send(room.code, token, "skip");
  assert.equal(r.players.find((p) => p.id === id)?.position, 0);
  assert.equal(r.card, null);
  const r2 = load(room.code);
  r2.card = { id: "test2", text: "test", type: "DARE" };
  r2.players[r2.active].position = 34;
  save(r2);
  const id2 = r2.players[r2.active].id;
  r = await send(room.code, r2.players[r2.active].token, "skip");
  assert.equal(r.players.find((p) => p.id === id2)?.position, 31);
  assert.equal(r.card, null);
});

test("Duplicate actions do not double roll; stale state is rejected", async () => {
  const { room } = await setup();
  const token = room.players[room.active].token;
  const b = {
    kind: "roll",
    version: room.version,
    turnId: room.turnId,
    actionId: randomUUID(),
  };
  const first = await action(room.code, token, b),
    second = await action(room.code, token, b);
  assert.equal(first.version, second.version);
  assert.equal(first.dice, second.dice);
  assert.deepEqual(
    first.players.map((p) => p.position),
    second.players.map((p) => p.position),
  );
  await assert.rejects(
    async () => await action(room.code, token, { ...b, actionId: randomUUID() }),
    /game state changed/i,
  );
});

test("Card timeout and late actions are only resolved once", async () => {
  const { room } = await setup();
  const id = room.players[room.active].id,
    token = room.players[room.active].token;
  room.players[room.active].position = 34;
  room.card = { id: "test", text: "test", type: "TRUTH" };
  room.deadline = Date.now() - 1;
  save(room);
  await assert.rejects(
    async () =>
      await action(room.code, token, {
        kind: "complete",
        version: room.version,
        turnId: room.turnId,
        actionId: randomUUID(),
      }),
    /game state changed/i,
  );
  const r = await snapshot(room.code, token);
  assert.equal(r.players.find((p) => p.id === id)?.position, 31);
  assert.equal(r.players.find((p) => p.id === id)?.skipped, 1);
  assert.equal((await snapshot(room.code, token)).version, r.version);
});

test("Reconnect preserves identity and snapshot does not leak player tokens", async () => {
  const { a, room } = await setup();
  const before = load(room.code);
  const rejoin = await joinRoom(room.code, "Other Name", 4, a.player.token);
  assert.equal(rejoin.player.id, a.player.id);
  const snap = await snapshot(room.code, a.player.token);
  assert.equal("token" in snap.players[0], false);
  assert.equal(snap.turnId, before.turnId);
  assert.equal(snap.deadline, before.deadline);
});

test("Kick revokes token and aborts session when only one player remains", async () => {
  const { a, b, room } = await setup();
  const r = await send(room.code, a.player.token, "kick", { target: b.player.id });
  assert.equal(r.status, "ABORTED");
  assert.equal(r.winner, null);
  await assert.rejects(
    async () => await snapshot(room.code, b.player.token),
    /invalid/i,
  );
});

test("Offline host is replaced and disconnected player's card is canceled", async () => {
  const { a, room } = await setup();
  const third = await createRoom("Other", 1);
  assert.notEqual(third.room.code, room.code);
  const host = room.players.find((p) => p.id === a.player.id)!;
  room.active = room.players.indexOf(host);
  room.card = { id: "test", type: "TRUTH", text: "test" };
  host.seen = Date.now() - 181000;
  reconcile(room);
  assert.notEqual(room.host, host.id);
  assert.equal(room.card, null);
  assert.equal(room.status, "ABORTED");
});

test("Rematch resets positions and readiness; settings reset ready", async () => {
  const { a, room } = await setup();
  room.status = "FINISHED";
  room.winner = a.player.id;
  room.players[0].position = 100;
  save(room);
  let r = await send(room.code, a.player.token, "rematch");
  assert.equal(r.status, "LOBBY");
  assert.ok(r.players.every((p) => p.position === 0 && !p.ready));
  await send(room.code, a.player.token, "ready");
  r = await send(room.code, a.player.token, "settings", {
    timer: 90,
  });
  assert.ok(r.players.every((p) => !p.ready));
});

test("Card deck does not repeat before being exhausted", async () => {
  const truthCards = cards.filter((c) => c.type === "TRUTH");
  const dareCards = cards.filter((c) => c.type === "DARE");
  assert.ok(truthCards.length > 0);
  assert.ok(dareCards.length > 0);
  assert.equal(cards.length, truthCards.length + dareCards.length);
  const { room } = await setup();
  const seen = new Set<string>();
  for (let i = 0; i < truthCards.length; i++) {
    room.players[room.active].position = 0;
    room.card = null;
    applyRoll(room, 2);
    const card = (room as Room).card!;
    assert.equal(card.type, "TRUTH");
    assert.ok(!seen.has(card.id));
    seen.add(card.id);
  }
  const last = (room as Room).card!.id;
  room.players[room.active].position = 0;
  room.card = null;
  applyRoll(room, 2);
  assert.notEqual((room as Room).card!.id, last);
});

test("Name validation, room full, and game in progress", async () => {
  await assert.rejects(async () => await createRoom("A", 0), /2–20/);
  const a = await createRoom("Rani", 0);
  for (let i = 0; i < 5; i++) await joinRoom(a.room.code, "Guest " + i, 0);
  await assert.rejects(
    async () => await joinRoom(a.room.code, "Extra guest", 0),
    /full/i,
  );
  const { room } = await setup();
  await assert.rejects(
    async () => await joinRoom(room.code, "New", 0),
    /progress/i,
  );
});
