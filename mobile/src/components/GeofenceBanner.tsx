import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface GeofenceBannerProps {
  visible: boolean;
  status: 'outside' | 'returned' | null;
  geofenceName: string | null;
  distanceM: number | null;
  radiusM: number | null;
  /**
   * When true, tapping the banner calls onDismiss. The "outside" banner is
   * intentionally non-dismissible — the alarm should keep showing until the
   * device actually returns to the zone.
   */
  dismissible?: boolean;
  onDismiss?: () => void;
}

/**
 * Top-of-screen banner for geofence breach / return events. Slides in,
 * stays until externally cleared (status='outside') or auto-dismissed by
 * the parent (status='returned'). Tap-to-dismiss is opt-in via the
 * `dismissible` prop.
 */
export default function GeofenceBanner({
  visible,
  status,
  geofenceName,
  distanceM,
  radiusM,
  dismissible = false,
  onDismiss,
}: GeofenceBannerProps) {
  const translateY = useRef(new Animated.Value(-200)).current;

  useEffect(() => {
    Animated.timing(translateY, {
      toValue: visible ? 0 : -200,
      duration: 280,
      useNativeDriver: true,
    }).start();
  }, [visible, translateY]);

  if (!visible || !status) return null;

  const isOutside = status === 'outside';
  const Wrapper = dismissible ? TouchableOpacity : View;
  const wrapperProps = dismissible
    ? { activeOpacity: 0.85, onPress: onDismiss }
    : {};

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.wrapper, { transform: [{ translateY }] }]}
    >
      <Wrapper
        {...wrapperProps}
        style={[styles.banner, isOutside ? styles.outside : styles.returned]}
      >
        <Text style={styles.icon}>{isOutside ? '⚠️' : '✅'}</Text>
        <View style={styles.body}>
          <Text style={styles.title}>
            {isOutside
              ? 'Bạn đang ở ngoài vùng giám sát'
              : 'Đã trở lại vùng giám sát'}
          </Text>
          <Text style={styles.subtitle}>
            {geofenceName ?? 'Vùng'}
            {distanceM != null && radiusM != null
              ? ` · cách tâm ${distanceM}m / bán kính ${radiusM}m`
              : ''}
          </Text>
          {isOutside && (
            <Text style={styles.hint}>
              Cảnh báo sẽ tự tắt khi bạn quay lại vùng.
            </Text>
          )}
        </View>
      </Wrapper>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    paddingTop: 50,
    paddingHorizontal: 12,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
  },
  outside: { backgroundColor: '#FEE2E2', borderWidth: 1, borderColor: '#FCA5A5' },
  returned: {
    backgroundColor: '#DCFCE7',
    borderWidth: 1,
    borderColor: '#86EFAC',
  },
  icon: { fontSize: 28, marginRight: 12 },
  body: { flex: 1 },
  title: { fontSize: 15, fontWeight: '700', color: '#111827' },
  subtitle: { fontSize: 12, color: '#374151', marginTop: 2 },
  hint: {
    fontSize: 11,
    color: '#7F1D1D',
    marginTop: 4,
    fontStyle: 'italic',
  },
});
