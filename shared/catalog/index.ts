import type { Group, GroupId, Setting } from "../types";
import { access, basics } from "./basics-access";
import { items, tweaks } from "./items-tweaks";
import { advanced, backups, network, plugins, version } from "./ops";
import { performance, resources } from "./performance";
import { rules } from "./rules";
import { mobs, world } from "./world-mobs";

export const GROUPS: Group[] = [
  { id: "basics", label: "Server basics", icon: "Server", description: "Your server's name, how many can play, and the mode and difficulty new players get." },
  { id: "access", label: "Players & access", icon: "ShieldCheck", description: "Who is allowed in, what operators can do, and the messages people see when turned away." },
  { id: "rules", label: "Game rules", icon: "Gamepad2", description: "Everyday gameplay switches. These apply instantly, with no restart." },
  { id: "world", label: "World", icon: "Globe", description: "How new terrain generates, which dimensions exist, and limits on the world." },
  { id: "mobs", label: "Mobs & spawning", icon: "Bug", description: "How many mobs there are, where they appear, and how they behave." },
  { id: "items", label: "Items & farming", icon: "Wheat", description: "Dropped items, hoppers, crop growth and loot." },
  { id: "tweaks", label: "Gameplay tweaks", icon: "SlidersHorizontal", description: "Smaller adjustments to hunger, combat and movement." },
  { id: "performance", label: "Performance", icon: "Gauge", description: "Trade visual range and simulation for a smoother server." },
  { id: "resources", label: "Memory & Java", icon: "MemoryStick", description: "How much of the node the server may use, and how it shuts down." },
  { id: "plugins", label: "Plugins & packs", icon: "Puzzle", description: "Plugins, resource packs and datapacks downloaded when the server starts." },
  { id: "backups", label: "Backups", icon: "Archive", description: "When the world is archived, how long copies are kept, and what they contain." },
  { id: "version", label: "Version", icon: "PackageCheck", description: "Which Minecraft and Paper versions the server runs." },
  { id: "network", label: "Network & security", icon: "Network", description: "The tunnel, what the server reveals, and protection against cheats and floods." },
  { id: "advanced", label: "Advanced", icon: "Wrench", description: "Logging, data saving, command behaviour and unsupported options." },
];

export const SETTINGS: Setting[] = [
  ...basics,
  ...access,
  ...rules,
  ...world,
  ...mobs,
  ...items,
  ...tweaks,
  ...performance,
  ...resources,
  ...plugins,
  ...backups,
  ...version,
  ...network,
  ...advanced,
];

export const SETTINGS_BY_ID: ReadonlyMap<string, Setting> = new Map(SETTINGS.map((s) => [s.id, s]));

export function settingsInGroup(group: GroupId): Setting[] {
  return SETTINGS.filter((s) => s.group === group);
}

/** Order-preserving sections of a group. */
export function sectionsInGroup(group: GroupId): { title: string; settings: Setting[] }[] {
  const sections = new Map<string, Setting[]>();
  for (const setting of settingsInGroup(group)) {
    const existing = sections.get(setting.section);
    if (existing) existing.push(setting);
    else sections.set(setting.section, [setting]);
  }
  return [...sections].map(([title, settings]) => ({ title, settings }));
}

/** The technical name of a setting, shown in tooltips and used by search. */
export function technicalKey(setting: Setting): string {
  const t = setting.target;
  switch (t.kind) {
    case "env":
      return t.property ? `${t.name} → server.properties: ${t.property}` : t.name;
    case "resource":
      return `${t.container} container: resources.${t.path.join(".")}`;
    case "pod":
      return `StatefulSet: ${t.field}`;
    case "patch": {
      const file = { spigot: "spigot.yml", bukkit: "bukkit.yml", "paper-world": "paper-world-defaults.yml", chunky: "plugins/Chunky/config.yml" }[t.file];
      return `${file}: ${t.path.join(".")}`;
    }
    case "paper-global":
      return `paper-global.yml: ${t.path.join(".")}`;
    case "gamerule":
      return `/gamerule ${t.rule}`;
  }
}
