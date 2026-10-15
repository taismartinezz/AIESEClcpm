// Institution search — Hipolabs Universities API with bundled fallback
// API docs: http://universities.hipolabs.com/search?name=<query>

export interface InstitutionResult {
  name: string;
  country: string;
  /** Normalized slug for projects.institution_key */
  key: string;
}

// ~50 common institutions as offline fallback
const FALLBACK_INSTITUTIONS: InstitutionResult[] = [
  { name: "Harvard University", country: "United States", key: "harvard" },
  { name: "Massachusetts Institute of Technology", country: "United States", key: "mit" },
  { name: "Stanford University", country: "United States", key: "stanford" },
  { name: "Yale University", country: "United States", key: "yale" },
  { name: "Columbia University", country: "United States", key: "columbia" },
  { name: "Princeton University", country: "United States", key: "princeton" },
  { name: "University of Chicago", country: "United States", key: "uchicago" },
  { name: "University of Pennsylvania", country: "United States", key: "upenn" },
  { name: "Northwestern University", country: "United States", key: "northwestern" },
  { name: "Duke University", country: "United States", key: "duke" },
  { name: "Johns Hopkins University", country: "United States", key: "jhu" },
  { name: "Dartmouth College", country: "United States", key: "dartmouth" },
  { name: "Brown University", country: "United States", key: "brown" },
  { name: "Cornell University", country: "United States", key: "cornell" },
  { name: "University of Michigan", country: "United States", key: "umich" },
  { name: "University of California, Berkeley", country: "United States", key: "berkeley" },
  { name: "University of California, Los Angeles", country: "United States", key: "ucla" },
  { name: "University of California, San Diego", country: "United States", key: "ucsd" },
  { name: "University of Washington", country: "United States", key: "uw" },
  { name: "University of Minnesota", country: "United States", key: "umn" },
  { name: "University of Texas at Austin", country: "United States", key: "utaustin" },
  { name: "New York University", country: "United States", key: "nyu" },
  { name: "Boston University", country: "United States", key: "bu" },
  { name: "Georgetown University", country: "United States", key: "georgetown" },
  { name: "Emory University", country: "United States", key: "emory" },
  { name: "Vanderbilt University", country: "United States", key: "vanderbilt" },
  { name: "University of Notre Dame", country: "United States", key: "notredame" },
  { name: "Carnegie Mellon University", country: "United States", key: "cmu" },
  { name: "Tufts University", country: "United States", key: "tufts" },
  { name: "George Washington University", country: "United States", key: "gwu" },
  { name: "University of Oxford", country: "United Kingdom", key: "oxford" },
  { name: "University of Cambridge", country: "United Kingdom", key: "cambridge" },
  { name: "Imperial College London", country: "United Kingdom", key: "imperial" },
  { name: "University College London", country: "United Kingdom", key: "ucl" },
  { name: "London School of Economics", country: "United Kingdom", key: "lse" },
  { name: "University of Edinburgh", country: "United Kingdom", key: "edinburgh" },
  { name: "University of Toronto", country: "Canada", key: "utoronto" },
  { name: "McGill University", country: "Canada", key: "mcgill" },
  { name: "University of British Columbia", country: "Canada", key: "ubc" },
  { name: "University of Melbourne", country: "Australia", key: "umelbourne" },
  { name: "Australian National University", country: "Australia", key: "anu" },
  { name: "ETH Zurich", country: "Switzerland", key: "ethz" },
  { name: "University of Amsterdam", country: "Netherlands", key: "uva" },
  { name: "Leiden University", country: "Netherlands", key: "leiden" },
  { name: "KU Leuven", country: "Belgium", key: "kuleuven" },
  { name: "University of Copenhagen", country: "Denmark", key: "ucph" },
  { name: "Karolinska Institutet", country: "Sweden", key: "karolinska" },
  { name: "University of Tokyo", country: "Japan", key: "utokyo" },
  { name: "National University of Singapore", country: "Singapore", key: "nus" },
  { name: "University of Cape Town", country: "South Africa", key: "uct" },
];

/** Convert an institution name to a slug compatible with institution_key */
export function toInstitutionKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bthe\b/g, "")
    .replace(/university|college|institute|of|and|at|,/gi, " ")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

let apiAvailable = true; // optimistic; set false on failure

export async function searchInstitutions(query: string): Promise<InstitutionResult[]> {
  if (!query.trim()) return [];
  const q = query.trim().toLowerCase();

  if (apiAvailable) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(
        `https://universities.hipolabs.com/search?name=${encodeURIComponent(query)}&limit=20`,
        { signal: controller.signal }
      );
      clearTimeout(timeout);
      if (res.ok) {
        const data = await res.json() as { name: string; country: string }[];
        return data.slice(0, 12).map((d) => ({
          name: d.name,
          country: d.country,
          key: toInstitutionKey(d.name),
        }));
      }
    } catch {
      apiAvailable = false; // fall back for the rest of this session
    }
  }

  // Bundled fallback — filter by query
  return FALLBACK_INSTITUTIONS.filter(
    (inst) =>
      inst.name.toLowerCase().includes(q) ||
      inst.key.includes(q.replace(/\s+/g, "_"))
  ).slice(0, 12);
}
