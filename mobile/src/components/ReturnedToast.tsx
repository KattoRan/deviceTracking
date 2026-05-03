import { useEffect, useRef } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useGeofenceAlert } from '../contexts/GeofenceAlertContext';

/**
 * Subtle bottom-of-screen confirmation that auto-dismisses. Shown only when
 * the device just returned to its zone — gives the user a single positive
 * acknowledgement and gets out of the way.
 */
export default function ReturnedToast() {
  const { returnedToast, dismissReturnedToast } = useGeofenceAlert();
  const visible = returnedToast != null;
  const translateY = useRef(new Animated.Value(120)).current;

  useEffect(() => {
    Animated.timing(translateY, {
      toValue: visible ? 0 : 120,
      duration: 240,
      useNativeDriver: true,
    }).start();
  }, [visible, translateY]);

  if (!returnedToast) return null;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.wrapper, { transform: [{ translateY }] }]}
    >
      <Pressable style={styles.toast} onPress={dismissReturnedToast}>
        <Text style={styles.icon}>✅</Text>
        <View style={styles.body}>
          <Text style={styles.title}>Đã trở lại vùng an toàn</Text>
          {returnedToast.geofenceName && (
            <Text style={styles.subtitle}>{returnedToast.geofenceName}</Text>
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingBottom: 24,
    zIndex: 9998,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#065F46',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
  },
  icon: { fontSize: 22, marginRight: 12 },
  body: { flex: 1 },
  title: { fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
  subtitle: { fontSize: 12, color: '#A7F3D0', marginTop: 2 },
});
