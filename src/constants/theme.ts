export const Palette = {
  bg: '#0B1220',
  background: '#0B1220',
  surface: '#111A2C',
  surfaceAlt: '#1E293B',
  surfaceMuted: '#1E293B',
  surfacePressed: '#1E293B',
  primary: '#3B82F6',
  primaryPressed: '#2563EB',
  primarySoft: 'rgba(59, 130, 246, 0.16)',
  accent: '#38BDF8',
  border: '#2A3A52',
  borderStrong: '#3A4F6A',
  text: '#E8EEF7',
  textStrong: '#F3F7FF',
  textSecondary: '#8CA3BF',
  textMuted: '#8CA3BF',
  success: '#10B981',
  successSoft: 'rgba(16, 185, 129, 0.16)',
  danger: '#EF4444',
  dangerPressed: '#DC2626',
  dangerSoft: 'rgba(239, 68, 68, 0.16)',
  warning: '#F59E0B',
  warningSoft: 'rgba(245, 158, 11, 0.16)',
  gold: '#D4AF37',
  infoSoft: 'rgba(56, 189, 248, 0.16)',
  overlay: 'rgba(3, 7, 15, 0.65)',
  onPrimary: '#FFFFFF',
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
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.35)',
    elevation: 2,
  },
  fab: {
    boxShadow: '0 4px 10px rgba(0, 0, 0, 0.5)',
    elevation: 5,
  },
} as const;