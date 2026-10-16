export type AppRole =
  | "executive"
  | "hr_admin"
  | "finance"
  | "hod"
  | "employee"
  | "recruiter"
  | "system_admin"
  | "auditor";

export const ROLE_LABELS: Record<AppRole, string> = {
  executive: "Executive",
  hr_admin: "HR Admin",
  finance: "Finance",
  hod: "HOD / Manager",
  employee: "Employee",
  recruiter: "Recruiter",
  system_admin: "System Admin",
  auditor: "Auditor",
};

export type EmployeeStatus = "draft" | "active" | "probation" | "confirmed" | "notice" | "exited";
export const EMPLOYEE_STATUSES: EmployeeStatus[] = [
  "draft",
  "active",
  "probation",
  "confirmed",
  "notice",
  "exited",
];

export type EmploymentType = "permanent" | "contractual" | "probationary" | "intern" | "consultant";
export const EMPLOYMENT_TYPES: EmploymentType[] = [
  "permanent",
  "contractual",
  "probationary",
  "intern",
  "consultant",
];

export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface Employee {
  id: string;
  employee_code: string;
  user_id: string | null;
  first_name: string;
  last_name: string;
  full_name: string;
  father_name: string | null;
  work_email: string | null;
  personal_email: string | null;
  phone: string | null;
  date_of_birth: string | null;
  gender: "male" | "female" | "other" | null;
  marital_status: "single" | "married" | "divorced" | "widowed" | null;
  nationality: string | null;
  address: string | null;
  city: string | null;
  organization_id: string | null;
  department_id: string | null;
  position_id: string | null;
  location_id: string | null;
  manager_id: string | null;
  biometric_user_id: string | null;
  employment_type: EmploymentType;
  status: EmployeeStatus;
  joining_date: string | null;
  probation_end_date: string | null;
  confirmation_date: string | null;
  contract_end_date: string | null;
  exit_date: string | null;
}

export interface Department {
  id: string;
  code: string;
  name: string;
  unit_type: "department" | "section" | "team";
  parent_id: string | null;
  cost_center_id: string | null;
  head_employee_id: string | null;
  is_active: boolean;
}

export interface Position {
  id: string;
  code: string;
  title: string;
  grade: string | null;
  department_id: string | null;
  is_active: boolean;
}

export interface Location {
  id: string;
  code: string;
  name: string;
  city: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  geofence_radius_m: number;
  is_active: boolean;
}

export interface LeaveType {
  id: string;
  code: string;
  name: string;
  days_per_year: number;
  requires_hr_approval: boolean;
  allow_half_day: boolean;
  is_active: boolean;
}

export interface LeaveBalance {
  id: string;
  employee_id: string;
  leave_type_id: string;
  leave_type: string;
  year: number;
  entitled: number;
  used: number;
  pending: number;
  available: number;
}

export interface LeaveRequest {
  id: string;
  employee_id: string;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  half_day: boolean;
  days: number;
  reason: string | null;
  status: LeaveStatus;
  stage: "manager" | "hr" | "done";
  decision_comment: string | null;
  created_at: string;
}

/** Result shape returned by server actions to forms. */
export type ActionState = { ok?: boolean; error?: string; message?: string } | undefined;
