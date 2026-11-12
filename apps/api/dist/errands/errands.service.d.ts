import { OnModuleInit } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { type Db } from '../db/database.module';
import { CountriesService } from '../countries/countries.service';
import type { AuthContext } from '../auth/auth.types';
import { type ErrandTimerJob, type ErrandTimers } from '../timers/errand-timers';
import { ErrandNotifier } from './errand-notifier';
import { type CreateErrandInput, type ErrandEventInput } from './errand-input';
import { type PersonSummary, type ViewerRole } from './errand-view';
export declare class ErrandsService implements OnModuleInit {
    private readonly db;
    private readonly config;
    private readonly timers;
    private readonly countries;
    private readonly notifier;
    constructor(db: Db, config: AppConfig, timers: ErrandTimers, countries: CountriesService, notifier: ErrandNotifier);
    onModuleInit(): void;
    private roleFor;
    private people;
    private views;
    private load;
    get(errandId: string, auth: AuthContext): Promise<{
        id: string;
        status: "requested" | "accepted" | "started" | "item_pending" | "items_locked" | "delivered" | "photo_pending" | "unreachable" | "disputed" | "completed" | "cancelled" | "expired";
        version: number;
        countryCode: string;
        stateCode: string;
        categoryKey: string;
        buy: boolean;
        urgent: boolean;
        description: string;
        feeKobo: number;
        pendingOfferKobo: number | null;
        itemAmountKobo: number | null;
        scheduledFor: Date | null;
        settingsVersion: number;
        stops: {
            seq: number;
            kind: "pickup" | "stop" | "dropoff";
            label: string | null;
            address: string;
            lat: number;
            lng: number;
        }[];
        customer: PersonSummary | null;
        agent: PersonSummary | null;
        role: ViewerRole;
        allowedEvents: ("accept" | "expire" | "cancel" | "withdraw" | "send_offer" | "accept_offer" | "decline_offer" | "release_agent" | "start" | "send_item_amount" | "lock_item_amount" | "item_lock_timeout" | "mark_delivered" | "confirm_pin" | "send_dropoff_photo" | "approve_photo" | "auto_release" | "report_unreachable" | "redeliver" | "unreachable_timeout" | "open_dispute" | "admin_intervene" | "resolve_complete" | "resolve_cancel")[];
        acceptedAt: Date | null;
        startedAt: Date | null;
        deliveredAt: Date | null;
        completedAt: Date | null;
        cancelledAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
    }>;
    /** The caller's own errands: as the customer in the customer app, as the agent in the agent app. */
    listMine(auth: AuthContext, before: Date | undefined, limit: number): Promise<{
        id: string;
        status: "requested" | "accepted" | "started" | "item_pending" | "items_locked" | "delivered" | "photo_pending" | "unreachable" | "disputed" | "completed" | "cancelled" | "expired";
        version: number;
        countryCode: string;
        stateCode: string;
        categoryKey: string;
        buy: boolean;
        urgent: boolean;
        description: string;
        feeKobo: number;
        pendingOfferKobo: number | null;
        itemAmountKobo: number | null;
        scheduledFor: Date | null;
        settingsVersion: number;
        stops: {
            seq: number;
            kind: "pickup" | "stop" | "dropoff";
            label: string | null;
            address: string;
            lat: number;
            lng: number;
        }[];
        customer: PersonSummary | null;
        agent: PersonSummary | null;
        role: ViewerRole;
        allowedEvents: ("accept" | "expire" | "cancel" | "withdraw" | "send_offer" | "accept_offer" | "decline_offer" | "release_agent" | "start" | "send_item_amount" | "lock_item_amount" | "item_lock_timeout" | "mark_delivered" | "confirm_pin" | "send_dropoff_photo" | "approve_photo" | "auto_release" | "report_unreachable" | "redeliver" | "unreachable_timeout" | "open_dispute" | "admin_intervene" | "resolve_complete" | "resolve_cancel")[];
        acceptedAt: Date | null;
        startedAt: Date | null;
        deliveredAt: Date | null;
        completedAt: Date | null;
        cancelledAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
    }[]>;
    /** Open errands whose pickup is within the radius, nearest first. */
    board(auth: AuthContext, q: {
        lat: number;
        lng: number;
        radiusKm: number;
        limit: number;
    }): Promise<{
        distanceMeters: number;
        id: string;
        status: "requested" | "accepted" | "started" | "item_pending" | "items_locked" | "delivered" | "photo_pending" | "unreachable" | "disputed" | "completed" | "cancelled" | "expired";
        version: number;
        countryCode: string;
        stateCode: string;
        categoryKey: string;
        buy: boolean;
        urgent: boolean;
        description: string;
        feeKobo: number;
        pendingOfferKobo: number | null;
        itemAmountKobo: number | null;
        scheduledFor: Date | null;
        settingsVersion: number;
        stops: {
            seq: number;
            kind: "pickup" | "stop" | "dropoff";
            label: string | null;
            address: string;
            lat: number;
            lng: number;
        }[];
        customer: PersonSummary | null;
        agent: PersonSummary | null;
        role: ViewerRole;
        allowedEvents: ("accept" | "expire" | "cancel" | "withdraw" | "send_offer" | "accept_offer" | "decline_offer" | "release_agent" | "start" | "send_item_amount" | "lock_item_amount" | "item_lock_timeout" | "mark_delivered" | "confirm_pin" | "send_dropoff_photo" | "approve_photo" | "auto_release" | "report_unreachable" | "redeliver" | "unreachable_timeout" | "open_dispute" | "admin_intervene" | "resolve_complete" | "resolve_cancel")[];
        acceptedAt: Date | null;
        startedAt: Date | null;
        deliveredAt: Date | null;
        completedAt: Date | null;
        cancelledAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
    }[]>;
    events(errandId: string, auth: AuthContext): Promise<{
        id: number;
        event: string;
        fromStatus: "requested" | "accepted" | "started" | "item_pending" | "items_locked" | "delivered" | "photo_pending" | "unreachable" | "disputed" | "completed" | "cancelled" | "expired" | null;
        toStatus: "requested" | "accepted" | "started" | "item_pending" | "items_locked" | "delivered" | "photo_pending" | "unreachable" | "disputed" | "completed" | "cancelled" | "expired";
        actorRole: "customer" | "agent" | "system" | "admin";
        data: Record<string, unknown>;
        createdAt: Date;
    }[]>;
    /** The customer's hand-off PIN. Shown only once the agent has marked the errand delivered. */
    pin(errandId: string, auth: AuthContext): Promise<{
        pin: string;
    }>;
    create(auth: AuthContext, input: CreateErrandInput): Promise<{
        id: string;
        status: "requested" | "accepted" | "started" | "item_pending" | "items_locked" | "delivered" | "photo_pending" | "unreachable" | "disputed" | "completed" | "cancelled" | "expired";
        version: number;
        countryCode: string;
        stateCode: string;
        categoryKey: string;
        buy: boolean;
        urgent: boolean;
        description: string;
        feeKobo: number;
        pendingOfferKobo: number | null;
        itemAmountKobo: number | null;
        scheduledFor: Date | null;
        settingsVersion: number;
        stops: {
            seq: number;
            kind: "pickup" | "stop" | "dropoff";
            label: string | null;
            address: string;
            lat: number;
            lng: number;
        }[];
        customer: PersonSummary | null;
        agent: PersonSummary | null;
        role: ViewerRole;
        allowedEvents: ("accept" | "expire" | "cancel" | "withdraw" | "send_offer" | "accept_offer" | "decline_offer" | "release_agent" | "start" | "send_item_amount" | "lock_item_amount" | "item_lock_timeout" | "mark_delivered" | "confirm_pin" | "send_dropoff_photo" | "approve_photo" | "auto_release" | "report_unreachable" | "redeliver" | "unreachable_timeout" | "open_dispute" | "admin_intervene" | "resolve_complete" | "resolve_cancel")[];
        acceptedAt: Date | null;
        startedAt: Date | null;
        deliveredAt: Date | null;
        completedAt: Date | null;
        cancelledAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
    }>;
    /** Runs one event from the customer or agent app through the state machine. */
    transition(errandId: string, auth: AuthContext, input: ErrandEventInput): Promise<{
        id: string;
        status: "requested" | "accepted" | "started" | "item_pending" | "items_locked" | "delivered" | "photo_pending" | "unreachable" | "disputed" | "completed" | "cancelled" | "expired";
        version: number;
        countryCode: string;
        stateCode: string;
        categoryKey: string;
        buy: boolean;
        urgent: boolean;
        description: string;
        feeKobo: number;
        pendingOfferKobo: number | null;
        itemAmountKobo: number | null;
        scheduledFor: Date | null;
        settingsVersion: number;
        stops: {
            seq: number;
            kind: "pickup" | "stop" | "dropoff";
            label: string | null;
            address: string;
            lat: number;
            lng: number;
        }[];
        customer: PersonSummary | null;
        agent: PersonSummary | null;
        role: ViewerRole;
        allowedEvents: ("accept" | "expire" | "cancel" | "withdraw" | "send_offer" | "accept_offer" | "decline_offer" | "release_agent" | "start" | "send_item_amount" | "lock_item_amount" | "item_lock_timeout" | "mark_delivered" | "confirm_pin" | "send_dropoff_photo" | "approve_photo" | "auto_release" | "report_unreachable" | "redeliver" | "unreachable_timeout" | "open_dispute" | "admin_intervene" | "resolve_complete" | "resolve_cancel")[];
        acceptedAt: Date | null;
        startedAt: Date | null;
        deliveredAt: Date | null;
        completedAt: Date | null;
        cancelledAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
    }>;
    /** A timer came due. It applies only if the errand has not moved since the timer was set. */
    applyTimer(job: ErrandTimerJob): Promise<void>;
    private write;
    private parse;
    /**
     * The checks and field changes for one event. Returns an ApiError (instead of throwing) when the
     * refusal must still be saved, such as a wrong PIN counting towards the limit.
     */
    private effectOf;
    private afterCommit;
    /** Sets the system timer for the state the errand just entered, if that state has one. */
    private scheduleTimers;
}
