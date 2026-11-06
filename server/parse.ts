/** Parsers for the text the server and its containers print. */
import type { BackupEntry, OnlinePlayers, PlayerEntry } from "../shared/types";

/** Removes ANSI colours and § formatting codes, which RCON replies are full of. */
export function stripFormatting(text: string): string {
  return text
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
    .replace(/§x/g, "")
    .replace(/§[0-9a-zA-Z]/g, "")
    .replace(/\r/g, "")
    .trim();
}

/** The replies from one rcon-cli session, which prompts before each command: `> reply one\n> reply two\n> ` */
export function parseRconSession(text: string): string[] {
  if (!text.startsWith("> ")) return [];
  return text.slice(2).split("\n> ").slice(0, -1).map(stripFormatting);
}

/** `There are 2 of a max of 10 players online: Alice, Bob` */
export function parseList(text: string): OnlinePlayers | undefined {
  const match = stripFormatting(text).match(/There are (\d+) of a max of (\d+) players online:?\s*(.*)$/s);
  if (!match) return undefined;
  const names = (match[3] ?? "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
  return { count: Number(match[1]), max: Number(match[2]), names };
}

/** `TPS from last 1m, 5m, 15m: 20.0, 20.0, 20.0`, where Paper can write `*20.0` when above 20. */
export function parseTps(text: string) {
  const match = stripFormatting(text).match(/([\d.]+),\s*\*?([\d.]+),\s*\*?([\d.]+)\s*$/);
  if (!match) return undefined;
  return { m1: Number(match[1]), m5: Number(match[2]), m15: Number(match[3]) };
}

/** Avg/min/max for the last 5s, 10s and 1m: `◴ 0.2/0.1/2.0, 0.1/0.1/2.0, 0.1/0.1/5.0` */
export function parseMspt(text: string) {
  const triples = [...stripFormatting(text).matchAll(/([\d.]+)\/([\d.]+)\/([\d.]+)/g)];
  if (triples.length < 3) return undefined;
  const first = triples[0]!;
  const last = triples[2]!;
  return {
    avg5s: Number(first[1]),
    min5s: Number(first[2]),
    max5s: Number(first[3]),
    avg1m: Number(last[1]),
    max1m: Number(last[3]),
  };
}

/** `Game rule keep_inventory is currently set to false` */
export function parseGamerule(text: string): boolean | number | undefined {
  const match = stripFormatting(text).match(/is (?:currently |now )?set to:? (\S+)\s*$/);
  if (!match) return undefined;
  const value = match[1]!;
  if (value === "true") return true;
  if (value === "false") return false;
  const number = Number(value);
  return Number.isNaN(number) ? undefined : number;
}

/** `ls -l --time-style=+%s /backups`: mode links owner group size epoch name */
export function parseBackups(text: string): BackupEntry[] {
  const entries: BackupEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^-\S+\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) continue;
    entries.push({
      name: match[3]!,
      sizeBytes: Number(match[1]),
      createdAt: new Date(Number(match[2]) * 1000).toISOString(),
    });
  }
  return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** The last line of `df -kP`. */
export function parseDf(text: string) {
  const line = text.trim().split(/\r?\n/).pop() ?? "";
  const match = line.match(/\s(\d+)\s+(\d+)\s+(\d+)\s+\d+%/);
  if (!match) return undefined;
  return { totalBytes: Number(match[1]) * 1024, usedBytes: Number(match[2]) * 1024 };
}

function parseJsonList(text: string): Record<string, unknown>[] {
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : [];
  } catch {
    return [];
  }
}

const str = (value: unknown) => (typeof value === "string" ? value : undefined);

export function parsePlayerFile(text: string): PlayerEntry[] {
  return parseJsonList(text)
    .map((entry) => ({
      name: str(entry.name) ?? "",
      uuid: str(entry.uuid),
      level: typeof entry.level === "number" ? entry.level : undefined,
      reason: str(entry.reason),
      source: str(entry.source),
      created: str(entry.created),
      expires: str(entry.expires),
    }))
    .filter((entry) => entry.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function parseIpBans(text: string) {
  return parseJsonList(text).map((entry) => ({
    ip: str(entry.ip) ?? "",
    reason: str(entry.reason),
    created: str(entry.created),
    source: str(entry.source),
  }));
}
