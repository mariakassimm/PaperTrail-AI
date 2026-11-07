import type { ReactNode } from "react";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Mirrors the backend's stopword list closely enough that we never highlight filler words.
const STOP = new Set(("a an and are as at be been but by can could did do does for from had has have how if in into is it its me my of on or our so than " +
  "that the their them then there these they this to was we were what when where which who whom why will with would you your about tell").split(" "));

/** Highlight whole-word matches of the query's content words (plural-tolerant). Never uses innerHTML. */
export function highlight(text: string, query: string): ReactNode {
  const stems = Array.from(new Set(query.toLowerCase().split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))));
  if (!stems.length) return text;
  const re = new RegExp(`(\\b(?:${stems.map(escapeRe).join("|")})s?\\b)`, "gi");
  return text.split(re).map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : part));
}

/** Single line breaks inside a paragraph are PDF layout, not meaning: show them as spaces. */
export const reflow = (s: string) => s.replace(/(?<!\n)\n(?!\n)/g, " ");
