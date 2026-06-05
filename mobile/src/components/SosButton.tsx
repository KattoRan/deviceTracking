import * as Battery from 'expo-battery';
import * as Location from 'expo-location';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  Vibration,
  View,
} from 'react-native';
import { ApiError, triggerSos } from '../services/apiService';

interface Props {
  deviceId: string | null;
  /**
   * Last known location pushed by parent screen (so we don't wait for a fresh
   * GPS lock when user bấm SOS). The button falls back to a synchronous
   * Location.getCurrentPositionAsync(BestForNavigation) if no cache is given.
   */
  lastKnown?: { lat: number; lon: number; accuracy?: number } | null;
  /** Show feedback toast from parent (caller wires Alert / overlay). */
  onResult?: (state: 'success' | 'error', message: string) => void;
}

/**
 * Nút SOS lớn, bấm 1 lần để gửi. Trước đây dùng long-press 2 giây nhưng trẻ
 * em / người già khó giữ đủ lâu, nên đổi sang ấn đơn cho dễ dùng. Có rung phản
 * hồi khi gửi. Nút chiếm toàn bộ vùng được màn hình cha cấp (flex: 1).
 */
export default function SosButton({ deviceId, lastKnown, onResult }: Props) {
  const [sending, setSending] = useState(false);

  const fireSos = useCallback(async () => {
    if (sending) return;
    if (!deviceId) {
      onResult?.('error', 'Thiết bị chưa được ghép');
      return;
    }
    setSending(true);
    Vibration.vibrate([0, 200, 100, 200]);
    try {
      let lat: number;
      let lon: number;
      let accuracy: number | undefined;
      if (lastKnown) {
        lat = lastKnown.lat;
        lon = lastKnown.lon;
        accuracy = lastKnown.accuracy;
      } else {
        // Fallback — lấy GPS hiện tại. Chấp nhận chậm 2-5s vì SOS phải có
        // toạ độ chính xác nhất có thể; người dùng đã cho phép location khi
        // pair, nên permission check đã pass.
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.BestForNavigation,
        });
        lat = pos.coords.latitude;
        lon = pos.coords.longitude;
        accuracy = pos.coords.accuracy ?? undefined;
      }

      let batteryLevel: number | undefined;
      try {
        const lvl = await Battery.getBatteryLevelAsync();
        batteryLevel = Math.round(lvl * 100);
      } catch {
        // Battery API failure không chặn SOS.
      }

      await triggerSos(deviceId, { lat, lon, accuracy, batteryLevel });
      onResult?.('success', 'Đã gửi SOS đến người thân');
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Lỗi không xác định';
      onResult?.('error', 'Gửi SOS thất bại: ' + msg);
    } finally {
      setSending(false);
    }
  }, [deviceId, lastKnown, onResult, sending]);

  return (
    <TouchableOpacity
      style={styles.button}
      onPress={fireSos}
      activeOpacity={0.85}
      disabled={sending}
    >
      {sending ? (
        <View style={styles.center}>
          <ActivityIndicator color="#fff" size="large" />
          <Text style={styles.hint}>Đang gửi...</Text>
        </View>
      ) : (
        <View style={styles.center}>
          <Text style={styles.label}>SOS</Text>
          <Text style={styles.hint}>Bấm để gửi cảnh báo khẩn cấp</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    flex: 1,
    minHeight: 180,
    borderRadius: 20,
    backgroundColor: '#D32F2F',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  center: { alignItems: 'center', justifyContent: 'center' },
  label: { color: '#FFFFFF', fontSize: 72, fontWeight: '900', letterSpacing: 6 },
  hint: { color: '#FFEBEE', fontSize: 16, marginTop: 10 },
});
