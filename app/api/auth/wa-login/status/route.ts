import { NextResponse } from "next/server";
import { waLoginStatus } from "@/lib/wa-login";

// Browser polls this with its token until the status flips to "verified" (the
// moment the user's WhatsApp message lands). No phone/account info is returned.
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!token) return NextResponse.json({ status: "unknown" }, { status: 400 });
  const status = await waLoginStatus(token);
  return NextResponse.json({ status });
}
