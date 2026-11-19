import * as Crypto from 'expo-crypto';

/** SHA-256 of the text's UTF-8 bytes, as hex: for signed money requests and app checks. */
export const sha256Hex = (text: string) =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text, { encoding: Crypto.CryptoEncoding.HEX });
