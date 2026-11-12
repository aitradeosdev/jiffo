import { type CountrySettings } from '@jiffo/shared';
import { type Db } from '../db/database.module';
export interface VersionedSettings {
    version: number;
    settings: CountrySettings;
}
/**
 * The country adapter: everything that differs by country (currency, states, categories, fees, timers,
 * identity rules) is read through here, never hard-coded.
 */
export declare class CountriesService {
    private readonly db;
    constructor(db: Db);
    enabledCountry(code: string): Promise<{
        code: string;
        name: string;
        currency: string;
        phonePrefix: string;
        timezone: string;
        enabled: boolean;
    }>;
    currentSettings(countryCode: string): Promise<VersionedSettings>;
    /** The settings an errand was created under, so its timers and limits never change mid-errand. */
    settingsAt(countryCode: string, version: number): Promise<CountrySettings>;
    enabledStates(countryCode: string): Omit<import("drizzle-orm/pg-core").PgSelectBase<"states", {
        code: import("drizzle-orm/pg-core").PgColumn<{
            name: "code";
            tableName: "states";
            dataType: "string";
            columnType: "PgText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        name: import("drizzle-orm/pg-core").PgColumn<{
            name: "name";
            tableName: "states";
            dataType: "string";
            columnType: "PgText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        agentSignups: import("drizzle-orm/pg-core").PgColumn<{
            name: "agent_signups";
            tableName: "states";
            dataType: "string";
            columnType: "PgText";
            data: "open" | "waitlist";
            driverParam: string;
            notNull: true;
            hasDefault: true;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: ["open", "waitlist"];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
    }, "partial", Record<"states", "not-null">, false, "where" | "orderBy", {
        code: string;
        name: string;
        agentSignups: "open" | "waitlist";
    }[], {
        code: import("drizzle-orm/pg-core").PgColumn<{
            name: "code";
            tableName: "states";
            dataType: "string";
            columnType: "PgText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        name: import("drizzle-orm/pg-core").PgColumn<{
            name: "name";
            tableName: "states";
            dataType: "string";
            columnType: "PgText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        agentSignups: import("drizzle-orm/pg-core").PgColumn<{
            name: "agent_signups";
            tableName: "states";
            dataType: "string";
            columnType: "PgText";
            data: "open" | "waitlist";
            driverParam: string;
            notNull: true;
            hasDefault: true;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: ["open", "waitlist"];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
    }>, "where" | "orderBy">;
    enabledState(countryCode: string, code: string): Promise<{
        code: string;
        name: string;
        enabled: boolean;
        id: string;
        countryCode: string;
        agentSignups: "open" | "waitlist";
    } | undefined>;
    activeCategories(countryCode: string): Omit<import("drizzle-orm/pg-core").PgSelectBase<"categories", {
        key: import("drizzle-orm/pg-core").PgColumn<{
            name: "key";
            tableName: "categories";
            dataType: "string";
            columnType: "PgText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        name: import("drizzle-orm/pg-core").PgColumn<{
            name: "name";
            tableName: "categories";
            dataType: "string";
            columnType: "PgText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        icon: import("drizzle-orm/pg-core").PgColumn<{
            name: "icon";
            tableName: "categories";
            dataType: "string";
            columnType: "PgText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        description: import("drizzle-orm/pg-core").PgColumn<{
            name: "description";
            tableName: "categories";
            dataType: "string";
            columnType: "PgText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: true;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        buyDefault: import("drizzle-orm/pg-core").PgColumn<{
            name: "buy_default";
            tableName: "categories";
            dataType: "boolean";
            columnType: "PgBoolean";
            data: boolean;
            driverParam: boolean;
            notNull: true;
            hasDefault: true;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
    }, "partial", Record<"categories", "not-null">, false, "where" | "orderBy", {
        key: string;
        name: string;
        icon: string;
        description: string;
        buyDefault: boolean;
    }[], {
        key: import("drizzle-orm/pg-core").PgColumn<{
            name: "key";
            tableName: "categories";
            dataType: "string";
            columnType: "PgText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        name: import("drizzle-orm/pg-core").PgColumn<{
            name: "name";
            tableName: "categories";
            dataType: "string";
            columnType: "PgText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        icon: import("drizzle-orm/pg-core").PgColumn<{
            name: "icon";
            tableName: "categories";
            dataType: "string";
            columnType: "PgText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        description: import("drizzle-orm/pg-core").PgColumn<{
            name: "description";
            tableName: "categories";
            dataType: "string";
            columnType: "PgText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: true;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        buyDefault: import("drizzle-orm/pg-core").PgColumn<{
            name: "buy_default";
            tableName: "categories";
            dataType: "boolean";
            columnType: "PgBoolean";
            data: boolean;
            driverParam: boolean;
            notNull: true;
            hasDefault: true;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
    }>, "where" | "orderBy">;
    activeCategory(countryCode: string, key: string): Promise<{
        sort: number;
        name: string;
        id: string;
        countryCode: string;
        createdAt: Date;
        key: string;
        icon: string;
        description: string;
        buyDefault: boolean;
        active: boolean;
        deletedAt: Date | null;
    } | undefined>;
}
