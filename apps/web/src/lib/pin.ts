// Code PIN facultatif (SPEC 6, bonus) : seul un hachage PBKDF2 salé est gardé, jamais le code.
const enc = new TextEncoder();

const toB64 = (b: ArrayBuffer | Uint8Array): string => btoa(String.fromCharCode(...new Uint8Array(b)));
const fromB64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function isValidPin(pin: string): boolean {
  return /^\d{4,8}$/.test(pin);
}

async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, key, 256);
  return toB64(bits);
}

export async function hashPin(pin: string, iterations = 150_000): Promise<{ salt: string; hash: string; iterations: number }> {
  if (!isValidPin(pin)) throw new Error("PIN must be 4 to 8 digits");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: toB64(salt), hash: await derive(pin, salt, iterations), iterations };
}

export async function verifyPin(pin: string, stored: { salt: string; hash: string; iterations: number }): Promise<boolean> {
  if (!isValidPin(pin)) return false;
  const h = await derive(pin, fromB64(stored.salt), stored.iterations);
  // Comparaison à temps constant.
  if (h.length !== stored.hash.length) return false;
  let diff = 0;
  for (let i = 0; i < h.length; i++) diff |= h.charCodeAt(i) ^ stored.hash.charCodeAt(i);
  return diff === 0;
}
