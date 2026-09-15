import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Palette, Radius, Spacing } from '@/constants/theme';

const WORD = 'MiCasa';
const LETTER_DELAY_MS = 90;
const RING_DURATION_MS = 2400;
const COIN_SPIN_MS = 5600;

function SplashLetter({ char, index }: { char: string; index: number }) {
  const progress = useSharedValue(0);
  const delay = 480 + index * LETTER_DELAY_MS;

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withSpring(1, { damping: 14, stiffness: 130, mass: 0.9 }),
    );
  }, [delay, progress]);

  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { translateY: (1 - progress.value) * 26 },
      { scale: 0.8 + progress.value * 0.2 },
    ],
  }));

  return <Animated.Text style={[styles.wordLetter, style]}>{char}</Animated.Text>;
}

function SplashWord() {
  return (
    <View style={styles.wordRow} accessibilityElementsHidden>
      {WORD.split('').map((char, index) => (
        <SplashLetter key={`${char}-${index}`} char={char} index={index} />
      ))}
    </View>
  );
}

function PulseRing({ delay, color }: { delay: number; color: string }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, {
            duration: RING_DURATION_MS,
            easing: Easing.out(Easing.cubic),
            reduceMotion: ReduceMotion.System,
          }),
          withTiming(0, { duration: 0 }),
        ),
        -1,
      ),
    );
  }, [delay, progress]);

  const style = useAnimatedStyle(() => ({
    opacity: 0.5 * (1 - progress.value),
    transform: [{ scale: 1 + progress.value * 1.7 }],
  }));

  return <Animated.View pointerEvents="none" style={[styles.ring, { borderColor: color }, style]} />;
}

function SplashLogo() {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      160,
      withSpring(1, { damping: 12, stiffness: 120 }),
    );
  }, [progress]);

  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { scale: 0.7 + progress.value * 0.3 },
      { translateY: (1 - progress.value) * 30 },
    ],
  }));

  return (
    <Animated.View style={[styles.logoWrap, style]}>
      <PulseRing delay={0} color="rgba(255, 255, 255, 0.55)" />
      <PulseRing delay={RING_DURATION_MS / 2 - 200} color="rgba(255, 255, 255, 0.35)" />
      <View style={styles.logoTile}>
        <Ionicons name="home" size={34} color={Palette.primary} />
      </View>
    </Animated.View>
  );
}

function SplashTagline() {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      900,
      withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) }),
    );
  }, [progress]);

  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 14 }],
  }));

  return <Animated.Text style={[styles.tagline, style]}>Tu hogar, un solo lugar</Animated.Text>;
}

function Aurora({ color, left, top, size }: { color: string; left: number; top: number; size: number }) {
  const x = useSharedValue(0);
  const y = useSharedValue(0);

  useEffect(() => {
    x.value = withRepeat(
      withTiming(1, { duration: 7200, easing: Easing.inOut(Easing.sin), reduceMotion: ReduceMotion.System }),
      -1,
      true,
    );
    y.value = withRepeat(
      withTiming(1, { duration: 9400, easing: Easing.inOut(Easing.sin), reduceMotion: ReduceMotion.System }),
      -1,
      true,
    );
  }, [x, y]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value * 70 - 35 },
      { translateY: y.value * 50 - 25 },
      { scale: 1 + y.value * 0.18 },
    ],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.aurora, { backgroundColor: color, left, top, width: size, height: size, borderRadius: size / 2 }, style]}
    />
  );
}

