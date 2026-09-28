import {
  APPOINTMENT_ICON_OPTIONS,
  DEFAULT_APPOINTMENT_ICON,
  isAppointmentIcon,
  resolveAppointmentIcon,
} from '@/lib/appointment-icons';

describe('appointment-icons', () => {
  it('expone un conjunto pequeño de iconos únicos', () => {
    expect(APPOINTMENT_ICON_OPTIONS.length).toBeGreaterThan(0);
    expect(APPOINTMENT_ICON_OPTIONS.length).toBeLessThanOrEqual(20);
    const icons = APPOINTMENT_ICON_OPTIONS.map((option) => option.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it('usa el icono por defecto de la base de datos', () => {
    expect(DEFAULT_APPOINTMENT_ICON).toBe('ellipsis-horizontal-outline');
  });

  it('acepta solo iconos del catálogo', () => {
    expect(isAppointmentIcon('medkit-outline')).toBe(true);
    expect(isAppointmentIcon('pricetag')).toBe(false);
    expect(isAppointmentIcon('')).toBe(false);
    expect(isAppointmentIcon(null)).toBe(false);
    expect(isAppointmentIcon(undefined)).toBe(false);
    expect(isAppointmentIcon(42)).toBe(false);
  });

  it('resuelve iconos guardados y cae al valor por defecto', () => {
    expect(resolveAppointmentIcon('school-outline')).toBe('school-outline');
    expect(resolveAppointmentIcon('desconocido')).toBe(DEFAULT_APPOINTMENT_ICON);
    expect(resolveAppointmentIcon(null)).toBe(DEFAULT_APPOINTMENT_ICON);
    expect(resolveAppointmentIcon(undefined)).toBe(DEFAULT_APPOINTMENT_ICON);
  });

  it('incluye el icono por defecto en el catálogo', () => {
    expect(APPOINTMENT_ICON_OPTIONS.some((o) => o.icon === DEFAULT_APPOINTMENT_ICON)).toBe(true);
  });
});
