import * as Battery from 'expo-battery';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  type AppStateStatus,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import SosButton from '../components/SosButton';
import { useDeviceInfo } from '../hooks/useDeviceInfo';
import { useLocation } from '../hooks/useLocation';
import type { CommandDispatchEvent } from '../models/types';
import { fetchAdminContact } from '../services/apiService';
import {
  getCurrentActivity,
  onActivityChange,
  type Activity,
} from '../services/activityService';
import {
  requestImmediateSend,
  startForegroundLocation,
} from '../services/foregroundLocationService';
import { connectMqtt, disconnectMqtt } from '../services/mqttService';
import {
  ackCommand,
  onCommand,
  sendCommandResult,
} from '../services/socketService';

interface AdminContact {
  displayName: string | null;
  phoneNumber: string | null;
}

const ACTIVITY_ICON: Record<Activity, string> = {
  STILL: '⏸️',
  WALKING: '🚶',
  RUNNING: '🏃',
  ON_BICYCLE: '🚴',
  IN_VEHICLE: '🚗',
  UNKNOWN: '❓',
};

const ACTIVITY_LABEL: Record<Activity, string> = {
  STILL: 'Đứng yên',
  WALKING: 'Đang đi bộ',
  RUNNING: 'Đang chạy',
  ON_BICYCLE: 'Đang đi xe đạp',
  IN_VEHICLE: 'Đang lái xe',
  UNKNOWN: 'Đang xác định...',
};

