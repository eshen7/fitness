import { randomBytes, scrypt, type ScryptOptions, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * `promisify(scrypt)` collapses onto the three-argument overload and drops the
 * options object, so the callback form is wrapped by hand instead.
 */
function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

/** OWASP-recommended scrypt parameters, comfortable for a single login. */
const N = 2 ** 17;
const r = 8;
const p = 1;
const KEY_BYTES = 32;
const SALT_BYTES = 16;

/**
 * scrypt from `node:crypto` rather than bcrypt, for two reasons. It has no
 * native dependency to build on a deploy, and its encoded form contains no `$`
 * characters, so the hash survives a `.env` file intact. Dotenv expands `$VAR`
 * inside values, which silently truncates a bcrypt hash to an empty string and
 * leaves an app that cannot be unlocked and gives no clue why.
 *
 * Encoded as `scrypt:<N>:<r>:<p>:<saltHex>:<keyHex>`.
 */
export async function hashPasscode(passcode: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scryptAsync(passcode, salt, KEY_BYTES, {
    N,
    r,
    p,
    maxmem: 256 * 1024 * 1024,
  });
  return [
    "scrypt",
    N,
    r,
    p,
    salt.toString("hex"),
    key.toString("hex"),
  ].join(":");
}

export async function verifyPasscode(
  passcode: string,
  encoded: string,
): Promise<boolean> {
  const parts = encoded.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, nRaw, rRaw, pRaw, saltHex, keyHex] = parts;
  const params = {
    N: Number(nRaw),
    r: Number(rRaw),
    p: Number(pRaw),
    maxmem: 512 * 1024 * 1024,
  };
  if (!Number.isFinite(params.N) || !Number.isFinite(params.r)) return false;

  const expected = Buffer.from(keyHex, "hex");
  if (expected.length === 0) return false;

  const actual = await scryptAsync(
    passcode,
    Buffer.from(saltHex, "hex"),
    expected.length,
    params,
  );

  return timingSafeEqual(actual, expected);
}

export function checkPasscode(passcode: string): Promise<boolean> {
  return verifyPasscode(passcode, env().PASSCODE_HASH);
}
