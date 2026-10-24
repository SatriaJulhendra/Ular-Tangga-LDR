import { randomInt, randomBytes, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { Redis } from "@upstash/redis";
import { move } from "./board";
import { cards } from "./content";

export type Player = {
  id: string;
  token: string;
  name: string;
  avatar: number;
  position: number;
  ready: boolean;
  seen: number;
  joined: number;
  truth: number;
  dare: number;
  skipped: number;
};

export type Room = {
  code: string;
  host: string;
  players: Player[];
  pack?: string;
  timer: number;
  status: "LOBBY" | "PLAYING" | "FINISHED" | "ABORTED";
  version: number;
  turnId: string;
  active: number;
  dice: number;
  deadline: number;
  card: { id: string; text: string; type: "TRUTH" | "DARE" } | null;
  winner: string | null;
  reason: string;
  log: string[];
  used: string[];
  receipts: string[];
  created: number;
  activity: number;
};

export type PublicRoom = Omit<Room, "receipts" | "used" | "players"> & {
  players: Omit<Player, "token">[];
  serverNow: number;
};

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

function directory() {
  if (process.env.NJ_DATA_DIR) return process.env.NJ_DATA_DIR;
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return path.join(os.tmpdir(), "rooms");
  }
  return path.join(process.cwd(), "data", "rooms");
}

function file(code: string) {
  if (!/^[A-Z2-9]{6}$/.test(code)) throw Error("Invalid room code.");
  return path.join(directory(), code + ".json");
}

async function roomExists(code: string): Promise<boolean> {
  if (redis) {
    const exists = await redis.exists(`room:${code}`);
    return exists === 1;
  }
  return existsSync(file(code));
}

async function save(r: Room): Promise<void> {
  if (redis) {
    await redis.set(`room:${r.code}`, JSON.stringify(r), { ex: 86400 });
    return;
  }
  mkdirSync(directory(), { recursive: true });
  const target = file(r.code);
  writeFileSync(target + ".tmp", JSON.stringify(r));
  renameSync(target + ".tmp", target);
}

async function read(code: string): Promise<Room> {
  if (redis) {
    const data = await redis.get<Room | string>(`room:${code}`);
    if (!data) throw Error("Room not found. Please check the code.");
    return typeof data === "string" ? JSON.parse(data) : (data as Room);
  }
  const target = file(code);
  if (!existsSync(target))
    throw Error("Room not found. Please check the code.");
  return JSON.parse(readFileSync(target, "utf8"));
}

function log(r: Room, message: string) {
  r.log = [message, ...r.log].slice(0, 25);
}

function next(r: Room, at = Date.now()) {
  r.card = null;
  r.active = (r.active + 1) % r.players.length;
  r.turnId = randomUUID();
  r.deadline = at + 30000;
}

function finishIfAlone(r: Room) {
  if (r.status === "PLAYING" && r.players.length < 2) {
    r.status = "ABORTED";
    r.reason = "Other players have left. Session ended without a winner.";
    r.card = null;
  }
}

function remove(r: Room, id: string) {
  const i = r.players.findIndex((p) => p.id === id);
  if (i < 0) return;
  const current = r.players[r.active]?.id;
  const p = r.players[i];
  r.players.splice(i, 1);
  log(r, `${p.name} left the room.`);
  if (r.host === id)
    r.host = [...r.players].sort((a, b) => a.joined - b.joined)[0]?.id || "";
  if (current === id && r.players.length) {
    r.active = (i - 1 + r.players.length) % r.players.length;
    next(r);
  } else
    r.active = Math.max(
      0,
      r.players.findIndex((p) => p.id === current),
    );
  finishIfAlone(r);
}

export function reconcile(r: Room, now = Date.now()) {
  if (r.status === "LOBBY" && now - r.activity > 1800000)
    throw Error("Room expired after 30 minutes of inactivity.");
  if (r.status === "PLAYING" && r.players.every((p) => now - p.seen > 300000)) {
    r.status = "ABORTED";
    r.reason = "All players disconnected for 5 minutes.";
    r.card = null;
    r.version++;
    return;
  }
  const connected = r.players.filter((p) => now - p.seen < 45000);
  if (connected.length) {
    for (const p of [...r.players])
      if (now - p.seen > 180000) {
        remove(r, p.id);
        r.version++;
      }
  }
  if (r.status === "PLAYING") {
    let count = 0;
    while (now >= r.deadline && count++ < 100 && r.status === "PLAYING") {
      const deadline = r.deadline,
        p = r.players[r.active];
      if (r.card) {
        p.position = Math.max(0, p.position - 3);
        p.skipped++;
        log(r, `${p.name}'s time ran out. Moved back 3 tiles.`);
      } else log(r, `${p.name} missed the dice roll window.`);
      next(r, deadline);
      r.version++;
    }
  }
}

