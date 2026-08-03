export type Role = 'owner' | 'admin' | 'member';

export type AppointmentKind = 'medico' | 'escuela' | 'mascota' | 'personal' | 'otro';

export interface Profile {
  id: string;
  display_name: string;
  created_at: string;
}

export interface Casa {
  id: string;
  name: string;
  invite_code: string;
  created_by: string | null;
  created_at: string;
}

export interface CasaMember {
  casa_id: string;
  user_id: string;
  role: Role;
  created_at: string;
}

export interface Category {
  id: string;
  casa_id: string;
  name: string;
  color: string;
  icon: string;
  budget: number | null;
  created_at: string;
}

export interface Expense {
  id: string;
  casa_id: string;
  category_id: string | null;
  user_id: string | null;
  title: string;
  amount: number;
  spent_at: string;
  note: string | null;
  created_at: string;
}

export interface Appointment {
  id: string;
  casa_id: string;
  user_id: string | null;
  title: string;
  description: string | null;
  person: string | null;
  location: string | null;
  kind: AppointmentKind;
  starts_at: string;
  reminder_at: string | null;
  created_at: string;
}

export interface ShoppingList {
  id: string;
  casa_id: string;
  user_id: string | null;
  title: string;
  done: boolean;
  created_at: string;
}

export interface ShoppingItem {
  id: string;
  list_id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  done: boolean;
  created_at: string;
}

export interface Contact {
  id: string;
  casa_id: string;
  user_id: string | null;
  name: string;
  birth_date: string;
  relationship: string | null;
  phone: string | null;
  created_at: string;
}
