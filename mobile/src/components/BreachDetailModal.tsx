import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useGeofenceAlert } from '../contexts/GeofenceAlertContext';

interface BreachDetailModalProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * Bottom-sheet style modal showing the current geofence breach (if any).
 * Tapping the backdrop or the close pill dismisses it; the alert state
 * itself is unaffected — only the device returning to its zone clears it.
 */
export default function BreachDetailModal({
  visible,
  onClose,
}: BreachDetailModalProps) {
  const { activeBreach } = useGeofenceAlert();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={styles.sheet}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.handle} />

          {activeBreach ? (
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.headerOutside}>
                <Text style={styles.iconBig}>⚠️</Text>
                <Text style={styles.titleOutside}>
                  Đang ngoài vùng giám sát
                </Text>
              </View>

              <View style={styles.zoneCard}>
                <Text style={styles.zoneLabel}>Vùng</Text>
                <Text style={styles.zoneName}>{activeBreach.geofenceName}</Text>
              </View>

              <View style={styles.statRow}>
                <View style={styles.stat}>
                  <Text style={styles.statLabel}>Cách tâm</Text>
                  <Text style={styles.statValue}>
                    {activeBreach.distanceM}
                    <Text style={styles.statUnit}> m</Text>
                  </Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.stat}>
                  <Text style={styles.statLabel}>Bán kính</Text>
                  <Text style={styles.statValue}>
                    {activeBreach.radiusM}
                    <Text style={styles.statUnit}> m</Text>
                  </Text>
                </View>
              </View>

              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Cập nhật cuối</Text>
                <Text style={styles.metaValue}>
                  {new Date(activeBreach.timestamp).toLocaleTimeString('vi-VN')}
                </Text>
              </View>

              <View style={styles.hintBox}>
                <Text style={styles.hintText}>
                  Cảnh báo sẽ tự tắt khi bạn quay lại vùng. Hệ thống nhắc lại
                  bằng rung mỗi 30 giây.
                </Text>
              </View>
            </ScrollView>
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.iconBig}>✅</Text>
              <Text style={styles.titleOk}>Không có cảnh báo</Text>
              <Text style={styles.emptyHint}>
                Thiết bị đang trong vùng giám sát.
              </Text>
            </View>
          )}

          <Pressable style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>Đóng</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 32,
    minHeight: 280,
    maxHeight: '80%',
  },
  handle: {
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#CBD5E1',
    alignSelf: 'center',
    marginBottom: 16,
  },
  headerOutside: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  iconBig: { fontSize: 36 },
  titleOutside: {
    fontSize: 19,
    fontWeight: '700',
    color: '#7F1D1D',
    flex: 1,
  },
  titleOk: {
    fontSize: 19,
    fontWeight: '700',
    color: '#065F46',
    marginTop: 12,
  },
  zoneCard: {
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#FECACA',
    marginBottom: 14,
  },
  zoneLabel: {
    fontSize: 11,
    color: '#991B1B',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  zoneName: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1F2937',
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    paddingVertical: 14,
    marginBottom: 14,
  },
  stat: { flex: 1, alignItems: 'center' },
  statDivider: {
    width: 1,
    height: 32,
    backgroundColor: '#E2E8F0',
  },
  statLabel: {
    fontSize: 11,
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0F172A',
  },
  statUnit: {
    fontSize: 13,
    fontWeight: '500',
    color: '#64748B',
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    marginBottom: 14,
  },
  metaLabel: { fontSize: 13, color: '#64748B' },
  metaValue: { fontSize: 13, color: '#0F172A', fontWeight: '500' },
  hintBox: {
    backgroundColor: '#FFF7ED',
    borderRadius: 10,
    padding: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#F97316',
  },
  hintText: { fontSize: 12, color: '#7C2D12', lineHeight: 18 },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  emptyHint: {
    fontSize: 14,
    color: '#475569',
    marginTop: 6,
    textAlign: 'center',
  },
  closeBtn: {
    marginTop: 18,
    backgroundColor: '#1976D2',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  closeBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
});
