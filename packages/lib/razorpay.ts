import Razorpay from 'razorpay';
import crypto from 'crypto';

export function createRazorpayClient() {
  return new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID!, key_secret: process.env.RAZORPAY_KEY_SECRET! });
}
export function isValidSignature(orderId: string, paymentId: string, signature: string): boolean {
  try {
    const body = orderId + '|' + paymentId;
    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!).update(body).digest('hex');
    // timingSafeEqual throws if buffers have different lengths
    if (expected.length !== signature.length) {
      console.error('[Razorpay] Signature length mismatch:', { expected: expected.length, got: signature.length });
      return false;
    }
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch (err) {
    console.error('[Razorpay] Signature verification error:', err);
    return false;
  }
}