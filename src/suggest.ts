// "Did you mean …?" for a note name that does not exist. A model (or a person)
// that typos `sesion.md` or asks for `plan.md` when the file is `plan.txt`
// otherwise needs another round trip — a listing — to find the right name.
// Only runs on the failure path, so a successful read costs nothing extra.

const EXT_RE = /\.(?:md|markdown|txt)$/i;
const MAX_SUGGESTIONS = 3;

function stem(name: string): string {
  return name.replace(/\\/g, "/").replace(EXT_RE, "").toLowerCase();
}

function basenameOf(value: string): string {
  return value.slice(value.lastIndexOf("/") + 1);
}

/**
 * Edit distance where swapping two neighbouring letters is one edit (optimal
 * string alignment): `todya` is one typo away from `today`, not two.
 */
function distance(a: string, b: string): number {
  let before: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, before[j - 2] + 1);
      }
      current.push(best);
    }
    before = previous;
    previous = current;
  }
  return previous[b.length];
}

/** How close a candidate is to what was asked for; undefined when not close. */
function score(wanted: string, candidate: string): number | undefined {
  const forms = [stem(candidate), basenameOf(stem(candidate))];
  if (forms.includes(wanted)) return 0; // only case, extension or folder differ
  if (forms.some((form) => form.startsWith(wanted) || wanted.startsWith(form))) return 1;
  const closest = Math.min(...forms.map((form) => distance(wanted, form)));
  return closest <= Math.max(1, Math.floor(wanted.length / 3)) ? 1 + closest : undefined;
}

/** Up to three existing names close to `wanted`, closest first. */
export function suggestNames(wanted: string, names: readonly string[]): string[] {
  const key = stem(wanted.trim());
  if (key === "") return [];
  return names
    .map((name) => ({ name, rank: score(key, name) }))
    .filter((entry): entry is { name: string; rank: number } => entry.rank !== undefined)
    .sort((a, b) => a.rank - b.rank || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .slice(0, MAX_SUGGESTIONS)
    .map((entry) => entry.name);
}

/** " (did you mean a.md or b.md?)" for an error message, or "" when nothing is close. */
export function notFoundHint(wanted: string, names: readonly string[]): string {
  const found = suggestNames(wanted, names);
  if (found.length === 0) return "";
  const list =
    found.length === 1 ? found[0] : `${found.slice(0, -1).join(", ")} or ${found.at(-1)}`;
  return ` (did you mean ${list}?)`;
}
