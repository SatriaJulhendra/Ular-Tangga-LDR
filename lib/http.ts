import { NextRequest, NextResponse } from "next/server";
const limits = new Map<string, { at: number; count: number }>();
export function guard(req: NextRequest, mutation = false) {
  if (
    mutation &&
    req.headers.get("origin") &&
    new URL(req.headers.get("origin")!).host !== req.headers.get("host")
  )
    throw Error("Origin permintaan tidak diizinkan.");
  if (Number(req.headers.get("content-length") || 0) > 4096)
    throw Error("Permintaan terlalu besar.");
  const key = req.headers.get("x-forwarded-for")?.split(",")[0] || "local";
  const now = Date.now(),
    entry = limits.get(key);
  if (!entry || now - entry.at > 60000) limits.set(key, { at: now, count: 1 });
  else if (++entry.count > 900)
    throw Error("Terlalu banyak permintaan. Tunggu sebentar.");
  if (limits.size > 10000)
    for (const [k, v] of limits) if (now - v.at > 60000) limits.delete(k);
}
export function setIdentity(res: NextResponse, code: string, token: string) {
  res.cookies.set("nj_" + code, token, {
    httpOnly: true,
    sameSite: "strict",
    secure:
      process.env.NODE_ENV === "production" &&
      process.env.COOKIE_SECURE === "true",
    path: "/api/rooms",
    maxAge: 86400,
  });
}
export function fail(e: unknown) {
  return NextResponse.json(
    {
      error:
        e instanceof Error
          ? e.message
          : "Terjadi kesalahan. Silakan coba lagi.",
    },
    { status: 400 },
  );
}
