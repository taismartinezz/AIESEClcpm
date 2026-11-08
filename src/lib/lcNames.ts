// What two LC names are compared by, so "AIESEC in Lisbón!" and "aiesec Lisbon"
// (or "Eskişehir" and "Eskisehir") count as the same LC. Mirrors lc_name_key()
// in the database (migration 20261108005), which refuses a duplicate within a
// country; a database test checks the two agree.

// Letters that don't decompose into a base letter plus an accent.
const SPECIAL: Record<string, string> = { "ı": "i", "ł": "l", "ø": "o", "đ": "d", "ð": "d", "ħ": "h", "ŀ": "l", "æ": "ae", "œ": "oe", "ß": "ss", "þ": "th" };
// Filler words, as whole words in any script.
const FILLER = /(?<![\p{L}\p{N}_])(aiesec|in|at|en|em|de|del|da|do|of|the|lc)(?![\p{L}\p{N}_])/gu;

export function lcNameKey(name: string | null | undefined): string {
  return (name ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[ıłøđðħŀæœßþ]/g, (c) => SPECIAL[c])
    .replace(FILLER, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}
