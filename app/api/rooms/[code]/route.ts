import { NextRequest, NextResponse } from "next/server";
import { action, joinRoom, snapshot } from "../../../../lib/game";
import { guard, fail, setIdentity } from "../../../../lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ code: string }> };
export async function GET(req: NextRequest, context: Context) {
  try {
    guard(req);
    const { code } = await context.params;
    return NextResponse.json(
      { room: await snapshot(code, req.cookies.get("nj_" + code)?.value || "") },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return fail(e);
  }
}
export async function POST(req: NextRequest, context: Context) {
  try {
    guard(req, true);
    const { code } = await context.params;
    const b = await req.json(),
      token = req.cookies.get("nj_" + code)?.value || "";
    if (b.kind === "join") {
      const result = await joinRoom(code, b.name, b.avatar, token);
      const res = NextResponse.json({
        room: result.room,
        playerId: result.player.id,
      });
      setIdentity(res, code, result.player.token);
      return res;
    }
    return NextResponse.json({ room: await action(code, token, b) });
  } catch (e) {
    return fail(e);
  }
}
