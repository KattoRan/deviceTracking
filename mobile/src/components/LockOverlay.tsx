import { Modal, StyleSheet, Text, View } from 'react-native';

interface LockOverlayProps {
  visible: boolean;
  message?: string;
}

/**
 * Full-screen opaque modal that blocks all interaction. Presented when the
 * server sends `lock_device`. It intentionally has no dismiss button — the
 * only way out là admin unlock từ web (event `device_lock_changed`).
 */
export default function LockOverlay({ visible, message }: LockOverlayProps) {
  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={false}
      // On Android, prevent the hardware back button from dismissing the
      // overlay. `onRequestClose` is required by the Modal API — making it
      // a no-op is exactly what we want here.
      onRequestClose={() => {
        /* intentionally blocked */
      }}
    >
      <View style={styles.root}>
        <View style={styles.iconCircle}>
          <Text style={styles.iconEmoji}>🔒</Text>
        </View>
        <Text style={styles.title}>Thiết bị đã bị khóa</Text>
        <Text style={styles.message}>
          {message || 'Thiết bị đã bị khóa bởi quản trị viên.'}
        </Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#1F2937',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  iconEmoji: { fontSize: 48 },
  title: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 12,
  },
  message: {
    color: '#D1D5DB',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
});
