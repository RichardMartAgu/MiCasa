import type { Database } from './database.types';

type Tables = Database['public']['Tables'];

export type Role = 'owner' | 'admin' | 'member';

export type AppointmentKind = 'medico' | 'escuela' | 'personal' | 'otro';

export type AppointmentKindRow = Tables['appointment_kinds']['Row'];

export type Profile = Tables['profiles']['Row'];

export type Casa = Tables['casas']['Row'];

export type CasaMember = Omit<Tables['casa_members']['Row'], 'role'> & { role: Role };

export type Category = Tables['categories']['Row'];

export type Expense = Tables['expenses']['Row'];

export type Appointment = Omit<Tables['appointments']['Row'], 'kind'> & { kind: string };

export type ShoppingList = Tables['shopping_lists']['Row'];

export type ShoppingItem = Tables['shopping_items']['Row'];

export type Contact = Tables['contacts']['Row'];