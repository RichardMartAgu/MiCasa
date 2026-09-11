export const Colors = {
  light: {
    text: '#0f172a',
    background: '#f6f7fb',
    backgroundElement: '#ffffff',
    backgroundSelected: '#eef2ff',
    textSecondary: '#64748b',
  },
  dark: {
    text: '#ffffff',
    background: '#0b0f19',
    backgroundElement: '#151a26',
    backgroundSelected: '#1f2737',
    textSecondary: '#94a3b8',
  },
} as const;

export const Palette = {
  primary: '#6366f1',
  primaryPressed: '#4f46e5',
  primarySoft: '#eef2ff',
  background: '#f6f7fb',
  surface: '#ffffff',
  surfaceMuted: '#f8fafc',
  surfacePressed: '#f1f5f9',
  border: '#e2e8f0',
  borderStrong: '#cbd5e1',
  text: '#0f172a',
  textStrong: '#1e293b',
  textSecondary: '#64748b',
  textMuted: '#94a3b8',
  success: '#10b981',
  successSoft: '#d1fae5',
  danger: '#ef4444',
  dangerPressed: '#dc2626',
  dangerSoft: '#fee2e2',
  warning: '#f59e0b',
  warningSoft: '#fef3c7',
  infoSoft: '#e0e7ff',
  overlay: 'rgba(15, 23, 42, 0.45)',
  onPrimary: '#ffffff',
} as const;

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Shadow = {
  card: {
    boxShadow: '0 4px 12px rgba(15, 23, 42, 0.06)',
    elevation: 2,
  },
  fab: {
    boxShadow: '0 4px 10px rgba(15, 23, 42, 0.18)',
    elevation: 5,
  },
} as const;
