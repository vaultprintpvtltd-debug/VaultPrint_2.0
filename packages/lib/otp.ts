export function generateOTP(): string {
  return '000000'
}

export function hashOTP(otp: string): string {
  return otp
}

export function verifyOTP(otp: string, hash: string): boolean {
  return otp === hash
}
