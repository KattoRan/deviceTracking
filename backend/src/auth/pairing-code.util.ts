import { randomInt } from 'crypto';

// 32 ký tự — bỏ 0/O/1/I/L để tránh nhầm lẫn khi đọc/gõ.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

function randomBlock(len: number): string {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += ALPHABET[randomInt(0, ALPHABET.length)];
  }
  return out;
}

// Sinh code dạng XXX-XXX (~30B combinations).
export function generatePairingCode(): string {
  return `${randomBlock(3)}-${randomBlock(3)}`;
}

// Chuẩn hoá input từ user (uppercase, strip space, đảm bảo có dấu '-').
export function normalizePairingCode(input: string): string {
  const cleaned = input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (cleaned.length !== 6) return input.toUpperCase().trim();
  return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}`;
}
