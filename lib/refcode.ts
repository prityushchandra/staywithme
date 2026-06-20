import { randomInt } from "crypto";
import { prisma } from "./db";

// Unambiguous uppercase alphanumeric — no 0/O, 1/I/L to avoid misreads when a
// guest types the code. 5 chars over a 30-char alphabet ≈ 24M combinations.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const LEN = 5;

export function genRefCode(): string {
  let s = "";
  for (let i = 0; i < LEN; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

/** Generate a refCode that isn't already taken (retries on the rare collision). */
export async function createUniqueRefCode(): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = genRefCode();
    const existing = await prisma.listing.findUnique({
      where: { refCode: code },
      select: { id: true },
    });
    if (!existing) return code;
  }
  // Astronomically unlikely; widen with a 6th char as a fallback.
  return genRefCode() + ALPHABET[randomInt(ALPHABET.length)];
}
