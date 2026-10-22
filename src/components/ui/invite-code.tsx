import { useEffect, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { Palette, Radius, Spacing } from '@/constants/theme';

type InviteCodeProps = {
  code: string;
  compact?: boolean;
};

function canUseWebShare(): boolean {
  return (
    Platform.OS === 'web' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function'
  );
}

function canUseWebClipboard(): boolean {
  if (Platform.OS !== 'web') return false;
  if (typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function') {
    return true;
  }
  return typeof document !== 'undefined' && typeof document.execCommand === 'function';
}

/** Último recurso para navegadores sin Clipboard API (http, WebView viejo). */
function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined') return false;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

export function InviteCode({ code, compact = false }: InviteCodeProps) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const announce = (next: 'copied' | 'error') => {
    if (!mounted.current) return;
    setStatus(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (mounted.current) setStatus('idle');
    }, 2000);
  };

  const copy = async () => {
    if (!canUseWebClipboard()) return;
    let done = false;
    if (typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(code);
        done = true;
      } catch {
        // El permiso puede fallar en http o con el documento sin foco: se
        // intenta el fallback antes de dar el error por definitivo.
      }
    }
    if (!done) done = legacyCopy(code);
    announce(done ? 'copied' : 'error');
  };

  const share = async () => {
    const message = `Únete a mi casa en MiCasa con el código ${code}`;

    if (canUseWebShare()) {
      try {
        await navigator.share({ title: 'MiCasa', text: message });
      } catch {
        // Cancelar el diálogo del sistema no es un error que merezca aviso.
      }
      return;
    }

    try {
      await Share.share({ message });
    } catch {
      // Igual que arriba: cancelar no es un fallo.
    }
  };

  return (
    <View style={[styles.row, compact && styles.rowCompact]}>
      <View style={styles.codeBox}>
        <Text
          style={[styles.code, compact && styles.codeCompact]}
          numberOfLines={1}
          selectable
          accessibilityLabel={`Código de invitación: ${code}`}
          {...(Platform.OS === 'web'
            ? null
            : { adjustsFontSizeToFit: true, minimumFontScale: 0.7 })}>
          {code}
        </Text>
      </View>
      <View style={styles.actions}>
        {canUseWebClipboard() ? (
          <Pressable
            onPress={() => void copy()}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel={
              status === 'copied'
                ? 'Código copiado'
                : status === 'error'
                  ? 'No se pudo copiar el código'
                  : 'Copiar código de invitación'
            }
            hitSlop={8}>
            <Ionicons
              name={status === 'copied' ? 'checkmark' : 'copy-outline'}
              size={compact ? 16 : 18}
              color={status === 'copied' ? Palette.success : Palette.primary}
            />
            {!compact ? (
              <Text
                style={[styles.actionText, status === 'copied' && styles.actionTextDone]}>
                {status === 'copied' ? 'Copiado' : 'Copiar'}
              </Text>
            ) : null}
          </Pressable>
        ) : null}
        {Platform.OS !== 'web' || canUseWebShare() ? (
          <Pressable
            onPress={() => void share()}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel="Compartir código de invitación"
            hitSlop={8}>
            <Ionicons name="share-outline" size={compact ? 16 : 18} color={Palette.primary} />
            {!compact ? <Text style={styles.actionText}>Compartir</Text> : null}
          </Pressable>
        ) : null}
      </View>
      {status !== 'idle' ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.status, status === 'error' && styles.statusError]}>
          {status === 'copied' ? 'Copiado' : 'No se pudo copiar'}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexWrap: 'wrap',
  },
  rowCompact: { gap: Spacing.one },
  codeBox: {
    flexShrink: 1,
    minWidth: 0,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.md,
    backgroundColor: Palette.primarySoft,
  },
  code: {
    fontFamily: 'monospace',
    fontSize: 18,
    fontWeight: '700',
    color: Palette.primary,
    letterSpacing: 2,
  },
  codeCompact: { fontSize: 14, letterSpacing: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  iconButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Radius.pill,
  },
  actionText: { fontSize: 13, fontWeight: '700', color: Palette.primary },
  actionTextDone: { color: Palette.success },
  status: { fontSize: 12, fontWeight: '600', color: Palette.success, flexBasis: '100%' },
  statusError: { color: Palette.danger },
});
