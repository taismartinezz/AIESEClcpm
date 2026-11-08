// What two LC names are compared by, so "AIESEC in Lisbón!" and "aiesec Lisbon"
// count as the same LC. Mirrors lc_name_key() in the database (migration
// 20261108003), which refuses a duplicate within a country; keep them equal.

const ACCENTS = "áàâãäåéèêëíìîïóòôõöúùûüçñ";
const PLAIN   = "aaaaaaeeeeiiiiooooouuuucn";
const FILLER  = /\b(aiesec|in|at|en|em|de|del|da|do|of|the|lc)\b/g;

export function lcNameKey(name: string | null | undefined): string {
  const lower = [...(name ?? "").toLowerCase()].map((c) => {
    const i = ACCENTS.indexOf(c);
    return i >= 0 ? PLAIN[i] : c;
  }).join("");
  return lower.replace(FILLER, "").replace(/[^a-z0-9]+/g, "");
}
