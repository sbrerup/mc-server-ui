import { formatValue } from "../../shared/rules";
import type { Setting, Value } from "../../shared/types";

/** How a value reads for people, using the labels a setting defines. */
export function displayValue(setting: Setting | undefined, value: Value | undefined): string {
  if (setting?.control.type === "select") {
    const option = setting.control.options.find((o) => o.value === value);
    if (option) return option.label;
  }
  if (setting?.control.type === "number") {
    const special = setting.control.specials?.find((s) => s.value === value);
    if (special) return special.label;
    if (typeof value === "number" && setting.control.unit) return `${value} ${setting.control.unit}`;
  }
  return formatValue(value);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit++;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

export function timeAgo(date: string | undefined): string {
  if (!date) return "";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(date).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} d ago`;
}

export function uptime(date: string | undefined): string {
  if (!date) return "–";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(date).getTime()) / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} d ${hours % 24} h`;
}

export function shortSha(sha: string | undefined): string {
  return sha ? sha.slice(0, 7) : "–";
}

export function effectLabel(effect: Setting["effect"]): string {
  switch (effect) {
    case "live":
      return "Applies instantly";
    case "restart":
      return "Needs a restart";
    case "new-world":
      return "New terrain only";
  }
}

/** Longer text for tooltips. */
export function effectDetail(effect: Setting["effect"]): string {
  switch (effect) {
    case "live":
      return "Applies straight away with no restart.";
    case "restart":
      return "Takes effect after the server restarts, which happens automatically when you apply.";
    case "new-world":
      return "Only affects a new world or newly generated chunks. Existing terrain doesn't change.";
  }
}