function nameOf(value: unknown) {
  if (typeof value !== "string") throw Error("Please enter a name.");
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 20)
    throw Error("Name must be 2–20 characters.");
  return name;
}

function player(name: unknown, avatar: unknown): Player {
  return {
    id: randomUUID(),
    token: randomBytes(32).toString("hex"),
    name: nameOf(name),
    avatar:
      Number.isInteger(avatar) && Number(avatar) >= 0 && Number(avatar) < 6
        ? Number(avatar)
        : 0,
    position: 0,
    ready: false,
    seen: Date.now(),
    joined: Date.now(),
    truth: 0,
    dare: 0,
    skipped: 0,
  };
}

export async function createRoom(name: unknown, avatar: unknown) {
  const p = player(name, avatar);
  let code = "";
  let exists = false;
  do {
    code = Array.from(
      { length: 6 },
      () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[randomInt(32)],
    ).join("");
    exists = await roomExists(code);
  } while (exists);
  const r: Room = {
    code,
    host: p.id,
    players: [p],
    timer: 0,
    status: "LOBBY",
    version: 1,
    turnId: randomUUID(),
    active: 0,
    dice: 1,
    deadline: 0,
    card: null,
    winner: null,
    reason: "",
    log: ["Room created. Invite your friends to join!"],
    used: [],
    receipts: [],
    created: Date.now(),
    activity: Date.now(),
  };
  await save(r);
  return { room: publicRoom(r), player: p };
}

export function publicRoom(r: Room): PublicRoom {
  const { receipts, used, players, ...rest } = r;
  return {
    ...rest,
    players: players.map(({ token, ...p }) => p),
    serverNow: Date.now(),
  };
}

export async function joinRoom(
  code: string,
  name: unknown,
  avatar: unknown,
  token?: string,
) {
  const r = await read(code);
  reconcile(r);
  const existing = r.players.find((p) => p.token === token);
  if (existing) {
    existing.seen = Date.now();
    await save(r);
    return { room: publicRoom(r), player: existing };
  }
  if (r.status !== "LOBBY")
    throw Error("Game is already in progress or finished. Wait for a new lobby.");
  if (r.players.length >= 6) throw Error("Room is full (maximum 6 players).");
  const p = player(name, avatar);
  const base = p.name;
  let suffix = 2;
  while (r.players.some((x) => x.name === p.name))
    p.name = `${base.slice(0, 16)} (${suffix++})`;
  r.players.push(p);
  r.version++;
  r.activity = Date.now();
  log(r, `${p.name} joined.`);
  await save(r);
  return { room: publicRoom(r), player: p };
}

export async function snapshot(code: string, token: string) {
  const r = await read(code);
  const versionBefore = r.version;
  reconcile(r);
  const p = r.players.find((p) => p.token === token);
  if (!p) {
    throw Error("Player session is invalid or has been removed.");
  }
  const now = Date.now();
  let needSave = r.version !== versionBefore;
  if (now - p.seen > 15000) {
    p.seen = now;
    if (r.status === "LOBBY") r.activity = now;
    needSave = true;
  }
  if (needSave) {
    await save(r);
  }
  return publicRoom(r);
}

export function applyRoll(r: Room, dice: number) {
  const p = r.players[r.active],
    result = move(p.position, dice);
  r.dice = dice;
  p.position = result.position;
  log(
    r,
    `${p.name} rolled ${dice}. ${result.type === "OVERSHOOT" ? "Exceeded 100, staying in place." : result.type === "LADDER" ? `Climbed ladder: ${result.landed} → ${result.position}.` : result.type === "SNAKE" ? `Slid down snake: ${result.landed} → ${result.position}.` : `Landed on tile ${result.position}.`}`,
  );
  if (p.position === 100) {
    r.status = "FINISHED";
    r.winner = p.id;
    r.card = null;
    log(r, `${p.name} reached 100 and won!`);
    return;
  }
  if (result.type === "TRUTH" || result.type === "DARE") {
    let pool = cards.filter(
      (c) => c.type === result.type && !r.used.includes(c.id),
    );
    if (!pool.length) {
      const last = r.used.at(-1);
      r.used = r.used.filter((id) => !id.startsWith(`${result.type}-`));
      pool = cards.filter((c) => c.type === result.type && c.id !== last);
    }
    const card = pool[randomInt(pool.length)];
    r.used.push(card.id);
    r.card = { id: card.id, type: card.type, text: card.text };
    r.deadline = Date.now() + (r.timer || card.durationSeconds) * 1000;
  } else next(r);
}

