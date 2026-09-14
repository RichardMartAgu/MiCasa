import type { Appointment, Contact, Expense } from './types';

export interface ExpenseFilters {
  search?: string;
  categoryId?: string;
  dateRange?: string;
}

export function filterExpenses(
  expenses: Expense[],
  filters: ExpenseFilters = {},
): Expense[] {
  const { search, categoryId, dateRange } = filters;
  const q = search?.trim().toLowerCase() ?? '';
  const now = new Date();

  return expenses.filter((e) => {
    if (q && !e.title.toLowerCase().includes(q)) return false;
    if (categoryId && e.category_id !== categoryId) return false;
    if (dateRange && dateRange !== 'all') {
      const spent = new Date(e.spent_at);
      if (Number.isNaN(spent.getTime())) return false;
      switch (dateRange) {
        case 'this_month':
          if (spent.getMonth() !== now.getMonth() || spent.getFullYear() !== now.getFullYear()) {
            return false;
          }
          break;
        case 'this_year':
          if (spent.getFullYear() !== now.getFullYear()) return false;
          break;
        case 'last_3_months': {
          const limit = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
          if (spent < limit || spent > now) return false;
          break;
        }
        default:
          break;
      }
    }
    return true;
  });
}

export interface AppointmentFilters {
  search?: string;
  kind?: string;
}

export function filterAppointments(
  appointments: Appointment[],
  filters: AppointmentFilters = {},
): Appointment[] {
  const { search, kind } = filters;
  const q = search?.trim().toLowerCase() ?? '';

  return appointments.filter((a) => {
    if (q) {
      const inTitle = a.title.toLowerCase().includes(q);
      const inPerson = a.person?.toLowerCase().includes(q) ?? false;
      const inLocation = a.location?.toLowerCase().includes(q) ?? false;
      if (!inTitle && !inPerson && !inLocation) return false;
    }
    if (kind && a.kind !== kind) return false;
    return true;
  });
}

export interface ContactFilters {
  search?: string;
  relationship?: string;
}

export function filterContacts(
  contacts: Contact[],
  filters: ContactFilters = {},
): Contact[] {
  const { search, relationship } = filters;
  const q = search?.trim().toLowerCase() ?? '';

  return contacts.filter((c) => {
    if (q && !c.name.toLowerCase().includes(q)) return false;
    if (relationship) {
      if (c.relationship === null || c.relationship.trim() !== relationship) {
        return false;
      }
    }
    return true;
  });
}