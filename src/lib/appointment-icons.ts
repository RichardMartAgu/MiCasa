export const APPOINTMENT_ICON_OPTIONS = [
  { icon: 'medkit-outline', label: 'Salud' },
  { icon: 'school-outline', label: 'Cole' },
  { icon: 'briefcase-outline', label: 'Trabajo' },
  { icon: 'person-outline', label: 'Personal' },
  { icon: 'call-outline', label: 'Llamada' },
  { icon: 'chatbubble-ellipses-outline', label: 'Reunión' },
  { icon: 'car-outline', label: 'Coche' },
  { icon: 'home-outline', label: 'Casa' },
  { icon: 'cart-outline', label: 'Compras' },
  { icon: 'restaurant-outline', label: 'Restaurante' },
  { icon: 'fitness-outline', label: 'Deporte' },
  { icon: 'gift-outline', label: 'Evento' },
  { icon: 'calendar-outline', label: 'Calendario' },
  { icon: 'ellipsis-horizontal-outline', label: 'Otro' },
] as const;

export type AppointmentIconOption = (typeof APPOINTMENT_ICON_OPTIONS)[number];
export type AppointmentIcon = AppointmentIconOption['icon'];

export const DEFAULT_APPOINTMENT_ICON: AppointmentIcon = 'ellipsis-horizontal-outline';

const APPOINTMENT_ICONS: ReadonlySet<string> = new Set(
  APPOINTMENT_ICON_OPTIONS.map((option) => option.icon),
);

export function isAppointmentIcon(value: unknown): value is AppointmentIcon {
  return typeof value === 'string' && APPOINTMENT_ICONS.has(value);
}

export function resolveAppointmentIcon(value: string | null | undefined): AppointmentIcon {
  return isAppointmentIcon(value) ? value : DEFAULT_APPOINTMENT_ICON;
}
