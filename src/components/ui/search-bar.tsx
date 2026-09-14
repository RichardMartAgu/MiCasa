import { useEffect, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Palette, Radius, Spacing } from '@/constants/theme';

export type SearchBarProps = {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
};

const DEBOUNCE_MS = 300;

export function SearchBar({ value, onChangeText, placeholder = 'Buscar' }: SearchBarProps) {
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEmittedRef = useRef(value);
  const textRef = useRef(value);

  useEffect(() => {
    if (value !== textRef.current) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      textRef.current = value;
      lastEmittedRef.current = value;
      setText(value);
    }
  }, [value]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleChangeText = (next: string) => {
    setText(next);
    textRef.current = next;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      lastEmittedRef.current = next;
      onChangeText(next);
    }, DEBOUNCE_MS);
  };

  const handleClear = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    textRef.current = '';
    lastEmittedRef.current = '';
    setText('');
    onChangeText('');
  };

  return (
    <View style={[styles.container, focused && styles.containerFocused]}>
      <Ionicons name="search" size={20} color={Palette.textMuted} />
      <TextInput
        accessibilityLabel={placeholder}
        value={text}
        onChangeText={handleChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        placeholderTextColor={Palette.textMuted}
        returnKeyType="search"
        autoCorrect={false}
        style={styles.input}
      />
      {text.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Limpiar búsqueda"
          hitSlop={8}
          onPress={handleClear}
          style={styles.clearButton}>
          <Ionicons name="close-circle" size={20} color={Palette.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: Palette.surfaceMuted,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Palette.border,
    paddingHorizontal: Spacing.three,
    minHeight: 48,
  },
  containerFocused: {
    borderColor: Palette.primary,
    borderWidth: 2,
    paddingHorizontal: Spacing.three - 1,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: Palette.text,
    paddingVertical: 0,
  },
  clearButton: {
    padding: Spacing.one,
  },
});