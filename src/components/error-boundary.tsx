import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Palette, Radius, Spacing } from '@/constants/theme';
import { Button } from '@/components/ui/button';

type Props = { children: ReactNode };
type State = { error: Error | null; attempt: number };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      `[ErrorBoundary] ${error.message}\n${error.stack ?? ''}\n${info.componentStack ?? ''}`,
    );
  }

  private reset = () => {
    this.setState((prev) => ({ error: null, attempt: prev.attempt + 1 }));
  };

  render() {
    if (this.state.error) {
      return (
        <View style={styles.root} accessibilityRole="alert" testID="error-boundary">
          <View style={styles.card}>
            <Text style={styles.title}>Algo salió mal.</Text>
            <Text style={styles.subtitle}>
              Intenta de nuevo. Si el problema continúa, revisa la consola.
            </Text>
            <Button title="Reintentar" variant="primary" onPress={this.reset} />
          </View>
        </View>
      );
    }

    return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Palette.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  card: {
    backgroundColor: Palette.surface,
    borderRadius: Radius.xl,
    padding: Spacing.four,
    borderWidth: 1,
    borderColor: Palette.border,
    alignItems: 'center',
    gap: Spacing.three,
    width: '100%',
    maxWidth: 400,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: Palette.text,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: Palette.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
});