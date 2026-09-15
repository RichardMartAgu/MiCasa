import { supabase } from './supabase';
import { friendlyError } from './errors';
import type {
  Appointment,
  AppointmentKind,
  Category,
  Contact,
  Expense,
  ShoppingItem,
  ShoppingList,
} from './types';

export type ApiError = { message: string };

function toError(error: { message: string } | null): ApiError | null {
  return error ? { message: friendlyError(error.message) } : null;
}

// ---- Categorías / secciones ------------------------------------------------

export async function fetchCategories(casaId: string): Promise<Category[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('casa_id', casaId)
    .order('name');
  if (error) throw new Error(friendlyError(error.message));
  return (data ?? []) as Category[];
}

export async function addCategory(input: {
  casa_id: string;
  name: string;
  color: string;
  icon: string;
  budget: number | null;
}): Promise<ApiError | null> {
  const { error } = await supabase.from('categories').insert(input);
  return toError(error);
}

export async function updateCategory(
  id: string,
  input: { name: string; color: string; icon: string; budget: number | null },
): Promise<ApiError | null> {
  const { error } = await supabase.from('categories').update(input).eq('id', id);
  return toError(error);
}

export async function removeCategory(id: string): Promise<ApiError | null> {
  const { error } = await supabase.from('categories').delete().eq('id', id);
  return toError(error);
}

// ---- Gastos -----------------------------------------------------------------

export async function fetchExpenses(casaId: string): Promise<Expense[]> {
  const { data, error } = await supabase
    .from('expenses')
    .select('*')
    .eq('casa_id', casaId)
    .order('spent_at', { ascending: false });
  if (error) throw new Error(friendlyError(error.message));
  return (data ?? []) as Expense[];
}

export async function addExpense(input: {
  casa_id: string;
  user_id: string;
  category_id: string | null;
  title: string;
  amount: number;
  spent_at: string;
  note?: string | null;
}): Promise<ApiError | null> {
  const { error } = await supabase.from('expenses').insert(input);
  return toError(error);
}

export async function updateExpense(
  id: string,
  input: {
    category_id: string | null;
    title: string;
    amount: number;
    spent_at: string;
    note?: string | null;
  },
): Promise<ApiError | null> {
  const { error } = await supabase.from('expenses').update(input).eq('id', id);
  return toError(error);
}

export async function removeExpense(id: string): Promise<ApiError | null> {
  const { error } = await supabase.from('expenses').delete().eq('id', id);
  return toError(error);
}

// ---- Citas ------------------------------------------------------------------

export async function fetchAppointments(casaId: string): Promise<Appointment[]> {
  const { data, error } = await supabase
    .from('appointments')
    .select('*')
    .eq('casa_id', casaId)
    .order('starts_at', { ascending: true });
  if (error) throw new Error(friendlyError(error.message));
  return (data ?? []) as Appointment[];
}

export async function addAppointment(input: {
  casa_id: string;
  user_id: string;
  title: string;
  description?: string | null;
  person?: string | null;
  location?: string | null;
  kind: AppointmentKind;
  starts_at: string;
  reminder_at?: string | null;
}): Promise<ApiError | null> {
  const { error } = await supabase.from('appointments').insert(input);
  return toError(error);
}

export async function updateAppointment(
  id: string,
  input: {
    title: string;
    description?: string | null;
    person?: string | null;
    location?: string | null;
    kind: AppointmentKind;
    starts_at: string;
    reminder_at?: string | null;
  },
): Promise<ApiError | null> {
  const { error } = await supabase.from('appointments').update(input).eq('id', id);
  return toError(error);
}

export async function removeAppointment(id: string): Promise<ApiError | null> {
  const { error } = await supabase.from('appointments').delete().eq('id', id);
  return toError(error);
}

// ---- Listas de la compra -----------------------------------------------------

export async function fetchShoppingLists(casaId: string): Promise<ShoppingList[]> {
  const { data, error } = await supabase
    .from('shopping_lists')
    .select('*')
    .eq('casa_id', casaId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(friendlyError(error.message));
  return (data ?? []) as ShoppingList[];
}

export async function addShoppingList(input: {
  casa_id: string;
  user_id: string;
  title: string;
}): Promise<ApiError | null> {
  const { error } = await supabase
    .from('shopping_lists')
    .insert({ casa_id: input.casa_id, user_id: input.user_id, title: input.title });
  return toError(error);
}

export async function removeShoppingList(id: string): Promise<ApiError | null> {
  const { error } = await supabase.from('shopping_lists').delete().eq('id', id);
  return toError(error);
}

export async function toggleShoppingList(id: string, done: boolean): Promise<ApiError | null> {
  const { error } = await supabase.from('shopping_lists').update({ done }).eq('id', id);
  return toError(error);
}

export async function fetchShoppingItems(listId: string): Promise<ShoppingItem[]> {
  const { data, error } = await supabase
    .from('shopping_items')
    .select('*')
    .eq('list_id', listId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(friendlyError(error.message));
  return (data ?? []) as ShoppingItem[];
}

export async function addShoppingItem(input: {
  list_id: string;
  name: string;
  quantity?: number | null;
  unit?: string | null;
}): Promise<ApiError | null> {
  const { error } = await supabase.from('shopping_items').insert(input);
  return toError(error);
}

export async function toggleShoppingItem(id: string, done: boolean): Promise<ApiError | null> {
  const { error } = await supabase.from('shopping_items').update({ done }).eq('id', id);
  return toError(error);
}

export async function removeShoppingItem(id: string): Promise<ApiError | null> {
  const { error } = await supabase.from('shopping_items').delete().eq('id', id);
  return toError(error);
}

// ---- Contactos / cumpleaños ---------------------------------------------------

export async function fetchContacts(casaId: string): Promise<Contact[]> {
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('casa_id', casaId)
    .order('name');
  if (error) throw new Error(friendlyError(error.message));
  return (data ?? []) as Contact[];
}

export async function addContact(input: {
  casa_id: string;
  user_id: string;
  name: string;
  birth_date: string;
  relationship?: string | null;
  phone?: string | null;
}): Promise<ApiError | null> {
  const { error } = await supabase.from('contacts').insert(input);
  return toError(error);
}

export async function updateContact(
  id: string,
  input: {
    name: string;
    birth_date: string;
    relationship?: string | null;
    phone?: string | null;
  },
): Promise<ApiError | null> {
  const { error } = await supabase.from('contacts').update(input).eq('id', id);
  return toError(error);
}

export async function removeContact(id: string): Promise<ApiError | null> {
  const { error } = await supabase.from('contacts').delete().eq('id', id);
  return toError(error);
}

// ---- Miembros de la casa -----------------------------------------------------

export async function removeCasaMember(
  casaId: string,
  userId: string,
): Promise<ApiError | null> {
  const { error } = await supabase
    .from('casa_members')
    .delete()
    .eq('casa_id', casaId)
    .eq('user_id', userId);
  return toError(error);
}

export async function setCasaMemberRole(
  casaId: string,
  userId: string,
  role: 'admin' | 'member',
): Promise<ApiError | null> {
  const { error } = await supabase
    .from('casa_members')
    .update({ role })
    .eq('casa_id', casaId)
    .eq('user_id', userId);
  return toError(error);
}
