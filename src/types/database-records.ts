/** Database column names used by profile and workspace screens (not domain UI objects). */
export interface UserProfileRecord {
  id?: string;
  name?: string | null;
  email?: string | null;
  bio?: string | null;
  institution?: string | null;
  avatar_url?: string | null;
  avatar_color?: string | null;
  avatar_initials?: string | null;
  created_at?: string;
}

export interface ProjectRecord {
  id: string;
  name?: string;
  institution?: string;
  color?: string | null;
}
