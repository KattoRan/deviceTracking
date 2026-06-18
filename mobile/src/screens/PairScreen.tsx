import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useDeviceInfo } from '../hooks/useDeviceInfo';
import {
  PAIRING_CODE_REGEX,
  PHONE_REGEX,
  type PairDeviceRequest,
} from '../models/types';
import { ApiError, pairDevice } from '../services/apiService';

type Field = 'pairingCode' | 'ownerName' | 'phoneNumber';
type Errors = Partial<Record<Field, string>>;

function normalizePairingInput(raw: string): string {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.length <= 3) return cleaned;
  return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}`;
}

export default function PairScreen() {
  const { deviceModel, deviceOS, deviceType, saveDeviceData } = useDeviceInfo();

  const [pairingCode, setPairingCode] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Errors>({});

  const clearError = (field: Field) => {
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  };

  const validate = (): boolean => {
    const next: Errors = {};
    const code = pairingCode.trim();
    if (!code) next.pairingCode = 'Vui lòng nhập pairing code';
    else if (!PAIRING_CODE_REGEX.test(code))
      next.pairingCode = 'Code có dạng XXX-XXX (6 ký tự)';

    const name = ownerName.trim();
    if (!name) next.ownerName = 'Vui lòng nhập tên';
    else if (name.length < 1) next.ownerName = 'Tên quá ngắn';

    const phone = phoneNumber.trim();
    if (phone && !PHONE_REGEX.test(phone)) {
      next.phoneNumber = 'Số điện thoại không hợp lệ';
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async () => {
    if (submitting || !validate()) return;
    setSubmitting(true);

    const payload: PairDeviceRequest = {
      pairingCode: pairingCode.trim(),
      ownerName: ownerName.trim(),
      phoneNumber: phoneNumber.trim() || undefined,
      device: { model: deviceModel, type: deviceType, os: deviceOS },
    };

    try {
      const res = await pairDevice(payload);
      await saveDeviceData({
        deviceId: res.deviceId,
        ownerName: res.ownerName,
        pairedAt: new Date().toISOString(),
      });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Lỗi không xác định';
      Alert.alert('Ghép thiết bị thất bại', message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.headerCard}>
          <Text style={styles.headerTitle}>Ghép với tài khoản quản lý</Text>
          <Text style={styles.headerSubtitle}>
            Nhập <Text style={styles.bold}>pairing code</Text> người quản lý đã tạo
            trên ứng dụng web để kết nối thiết bị này với tài khoản quản lý.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Mã ghép thiết bị</Text>
          <Field
            label="Pairing code"
            required
            value={pairingCode}
            onChangeText={(v) => {
              setPairingCode(normalizePairingInput(v));
              clearError('pairingCode');
            }}
            placeholder="K7M-9X2"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={7}
            hint="6 ký tự + dấu gạch (vd K7M-9X2)"
            error={errors.pairingCode}
            editable={!submitting}
            inputStyle={styles.codeInput}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Người được giám sát</Text>

          <Field
            label="Tên hiển thị"
            required
            value={ownerName}
            onChangeText={(v) => {
              setOwnerName(v);
              clearError('ownerName');
            }}
            placeholder="Bé Minh / Bà Hoa"
            autoCapitalize="words"
            error={errors.ownerName}
            editable={!submitting}
          />

          <Field
            label="Số điện thoại"
            value={phoneNumber}
            onChangeText={(v) => {
              setPhoneNumber(v.replace(/[^0-9+]/g, ''));
              clearError('phoneNumber');
            }}
            placeholder="0912345678"
            keyboardType="phone-pad"
            maxLength={13}
            hint="Không bắt buộc"
            error={errors.phoneNumber}
            editable={!submitting}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Thông tin thiết bị (tự động)</Text>
          <InfoRow label="Model" value={deviceModel} />
          <InfoRow label="OS" value={deviceOS} />
          <InfoRow label="Loại" value={deviceType} />
        </View>

        <TouchableOpacity
          style={[styles.submit, submitting && styles.submitDisabled]}
          onPress={handleSubmit}
          disabled={submitting}
          activeOpacity={0.7}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitText}>Ghép thiết bị</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}:</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

interface FieldProps extends React.ComponentProps<typeof TextInput> {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  inputStyle?: object;
}

function Field({
  label,
  required,
  error,
  hint,
  style,
  inputStyle,
  ...input
}: FieldProps) {
  return (
    <View style={styles.group}>
      <Text style={styles.label}>
        {label}
        {required ? <Text style={styles.required}> *</Text> : null}
      </Text>
      <TextInput
        {...input}
        style={[styles.input, error ? styles.inputError : null, inputStyle, style]}
        placeholderTextColor="#B0B0B0"
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {!error && hint ? <Text style={styles.hintText}>{hint}</Text> : null}
    </View>
  );
}

function ChoiceButton({
  label,
  active,
  onPress,
  disabled,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.choice, active && styles.choiceActive]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
    >
      <Text style={[styles.choiceText, active && styles.choiceTextActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  content: { padding: 16, paddingBottom: 40 },
  headerCard: {
    backgroundColor: '#E3F2FD',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#1976D2',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#0D47A1', marginBottom: 6 },
  headerSubtitle: { fontSize: 14, color: '#1565C0', lineHeight: 20 },
  bold: { fontWeight: '700' },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
    marginBottom: 14,
  },
  infoRow: { flexDirection: 'row', paddingVertical: 4 },
  infoLabel: { fontSize: 14, color: '#999', width: 70 },
  infoValue: { fontSize: 14, color: '#333', fontWeight: '500', flex: 1 },
  group: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 6 },
  required: { color: '#F44336' },
  input: {
    borderWidth: 1,
    borderColor: '#DDD',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#333',
    backgroundColor: '#FAFAFA',
  },
  codeInput: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 4,
    textAlign: 'center',
  },
  inputError: { borderColor: '#F44336', backgroundColor: '#FFF5F5' },
  errorText: { color: '#F44336', fontSize: 12, marginTop: 4 },
  hintText: { color: '#999', fontSize: 12, marginTop: 4 },
  choiceRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  choice: {
    flex: 1,
    paddingVertical: 14,
    borderWidth: 2,
    borderColor: '#DDD',
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#FAFAFA',
  },
  choiceActive: { borderColor: '#1976D2', backgroundColor: '#E3F2FD' },
  choiceText: { fontSize: 15, fontWeight: '600', color: '#666' },
  choiceTextActive: { color: '#1976D2' },
  submit: {
    backgroundColor: '#1976D2',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  submitDisabled: { backgroundColor: '#90CAF9' },
  submitText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
});
