/** v1.3.5 (F-21). A coupon code is exactly 11 letters and digits; anything else is dropped as it is typed. */
export const COUPON_LENGTH = 11;

export function cleanCoupon(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, COUPON_LENGTH);
}
