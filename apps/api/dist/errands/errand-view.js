"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.eventsFor = eventsFor;
exports.errandView = errandView;
const shared_1 = require("@jiffo/shared");
function eventsFor(errand, role) {
    const ctx = {
        actor: role === 'customer' ? 'customer' : 'agent',
        buy: errand.buy,
        pendingOffer: errand.pendingOfferKobo !== null,
    };
    const events = (0, shared_1.allowedEvents)(errand.status, ctx);
    return role === 'prospect' ? events.filter((e) => e === 'accept') : events;
}
function errandView(errand, stops, people, role) {
    return {
        id: errand.id,
        status: errand.status,
        version: errand.version,
        countryCode: errand.countryCode,
        stateCode: errand.stateCode,
        categoryKey: errand.categoryKey,
        buy: errand.buy,
        urgent: errand.urgent,
        description: errand.description,
        feeKobo: errand.feeKobo,
        pendingOfferKobo: errand.pendingOfferKobo,
        itemAmountKobo: errand.itemAmountKobo,
        scheduledFor: errand.scheduledFor,
        settingsVersion: errand.settingsVersion,
        stops: [...stops]
            .sort((a, b) => a.seq - b.seq)
            .map((s) => ({ seq: s.seq, kind: s.kind, label: s.label, address: s.address, lat: s.lat, lng: s.lng })),
        customer: people.customer,
        agent: people.agent,
        role,
        allowedEvents: eventsFor(errand, role),
        acceptedAt: errand.acceptedAt,
        startedAt: errand.startedAt,
        deliveredAt: errand.deliveredAt,
        completedAt: errand.completedAt,
        cancelledAt: errand.cancelledAt,
        createdAt: errand.createdAt,
        updatedAt: errand.updatedAt,
    };
}
//# sourceMappingURL=errand-view.js.map