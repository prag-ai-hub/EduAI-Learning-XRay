/**
 * Response shapes from the Django service.
 *
 * These mirror the DRF serializers under `backend/apps` - each app's
 * `serializers.py`. When one changes, this changes with it; that is the
 * duplication this package exists to remove.
 */

export type SchoolStatus = "Pending" | "Active" | "Suspended" | "Closed";

/** SchoolSerializer, in the schools app. */
export type School = {
  id: string;
  name: string;
  city: string | null;
  board: string | null;
  status: SchoolStatus;
  created_at: string;
  approved_at: string | null;
  approved_by: string | null;
  suspended_at: string | null;
  /** Present on the directory listing only, where the queryset annotates them. */
  user_count?: number;
  student_count?: number;
};

export type Paginated<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

export type SchoolRegistration = {
  name: string;
  city?: string;
  board?: string;
  admin_name: string;
  phone?: string;
};
