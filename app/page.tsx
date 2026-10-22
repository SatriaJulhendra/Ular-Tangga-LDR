"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { board, coordinate, ladders, snakes } from "../lib/board";
import type { PublicRoom } from "../lib/game";
const avatars = ["🐯", "🐸", "🐱", "🐼", "🦊", "🐰"];
const labels = {
  EMPTY: "Netral",
  LADDER: "Tangga",
  SNAKE: "Ular",
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
    const controller = new AbortController();
    const poll = async () => {
      try {
        const res = await fetch("/api/rooms/" + room.code, {
          cache: "no-store",
          signal: controller.signal,
        });
        const d = await res.json();
        if (!alive) return;
        if (d.error) {
          setError(d.error);
          setConnected(false);
        } else accept(d.room);
      } catch {
        if (alive) setConnected(false);
      }
    };
    const timer = setInterval(poll, 1000);
    return () => {
      alive = false;
      clearInterval(timer);
      controller.abort();
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
      setError("Tautan: " + location.origin + "?room=" + room!.code);
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
        <a className="brand" href="/" aria-label="Beranda">
          <span className="brand-icon">↗</span>
          <span>
            naik<span className="brand-light">jujur.</span>
            <small>ULAR TANGGA · TRUTH OR DARE</small>
          </span>
        </a>
        <nav>
          <span className="header-note">
            Sedikit keberuntungan. Banyak cerita.
          </span>
          <button className="text-button" onClick={() => setRules(true)}>
            ⓘ <span>Cara main</span>
          </button>
          {room && (
            <button className="text-button" onClick={() => act("leave")}>
              Keluar ↗
            </button>
          )}
        </nav>
      </header>
      <main>
        <div className="page-heading">
          <div>
            <div className="eyebrow">
              <span />{" "}
              {room ? "RUANG BERMAIN BERSAMA" : "MALAM INI, BIKIN CERITA BARU"}
            </div>
            <h1>
              {room ? (
                lobby ? (
                  "Semua sudah kumpul?"
                ) : (
                  "Naik jujur, turun berani."
                )
              ) : (
                <>
                  Naik jujur.
                  <br /> Turun <em>berani.</em>
                </>
              )}
            </h1>
            <p>
              {room
                ? lobby
                  ? "Siapkan diri. Perjalanan seru dimulai dari sini."
                  : "Satu papan, seratus kejutan. Nikmati setiap giliran."
                : "Ular tangga klasik, dengan pertanyaan dan tantangan yang bikin makin dekat."}
            </p>
          </div>
          {room ? (
            <div className="room-pill">
              <small>ROOM PRIVAT</small>
              <button onClick={copy}>
                {room.code} <span>{copied ? "✓" : "⧉"}</span>
              </button>
            </div>
          ) : (
            <div className="hero-aside">
              <span className="little-spark">✳</span>
              <p>
                Bukan cuma soal
                <br />
                <b>siapa yang sampai duluan.</b>
              </p>
            </div>
          )}
        </div>
        {error && (
          <div className="error" role="alert">
            {error}
            <button onClick={() => setError("")} aria-label="Tutup pesan">
              ×
            </button>
            {room && !me && <button onClick={exit}>Kembali</button>}
          </div>
        )}
        {room && !connected && (
          <div className="connection" role="status">
            Koneksi terganggu. Mencoba menyambungkan kembali…{" "}
            <button onClick={exit}>Kembali ke beranda</button>
          </div>
        )}
        <div className="game-layout">
          <section className="board-panel" aria-label="Papan ular tangga">
            <div className="board-heading">
              <div>
                <span className="tiny-dot" />{" "}
                {room
                  ? `PAKET ${room.pack.toUpperCase()}`
                  : "PAPAN PENUH KEJUTAN"}
              </div>
              <span>
                {room ? "2–6 PEMAIN · TEPAT 100" : "100 KOTAK · 1 TUJUAN"}
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
                      aria-label={`Kotak ${n}, ${labels[t.type]}${t.destination ? ", ke " + t.destination : ""}${occupants.length ? ", pemain " + occupants.map((p) => p.name).join(", ") : ""}`}
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
                  <small>Setiap perjalanan dimulai dari nol.</small>
                )}
              </div>
              <small>
                {room
                  ? "Pion menunggu di luar papan"
                  : "Klik kotak untuk melihat efeknya"}
              </small>
            </div>
          </section>
          <aside className="side-panel">
            {!room ? (
              <>
                <section className="card enter-card">
                  <span className="section-kicker">TEMAN JAUH, TETAP SERU</span>
                  <h2>Yuk, main bareng.</h2>
                  <p>Buat ruang kecil untuk cerita besar.</p>
                  <div className="segmented">
                    <button
                      className={mode === "create" ? "selected" : ""}
                      onClick={() => setMode("create")}
                    >
                      Buat room
                    </button>
                    <button
                      className={mode === "join" ? "selected" : ""}
                      onClick={() => setMode("join")}
                    >
                      Gabung room
                    </button>
                  </div>
                  <form onSubmit={enter}>
                    <label htmlFor="name">Nama panggilan</label>
                    <input
                      id="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Teman-teman memanggilmu…"
                      minLength={2}
                      maxLength={20}
                      required
                      autoComplete="nickname"
                    />
                    <label>Pilih teman perjalananmu</label>
                    <div className="avatars">
                      {avatars.map((a, i) => (
                        <button
                          type="button"
                          key={a}
                          aria-label={
                            "Pilih avatar " +
                            [
                              "harimau",
                              "katak",
                              "kucing",
                              "panda",
                              "rubah",
                              "kelinci",
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
                        <label htmlFor="code">Kode room</label>
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
                          placeholder="Contoh: XJ7K2M"
                          minLength={6}
                          maxLength={6}
                          required
                        />
                      </>
                    )}
                    <button className="primary" disabled={busy}>
                      {busy
                        ? "Menyiapkan…"
                        : mode === "create"
                          ? "Buat room baru ↗"
                          : "Gabung permainan ↗"}
                    </button>
                  </form>
                  <div className="privacy-note">
                    ♧ Tanpa akun · Room privat · 2–6 pemain
                  </div>
                </section>
                <section className="invitation">
                  <span>✦</span>
                  <div>
                    <h3>Bebas jadi diri sendiri.</h3>
                    <p>
                      Kurang nyaman dengan kartu? Selalu boleh lewati. Cukup
                      mundur 3 kotak.
                    </p>
                  </div>
                </section>
              </>
            ) : (
              <>
                <section className="card players-card">
                  <div className="section-title">
                    <h2>{lobby ? "Lobby pemain" : "Teman seperjalanan"}</h2>
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
                            {p.name} {p.id === myId && <small>(kamu)</small>}
                          </b>
                          <small>
                            {p.id === room.host ? "♛ Host · " : ""}
                            {lobby
                              ? p.ready
                                ? "Siap bermain"
                                : "Menunggu siap"
                              : playing && p.id === active?.id
                                ? "Sedang bermain"
                                : `Kotak ${p.position}`}
                            {now - p.seen > 15000 ? " · Offline" : ""}
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
                            aria-label={"Keluarkan " + p.name}
                            title="Keluarkan pemain"
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
                      {copied ? "Tautan disalin ✓" : "⧉ Salin undangan"}
                    </button>
                  )}
                </section>
                {lobby && (
                  <section className="card">
                    <span className="section-kicker">SEBELUM PERJALANAN</span>
                    <h2>Atur suasananya.</h2>
                    <label htmlFor="pack">Paket kartu</label>
                    <select
                      id="pack"
                      value={room.pack}
                      disabled={!isHost || busy}
                      onChange={(e) =>
                        act("settings", {
                          pack: e.target.value,
                          timer: room.timer,
                        })
                      }
                    >
                      <option>Keluarga</option>
                      <option>Teman</option>
                      <option>Pasangan</option>
                    </select>
                    <label htmlFor="timer">Waktu kartu</label>
                    <select
                      id="timer"
                      value={room.timer}
                      disabled={!isHost || busy}
                      onChange={(e) =>
                        act("settings", {
                          pack: room.pack,
                          timer: Number(e.target.value),
                        })
                      }
                    >
                      <option value={0}>Default · Truth 60d / Dare 90d</option>
                      <option value={60}>60 detik</option>
                      <option value={90}>90 detik</option>
                      <option value={120}>120 detik</option>
                    </select>
                    <p className="fine-print">
                      Jawab lewat obrolan atau panggilan kalian. Lewati kartu:
                      mundur 3 kotak.{" "}
                      <button
                        className="inline-link"
                        onClick={() => setRules(true)}
                      >
                        Baca aturan
                      </button>
                    </p>
                    <button
                      className={me?.ready ? "secondary full" : "primary"}
                      disabled={busy}
                      onClick={() => act("ready")}
                    >
                      {me?.ready
                        ? "✓ Kamu sudah siap · Batalkan"
                        : "Aku siap bermain ✓"}
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
                        Mulai perjalanan ↗
                      </button>
                    )}
                    <p className="center-note">
                      {room.players.length < 2
                        ? "Ajak minimal satu teman lagi."
                        : !isHost
                          ? "Host akan memulai saat semua siap."
                          : "Semua pemain, termasuk host, harus siap."}
                    </p>
                  </section>
                )}
                {playing && (
                  <section className="card turn-card">
                    <div className="section-title">
                      <span className="section-kicker">
                        {isTurn ? "SEKARANG GILIRANMU" : "GILIRAN BERMAIN"}
                      </span>
                      <span
                        className={"timer " + (remaining <= 10 ? "urgent" : "")}
                      >
                        ◷ {remaining}d
                      </span>
                    </div>
                    <h2>
                      {active?.name}
                      <span className="wave">✳</span>
                    </h2>
                    <p>
                      {room.card
                        ? "Ada cerita yang menunggumu."
                        : isTurn
                          ? "Satu lemparan, kejutan baru."
                          : "Tunggu sebentar, giliranmu akan tiba."}
                    </p>
                    <div className={"dice-area " + (rolling ? "rolling" : "")}>
                      <div
                        className="die"
                        aria-label={"Hasil dadu " + room.dice}
                      >
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
                          <i
                            key={i}
                            className={
                              (
                                {
                                  1: [5],
                                  2: [1, 9],
                                  3: [1, 5, 9],
                                  4: [1, 3, 7, 9],
                                  5: [1, 3, 5, 7, 9],
                                  6: [1, 3, 4, 6, 7, 9],
                                }[room.dice] || []
                              ).includes(i)
                                ? "pip visible"
                                : "pip"
                            }
                          />
                        ))}
                      </div>
                      <span>
                        {room.card
                          ? "Selesaikan kartumu dahulu"
                          : "Dadu ditentukan oleh server"}
                      </span>
                    </div>
                    <button
                      className="primary"
                      disabled={busy || !isTurn || !!room.card || !connected}
                      onClick={() => act("roll")}
                    >
                      {rolling
                        ? "Dadu bergulir…"
                        : isTurn
                          ? "Lempar dadu ↗"
                          : `Menunggu ${active?.name}…`}
                    </button>
                    <p className="center-note">
                      Angka 6 tidak menambah giliran.
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
                        {minimized ? "Buka +" : "Kecilkan −"}
                      </button>
                    </div>
                    {!minimized && (
                      <>
                        <h3>{room.card.text}</h3>
                        <p>
                          Untuk {active?.name} · lakukan lewat panggilan atau
                          saat bersama.
                        </p>
                        {isTurn ? (
                          <div className="challenge-actions">
                            <button
                              className="dark-button"
                              disabled={busy || !connected}
                              onClick={() => act("complete")}
                            >
                              {room.card.type === "TRUTH"
                                ? "Sudah dijawab ✓"
                                : "Selesai ✓"}
                            </button>
                            <button
                              className="skip-button"
                              disabled={busy || !connected}
                              onClick={() => act("skip")}
                            >
                              Lewati · −3 kotak
                            </button>
                          </div>
                        ) : (
                          <p className="fine-print">
                            Menunggu pemain menyelesaikan atau melewati kartu.
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
                      {room.winner ? "SAMPAI DI PUNCAK!" : "SESI BERAKHIR"}
                    </span>
                    <h2>
                      {room.players.find((p) => p.id === room.winner)?.name ||
                        "Terima kasih bermain."}
                    </h2>
                    <p>
                      {room.winner
                        ? "Menang di papan, dekat di pertemanan."
                        : room.reason}
                    </p>
                    {room.players.map((p) => (
                      <div className="result-row" key={p.id}>
                        <b>{p.name}</b>
                        <span>
                          {p.truth} Truth · {p.dare} Dare · {p.skipped} lewati
                        </span>
                      </div>
                    ))}
                    {isHost ? (
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() => act("rematch")}
                      >
                        Main lagi ↗
                      </button>
                    ) : (
                      <p>Menunggu host membuka lobby baru.</p>
                    )}
                  </section>
                )}
                {!lobby && (
                  <section className="card history-card">
                    <div className="section-title">
                      <h3>Jejak perjalanan</h3>
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
            01 <b>Ajak orang favoritmu</b>
          </span>
          <span>
            02 <b>Lempar & ikuti kejutan</b>
          </span>
          <span>
            03 <b>Bawa pulang cerita</b>
          </span>
          <button onClick={() => setRules(true)}>Lihat aturan lengkap ↗</button>
        </div>
      </main>
      <footer>
        <span className="footer-brand">naikjujur.</span>
        <span>Dibuat untuk kebersamaan, dimainkan dengan kejujuran.</span>
        <span>✦ Selalu boleh lewati.</span>
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
              aria-label="Tutup"
              onClick={() => {
                setRules(false);
                setTile(null);
              }}
            >
              ×
            </button>
            {rules ? (
              <>
                <span className="section-kicker">SEBELUM MULAI</span>
                <h2 id="modal-title">
                  Sedikit aturan.
                  <br />
                  Banyak keseruan.
                </h2>
                <ol className="rules-list">
                  <li>
                    Semua pion mulai dari <b>0</b>. Bergiliran lempar dadu untuk
                    melangkah.
                  </li>
                  <li>
                    <b>Tangga naik, ular turun.</b> Efek kotak tujuan
                    perpindahan tidak dijalankan lagi.
                  </li>
                  <li>
                    <b>? Truth</b> dijawab lisan. <b>ϟ Dare</b> dilakukan
                    langsung. Gunakan panggilan kalian sendiri; aplikasi tidak
                    merekam jawaban.
                  </li>
                  <li>
                    Boleh <b>Lewati</b> kapan saja, tanpa alasan. Penalti mundur
                    3 kotak, minimum 0, tanpa efek tujuan.
                  </li>
                  <li>
                    Waktu lempar <b>30 detik</b>. Default kartu Truth{" "}
                    <b>60 detik</b> dan Dare <b>90 detik</b>. Waktu kartu habis
                    = lewati.
                  </li>
                  <li>
                    Menang dengan <b>tepat mencapai 100</b>. Jika dadu berlebih,
                    pion tetap. Angka 6 tidak memberi giliran tambahan.
                  </li>
                  <li>
                    2–6 pemain. Koneksi putus punya tenggang 60 detik setelah
                    dinyatakan offline; host berpindah otomatis.
                  </li>
                </ol>
                <button className="primary" onClick={() => setRules(false)}>
                  Paham, ayo main ↗
                </button>
              </>
            ) : (
              tile !== null && (
                <>
                  <span className="section-kicker">KOTAK {tile}</span>
                  <h2 id="modal-title">
                    {tile === 100
                      ? "Garis akhir ⚑"
                      : labels[board[tile - 1].type]}
                  </h2>
                  <p>
                    {board[tile - 1].destination
                      ? `Pindah ke kotak ${board[tile - 1].destination}. Efek kotak tujuan tidak dipicu.`
                      : board[tile - 1].type === "EMPTY"
                        ? "Kotak netral. Istirahat sejenak, giliran berlanjut."
                        : board[tile - 1].type === "TRUTH"
                          ? "Berhenti di sini untuk menjawab pertanyaan. Boleh lewati dengan mundur 3 kotak."
                          : "Berhenti di sini untuk melakukan tantangan. Boleh lewati dengan mundur 3 kotak."}
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
