import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
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
  CITIZEN_ID_REGEX,
  EMAIL_REGEX,
  PHONE_REGEX,
  type RegisterDeviceRequest,
  type RootStackParamList,
} from '../models/types';
import { ApiError, registerDevice } from '../services/apiService';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Register'>;

type Field = 'fullName' | 'email' | 'citizenId' | 'phoneNumber';
type Errors = Partial<Record<Field, string>>;

export default function RegisterScreen() {
  const navigation = useNavigation<Nav>();
  const { deviceModel, deviceOS, deviceType, saveDeviceData } = useDeviceInfo();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [citizenId, setCitizenId] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Errors>({});

  const clearError = (field: Field) => {
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  };

  const validate = (): boolean => {
    const next: Errors = {};
    const name = fullName.trim();
    if (!name) next.fullName = 'Vui lòng nhập họ tên';
    else if (name.length < 2) next.fullName = 'Họ tên phải có ít nhất 2 ký tự';

    const mail = email.trim();
    if (!mail) next.email = 'Vui lòng nhập email';
    else if (!EMAIL_REGEX.test(mail)) next.email = 'Email không hợp lệ';

    if (!citizenId) next.citizenId = 'Vui lòng nhập số CCCD';
    else if (!CITIZEN_ID_REGEX.test(citizenId)) next.citizenId = 'CCCD phải có 9-12 chữ số';

    if (!phoneNumber) next.phoneNumber = 'Vui lòng nhập số điện thoại';
    else if (!PHONE_REGEX.test(phoneNumber)) next.phoneNumber = 'Số điện thoại không hợp lệ';

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async () => {
    if (submitting || !validate()) return;
    setSubmitting(true);

    const payload: RegisterDeviceRequest = {
      fullName: fullName.trim(),
      email: email.trim(),
      address: address.trim() || undefined,
      citizenId,
      phoneNumber,
      device: { model: deviceModel, type: deviceType, os: deviceOS },
    };

    try {
      const { userId, deviceId } = await registerDevice(payload);
      await saveDeviceData({
        userId,
        deviceId,
        fullName: payload.fullName,
        email: payload.email,
        registeredAt: new Date().toISOString(),
      });
      navigation.replace('Home');
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Lỗi không xác định';
      Alert.alert('Đăng ký thất bại', message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Thông tin thiết bị (tự động)</Text>
          <InfoRow label="Model" value={deviceModel} />
          <InfoRow label="OS" value={deviceOS} />
          <InfoRow label="Loại" value={deviceType} />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Thông tin cá nhân</Text>

          <Field
            label="Họ và tên"
            required
            value={fullName}
            onChangeText={(v) => {
              setFullName(v);
              clearError('fullName');
            }}
            placeholder="Nguyễn Văn A"
            autoCapitalize="words"
            error={errors.fullName}
            editable={!submitting}
          />

          <Field
            label="Email"
            required
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              clearError('email');
            }}
            placeholder="example@email.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            error={errors.email}
            editable={!submitting}
          />

          <Field
            label="Địa chỉ"
            value={address}
            onChangeText={setAddress}
            placeholder="123 Nguyễn Huệ, Q1, TP.HCM"
            editable={!submitting}
          />

          <Field
            label="Số CCCD"
            required
            value={citizenId}
            onChangeText={(v) => {
              setCitizenId(v.replace(/[^0-9]/g, ''));
              clearError('citizenId');
            }}
            placeholder="012345678901"
            keyboardType="numeric"
            maxLength={12}
            hint="9-12 chữ số"
            error={errors.citizenId}
            editable={!submitting}
          />

          <Field
            label="Số điện thoại"
            required
            value={phoneNumber}
            onChangeText={(v) => {
              setPhoneNumber(v.replace(/[^0-9+]/g, ''));
              clearError('phoneNumber');
            }}
            placeholder="0912345678"
            keyboardType="phone-pad"
            maxLength={13}
            hint="Bắt đầu bằng 0 hoặc +84"
            error={errors.phoneNumber}
            editable={!submitting}
          />
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
            <Text style={styles.submitText}>Đăng ký</Text>
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
}

function Field({ label, required, error, hint, style, ...input }: FieldProps) {
  return (
    <View style={styles.group}>
      <Text style={styles.label}>
        {label}
        {required ? <Text style={styles.required}> *</Text> : null}
      </Text>
      <TextInput
        {...input}
        style={[styles.input, error ? styles.inputError : null, style]}
        placeholderTextColor="#B0B0B0"
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {!error && hint ? <Text style={styles.hintText}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  content: { padding: 16, paddingBottom: 40 },
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
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#333', marginBottom: 14 },
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
  inputError: { borderColor: '#F44336', backgroundColor: '#FFF5F5' },
  errorText: { color: '#F44336', fontSize: 12, marginTop: 4 },
  hintText: { color: '#999', fontSize: 12, marginTop: 4 },
  submit: {
    backgroundColor: '#1976D2',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  submitDisabled: { backgroundColor: '#90CAF9' },
  submitText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
});
