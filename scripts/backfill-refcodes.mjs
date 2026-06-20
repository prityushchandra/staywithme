import { PrismaClient } from "@prisma/client";
import { randomInt } from "crypto";
const prisma = new PrismaClient();

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const gen = () => Array.from({ length: 5 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

const used = new Set(
  (await prisma.listing.findMany({ where: { refCode: { not: null } }, select: { refCode: true } }))
    .map((l) => l.refCode)
);
const todo = await prisma.listing.findMany({ where: { refCode: null }, select: { id: true, title: true } });
for (const l of todo) {
  let code;
  do { code = gen(); } while (used.has(code));
  used.add(code);
  await prisma.listing.update({ where: { id: l.id }, data: { refCode: code } });
  console.log(`${code}  ${l.title}`);
}
console.log(`Backfilled ${todo.length} listing(s).`);
await prisma.$disconnect();
