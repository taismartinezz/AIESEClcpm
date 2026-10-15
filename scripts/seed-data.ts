// Fictional accounts for a demo Local Committee. All addresses are @example.com
// so the seed can never touch a real person's account.

export interface SeedPerson {
  email: string;
  name: string;
  role: "president" | "vp" | "member";
  /** Department the member belongs to (members only). */
  department?: string;
  /** Departments a VP leads. */
  leads?: string[];
}

export const SEED_LC_NAME = "AIESEC in Demo City";

export const SEED_PEOPLE: SeedPerson[] = [
  { email: "lcp@example.com",          name: "Sofia Almeida", role: "president" },
  { email: "vp.ogx@example.com",       name: "Kwame Mensah",  role: "vp", leads: ["Outgoing Global Volunteer", "Outgoing Global Talent/Teacher"] },
  { email: "vp.marketing@example.com", name: "Lena Fischer",  role: "vp", leads: ["Marketing"] },
  { email: "vp.finance@example.com",   name: "Omar Haddad",   role: "vp", leads: ["Finance & Legality"] },
  { email: "member1@example.com",      name: "Tais Martinez", role: "member", department: "Marketing" },
  { email: "member2@example.com",      name: "Diego Rojas",   role: "member", department: "Marketing" },
  { email: "member3@example.com",      name: "Ana Costa",     role: "member", department: "Marketing" },
  { email: "member4@example.com",      name: "Priya Nair",    role: "member", department: "Outgoing Global Volunteer" },
  { email: "member5@example.com",      name: "Jonas Berg",    role: "member", department: "Outgoing Global Volunteer" },
  { email: "member6@example.com",      name: "Mei Tanaka",    role: "member", department: "Outgoing Global Volunteer" },
];

export const SEED_EMAILS = SEED_PEOPLE.map((p) => p.email);
