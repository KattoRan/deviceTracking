import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  type AppStateStatus,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { DEFAULT_TRACKING_INTERVAL_MS } from '../config/api';
import { useDeviceInfo } from '../hooks/useDeviceInfo';
import { useLocation } from '../hooks/useLocation';
import type {
  CellTower,
  CommandDispatchEvent,
  DeviceMovedEvent,
  IngestPayload,
  LocationData,
} from '../models/types';
import { fetchTrackingInterval, sendIngestData } from '../services/apiService';
import {
  getCellTowerInfo,
  isCellInfoUnavailable,
  isUsingMockCellInfo,
} from '../services/cellInfoService';
import {
  connectMqtt,
  disconnectMqtt,
  onMqttConnectionChange,
  publishTelemetry,
} from '../services/mqttService';
import {
  ackCommand,
  onCommand,
  onDeviceMoved,
  onTrackingIntervalChanged,
  sendCommandResult,
} from '../services/socketService';

const MAX_EVENTS = 10;

export default function TrackingScreen() {
  const { storedData } = useDeviceInfo();
  const {
    location,
    error: locationError,
    hasPermission,
    isWatching,
    requestPermission,
    startWatching,
    stopWatching,
    refreshLocation,
  } = useLocation();

  const [isActive, setIsActive] = useState(false);
  const [cellTowers, setCellTowers] = useState<CellTower[]>([]);
  const [lastSentAt, setLastSentAt] = useState<Date | null>(null);
  const [sendCount, setSendCount] = useState(0);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [mqttConnected, setMqttConnected] = useState(false);
  const [realtimeEvents, setRealtimeEvents] = useState<DeviceMovedEvent[]>([]);
  const [intervalMs, setIntervalMs] = useState<number>(DEFAULT_TRACKING_INTERVAL_MS);

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
      console.log(
        `[GPS] fix pushed → buffer=${bufferRef.current.length} acc=${location.accuracy?.toFixed(1) ?? '?'}m`,
      );
    }
    lastKnownRef.current = location;
  }, [location]);

  const fetchCellTowers = useCallback(async (): Promise<CellTower[]> => {
    const towers = await getCellTowerInfo();
    setCellTowers(towers);
    return towers;
  }, []);

  const sendTelemetry = useCallback(async (options: { forceFresh?: boolean } = {}) => {
    if (!storedData?.deviceId) return null;
    setSending(true);

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

      if (locations.length === 0) {
        setSendError('Không lấy được vị trí');
        return null;
      }

      console.log(
        `[GPS] flush → ${locations.length} fix(es) (fallback=${batch.length === 0})`,
      );
      const towers = await fetchCellTowers();
      const payload: IngestPayload = { locations, cellTowers: towers };

      const sentOverMqtt = await publishTelemetry(storedData.deviceId, payload);
      if (!sentOverMqtt) {
        await sendIngestData(storedData.deviceId, payload);
      }

      setLastSentAt(new Date());
      setSendCount((n) => n + 1);
      setSendError(null);
      return locations[locations.length - 1];
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Lỗi gửi dữ liệu');
      return null;
    } finally {
      setSending(false);
    }
  }, [storedData, refreshLocation, fetchCellTowers]);

  const startTracking = useCallback(async () => {
    if (!storedData?.deviceId) {
      Alert.alert('Chưa đăng ký', 'Vui lòng đăng ký thiết bị trước khi theo dõi.');
      return false;
    }

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
    setSendError(null);

    // Fire once immediately so the user sees progress without waiting a cycle.
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
      if (!storedData?.deviceId) return;
      const unsubscribe = onDeviceMoved((event) => {
        if (event.deviceId !== storedData.deviceId) return;
        setRealtimeEvents((prev) => [event, ...prev].slice(0, MAX_EVENTS));
      });
      return unsubscribe;
    }, [storedData]),
  );

  useEffect(() => onMqttConnectionChange(setMqttConnected), []);

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

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.cardTitle}>Trạng thái theo dõi</Text>
          <View
            style={[
              styles.badge,
              isActive
                ? styles.badgeActive
                : locationError
                  ? styles.badgeError
                  : styles.badgeIdle,
            ]}
          >
            <Text
              style={[
                styles.badgeText,
                isActive
                  ? styles.badgeTextActive
                  : locationError
                    ? styles.badgeTextError
                    : styles.badgeTextIdle,
              ]}
            >
              {isActive ? 'Đang theo dõi' : locationError ? 'Lỗi' : 'Tạm dừng'}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.toggleBtn, isActive ? styles.stopBtn : styles.startBtn]}
          onPress={isActive ? stopTracking : () => void startTracking()}
          activeOpacity={0.7}
          disabled={sending && !isActive}
        >
          {sending && !isActive ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.toggleText}>
              {isActive ? 'Dừng theo dõi' : 'Bắt đầu theo dõi'}
            </Text>
          )}
        </TouchableOpacity>

        <View style={styles.statsRow}>
          <Stat label="Lần gửi" value={String(sendCount)} />
          <Stat
            label="Gửi cuối"
            value={lastSentAt ? lastSentAt.toLocaleTimeString('vi-VN') : '--'}
          />
          <Stat label="Chu kỳ" value={`${Math.round(intervalMs / 1000)}s`} />
          <Stat label="MQTT" value={mqttConnected ? 'ON' : 'OFF'} />
          <Stat label="GPS" value={isWatching ? 'ON' : 'OFF'} />
        </View>

        {(sendError || locationError) && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{sendError || locationError}</Text>
          </View>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Vị trí GPS</Text>
        {location ? (
          <>
            <Coord label="Latitude" value={location.latitude.toFixed(6)} />
            <Coord label="Longitude" value={location.longitude.toFixed(6)} />
          </>
        ) : (
          <Text style={styles.placeholder}>
            Chưa có dữ liệu vị trí. Bật theo dõi để bắt đầu.
          </Text>
        )}
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Trạm BTS ({cellTowers.length})</Text>
      </View>
      {isUsingMockCellInfo() && cellTowers.length > 0 && (
        <Text style={styles.mockNotice}>
          Đang chạy trên Expo Go — dùng dữ liệu BTS mẫu. Chạy `expo prebuild` +
          `expo run:android` để đọc dữ liệu thật.
        </Text>
      )}
      {isCellInfoUnavailable() && (
        <Text style={styles.mockNotice}>
          Native module `cell-info` chưa được link. Kiểm tra autolinking
          (package.json → expo.autolinking.nativeModulesDir) rồi chạy lại
          `expo prebuild --clean` + `expo run:android`.
        </Text>
      )}
      {cellTowers.length > 0 ? (
        cellTowers.map((tower, idx) => (
          <CellTowerRow key={`${tower.cid}-${idx}`} tower={tower} />
        ))
      ) : (
        <View style={styles.card}>
          <Text style={styles.placeholder}>Chưa phát hiện trạm BTS nào.</Text>
        </View>
      )}

      {realtimeEvents.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Sự kiện realtime</Text>
          {realtimeEvents.map((event, idx) => (
            <View key={`${event.timestamp}-${idx}`} style={styles.eventRow}>
              <Text style={styles.eventTime}>
                {new Date(event.timestamp).toLocaleTimeString('vi-VN')}
              </Text>
              <Text style={styles.eventInfo} numberOfLines={1}>
                CID {event.cid ?? '--'} · {event.signalDbm ?? '--'} dBm
              </Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Coord({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.coordRow}>
      <Text style={styles.coordLabel}>{label}</Text>
      <Text style={styles.coordValue}>{value}</Text>
    </View>
  );
}

function CellTowerRow({ tower }: { tower: CellTower }) {
  return (
    <View style={styles.towerCard}>
      <View style={styles.towerHeader}>
        <Text style={styles.towerType}>{tower.type}</Text>
        <Text style={styles.towerSignal}>{tower.signalDbm} dBm</Text>
      </View>
      <View style={styles.towerMeta}>
        <Text style={styles.towerMetaItem}>CID {tower.cid}</Text>
        <Text style={styles.towerMetaItem}>LAC {tower.lac}</Text>
        <Text style={styles.towerMetaItem}>MCC {tower.mcc}</Text>
        <Text style={styles.towerMetaItem}>MNC {tower.mnc}</Text>
        {tower.pci != null && <Text style={styles.towerMetaItem}>PCI {tower.pci}</Text>}
      </View>
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
  badgeError: { backgroundColor: '#FDECEA' },
  badgeText: { fontSize: 12, fontWeight: '600' },
  badgeTextActive: { color: '#2E7D32' },
  badgeTextIdle: { color: '#757575' },
  badgeTextError: { color: '#C62828' },
  toggleBtn: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  startBtn: { backgroundColor: '#4CAF50' },
  stopBtn: { backgroundColor: '#F44336' },
  toggleText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  statsRow: { flexDirection: 'row', justifyContent: 'space-around' },
  stat: { alignItems: 'center', flex: 1 },
  statValue: { fontSize: 16, fontWeight: '700', color: '#1976D2' },
  statLabel: { fontSize: 11, color: '#999', marginTop: 2 },
  errorBox: {
    backgroundColor: '#FFF5F5',
    borderRadius: 8,
    padding: 10,
    marginTop: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#F44336',
  },
  errorText: { color: '#D32F2F', fontSize: 13 },
  coordRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  coordLabel: { fontSize: 14, color: '#666' },
  coordValue: { fontSize: 15, fontWeight: '600', color: '#333', fontVariant: ['tabular-nums'] },
  placeholder: {
    color: '#999',
    fontSize: 14,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 8,
  },
  sectionHeader: { marginBottom: 12, paddingHorizontal: 4 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#333' },
  mockNotice: {
    fontSize: 12,
    color: '#8A6D3B',
    backgroundColor: '#FCF3D7',
    borderRadius: 8,
    padding: 8,
    marginBottom: 12,
  },
  towerCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  towerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  towerType: { fontSize: 13, fontWeight: '700', color: '#1976D2' },
  towerSignal: { fontSize: 13, color: '#333' },
  towerMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  towerMetaItem: { fontSize: 11, color: '#666' },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EEE',
  },
  eventTime: { fontSize: 12, color: '#999', width: 80 },
  eventInfo: { fontSize: 13, color: '#333', flex: 1 },
});
