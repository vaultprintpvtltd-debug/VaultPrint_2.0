import bcrypt from 'bcryptjs';
import crypto from 'crypto';

export function generateOTP(): string {
  return crypto.randomInt(100000, 999999).toString().padStart(6, '0');
}
export async function hashOTP(otp: string): Promise<string> {
  return bcrypt.hash(otp, 10);
}
export async function verifyOTP(otp: string, hash: string, expiresAt: string, attempts: number) {
  if (attempts >= 3) return { valid: false, reason: 'max_attempts' };
  if (new Date() > new Date(expiresAt)) return { valid: false, reason: 'expired' };
  const match = await bcrypt.compare(otp, hash);
  return { valid: match, reason: match ? null : 'wrong' };
}