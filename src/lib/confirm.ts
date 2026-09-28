import { Alert, Platform } from 'react-native';

export interface ConfirmOptions {
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
}

export async function confirmDialog(
  title: string,
  message: string,
  options: ConfirmOptions = {},
): Promise<boolean> {
  const { confirmText = 'Confirmar', cancelText = 'Cancelar', destructive = false } = options;

  if (Platform.OS === 'web') {
    return Boolean(
      (globalThis as { confirm?: (message: string) => boolean }).confirm?.(message),
    );
  }

  return new Promise<boolean>((resolve) => {
    Alert.alert(title, message, [
      { text: cancelText, style: 'cancel', onPress: () => resolve(false) },
      {
        text: confirmText,
        style: destructive ? 'destructive' : undefined,
        onPress: () => resolve(true),
      },
    ]);
  });
}