import { NextRequest, NextResponse } from "next/server";
import { createRoom } from "../../../lib/game";
import { guard, fail, setIdentity } from "../../../lib/http";
export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  try {
    guard(req, true);
    const b = await req.json();
    const result = await createRoom(b.name, b.avatar);
    const res = NextResponse.json({
      room: result.room,
      playerId: result.player.id,
    });
    setIdentity(res, result.room.code, result.player.token);
    return res;
  } catch (e) {
    return fail(e);
  }
}