export default function TrackingScreen() {
  const { storedData } = useDeviceInfo();
  const {
    location,
    error: locationError,
    hasPermission,
    requestPermission,
    startWatching,
  } = useLocation();

  const [isActive, setIsActive] = useState(false);
  const [adminContact, setAdminContact] = useState<AdminContact | null>(null);
  const [contactLoading, setContactLoading] = useState(true);
  const [battery, setBattery] = useState<number | null>(null);
  const [activity, setActivity] = useState<Activity>('UNKNOWN');
  const [sosResult, setSosResult] = useState<{
    state: 'success' | 'error';
    message: string;
  } | null>(null);

  const isActiveRef = useRef(false);
  // Once-per-mount guard so the auto-start effect doesn't re-fire when
  // unrelated callback deps change. A fresh mount — e.g. after re-registering
  // — resets it to false.
  const autoStartedRef = useRef(false);
  // True khi foreground service đã start thành công. False = thiếu permission
  // hoặc lỗi → cho phép retry khi user quay lại từ Settings.
  const serviceActiveRef = useRef(false);

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  const startTracking = useCallback(async () => {
    if (!storedData?.deviceId) return false;

    const granted = hasPermission || (await requestPermission());
    if (!granted) {
      Alert.alert('Chưa cấp quyền', 'Vui lòng cấp quyền truy cập vị trí.');
      return false;
    }

    connectMqtt(storedData.deviceId);
    const watching = await startWatching();
    if (!watching) return false;

    setIsActive(true);

    // Foreground service là source duy nhất gửi telemetry — tiếp tục chạy
    // khi user minimize app / khoá màn hình. useLocation watcher chỉ phục
    // vụ UI hiện location + SosButton lastKnown.
    const fgRes = await startForegroundLocation();
    if (fgRes.ok) {
      serviceActiveRef.current = true;
    } else if (fgRes.code === 'permission') {
      // Thực sự thiếu quyền → hướng dẫn cấp "Luôn cho phép".
      console.warn('[tracking] foreground service: missing permission');
      Alert.alert(
        'Chưa cấp quyền vị trí',
        'Vào Cài đặt → Ứng dụng → deviceTracking → Quyền → Vị trí → chọn "Luôn cho phép".',
        [
          { text: 'Mở Cài đặt', onPress: () => Linking.openSettings() },
          { text: 'Bỏ qua' },
        ],
      );
    } else {
      // Lỗi khởi động native (vd NPE SharedPreferences sau khi retry hết) —
      // KHÔNG phải lỗi quyền. Không nhắc cấp quyền để khỏi gây hiểu nhầm; tự
      // thử lại ở lần app trở lại foreground.
      console.warn('[tracking] foreground service start failed:', fgRes.reason);
    }
    return true;
  }, [storedData, hasPermission, requestPermission, startWatching]);

  // Auto-start tracking the moment the screen has a deviceId — there is no
  // longer a Home screen between Register and Tracking, so the user lands
  // here directly and expects monitoring to be running already.
  useEffect(() => {
    if (autoStartedRef.current) return;
    if (!storedData?.deviceId) return;
    autoStartedRef.current = true;
    void startTracking();
  }, [storedData?.deviceId, startTracking]);

  // Fetch admin contact info once we have a deviceId. Showing admin name
  // and phone on this screen so the monitored person can always call back
  // is the whole reason the field exists in admin_accounts.
  useEffect(() => {
    if (!storedData?.deviceId) return;
    let cancelled = false;
    setContactLoading(true);
    fetchAdminContact(storedData.deviceId)
      .then((info) => {
        if (!cancelled) setAdminContact(info);
      })
      .catch(() => {
        if (!cancelled) setAdminContact(null);
      })
      .finally(() => {
        if (!cancelled) setContactLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [storedData?.deviceId]);

  // Khi app trở lại foreground: re-fetch admin contact (user có thể vừa
  // đổi sđt trên web) + retry service start nếu trước đó fail (vd thiếu
  // permission — user có thể đã grant từ Settings).
  useEffect(() => {
    if (!storedData?.deviceId) return;
    const deviceId = storedData.deviceId;
    let prevState: AppStateStatus = AppState.currentState;
    const sub = AppState.addEventListener('change', (next) => {
      const prev = prevState;
      prevState = next;
      if (prev.match(/inactive|background/) && next === 'active') {
        fetchAdminContact(deviceId)
          .then((info) => setAdminContact(info))
          .catch(() => undefined);
        if (isActiveRef.current && !serviceActiveRef.current) {
          void startForegroundLocation().then((res) => {
            if (res.ok) serviceActiveRef.current = true;
          });
        }
      }
    });
    return () => sub.remove();
  }, [storedData?.deviceId]);

  // Auto-dismiss SOS feedback after 3s.
  useEffect(() => {
    if (!sosResult) return;
    const t = setTimeout(() => setSosResult(null), 3000);
    return () => clearTimeout(t);
  }, [sosResult]);

  // Tracking-specific commands (request_location_now). ring_alarm and
  // lock_device are handled globally in App.tsx so they still work khi user
  // ở screen khác.
  useEffect(() => {
    if (!storedData?.deviceId) return;
    return onCommand(async (event: CommandDispatchEvent) => {
      if (event.command === 'request_location_now') {
        ackCommand(event.commandId);
        const current = await requestImmediateSend();
        if (current) {
          sendCommandResult({
            commandId: event.commandId,
            success: true,
            data: { lat: current.lat, lon: current.lon },
          });
        } else {
          sendCommandResult({
            commandId: event.commandId,
            success: false,
            error: 'Không lấy được vị trí',
          });
        }
      }
    });
  }, [storedData]);

  // Cleanup MQTT khi unmount.
  useEffect(() => {
    return () => {
      disconnectMqtt();
    };
  }, []);

  // Poll battery mỗi 60s — hiện UI cảnh báo khi <20%.
  useEffect(() => {
    let cancelled = false;
    async function read() {
      try {
        const lvl = await Battery.getBatteryLevelAsync();
        if (!cancelled) setBattery(Math.round(lvl * 100));
      } catch {
        if (!cancelled) setBattery(null);
      }
    }
    void read();
    const id = setInterval(read, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Activity subscription — hiện UI realtime để user biết app đang detect gì.
  useEffect(() => {
    setActivity(getCurrentActivity());
    return onActivityChange((next) => setActivity(next));
  }, []);

  const handleCallAdmin = useCallback(() => {
    if (!adminContact?.phoneNumber) return;
    const tel = adminContact.phoneNumber.replace(/\s+/g, '');
    Linking.openURL(`tel:${tel}`).catch(() => {
      Alert.alert('Không gọi được', 'Thiết bị không hỗ trợ cuộc gọi.');
    });
  }, [adminContact?.phoneNumber]);

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { flexGrow: 1 }]}
      >
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Thông tin liên lạc</Text>
          {contactLoading ? (
            <ActivityIndicator color="#1976D2" />
          ) : (
            <>
              <ContactRow
                label="Người quản lý"
                value={adminContact?.displayName || 'Chưa đặt tên'}
              />
              <ContactRow
                label="Số điện thoại"
                value={adminContact?.phoneNumber || 'Chưa có số'}
              />
              {adminContact?.phoneNumber ? (
                <TouchableOpacity
                  style={styles.callBtn}
                  onPress={handleCallAdmin}
                  activeOpacity={0.7}
                >
                  <Text style={styles.callBtnText}>Gọi người quản lý</Text>
                </TouchableOpacity>
              ) : (
                <Text style={styles.placeholder}>
                  Nhờ người quản lý cập nhật số điện thoại tại trang tài khoản.
                </Text>
              )}
            </>
          )}
        </View>

        <View style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={styles.cardTitle}>Theo dõi thời gian thực</Text>
            <View
              style={[
                styles.badge,
                isActive ? styles.badgeActive : styles.badgeIdle,
              ]}
            >
              <Text
                style={[
                  styles.badgeText,
                  isActive ? styles.badgeTextActive : styles.badgeTextIdle,
                ]}
              >
                {isActive ? 'Đang chạy' : 'Tạm dừng'}
              </Text>
            </View>
          </View>

          <View style={styles.statusGrid}>
            <View style={styles.statusCell}>
              <Text style={styles.statusLabel}>Hoạt động</Text>
              <Text style={styles.statusValue}>
                {ACTIVITY_ICON[activity]} {ACTIVITY_LABEL[activity]}
              </Text>
            </View>
            <View style={styles.statusCell}>
              <Text style={styles.statusLabel}>GPS</Text>
              <Text style={styles.statusValue}>
                {location
                  ? `±${Math.round(location.accuracy ?? 0)}m`
                  : 'Đang tìm vệ tinh...'}
              </Text>
            </View>
            <View style={styles.statusCell}>
              <Text style={styles.statusLabel}>Pin</Text>
              <Text
                style={[
                  styles.statusValue,
                  battery != null && battery < 20 && styles.statusValueWarn,
                ]}
              >
                {battery != null ? `${battery}%` : '--'}
              </Text>
            </View>
          </View>

          {battery != null && battery < 20 && (
            <View style={styles.batteryWarn}>
              <Text style={styles.batteryWarnText}>
                ⚠️ Pin yếu ({battery}%) — vui lòng cắm sạc để duy trì giám sát.
              </Text>
            </View>
          )}

          <Text style={styles.placeholder}>
            {isActive
              ? 'Tự động gửi vị trí khi di chuyển + heartbeat khi đứng yên.'
              : 'Mở ứng dụng để tiếp tục gửi vị trí thời gian thực.'}
          </Text>
        </View>

        {locationError && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{locationError}</Text>
          </View>
        )}

        <SosButton
          deviceId={storedData?.deviceId ?? null}
          lastKnown={
            location
              ? {
                  lat: location.latitude,
                  lon: location.longitude,
                  accuracy: location.accuracy,
                }
              : null
          }
          onResult={(state, message) => setSosResult({ state, message })}
        />
      </ScrollView>

      {sosResult && (
        <View
          style={[
            stylesSos.toast,
            sosResult.state === 'success' ? stylesSos.toastOk : stylesSos.toastErr,
          ]}
        >
          <Text style={stylesSos.toastText}>{sosResult.message}</Text>
        </View>
      )}
    </View>
  );
}

function ContactRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.contactRow}>
      <Text style={styles.contactLabel}>{label}</Text>
      <Text style={styles.contactValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  content: { padding: 16, paddingBottom: 32 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  cardTitle: { fontSize: 18, fontWeight: '700', color: '#333', marginBottom: 12 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeActive: { backgroundColor: '#E7F5EC' },
  badgeIdle: { backgroundColor: '#EEE' },
  badgeText: { fontSize: 12, fontWeight: '600' },
  badgeTextActive: { color: '#2E7D32' },
  badgeTextIdle: { color: '#757575' },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EEE',
    gap: 12,
  },
  contactLabel: { fontSize: 14, color: '#666', flexShrink: 0 },
  contactValue: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
    textAlign: 'right',
  },
  callBtn: {
    backgroundColor: '#1976D2',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  callBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  errorBox: {
    backgroundColor: '#FFF5F5',
    borderRadius: 8,
    padding: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#F44336',
    marginBottom: 16,
  },
  errorText: { color: '#D32F2F', fontSize: 13 },
  statusGrid: {
    flexDirection: 'row',
    marginVertical: 12,
    gap: 8,
  },
  statusCell: {
    flex: 1,
    backgroundColor: '#F5F7FA',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  statusLabel: {
    fontSize: 11,
    color: '#999',
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  statusValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
    textAlign: 'center',
  },
  statusValueWarn: { color: '#F44336' },
  batteryWarn: {
    backgroundColor: '#FFF3E0',
    borderLeftWidth: 3,
    borderLeftColor: '#F44336',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  batteryWarnText: { color: '#E65100', fontSize: 13, fontWeight: '500' },
  placeholder: {
    color: '#999',
    fontSize: 14,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 8,
  },
});

const stylesSos = StyleSheet.create({
  toast: {
    position: 'absolute',
    bottom: 140,
    left: 16,
    right: 16,
    padding: 14,
    borderRadius: 10,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  toastOk: { backgroundColor: '#2E7D32' },
  toastErr: { backgroundColor: '#C62828' },
  toastText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
});
