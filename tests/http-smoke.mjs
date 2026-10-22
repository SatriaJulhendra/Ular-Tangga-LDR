import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const base = process.env.TEST_URL || "http://localhost:3001";
async function post(route, body, cookie = "") {
  const res = await fetch(base + route, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base, cookie },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    data: await res.json(),
    cookie: res.headers
      .getSetCookie()
      .map((x) => x.split(";")[0])
      .join("; "),
  };
}
const a = await post("/api/rooms", { name: "HTTP Host", avatar: 0 });
assert.equal(a.status, 200, JSON.stringify(a.data));
const code = a.data.room.code,
  route = "/api/rooms/" + code;
const b = await post(route, { kind: "join", name: "HTTP Tamu", avatar: 1 });
assert.equal(b.status, 200);
const cookies = { [a.data.playerId]: a.cookie, [b.data.playerId]: b.cookie };
async function snap(cookie = a.cookie) {
  const res = await fetch(base + route, { headers: { cookie } });
  return (await res.json()).room;
}
async function act(kind, cookie, extra = {}) {
  const room = await snap(cookie);
  return post(
    route,
    {
      kind,
      actionId: randomUUID(),
      version: room.version,
      turnId: room.turnId,
      ...extra,
    },
    cookie,
  );
}
assert.equal((await act("ready", a.cookie)).status, 200);
assert.equal((await act("ready", b.cookie)).status, 200);
const start = await act("start", a.cookie);
assert.equal(start.data.room.status, "PLAYING");
let room = start.data.room;
const activeCookie = cookies[room.players[room.active].id];
const rollBody = {
  kind: "roll",
  actionId: randomUUID(),
  version: room.version,
  turnId: room.turnId,
};
const roll = await post(route, rollBody, activeCookie);
assert.equal(roll.status, 200);
assert.ok(roll.data.room.dice >= 1 && roll.data.room.dice <= 6);
const replay = await post(route, rollBody, activeCookie);
assert.equal(replay.data.room.version, roll.data.room.version);
if (roll.data.room.card)
  assert.equal((await act("complete", activeCookie)).status, 200);
const unauth = await fetch(base + route);
assert.equal(unauth.status, 400);
const malicious = await fetch(base + route, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    origin: "https://example.org",
    cookie: a.cookie,
  },
  body: JSON.stringify({ kind: "ready" }),
});
assert.equal(malicious.status, 400);
assert.equal((await act("leave", b.cookie)).status, 200);
assert.equal((await snap()).status, "ABORTED");
await act("leave", a.cookie);
console.log(
  "HTTP smoke PASS: create, join, cookies, ready, start, roll, replay, complete, authorization, origin, leave.",
);
