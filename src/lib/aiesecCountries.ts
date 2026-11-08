// Countries and territories with an AIESEC entity: the only choices in the
// Country picker (onboarding, Settings > Profile). Edit this list when AIESEC
// opens or closes an entity. `code` is ISO 3166-1 alpha-2; it's what we store.

export interface AiesecCountry { code: string; name: string; flag: string }

/** Flag emoji from the two-letter code (regional indicator letters). */
const flagOf = (code: string) => String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

const ENTRIES: [code: string, name: string][] = [
  ["AL", "Albania"], ["DZ", "Algeria"], ["AR", "Argentina"], ["AM", "Armenia"], ["AU", "Australia"],
  ["AT", "Austria"], ["AZ", "Azerbaijan"], ["BH", "Bahrain"], ["BD", "Bangladesh"], ["BE", "Belgium"],
  ["BJ", "Benin"], ["BO", "Bolivia"], ["BA", "Bosnia and Herzegovina"], ["BR", "Brazil"], ["BG", "Bulgaria"],
  ["BF", "Burkina Faso"], ["KH", "Cambodia"], ["CM", "Cameroon"], ["CA", "Canada"], ["CL", "Chile"],
  ["CN", "China (Mainland)"], ["CO", "Colombia"], ["CR", "Costa Rica"], ["CI", "Côte d'Ivoire"], ["HR", "Croatia"],
  ["CZ", "Czech Republic"], ["DK", "Denmark"], ["DO", "Dominican Republic"], ["EC", "Ecuador"], ["EG", "Egypt"],
  ["SV", "El Salvador"], ["EE", "Estonia"], ["ET", "Ethiopia"], ["FI", "Finland"], ["FR", "France"],
  ["GE", "Georgia"], ["DE", "Germany"], ["GH", "Ghana"], ["GR", "Greece"], ["GT", "Guatemala"],
  ["HK", "Hong Kong"], ["HU", "Hungary"], ["IS", "Iceland"], ["IN", "India"], ["ID", "Indonesia"],
  ["IT", "Italy"], ["JP", "Japan"], ["JO", "Jordan"], ["KZ", "Kazakhstan"], ["KE", "Kenya"],
  ["KW", "Kuwait"], ["KG", "Kyrgyzstan"], ["LV", "Latvia"], ["LB", "Lebanon"], ["LR", "Liberia"],
  ["LT", "Lithuania"], ["MY", "Malaysia"], ["MX", "Mexico"], ["MD", "Moldova"], ["MN", "Mongolia"],
  ["ME", "Montenegro"], ["MA", "Morocco"], ["MZ", "Mozambique"], ["MM", "Myanmar"], ["NP", "Nepal"],
  ["NL", "Netherlands"], ["NZ", "New Zealand"], ["NI", "Nicaragua"], ["NG", "Nigeria"], ["MK", "North Macedonia"],
  ["NO", "Norway"], ["PK", "Pakistan"], ["PA", "Panama"], ["PY", "Paraguay"], ["PE", "Peru"],
  ["PH", "Philippines"], ["PL", "Poland"], ["PT", "Portugal"], ["RO", "Romania"], ["RU", "Russia"],
  ["RW", "Rwanda"], ["SN", "Senegal"], ["RS", "Serbia"], ["SG", "Singapore"], ["SK", "Slovakia"],
  ["ZA", "South Africa"], ["KR", "South Korea"], ["ES", "Spain"], ["LK", "Sri Lanka"], ["SE", "Sweden"],
  ["CH", "Switzerland"], ["TW", "Taiwan"], ["TZ", "Tanzania"], ["TH", "Thailand"], ["TG", "Togo"],
  ["TN", "Tunisia"], ["TR", "Turkey"], ["UG", "Uganda"], ["UA", "Ukraine"], ["AE", "United Arab Emirates"],
  ["GB", "United Kingdom"], ["US", "United States"], ["VE", "Venezuela"], ["VN", "Vietnam"],
];

export const AIESEC_COUNTRIES: AiesecCountry[] = ENTRIES
  .map(([code, name]) => ({ code, name, flag: flagOf(code) }))
  .sort((a, b) => a.name.localeCompare(b.name, "en"));

export function countryByCode(code: string | null | undefined): AiesecCountry | null {
  return code ? AIESEC_COUNTRIES.find((c) => c.code === code.toUpperCase()) ?? null : null;
}

/** For matching what people type: lower case, accents and punctuation gone ("Côte" → "cote"). */
export function foldText(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Countries whose name (or code) matches the query, names starting with it first. */
export function searchCountries(query: string): AiesecCountry[] {
  const q = foldText(query);
  if (!q) return AIESEC_COUNTRIES;
  const hits = AIESEC_COUNTRIES.filter((c) => foldText(c.name).includes(q) || c.code.toLowerCase() === q);
  const starts = (c: AiesecCountry) => foldText(c.name).split(" ").some((w) => w.startsWith(q)) ? 0 : 1;
  return hits.sort((a, b) => starts(a) - starts(b));
}

// Countries whose name takes "the" in English ("AIESEC in the Netherlands").
const WITH_THE = new Set(["NL", "US", "PH", "GB", "AE", "CZ", "DO"]);

/** The MC's name for a country: "AIESEC in Portugal", "AIESEC in the Netherlands". The MCP can rename it. */
export function mcNameFor(code: string): string {
  const c = countryByCode(code);
  if (!c) return "";
  return `AIESEC in ${WITH_THE.has(c.code) ? "the " : ""}${c.name}`;
}
