import { NextResponse } from "next/server";
import { waLoginInfo } from "@/lib/wa-login";

// Browser polls this with its token until the status flips to "verified" (the
// moment the user's WhatsApp message lands). Returns `needsProfile` so the UI
// can collect a name on a first-ever login. No phone/account info is returned.
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!token) return NextResponse.json({ status: "unknown" }, { status: 400 });
  const info = await waLoginInfo(token);
  return NextResponse.json(info);
}