function YinYangLoader() {
  const insets = useSafeAreaInsets();
  const spin = useSharedValue(0);

  useEffect(() => {
    spin.value = withRepeat(
      withTiming(1, { duration: COIN_SPIN_MS, easing: Easing.linear, reduceMotion: ReduceMotion.System }),
      -1,
      false,
    );
  }, [spin]);

  const spinStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spin.value * 360}deg` }],
  }));

  return (
    <View
      style={[styles.loaderWrap, { bottom: insets.bottom + 44 }]}
      accessible
      accessibilityLabel="Cargando MiCasa">
      <View style={styles.loaderStage}>
        <View style={styles.coinHalo} />
        <View style={styles.coinTilt}>
          <Animated.View style={[styles.coinBody, spinStyle]}>
            <View style={styles.coinEdge} />
            <View style={styles.coinFace}>
              <View style={styles.coinHalfDark} />
              <View style={[styles.coinEye, styles.coinEyeDark]} />
              <View style={[styles.coinEye, styles.coinEyeLight]} />
            </View>
          </Animated.View>
          <View style={styles.coinGloss} pointerEvents="none">
            <View style={[styles.glossBand, styles.glossDark]} />
            <View style={[styles.glossBand, styles.glossLight]} />
            <View style={[styles.glossBand, styles.glossCore]} />
          </View>
        </View>
      </View>
    </View>
  );
}

export function SplashScreenView() {
  return (
    <View
      style={styles.root}
      accessible
      accessibilityLabel="MiCasa se está cargando"
      accessibilityViewIsModal>
      <Aurora color="rgba(255, 255, 255, 0.10)" left={-90} top={-80} size={340} />
      <Aurora color="rgba(79, 70, 229, 0.35)" left={-60} top={240} size={300} />
      <Aurora color="rgba(196, 181, 253, 0.14)" left={-40} top={360} size={360} />
      <View style={styles.center}>
        <SplashLogo />
        <SplashWord />
        <SplashTagline />
      </View>
      <YinYangLoader />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Palette.primary,
    overflow: 'hidden',
  },
  aurora: {
    position: 'absolute',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  logoWrap: {
    width: 140,
    height: 140,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 1.5,
  },
  logoTile: {
    width: 84,
    height: 84,
    borderRadius: Radius.xl + 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    shadowColor: '#1e1b4b',
    shadowOpacity: 0.25,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  wordRow: {
    flexDirection: 'row',
    marginTop: Spacing.five,
    gap: 2,
  },
  wordLetter: {
    fontSize: 46,
    fontWeight: '800',
    letterSpacing: 2,
    color: '#FFFFFF',
  },
  tagline: {
    marginTop: Spacing.three + 2,
    fontSize: 15,
    letterSpacing: 0.6,
    color: 'rgba(255, 255, 255, 0.85)',
  },
  loaderWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  loaderStage: {
    width: 90,
    height: 90,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coinHalo: {
    position: 'absolute',
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
  },
  coinTilt: {
    width: 90,
    height: 90,
    transform: [
      { perspective: 600 },
      { rotateX: '45deg' },
    ],
  },
  coinBody: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 90,
    height: 90,
  },
  coinEdge: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 90,
    height: 90,
    borderRadius: 45,
    borderWidth: 4,
    borderColor: '#c7d2fe',
    backgroundColor: '#4338ca',
    shadowColor: '#1e1b4b',
    shadowOpacity: 0.35,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 14 },
    elevation: 8,
  },
  coinFace: {
    position: 'absolute',
    top: 4,
    left: 4,
    width: 82,
    height: 82,
    borderRadius: 41,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  coinHalfDark: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 41,
    height: 82,
    backgroundColor: '#312e81',
  },
  coinEye: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
  },
  coinEyeDark: {
    top: 3,
    left: 19,
    backgroundColor: '#312e81',
  },
  coinEyeLight: {
    top: 57,
    left: 41,
    backgroundColor: '#FFFFFF',
  },
  coinGloss: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 90,
    height: 90,
    borderRadius: 45,
    overflow: 'hidden',
  },
  glossBand: {
    position: 'absolute',
    left: -18,
    width: 128,
    height: 40,
    transform: [{ rotate: '105deg' }],
  },
  glossDark: {
    top: 30,
    backgroundColor: 'rgba(30, 27, 75, 0.10)',
  },
  glossLight: {
    top: 52,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
  },
  glossCore: {
    top: 64,
    height: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.30)',
  },
});