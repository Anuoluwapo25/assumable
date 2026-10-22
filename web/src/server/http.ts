import "server-only";
import { toJson } from "@/lib/cashout/api";

export const json = (body: unknown, status = 200) =>
  new Response(toJson(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export const fail = (error: string, status = 400) => json({ error }, status);
