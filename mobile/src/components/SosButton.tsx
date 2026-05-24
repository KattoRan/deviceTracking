import * as Battery from 'expo-battery';
import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
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

const HOLD_DURATION_MS = 2000;

/**
 * Long-press 2 giây để gửi SOS. Cố ý không dùng tap đơn vì người già/trẻ em
 * dễ bấm nhầm; cũng không dùng dialog confirm vì panic state người ta không
 * đọc dialog. Long-press cho thanh tiến trình rõ ràng + rung phản hồi.
 */
export default function SosButton({ deviceId, lastKnown, onResult }: Props) {
  const [pressing, setPressing] = useState(false);
  const [sending, setSending] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animation = useRef<Animated.CompositeAnimation | null>(null);

  const cancelHold = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (animation.current) {
      animation.current.stop();
      animation.current = null;
    }
    progress.setValue(0);
    setPressing(false);
  }, [progress]);

  useEffect(() => {
    return () => cancelHold();
  }, [cancelHold]);

  const fireSos = useCallback(async () => {
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
  }, [deviceId, lastKnown, onResult]);

  const startHold = () => {
    if (sending) return;
    setPressing(true);
    animation.current = Animated.timing(progress, {
      toValue: 1,
      duration: HOLD_DURATION_MS,
      easing: Easing.linear,
      useNativeDriver: false,
    });
    animation.current.start();
    Vibration.vibrate(80);
    timer.current = setTimeout(() => {
      timer.current = null;
      animation.current = null;
      setPressing(false);
      progress.setValue(0);
      void fireSos();
    }, HOLD_DURATION_MS);
  };

  return (
    <View pointerEvents="box-none" style={styles.wrapper}>
      <TouchableWithoutFeedback
        onPressIn={startHold}
        onPressOut={cancelHold}
        disabled={sending}
      >
        <View style={[styles.button, pressing && styles.buttonHolding]}>
          {sending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Text style={styles.label}>SOS</Text>
              <Text style={styles.hint}>
                {pressing ? 'Giữ 2 giây...' : 'Giữ để gửi'}
              </Text>
            </>
          )}
          {pressing && !sending ? (
            <Animated.View
              style={[
                styles.progress,
                {
                  width: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0%', '100%'],
                  }),
                },
              ]}
            />
          ) : null}
        </View>
      </TouchableWithoutFeedback>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    bottom: 32,
    right: 24,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  button: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#D32F2F',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  buttonHolding: { backgroundColor: '#B71C1C' },
  label: { color: '#FFFFFF', fontSize: 26, fontWeight: '900', letterSpacing: 2 },
  hint: { color: '#FFEBEE', fontSize: 11, marginTop: 2 },
  progress: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    height: 4,
    backgroundColor: '#FFFFFF',
    opacity: 0.7,
  },
});
