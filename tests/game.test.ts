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

test("Blueprint memiliki 100 kotak dengan distribusi persis dan nomor zig-zag", () => {
  assert.equal(validateBoard(), true);
  assert.equal(board.filter((t) => t.type === "EMPTY").length, 15);
  assert.deepEqual(coordinate(1), { x: 5, y: 95 });
  assert.deepEqual(coordinate(100), { x: 5, y: 5 });
  assert.equal(coordinate(11).x, 95);
});

test("Tangga dan ular tidak memicu kartu tujuan", async () => {
  assert.deepEqual(move(0, 3), { position: 22, landed: 3, type: "LADDER" });
  assert.deepEqual(move(92, 6), { position: 79, landed: 98, type: "SNAKE" });
  const { room } = await setup();
  applyRoll(room, 3);
  assert.equal(room.players.find((p) => p.position === 22)?.position, 22);
  assert.equal(room.card, null);
});

test("Harus tepat mencapai 100, angka berlebih tidak memindahkan pion", async () => {
  assert.equal(move(97, 4).position, 97);
  const { room } = await setup();
  room.players[room.active].position = 97;
  const current = room.players[room.active].id;
  applyRoll(room, 3);
  assert.equal(room.status, "FINISHED");
  assert.equal(room.winner, current);
});

test("Dadu 6 tidak memberikan giliran tambahan", async () => {
  const { room } = await setup();
  const first = room.players[room.active].id;
  applyRoll(room, 6);
  assert.equal(room.card?.type, "DARE");
  save(room);
  const token = room.players[room.active].token;
  const r = await send(room.code, token, "complete");
  assert.notEqual(r.players[r.active].id, first);
});

test("Hanya pemain aktif dapat roll dan hanya host dapat start/settings/kick", async () => {
  const { room } = await setup();
  const other = room.players[(room.active + 1) % 2];
  await assert.rejects(
    async () => await send(room.code, other.token, "roll"),
    /Bukan giliran/,
  );
  const guest = room.players.find((p) => p.id !== room.host)!;
  await assert.rejects(
    async () =>
      await send(room.code, guest.token, "kick", { target: room.host }),
    /Hanya host/,
  );
});

test("Lewati minimum 0 dan tidak menjalankan efek kotak penalti", async () => {
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

test("Aksi duplikat tidak menggandakan roll; state lama ditolak", async () => {
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
    /Status permainan berubah/,
  );
});

test("Timeout kartu dan aksi terlambat hanya diresolusi sekali", async () => {
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
    /Status permainan berubah/,
  );
  const r = await snapshot(room.code, token);
  assert.equal(r.players.find((p) => p.id === id)?.position, 31);
  assert.equal(r.players.find((p) => p.id === id)?.skipped, 1);
  assert.equal((await snapshot(room.code, token)).version, r.version);
});

test("Reconnect mempertahankan identitas dan snapshot tidak membocorkan token", async () => {
  const { a, room } = await setup();
  const before = load(room.code);
  const rejoin = await joinRoom(room.code, "Nama lain", 4, a.player.token);
  assert.equal(rejoin.player.id, a.player.id);
  const snap = await snapshot(room.code, a.player.token);
  assert.equal("token" in snap.players[0], false);
  assert.equal(snap.turnId, before.turnId);
  assert.equal(snap.deadline, before.deadline);
});

test("Kick mencabut token dan mengakhiri sesi saat tinggal satu pemain", async () => {
  const { a, b, room } = await setup();
  const r = await send(room.code, a.player.token, "kick", { target: b.player.id });
  assert.equal(r.status, "ABORTED");
  assert.equal(r.winner, null);
  await assert.rejects(
    async () => await snapshot(room.code, b.player.token),
    /tidak valid/,
  );
});

test("Host offline diganti dan kartu pemain yang keluar dibatalkan", async () => {
  const { a, room } = await setup();
  const third = await createRoom("Lain", 1);
  assert.notEqual(third.room.code, room.code);
  const host = room.players.find((p) => p.id === a.player.id)!;
  room.active = room.players.indexOf(host);
  room.card = { id: "test", type: "TRUTH", text: "test" };
  host.seen = Date.now() - 76000;
  reconcile(room);
  assert.notEqual(room.host, host.id);
  assert.equal(room.card, null);
  assert.equal(room.status, "ABORTED");
});

test("Rematch mereset posisi dan kesiapan; pengaturan mereset siap", async () => {
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
    pack: "Keluarga",
    timer: 90,
  });
  assert.ok(r.players.every((p) => !p.ready));
});

test("300 kartu awal dan deck tidak mengulang sebelum habis", async () => {
  assert.equal(cards.length, 300);
  const { room } = await setup();
  const seen = new Set<string>();
  for (let i = 0; i < 50; i++) {
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

test("Validasi nama, room penuh, dan sesi berjalan", async () => {
  await assert.rejects(async () => await createRoom("A", 0), /2–20/);
  const a = await createRoom("Rani", 0);
  for (let i = 0; i < 5; i++) await joinRoom(a.room.code, "Tamu " + i, 0);
  await assert.rejects(
    async () => await joinRoom(a.room.code, "Tamu lebih", 0),
    /penuh/,
  );
  const { room } = await setup();
  await assert.rejects(
    async () => await joinRoom(room.code, "Baru", 0),
    /berjalan/,
  );
});
