import { Alert, Platform } from 'react-native';

/**
 * Aviso de un solo mensaje, sin confirmación ni botones.
 *
 * `Alert.alert` es un no-op en react-native-web: su implementación es una clase
 * con los métodos vacíos, así que en web todo el feedback de Ajustes desaparecía
 * sin dejar rastro y el interruptor de notificaciones se quedaba pulsado sin
 * explicar nada. Es el mismo problema que ya resuelve `confirmDialog` con
 * `globalThis.confirm`, aquí con `globalThis.alert`.
 *
 * En web solo se muestra el mensaje porque `window.alert` admite un único texto.
 * Los mensajes de esta app ya se leen solos ("No se pudo activar los avisos:
 * ..."), así que el título no pierde información. En nativo se mantiene, con su
 * título y su tipografía de plataforma.
 */
export function showNotice(title: string, message: string): void {
  if (Platform.OS === 'web') {
    (globalThis as { alert?: (text: string) => void }).alert?.(message);
    return;
  }

  Alert.alert(title, message);
}