export async function action(
  code: string,
  token: string,
  body: Record<string, unknown>,
) {
  const r = await read(code);
  reconcile(r);
  await save(r);
  const p = r.players.find((x) => x.token === token);
  if (!p) throw Error("Invalid player session.");
  if (typeof body.actionId !== "string" || body.actionId.length > 80)
    throw Error("Invalid action ID.");
  const receipt = `${p.id}:${body.actionId}`;
  if (r.receipts.includes(receipt)) return publicRoom(r);
  if (body.version !== r.version)
    throw Error("Game state changed. Please try again after syncing.");
  p.seen = Date.now();
  const kind = body.kind;
  if (kind === "leave") {
    remove(r, p.id);
  } else if (kind === "kick") {
    if (r.host !== p.id) throw Error("Only the host can kick players.");
    if (body.target === p.id) throw Error("Use the leave button instead.");
    remove(r, String(body.target));
  } else if (kind === "settings") {
    if (r.status !== "LOBBY" || r.host !== p.id)
      throw Error("Only the host can configure lobby settings.");
    if (
      body.timer !== undefined &&
      ![0, 60, 90, 120].includes(Number(body.timer))
    )
      throw Error("Invalid settings.");
    if (body.timer !== undefined) {
      r.timer = Number(body.timer);
    }
    r.players.forEach((p) => (p.ready = false));
  } else if (kind === "ready") {
    if (r.status !== "LOBBY") throw Error("Lobby is already closed.");
    p.ready = !p.ready;
  } else if (kind === "start") {
    if (
      r.status !== "LOBBY" ||
      r.host !== p.id ||
      r.players.length < 2 ||
      !r.players.every((p) => p.ready)
    )
      throw Error("Requires 2–6 players and everyone must be ready.");
    for (let i = r.players.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [r.players[i], r.players[j]] = [r.players[j], r.players[i]];
    }
    r.status = "PLAYING";
    r.active = r.players.length - 1;
    next(r);
    log(r, "Game started. Turn order has been randomized.");
  } else if (kind === "rematch") {
    if (!["FINISHED", "ABORTED"].includes(r.status) || r.host !== p.id)
      throw Error("Only the host can open a new lobby after the session ends.");
    r.status = "LOBBY";
    r.winner = null;
    r.reason = "";
    r.card = null;
    r.used = [];
    r.turnId = randomUUID();
    r.players.forEach((p) => {
      p.position = 0;
      p.ready = false;
      p.truth = 0;
      p.dare = 0;
      p.skipped = 0;
    });
    log(r, "New lobby opened. All players need to ready up again.");
  } else if (["roll", "complete", "skip"].includes(String(kind))) {
    if (
      r.status !== "PLAYING" ||
      r.players[r.active]?.id !== p.id ||
      body.turnId !== r.turnId
    )
      throw Error("It is not your turn or your turn has expired.");
    if (kind === "roll") {
      if (r.card) throw Error("Please complete the active card first.");
      applyRoll(r, randomInt(1, 7));
    } else {
      if (!r.card) throw Error("No active card.");
      if (kind === "skip") {
        p.position = Math.max(0, p.position - 3);
        p.skipped++;
        log(r, `${p.name} skipped the card. Moved back 3 tiles to ${p.position}.`);
      } else {
        if (r.card.type === "TRUTH") p.truth++;
        else p.dare++;
        log(
          r,
          `${p.name} completed ${r.card.type === "TRUTH" ? "Truth" : "Dare"}.`,
        );
      }
      next(r);
    }
  } else throw Error("Unknown action.");
  r.version++;
  r.activity = Date.now();
  r.receipts = [...r.receipts, receipt].slice(-300);
  await save(r);
  return publicRoom(r);
}
