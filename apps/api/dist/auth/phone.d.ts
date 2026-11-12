/** Turns what the person typed (0803..., 803..., +234803...) into E.164 and the number's country. */
export declare function normalisePhone(input: string, defaultCountry: string): {
    e164: string;
    country: string;
};
