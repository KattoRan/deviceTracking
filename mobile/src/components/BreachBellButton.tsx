import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useGeofenceAlert } from '../contexts/GeofenceAlertContext';
import BreachDetailModal from './BreachDetailModal';

/**
 * Mounted in the navigation header (right side). A red dot appears over the
 * bell whenever the device is outside its zone. Tapping opens a modal with
 * the full breach detail. Compact form — no longer steals the top region of
 * every screen.
 */
export default function BreachBellButton() {
  const { activeBreach } = useGeofenceAlert();
  const [open, setOpen] = useState(false);
  const hasAlert = activeBreach != null;

  return (
    <>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={
          hasAlert
            ? 'Có cảnh báo vùng giám sát — bấm để xem chi tiết'
            : 'Cảnh báo vùng giám sát'
        }
        onPress={() => setOpen(true)}
        style={styles.button}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={[styles.bell, hasAlert && styles.bellAlert]}>🔔</Text>
        {hasAlert && (
          <>
            <View style={styles.badge} />
            <View style={styles.badgePulse} />
          </>
        )}
      </TouchableOpacity>
      <BreachDetailModal visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    position: 'relative',
  },
  bell: {
    fontSize: 22,
    // Emojis already carry color; the alert variant just nudges saturation.
    opacity: 0.85,
  },
  bellAlert: { opacity: 1 },
  badge: {
    position: 'absolute',
    top: 4,
    right: 8,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#EF4444',
    borderWidth: 2,
    borderColor: '#1976D2',
    zIndex: 2,
  },
  // Static "halo" — a real pulse animation would need Animated; this static
  // ring is enough to draw the eye without extra dependencies.
  badgePulse: {
    position: 'absolute',
    top: 1,
    right: 5,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(239, 68, 68, 0.35)',
    zIndex: 1,
  },
});
