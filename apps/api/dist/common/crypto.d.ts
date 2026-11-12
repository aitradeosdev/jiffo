export declare const sha256: (value: string) => string;
export declare const hmacSha256: (secret: string, value: string) => string;
/** Compares two strings in constant time, so a wrong guess takes as long as a right one. */
export declare function safeEqual(a: string, b: string): boolean;
/** A numeric code with leading zeros kept, e.g. "004217". */
export declare const numericCode: (digits: number) => string;
export declare const randomToken: (bytes?: number) => string;
/** AES-256-GCM. The output is iv.tag.ciphertext, each base64url. Used for hand-off PINs the customer must be able to see. */
export declare function encrypt(keyHex: string, plaintext: string): string;
export declare function decrypt(keyHex: string, sealed: string): string;
