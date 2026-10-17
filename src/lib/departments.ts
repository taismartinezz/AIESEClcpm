// The usual AIESEC departments, offered to the president as one-click
// suggestions in Settings → Departments. New LCs start without departments.
// Mirrors seed_default_departments() in supabase/migrations.

export interface SuggestedDepartment {
  name: string;
  color: string;
  products: string[];
  is_finance: boolean;
}

export const SUGGESTED_DEPARTMENTS: SuggestedDepartment[] = [
  { name: "Outgoing Global Volunteer",      color: "#F85A40", products: ["ogv"],          is_finance: false },
  { name: "Outgoing Global Talent/Teacher", color: "#0CB9C1", products: ["ogta", "ogte"], is_finance: false },
  { name: "Incoming Global Volunteer",      color: "#D9442B", products: ["igv"],          is_finance: false },
  { name: "Incoming Global Talent/Teacher", color: "#0A8F96", products: ["igta", "igte"], is_finance: false },
  { name: "Marketing",                      color: "#FFC845", products: [],               is_finance: false },
  { name: "Talent Management",              color: "#00C16E", products: [],               is_finance: false },
  { name: "Finance & Legality",             color: "#037EF3", products: [],               is_finance: true  },
  { name: "Business Development",           color: "#7552CC", products: [],               is_finance: false },
];
