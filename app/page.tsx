"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { board, coordinate, ladders, snakes } from "../lib/board";
import type { PublicRoom } from "../lib/game";
const avatars = ["🐯", "🐸", "🐱", "🐼", "🦊", "🐰"];
const labels = {
  EMPTY: "Neutral",
  LADDER: "Ladder",
  SNAKE: "Snake",
  TRUTH: "Truth",
  DARE: "Dare",
};
const icons = { EMPTY: "·", LADDER: "↗", SNAKE: "↘", TRUTH: "?", DARE: "ϟ" };
const colors = [
  "#f27850",
  "#628cdb",
  "#9370c5",
  "#48a58b",
  "#d5a139",
  "#d676a1",
];
export default function Home() {
  const [room, setRoom] = useState<PublicRoom | null>(null),
    [myId, setMyId] = useState(""),
    [name, setName] = useState(""),
    [avatar, setAvatar] = useState(0),
    [code, setCode] = useState(""),
    [mode, setMode] = useState<"create" | "join">("create");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [connected, setConnected] = useState(true),
    [rules, setRules] = useState(false),
    [tile, setTile] = useState<number | null>(null),
    [minimized, setMinimized] = useState(false),
    [copied, setCopied] = useState(false),
    [now, setNow] = useState(Date.now()),
    [rolling, setRolling] = useState(false);
  const offset = useRef(0),
    current = useRef<PublicRoom | null>(null),
    actionBusy = useRef(false);
  const modalRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!rules && tile === null) return;
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    modalRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setRules(false);
        setTile(null);
      }
      if (event.key !== "Tab") return;
      const controls = modalRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], input, select, [tabindex="0"]',
      );
      if (!controls?.length) return;
      const first = controls[0],
        last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, [rules, tile]);
  const accept = useCallback((r: PublicRoom) => {
    if (current.current?.code === r.code && current.current.version > r.version)
      return;
    offset.current = r.serverNow - Date.now();
    current.current = r;
    setRoom(r);
    setConnected(true);
  }, []);
  useEffect(() => {
    const q = new URLSearchParams(location.search).get("room");
    if (q) {
      setCode(q.toUpperCase());
      setMode("join");
    }
    const saved = localStorage.getItem("nj-session");
    if (saved) {
      try {
        const s = JSON.parse(saved);
        if (q && q !== s.code) return;
        fetch("/api/rooms/" + s.code)
          .then((r) => r.json())
          .then((d) => {
            if (d.room) {
              setMyId(s.id);
              accept(d.room);
            }
          })
          .catch(() => {});
      } catch {
        localStorage.removeItem("nj-session");
      }
    }
  }, [accept]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + offset.current), 250);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!room?.code) return;
    let alive = true;
    let failCount = 0;
    const poll = async () => {
      try {
        const res = await fetch("/api/rooms/" + room.code, {
          cache: "no-store",
        });
        const d = await res.json();
        if (!alive) return;
        if (d.error) {
          failCount++;
          if (failCount >= 3) {
            setError(d.error);
            setConnected(false);
          }
        } else {
          failCount = 0;
          setConnected(true);
          accept(d.room);
        }
      } catch {
        if (alive) {
          failCount++;
          if (failCount >= 3) {
            setConnected(false);
          }
        }
      }
    };
    const timer = setInterval(poll, 1500);
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        poll();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [room?.code, accept]);
  useEffect(() => {
    setMinimized(false);
  }, [room?.card?.id, room?.turnId]);
  async function enter(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(
        mode === "create" ? "/api/rooms" : "/api/rooms/" + code.toUpperCase(),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "join", name, avatar }),
        },
      );
      const d = await res.json();
      if (d.error) throw Error(d.error);
      setMyId(d.playerId);
      accept(d.room);
      localStorage.setItem(
        "nj-session",
        JSON.stringify({ code: d.room.code, id: d.playerId }),
      );
      history.replaceState(null, "", "?room=" + d.room.code);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function act(kind: string, extra: Record<string, unknown> = {}) {
    if (actionBusy.current || !current.current) return;
    actionBusy.current = true;
    setBusy(true);
    setError("");
    const r = current.current;
    if (kind === "roll") setRolling(true);
    try {
      const res = await fetch("/api/rooms/" + r.code, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          ...extra,
          version: r.version,
          turnId: r.turnId,
          actionId: Array.from(
            crypto.getRandomValues(new Uint8Array(16)),
            (byte) => byte.toString(16).padStart(2, "0"),
          ).join(""),
        }),
      });
      const d = await res.json();
      if (d.error) throw Error(d.error);
      accept(d.room);
      if (kind === "leave") exit();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      actionBusy.current = false;
      setTimeout(() => setRolling(false), 450);
    }
  }
  function exit() {
    current.current = null;
    setRoom(null);
    setMyId("");
    localStorage.removeItem("nj-session");
    history.replaceState(null, "", location.pathname);
    setError("");
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(
        location.origin + "?room=" + room!.code,
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Link: " + location.origin + "?room=" + room!.code);
    }
  }
  const me = room?.players.find((p) => p.id === myId),
    active = room?.players[room.active],
    isHost = room?.host === myId,
    isTurn = active?.id === myId,
    playing = room?.status === "PLAYING",
    lobby = room?.status === "LOBBY",
    ended = room && ["FINISHED", "ABORTED"].includes(room.status),
    remaining = room ? Math.max(0, Math.ceil((room.deadline - now) / 1000)) : 0;
  const cells = Array.from({ length: 100 }, (_, i) => {
    const row = Math.floor(i / 10),
      col = i % 10;
    return (9 - row) % 2 === 0
      ? (9 - row) * 10 + col + 1
      : (10 - row) * 10 - col;
  });
  return (
    <>
      <header className="header">
        <a className="brand" href="/" aria-label="Home">
          <span className="brand-icon">↗</span>
          <span>
            naik<span className="brand-light">jujur.</span>
            <small>SNAKES & LADDERS · TRUTH OR DARE</small>
          </span>
        </a>
        <nav>
          <span className="header-note">
            A little luck. A lot of stories.
          </span>
          <button className="text-button" onClick={() => setRules(true)}>
            ⓘ <span>How to play</span>
          </button>
          {room && (
            <button className="text-button" onClick={() => act("leave")}>
              Leave ↗
            </button>
          )}
        </nav>
      </header>
      <main>
        <div className="page-heading">
          <div>
            <div className="eyebrow">
              <span />{" "}
              {room ? "SHARED PLAYROOM" : "TONIGHT, CREATE NEW STORIES"}
            </div>
            <h1>
              {room ? (
                lobby ? (
                  "Is everyone here?"
                ) : (
                  "Climb honest, slide brave."
                )
              ) : (
                <>
                  Climb honest.
                  <br /> Slide <em>brave.</em>
                </>
              )}
            </h1>
            <p>
              {room
                ? lobby
                  ? "Get ready. An exciting journey begins here."
                  : "One board, a hundred surprises. Enjoy every turn."
                : "Classic snakes and ladders, with questions and challenges that bring you closer."}
            </p>
          </div>
          {room ? (
            <div className="room-pill">
              <small>PRIVATE ROOM</small>
              <button onClick={copy}>
                {room.code} <span>{copied ? "✓" : "⧉"}</span>
              </button>
            </div>
          ) : (
            <div className="hero-aside">
              <span className="little-spark">✳</span>
              <p>
                It's not just about
                <br />
                <b>who reaches the finish line first.</b>
              </p>
            </div>
          )}
        </div>
        {error && (
          <div className="error" role="alert">
            {error}
            <button onClick={() => setError("")} aria-label="Close message">
              ×
            </button>
            {room && !me && <button onClick={exit}>Back</button>}
          </div>
        )}
        {room && !connected && (
          <div className="connection" role="status">
            Connection disrupted. Reconnecting…{" "}
            <button onClick={exit}>Back to home</button>
          </div>
        )}
        <div className="game-layout">
          <section className="board-panel" aria-label="Snakes and ladders board">
            <div className="board-heading">
              <div>
                <span className="tiny-dot" />{" "}
                {room
                  ? "LDR SNAKES & LADDERS"
                  : "A BOARD FULL OF SURPRISES"}
              </div>
              <span>
                {room ? "2–6 PLAYERS · EXACT 100" : "100 TILES · 1 GOAL"}
              </span>
            </div>
            <div className="board">
              <div className="board-grid">
                {cells.map((n) => {
                  const t = board[n - 1],
                    occupants =
                      room?.players.filter((p) => p.position === n) || [];
                  return (
                    <button
                      className={"cell cell-" + t.type.toLowerCase()}
                      key={n}
                      onClick={() => setTile(n)}
                      aria-label={`Tile ${n}, ${labels[t.type]}${t.destination ? ", to " + t.destination : ""}${occupants.length ? ", players " + occupants.map((p) => p.name).join(", ") : ""}`}
                    >
                      <span className="cell-number">{n}</span>
                      <span className="cell-symbol">
                        {n === 100 ? "⚑" : icons[t.type]}
                      </span>
                      {n === 100 && (
                        <span className="finish-label">FINISH</span>
                      )}
                      <span className="tokens">
                        {occupants.map((p) => (
                          <span
                            key={p.id}
                            className="token"
                            style={{
                              background: colors[room!.players.indexOf(p)],
                            }}
                            title={p.name}
                          >
                            {avatars[p.avatar]}
                          </span>
                        ))}
                      </span>
                    </button>
                  );
                })}
              </div>
              <svg
                className="connections"
                viewBox="0 0 100 100"
                aria-hidden="true"
              >
                {Object.entries(ladders).map(([from, to]) => {
                  const a = coordinate(+from),
                    b = coordinate(to),
                    dx = b.x - a.x,
                    dy = b.y - a.y,
                    len = Math.hypot(dx, dy),
                    px = (-dy / len) * 0.65,
                    py = (dx / len) * 0.65;
                  return (
                    <g key={from} className="ladder">
                      <path
                        d={`M${a.x + px},${a.y + py} L${b.x + px},${b.y + py} M${a.x - px},${a.y - py} L${b.x - px},${b.y - py}`}
                      />
                      {Array.from({ length: Math.floor(len / 2.6) }, (_, i) => {
                        const t = (i + 1) / (Math.floor(len / 2.6) + 1),
                          x = a.x + dx * t,
                          y = a.y + dy * t;
                        return (
                          <path
                            key={i}
                            d={`M${x + px},${y + py} L${x - px},${y - py}`}
                          />
                        );
                      })}
                    </g>
                  );
                })}
                {Object.entries(snakes).map(([from, to]) => {
                  const a = coordinate(+from),
                    b = coordinate(to);
                  return (
                    <g key={from} className="snake">
                      <path
                        d={`M${a.x},${a.y} C${a.x + 8},${a.y + 7} ${b.x - 8},${b.y - 7} ${b.x},${b.y}`}
                      />
                      <circle cx={a.x} cy={a.y} r="1.1" />
                      <circle
                        className="snake-eye"
                        cx={a.x - 0.3}
                        cy={a.y - 0.2}
                        r=".18"
                      />
                    </g>
                  );
                })}
              </svg>
            </div>
            <div className="board-legend">
              {Object.entries(labels).map(([type, label]) => (
                <span key={type}>
                  <i className={"key key-" + type.toLowerCase()}>
                    {icons[type as keyof typeof icons]}
                  </i>
                  {label}
                </span>
              ))}
            </div>
            <div className="start-line">
              <span>START ↗</span>
              <div>
                {room ? (
                  room.players
                    .filter((p) => p.position === 0)
                    .map((p) => (
                      <span key={p.id} title={p.name}>
                        {avatars[p.avatar]}
                      </span>
                    ))
                ) : (
                  <small>Every journey begins from zero.</small>
                )}
              </div>
              <small>
                {room
                  ? "Tokens waiting off-board"
                  : "Click any tile to inspect its effect"}
              </small>
            </div>
          </section>
          <aside className="side-panel">
            {!room ? (
              <>
                <section className="card enter-card">
                  <span className="section-kicker">FAR APART, STILL TOGETHER</span>
                  <h2>Come on, let's play.</h2>
                  <p>Create a cozy space for memorable stories.</p>
                  <div className="segmented">
                    <button
                      className={mode === "create" ? "selected" : ""}
                      onClick={() => setMode("create")}
                    >
                      Create room
                    </button>
                    <button
                      className={mode === "join" ? "selected" : ""}
                      onClick={() => setMode("join")}
                    >
                      Join room
                    </button>
                  </div>
                  <form onSubmit={enter}>
                    <label htmlFor="name">Nickname</label>
                    <input
                      id="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="What your friends call you…"
                      minLength={2}
                      maxLength={20}
                      required
                      autoComplete="nickname"
                    />
                    <label>Choose your travel companion</label>
                    <div className="avatars">
                      {avatars.map((a, i) => (
                        <button
                          type="button"
                          key={a}
                          aria-label={
                            "Choose avatar " +
                            [
                              "tiger",
                              "frog",
                              "cat",
                              "panda",
                              "fox",
                              "rabbit",
                            ][i]
                          }
                          aria-pressed={avatar === i}
                          className={avatar === i ? "chosen" : ""}
                          onClick={() => setAvatar(i)}
                        >
                          {a}
                        </button>
                      ))}
                    </div>
                    {mode === "join" && (
                      <>
                        <label htmlFor="code">Room code</label>
                        <input
                          id="code"
                          value={code}
                          onChange={(e) =>
                            setCode(
                              e.target.value
                                .toUpperCase()
                                .replace(/[^A-Z2-9]/g, ""),
                            )
                          }
                          placeholder="Example: XJ7K2M"
                          minLength={6}
                          maxLength={6}
                          required
                        />
                      </>
                    )}
                    <button className="primary" disabled={busy}>
                      {busy
                        ? "Preparing…"
                        : mode === "create"
                          ? "Create new room ↗"
                          : "Join game ↗"}
                    </button>
                  </form>
                  <div className="privacy-note">
                    ♧ No account required · Private room · 2–6 players
                  </div>
                </section>
                <section className="invitation">
                  <span>✦</span>
                  <div>
                    <h3>Feel free to be yourself.</h3>
                    <p>
                      Uncomfortable with a card? You can always skip. Just step
                      back 3 tiles.
                    </p>
                  </div>
                </section>
              </>
            ) : (
              <>
                <section className="card players-card">
                  <div className="section-title">
                    <h2>{lobby ? "Player lobby" : "Travel companions"}</h2>
                    <span className="badge">{room.players.length}/6</span>
                  </div>
                  <div className="player-list">
                    {room.players.map((p, i) => (
                      <div
                        key={p.id}
                        className={
                          "player " +
                          (playing && active?.id === p.id
                            ? "active-player"
                            : "")
                        }
                      >
                        <span
                          className="player-avatar"
                          style={{ background: colors[i] + "25" }}
                        >
                          {avatars[p.avatar]}
                        </span>
                        <div className="player-name">
                          <b>
                            {p.name} {p.id === myId && <small>(you)</small>}
                          </b>
                          <small>
                            {p.id === room.host ? "♛ Host · " : ""}
                            {lobby
                              ? p.ready
                                ? "Ready to play"
                                : "Waiting to ready up"
                              : playing && p.id === active?.id
                                ? "Taking turn"
                                : `Tile ${p.position}`}
                            {now - p.seen > 45000 ? " · Offline" : ""}
                          </small>
                        </div>
                        {lobby ? (
                          <span
                            className={p.ready ? "ready-mark" : "not-ready"}
                          >
                            {p.ready ? "✓" : "·"}
                          </span>
                        ) : (
                          <span className="position-badge">{p.position}</span>
                        )}
                        {isHost && p.id !== myId && (
                          <button
                            className="kick"
                            aria-label={"Kick " + p.name}
                            title="Kick player"
                            disabled={busy}
                            onClick={() => act("kick", { target: p.id })}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {lobby && (
                    <button className="secondary full" onClick={copy}>
                      {copied ? "Link copied ✓" : "⧉ Copy invite link"}
                    </button>
                  )}
                </section>
                {lobby && (
                  <section className="card">
                    <span className="section-kicker">BEFORE THE JOURNEY</span>
                    <h2>Set the mood.</h2>
                    <label htmlFor="timer">Card timer</label>
                    <select
                      id="timer"
                      value={room.timer}
                      disabled={!isHost || busy}
                      onChange={(e) =>
                        act("settings", {
                          timer: Number(e.target.value),
                        })
                      }
                    >
                      <option value={0}>Default · Truth 60s / Dare 90s</option>
                      <option value={60}>60 seconds</option>
                      <option value={90}>90 seconds</option>
                      <option value={120}>120 seconds</option>
                    </select>
                    <p className="fine-print">
                      Answer through your chat or call. Skip a card: move back 3
                      tiles.{" "}
                      <button
                        className="inline-link"
                        onClick={() => setRules(true)}
                      >
                        Read rules
                      </button>
                    </p>
                    <button
                      className={me?.ready ? "secondary full" : "primary"}
                      disabled={busy}
                      onClick={() => act("ready")}
                    >
                      {me?.ready
                        ? "✓ You are ready · Cancel"
                        : "I'm ready to play ✓"}
                    </button>
                    {isHost && (
                      <button
                        className="primary start-button"
                        disabled={
                          busy ||
                          room.players.length < 2 ||
                          !room.players.every((p) => p.ready)
                        }
                        onClick={() => act("start")}
                      >
                        Start journey ↗
                      </button>
                    )}
                    <p className="center-note">
                      {room.players.length < 2
                        ? "Invite at least one more friend."
                        : !isHost
                          ? "The host will start once everyone is ready."
                          : "All players, including host, must be ready."}
                    </p>
                  </section>
                )}
                {playing && (
                  <section className="card turn-card">
                    <div className="section-title">
                      <span className="section-kicker">
                        {isTurn ? "YOUR TURN NOW" : "CURRENT TURN"}
                      </span>
                      <span
                        className={"timer " + (remaining <= 10 ? "urgent" : "")}
                      >
                        ◷ {remaining}s
                      </span>
                    </div>
                    <h2>
                      {active?.name}
                      <span className="wave">✳</span>
                    </h2>
                    <p>
                      {room.card
                        ? "A story awaits you."
                        : isTurn
                          ? "One roll, a new surprise."
                          : "Hold tight, your turn is coming up."}
                    </p>
                    <div className={"dice-area " + (rolling ? "rolling" : "")}>
                      <div
                        className="die"
                        aria-label={"Dice result " + room.dice}
                      >
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
                          <i
                            key={i}
                            className={
                              (
                                ({
                                  1: [5],
                                  2: [1, 9],
                                  3: [1, 5, 9],
                                  4: [1, 3, 7, 9],
                                  5: [1, 3, 5, 7, 9],
                                  6: [1, 3, 4, 6, 7, 9],
                                } as Record<number, number[]>)[room.dice] || []
                              ).includes(i)
                                ? "pip visible"
                                : "pip"
                            }
                          />
                        ))}
                      </div>
                      <span>
                        {room.card
                          ? "Complete your card first"
                          : "Dice rolled by server"}
                      </span>
                    </div>
                    <button
                      className="primary"
                      disabled={busy || !isTurn || !!room.card || !connected}
                      onClick={() => act("roll")}
                    >
                      {rolling
                        ? "Rolling dice…"
                        : isTurn
                          ? "Roll dice ↗"
                          : `Waiting for ${active?.name}…`}
                    </button>
                    <p className="center-note">
                      Rolling a 6 does not grant an extra turn.
                    </p>
                  </section>
                )}
                {playing && room.card && (
                  <section
                    className={"challenge " + room.card.type.toLowerCase()}
                  >
                    <div className="section-title">
                      <span className="challenge-tag">
                        {room.card.type === "TRUTH" ? "? TRUTH" : "ϟ DARE"}
                      </span>
                      <button
                        className="text-button"
                        onClick={() => setMinimized(!minimized)}
                        aria-expanded={!minimized}
                      >
                        {minimized ? "Open +" : "Minimize −"}
                      </button>
                    </div>
                    {!minimized && (
                      <>
                        <h3>{room.card.text}</h3>
                        <p>
                          For {active?.name} · do this over call or together.
                        </p>
                        {isTurn ? (
                          <div className="challenge-actions">
                            <button
                              className="dark-button"
                              disabled={busy || !connected}
                              onClick={() => act("complete")}
                            >
                              {room.card.type === "TRUTH"
                                ? "Answered ✓"
                                : "Done ✓"}
                            </button>
                            <button
                              className="skip-button"
                              disabled={busy || !connected}
                              onClick={() => act("skip")}
                            >
                              Skip · −3 tiles
                            </button>
                          </div>
                        ) : (
                          <p className="fine-print">
                            Waiting for player to complete or skip the card.
                          </p>
                        )}
                      </>
                    )}
                  </section>
                )}
                {ended && (
                  <section className="card result-card">
                    <span className="trophy">{room.winner ? "🏆" : "⚑"}</span>
                    <span className="section-kicker">
                      {room.winner ? "REACHED THE TOP!" : "SESSION ENDED"}
                    </span>
                    <h2>
                      {room.players.find((p) => p.id === room.winner)?.name ||
                        "Thanks for playing."}
                    </h2>
                    <p>
                      {room.winner
                        ? "Won on the board, closer in heart."
                        : room.reason}
                    </p>
                    {room.players.map((p) => (
                      <div className="result-row" key={p.id}>
                        <b>{p.name}</b>
                        <span>
                          {p.truth} Truth · {p.dare} Dare · {p.skipped} skipped
                        </span>
                      </div>
                    ))}
                    {isHost ? (
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() => act("rematch")}
                      >
                        Play again ↗
                      </button>
                    ) : (
                      <p>Waiting for host to open a new lobby.</p>
                    )}
                  </section>
                )}
                {!lobby && (
                  <section className="card history-card">
                    <div className="section-title">
                      <h3>Journey log</h3>
                      <span>↺</span>
                    </div>
                    <ol aria-live="polite">
                      {room.log.slice(0, 5).map((line, i) => (
                        <li key={line + i}>{line}</li>
                      ))}
                    </ol>
                  </section>
                )}
              </>
            )}
          </aside>
        </div>
        <div className="bottom-strip">
          <span>
            01 <b>Invite your favorite people</b>
          </span>
          <span>
            02 <b>Roll & follow the surprises</b>
          </span>
          <span>
            03 <b>Bring home stories</b>
          </span>
          <button onClick={() => setRules(true)}>View full rules ↗</button>
        </div>
      </main>
      <footer>
        <span className="footer-brand">naikjujur.</span>
        <span>Built for connection, played with honesty.</span>
        <span>✦ Skipping is always allowed.</span>
      </footer>
      {(rules || tile !== null) && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setRules(false);
            setTile(null);
          }}
        >
          <dialog
            ref={modalRef}
            aria-modal="true"
            open
            className="modal"
            aria-labelledby="modal-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setRules(false);
                setTile(null);
              }
            }}
          >
            <button
              autoFocus
              className="modal-close"
              aria-label="Close"
              onClick={() => {
                setRules(false);
                setTile(null);
              }}
            >
              ×
            </button>
            {rules ? (
              <>
                <span className="section-kicker">BEFORE YOU START</span>
                <h2 id="modal-title">
                  A few rules.
                  <br />
                  Lots of fun.
                </h2>
                <ol className="rules-list">
                  <li>
                    All tokens start at <b>0</b>. Take turns rolling the dice to move.
                  </li>
                  <li>
                    <b>Ladders climb up, snakes slide down.</b> Transfer destination tile
                    effects are not triggered again.
                  </li>
                  <li>
                    <b>? Truth</b> is answered verbally. <b>ϟ Dare</b> is performed directly.
                    Use your own call or chat; the app never records answers.
                  </li>
                  <li>
                    You may <b>Skip</b> anytime, no questions asked. Penalty: move back 3
                    tiles, minimum 0, without destination tile effects.
                  </li>
                  <li>
                    Dice roll window: <b>30 seconds</b>. Default card timers: Truth{" "}
                    <b>60 seconds</b> and Dare <b>90 seconds</b>. Timer expiring = skipped.
                  </li>
                  <li>
                    Win by <b>landing exactly on 100</b>. Overshooting rolls keep the token in place.
                    Rolling a 6 does not give an extra turn.
                  </li>
                  <li>
                    2–6 players. Disconnected players have a 60-second grace window after being
                    marked offline; host migrates automatically.
                  </li>
                </ol>
                <button className="primary" onClick={() => setRules(false)}>
                  Got it, let's play ↗
                </button>
              </>
            ) : (
              tile !== null && (
                <>
                  <span className="section-kicker">TILE {tile}</span>
                  <h2 id="modal-title">
                    {tile === 100
                      ? "Finish line ⚑"
                      : labels[board[tile - 1].type]}
                  </h2>
                  <p>
                    {board[tile - 1].destination
                      ? `Move to tile ${board[tile - 1].destination}. Destination tile effect is not triggered.`
                      : board[tile - 1].type === "EMPTY"
                        ? "Neutral tile. Catch your breath, your turn continues."
                        : board[tile - 1].type === "TRUTH"
                          ? "Stop here to answer a truth question. You may skip by moving back 3 tiles."
                          : "Stop here to perform a dare. You may skip by moving back 3 tiles."}
                  </p>
                </>
              )
            )}
          </dialog>
        </div>
      )}
    </>
  );
}
