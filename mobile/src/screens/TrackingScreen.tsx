import { useFocusEffect } from '@react-navigation/native';
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
import { DEFAULT_TRACKING_INTERVAL_MS } from '../config/api';
import { useDeviceInfo } from '../hooks/useDeviceInfo';
import { useLocation } from '../hooks/useLocation';
import type {
  CommandDispatchEvent,
  IngestPayload,
  LocationData,
} from '../models/types';
import {
  fetchParentContact,
  fetchTrackingInterval,
  sendIngestData,
} from '../services/apiService';
import {
  isBackgroundLocationActive,
  startBackgroundLocation,
  stopBackgroundLocation,
} from '../services/backgroundLocationService';
import { getCellTowerInfo } from '../services/cellInfoService';
import {
  connectMqtt,
  disconnectMqtt,
  publishTelemetry,
} from '../services/mqttService';
import {
  ackCommand,
  onCommand,
  onTrackingIntervalChanged,
  sendCommandResult,
} from '../services/socketService';

interface ParentContact {
  displayName: string | null;
  phoneNumber: string | null;
}

export default function TrackingScreen() {
  const { storedData } = useDeviceInfo();
  const {
    location,
    error: locationError,
    hasPermission,
    requestPermission,
    startWatching,
    stopWatching,
    refreshLocation,
  } = useLocation();

  const [isActive, setIsActive] = useState(false);
  const [intervalMs, setIntervalMs] = useState<number>(DEFAULT_TRACKING_INTERVAL_MS);
  const [bgActive, setBgActive] = useState(false);
  const [bgToggling, setBgToggling] = useState(false);
  const [parentContact, setParentContact] = useState<ParentContact | null>(null);
  const [contactLoading, setContactLoading] = useState(true);
  const [sosResult, setSosResult] = useState<{
    state: 'success' | 'error';
    message: string;
  } | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const isActiveRef = useRef(false);
  // Once-per-mount guard so the auto-start effect doesn't re-fire when
  // unrelated callback deps (permission state, sendTelemetry identity, …)
  // change. A fresh mount — e.g. after re-registering — resets it to false.
  const autoStartedRef = useRef(false);
  // Accumulates every fix the watcher pushes during one send window. The
  // periodic timer drains this on each tick and ships the whole trajectory
  // in one payload — so server gets every waypoint, not just the latest.
  const bufferRef = useRef<LocationData[]>([]);
  // Fallback used when the buffer is empty at flush time (user stood still
  // and the OS produced no fix in the window). Resending the last known
  // fix keeps the device alive on the server without forcing a cold GPS read.
  const lastKnownRef = useRef<LocationData | null>(null);

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  useEffect(() => {
    if (!location) return;
    // Dedup: refreshLocation() pushes into the buffer directly too, so the
    // resulting setLocation(...) would otherwise re-add the same fix.
    const last = bufferRef.current[bufferRef.current.length - 1];
    if (!last || last.timestamp !== location.timestamp) {
      bufferRef.current.push(location);
    }
    lastKnownRef.current = location;
  }, [location]);

  const sendTelemetry = useCallback(
    async (options: { forceFresh?: boolean } = {}) => {
      if (!storedData?.deviceId) return null;

      try {
        // Explicit triggers (start, resume, on-demand command) — and the very
        // first tick before the watcher has produced anything — force a fresh
        // one-shot fix. The buffer accumulates passively from the watcher.
        if (options.forceFresh || lastKnownRef.current == null) {
          const fresh = await refreshLocation();
          if (fresh) {
            const last = bufferRef.current[bufferRef.current.length - 1];
            if (!last || last.timestamp !== fresh.timestamp) {
              bufferRef.current.push(fresh);
            }
            lastKnownRef.current = fresh;
          }
        }

        // Atomically take everything the watcher pushed during this window.
        const batch = bufferRef.current;
        bufferRef.current = [];

        // Heartbeat fallback — no fresh fix in this window, but we still want
        // the server to see the device is alive.
        const locations =
          batch.length > 0
            ? batch
            : lastKnownRef.current
              ? [lastKnownRef.current]
              : [];

        if (locations.length === 0) return null;

        const towers = await getCellTowerInfo();
        let batteryLevel: number | undefined;
        try {
          const lvl = await Battery.getBatteryLevelAsync();
          batteryLevel = Math.round(lvl * 100);
        } catch {
          // expo-battery có thể fail trên simulator hoặc Expo Go cũ — bỏ qua.
        }
        const payload: IngestPayload = {
          locations,
          cellTowers: towers,
          batteryLevel,
        };

        const sentOverMqtt = await publishTelemetry(storedData.deviceId, payload);
        if (!sentOverMqtt) {
          await sendIngestData(storedData.deviceId, payload);
        }

        return locations[locations.length - 1];
      } catch {
        // network / GPS errors are non-fatal — the next tick will retry
        return null;
      }
    },
    [storedData, refreshLocation],
  );

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

    bufferRef.current = [];
    lastKnownRef.current = null;
    setIsActive(true);

    // Fire once immediately so the server sees a fresh fix without waiting.
    await sendTelemetry({ forceFresh: true });
    return true;
  }, [storedData, hasPermission, requestPermission, startWatching, sendTelemetry]);

  const stopTracking = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    stopWatching();
    disconnectMqtt();
    setIsActive(false);
  }, [stopWatching]);

  // Auto-start tracking the moment the screen has a deviceId — there is no
  // longer a Home screen between Register and Tracking, so the user lands
  // here directly and expects monitoring to be running already.
  useEffect(() => {
    if (autoStartedRef.current) return;
    if (!storedData?.deviceId) return;
    autoStartedRef.current = true;
    void startTracking();
  }, [storedData?.deviceId, startTracking]);

  // (Re)create the periodic timer whenever isActive flips or the global
  // interval changes — this is how the remote `tracking_interval_changed`
  // broadcast actually takes effect on an already-running tracker.
  useEffect(() => {
    if (!isActive) return;
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      void sendTelemetry();
    }, intervalMs);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isActive, intervalMs, sendTelemetry]);

  // Pull the current global interval on mount so the very first tick uses
  // whatever the operator last set.
  useEffect(() => {
    let cancelled = false;
    fetchTrackingInterval()
      .then((res) => {
        if (!cancelled) setIntervalMs(res.intervalSec * 1000);
      })
      .catch(() => {
        // keep the default — tracking still works offline
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return onTrackingIntervalChanged((event) => {
      setIntervalMs(event.intervalSec * 1000);
    });
  }, []);

  // Sync trạng thái background task với UI khi mount.
  useEffect(() => {
    let cancelled = false;
    void isBackgroundLocationActive().then((active) => {
      if (!cancelled) setBgActive(active);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch parent contact info once we have a deviceId. Showing parent name
  // and phone on this screen so the monitored person can always call back
  // is the whole reason the field exists in parent_accounts.
  useEffect(() => {
    if (!storedData?.deviceId) return;
    let cancelled = false;
    setContactLoading(true);
    fetchParentContact(storedData.deviceId)
      .then((info) => {
        if (!cancelled) setParentContact(info);
      })
      .catch(() => {
        if (!cancelled) setParentContact(null);
      })
      .finally(() => {
        if (!cancelled) setContactLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [storedData?.deviceId]);

  const toggleBackground = useCallback(async () => {
    if (bgToggling) return;
    setBgToggling(true);
    try {
      if (bgActive) {
        await stopBackgroundLocation();
        setBgActive(false);
      } else {
        const res = await startBackgroundLocation();
        if (res.ok) {
          setBgActive(true);
        } else if (res.reason) {
          Alert.alert('Không bật được nền', res.reason);
        }
      }
    } finally {
      setBgToggling(false);
    }
  }, [bgActive, bgToggling]);

  // Auto-dismiss SOS feedback after 3s.
  useEffect(() => {
    if (!sosResult) return;
    const t = setTimeout(() => setSosResult(null), 3000);
    return () => clearTimeout(t);
  }, [sosResult]);

  // Tracking-specific commands (request_location_now, toggle_tracking).
  // ring_alarm and lock_device are handled globally in App.tsx so they
  // still work when the user is on a different screen.
  useEffect(() => {
    if (!storedData?.deviceId) return;
    return onCommand(async (event: CommandDispatchEvent) => {
      if (event.command === 'request_location_now') {
        ackCommand(event.commandId);
        const current = await sendTelemetry({ forceFresh: true });
        if (current) {
          sendCommandResult({
            commandId: event.commandId,
            success: true,
            data: { lat: current.latitude, lon: current.longitude },
          });
        } else {
          sendCommandResult({
            commandId: event.commandId,
            success: false,
            error: 'Không lấy được vị trí',
          });
        }
      } else if (event.command === 'toggle_tracking') {
        ackCommand(event.commandId);
        const enabled = !!event.payload?.enabled;
        try {
          if (enabled && !isActiveRef.current) {
            const ok = await startTracking();
            sendCommandResult({
              commandId: event.commandId,
              success: ok,
              error: ok ? null : 'Không bật được tracking',
            });
          } else if (!enabled && isActiveRef.current) {
            stopTracking();
            sendCommandResult({ commandId: event.commandId, success: true });
          } else {
            // no-op but still a success — the device is already in the
            // requested state.
            sendCommandResult({ commandId: event.commandId, success: true });
          }
        } catch (err) {
          sendCommandResult({
            commandId: event.commandId,
            success: false,
            error: err instanceof Error ? err.message : 'failed',
          });
        }
      }
    });
  }, [storedData, sendTelemetry, startTracking, stopTracking]);

  useFocusEffect(
    useCallback(() => {
      // Re-flush a fresh fix the moment the screen comes into focus so the
      // parent's dashboard sees a recent point even after a background pause.
      if (storedData?.deviceId && isActiveRef.current) {
        void sendTelemetry({ forceFresh: true });
      }
    }, [storedData, sendTelemetry]),
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      if (isActive && prev.match(/inactive|background/) && next === 'active') {
        void sendTelemetry({ forceFresh: true });
      }
    });
    return () => sub.remove();
  }, [isActive, sendTelemetry]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      disconnectMqtt();
    };
  }, []);

  const handleCallParent = useCallback(() => {
    if (!parentContact?.phoneNumber) return;
    const tel = parentContact.phoneNumber.replace(/\s+/g, '');
    Linking.openURL(`tel:${tel}`).catch(() => {
      Alert.alert('Không gọi được', 'Thiết bị không hỗ trợ cuộc gọi.');
    });
  }, [parentContact?.phoneNumber]);

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
      >
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Thông tin liên lạc</Text>
          {contactLoading ? (
            <ActivityIndicator color="#1976D2" />
          ) : (
            <>
              <ContactRow
                label="Phụ huynh"
                value={parentContact?.displayName || 'Chưa đặt tên'}
              />
              <ContactRow
                label="Số điện thoại"
                value={parentContact?.phoneNumber || 'Chưa có số'}
              />
              {parentContact?.phoneNumber ? (
                <TouchableOpacity
                  style={styles.callBtn}
                  onPress={handleCallParent}
                  activeOpacity={0.7}
                >
                  <Text style={styles.callBtnText}>Gọi phụ huynh</Text>
                </TouchableOpacity>
              ) : (
                <Text style={styles.placeholder}>
                  Nhờ phụ huynh cập nhật số điện thoại tại trang tài khoản.
                </Text>
              )}
            </>
          )}
        </View>

        <View style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={styles.cardTitle}>Theo dõi nền</Text>
            <View
              style={[
                styles.badge,
                bgActive ? styles.badgeActive : styles.badgeIdle,
              ]}
            >
              <Text
                style={[
                  styles.badgeText,
                  bgActive ? styles.badgeTextActive : styles.badgeTextIdle,
                ]}
              >
                {bgActive ? 'Đang chạy' : 'Tắt'}
              </Text>
            </View>
          </View>
          <Text style={styles.placeholder}>
            Khi bật, ứng dụng tiếp tục gửi vị trí ngay cả khi đóng app. Cần cấp
            quyền &quot;Luôn cho phép&quot; truy cập vị trí.
          </Text>
          <TouchableOpacity
            style={[
              styles.toggleBtn,
              bgActive ? styles.stopBtn : styles.startBtn,
            ]}
            onPress={toggleBackground}
            activeOpacity={0.7}
            disabled={bgToggling}
          >
            {bgToggling ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.toggleText}>
                {bgActive ? 'Tắt theo dõi nền' : 'Bật theo dõi nền'}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {locationError && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{locationError}</Text>
          </View>
        )}
      </ScrollView>

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
  toggleBtn: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 12,
  },
  startBtn: { backgroundColor: '#4CAF50' },
  stopBtn: { backgroundColor: '#F44336' },
  toggleText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  contactRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EEE',
  },
  contactLabel: { fontSize: 14, color: '#666' },
  contactValue: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
    textAlign: 'right',
    maxWidth: '60%',
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
