/** ID types the Nigeria country adapter knows. Another country adds its own. */
export declare const ID_TYPES: {
    readonly nin: {
        readonly name: "NIN slip or card";
        readonly pattern: RegExp;
    };
    readonly bvn: {
        readonly name: "BVN";
        readonly pattern: RegExp;
    };
    readonly drivers_licence: {
        readonly name: "Driver's licence";
        readonly pattern: RegExp;
    };
    readonly voters_card: {
        readonly name: "Voter's card (PVC)";
        readonly pattern: RegExp;
    };
    readonly passport: {
        readonly name: "International passport";
        readonly pattern: RegExp;
    };
};
export type IdType = keyof typeof ID_TYPES;
export declare const ID_TYPE_KEYS: [IdType, ...IdType[]];
/** Strips spaces and checks an ID number against its type's format. */
export declare function normaliseIdNumber(type: IdType, value: string): string | null;
