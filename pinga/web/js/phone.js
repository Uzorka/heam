// Phone numbers are stored in international format (+2348031234567).
// Must match private.phone_login_email() in the database.
export const PHONE_LOGIN_DOMAIN = 'phone.usepinga.com';

// Accepts what people actually type: "0803 123 4567", "+234 803...", "234803...", "803...".
export function normalizePhone(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim().replace(/[\s\-().]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (s.startsWith('+')) return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
  if (!/^\d+$/.test(s)) return null;
  if (s.length === 13 && s.startsWith('234')) return '+' + s;
  if (s.length === 11 && s.startsWith('0')) return '+234' + s.slice(1);
  if (s.length === 10 && /^[789]/.test(s)) return '+234' + s;
  return null;
}

export const loginEmailFor = (phone) => phone.slice(1) + '@' + PHONE_LOGIN_DOMAIN;

// PINs: 6 digits, not trivially guessable. Same rule as supabase/functions/accept-invite.
export const validPin = (pin) => typeof pin === 'string' && /^[0-9]{6}$/.test(pin) && !/^(\d)\1{5}$/.test(pin)
  && !['123456', '654321', '012345', '123123'].includes(pin);

// "+2348031234567" → "0803 123 4567" for Nigerian numbers; others unchanged.
export function displayPhone(phone) {
  if (!phone) return '';
  const m = /^\+234(\d{3})(\d{3})(\d{4})$/.exec(phone);
  return m ? `0${m[1]} ${m[2]} ${m[3]}` : phone;
}
