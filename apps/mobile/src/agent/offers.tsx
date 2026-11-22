import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, AppState, Modal, StyleSheet, Vibration, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, errorMessage } from '../api/client';
import { useCountryConfig } from '../api/useCountryConfig';
import { useSession } from '../auth/session';
import { naira } from '../money';
import { dismissOfferPush, usePushData } from '../push/push';
import { useRealtimeEvent } from '../realtime/realtime';
import { useColors } from '../theme/theme';
import { fonts } from '../theme/tokens';
import { Button, Text } from '../ui/kit';
import { Avatar, Badge, IconCircle, List, Row } from '../ui/parts';
import {
  afterAccepting,
  barShare,
  customerLine,
  isOfferPush,
  type Offer,
  offerEndsAt,
  offerFacts,
  secondsToGo,
} from './offer';

/** How long "Time's up" or "Taken by someone else" shows before the screen closes. */
const ENDED_MS = 2_500;

/** The offer on screen, and whether the server has said it ended (withdrawn, or its time up). */
type Showing = { offer: Offer; endsAt: number; gone?: boolean };

/**
 * Urgent errands offered to this agent alone (docs/matching.md, M6): the offer screen opens over whatever the
 * agent is doing when one arrives, by the live event, its ringing push, or the app coming to the front, and
 * counts down until they accept or decline.
 */
export function AgentOffersProvider({ children }: { children: ReactNode }) {
  const { api } = useSession();
  const [showing, setShowing] = useState<Showing | null>(null);

  const load = useCallback(async () => {
    // Counted from when the app asked, so a slow answer shortens the countdown rather than outlasting the offer.
    const asked = Date.now();
    try {
      const { offer } = await api.get<{ offer: Offer | null }>('/v1/agent/offers/current');
      setShowing((now) => {
        // None standing now: one on screen has ended, and says so before it closes.
        if (!offer) return now && !now.gone ? { ...now, gone: true } : now;
        // The same offer again keeps its countdown; a new one starts its own.
        if (now?.offer.id === offer.id) return now;
        return { offer, endsAt: offerEndsAt(offer, asked) };
      });
    } catch {
      // Offline for a moment: the next event, push or return to the app looks again.
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void load();
    });
    return () => sub.remove();
  }, [load]);
  useRealtimeEvent('offer.new', () => void load());
  useRealtimeEvent<{ offerId: string }>('offer.gone', ({ offerId }) => {
    void dismissOfferPush(offerId);
    setShowing((now) => (now?.offer.id === offerId ? { ...now, gone: true } : now));
  });
  usePushData((data, how) => {
    if (isOfferPush(data)) void load();
    // An urgent errand open to everyone near them (M8): tapping its push opens it, to accept.
    if (how === 'tapped' && data.type === 'errand.broadcast' && typeof data.errandId === 'string') {
      router.push(`/errand/${data.errandId}`);
    }
  });

  const shownId = showing?.offer.id;
  const close = useCallback(() => {
    if (shownId) void dismissOfferPush(shownId);
    setShowing((now) => (now?.offer.id === shownId ? null : now));
  }, [shownId]);

  return (
    <>
      {children}
      {showing ? <OfferScreen key={showing.offer.id} showing={showing} onClose={close} /> : null}
    </>
  );
}

/** The offer, counting down: what the agent earns, where, how far, and who the customer is; never an address. */
function OfferScreen({ showing, onClose }: { showing: Showing; onClose: () => void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { api } = useSession();
  const { config } = useCountryConfig();
  const { offer, endsAt } = showing;
  const [left, setLeft] = useState(() => secondsToGo(endsAt, Date.now()));
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [ended, setEnded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const category = config?.categories.find((k) => k.key === offer.errand.categoryKey);

  // Buzzes while the app is open too, and says so to screen readers, once per offer.
  useEffect(() => {
    Vibration.vibrate([0, 500, 250, 500]);
    AccessibilityInfo.announceForAccessibility(
      `${offer.backToBack ? 'Next errand offer, after the one you are on' : offer.paired ? 'Second errand offer, to carry with the one you are on' : 'New errand offer'}. You earn ${naira(offer.agentEarnsKobo)}. ${secondsToGo(endsAt, Date.now())} seconds to answer.`,
    );
    return () => Vibration.cancel();
  }, [offer, endsAt]);

  useEffect(() => {
    if (showing.gone) setEnded((now) => now ?? 'This offer has ended.');
  }, [showing.gone]);

  useEffect(() => {
    if (ended) return;
    const tick = setInterval(() => {
      const now = secondsToGo(endsAt, Date.now());
      setLeft(now);
      if (now === 0) setEnded("Time's up. It went to the next agent.");
    }, 250);
    return () => clearInterval(tick);
  }, [endsAt, ended]);

  useEffect(() => {
    if (!ended) return;
    const close = setTimeout(onClose, ENDED_MS);
    return () => clearTimeout(close);
  }, [ended, onClose]);

  const accept = async () => {
    setBusy('accept');
    setError(null);
    try {
      await api.post(`/v1/errands/${offer.errand.id}/events`, { event: 'accept' });
      onClose();
      const next = afterAccepting(offer);
      if (next) router.push(next);
    } catch (e) {
      // Ran out, or went elsewhere, as they tapped; any other refusal says why and leaves them to decline.
      if (e instanceof ApiError && (e.code === 'not_offered' || e.code === 'errand_not_found')) {
        setEnded('This offer has ended.');
      } else {
        setError(errorMessage(e));
      }
    } finally {
      setBusy(null);
    }
  };
  const decline = async () => {
    setBusy('decline');
    setError(null);
    try {
      await api.post(`/v1/agent/offers/${offer.id}/decline`);
      onClose();
    } catch (e) {
      // Ended already: nothing to say no to. Not sent (offline, say): the screen stays, so the no isn't lost and
      // counted as a missed offer instead.
      if (e instanceof ApiError && e.code === 'offer_not_found') onClose();
      else setError(e instanceof ApiError ? e.message : "Couldn't send that. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  const share = barShare(left, offer.windowSeconds);
  return (
    // The back button doesn't answer it: only Accept or Decline does, or its time running out.
    <Modal visible animationType="slide" onRequestClose={() => undefined} statusBarTranslucent>
      <View
        style={[styles.fill, { backgroundColor: c.bg, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}
      >
        <View style={styles.top}>
          <Badge icon="zap" label="Urgent errand for you" tone="urgent" />
          <Text
            style={[styles.count, { color: left <= 5 ? c.urgent : c.ink }]}
            accessibilityLabel={`${left} seconds left`}
          >
            {left}s
          </Text>
        </View>
        <View style={[styles.bar, { backgroundColor: c.surface2 }]}>
          <View
            style={[styles.barFill, { width: `${share * 100}%`, backgroundColor: left <= 5 ? c.urgent : c.brand }]}
          />
        </View>

        <View style={styles.body}>
          <View>
            <Text variant="sub" tone="ink3">
              You earn
            </Text>
            <Text style={styles.fee}>{naira(offer.agentEarnsKobo)}</Text>
            <Text variant="sub" tone="ink3">
              {naira(offer.errand.feeKobo)} fee, after commission
            </Text>
          </View>
          <View style={styles.badges}>
            {category ? <Badge icon={category.icon} label={category.name} /> : null}
            {offerFacts(offer).map((fact) => (
              <Badge key={fact} label={fact} tone={fact === 'You buy the items' ? 'brand' : undefined} />
            ))}
          </View>
          <List>
            <Row
              iconNode={<IconCircle icon="pin" tone="brand" />}
              title={offer.pickup.area}
              subtitle="Pickup"
              right={<Distance km={offer.pickup.km} label="away" />}
            />
            <Row
              iconNode={<IconCircle icon="flag" />}
              title={offer.dropoff.area}
              subtitle="Drop-off"
              right={<Distance km={offer.dropoff.km} label="in all" />}
            />
            <Row
              iconNode={<Avatar name={offer.customer.firstName} size={40} />}
              title={customerLine(offer.customer)}
              subtitle="Customer"
            />
          </List>
          <Text variant="note" tone="ink3">
            The full addresses show once you accept.
          </Text>
          {offer.backToBack ? (
            <Text variant="small" tone="ink2">
              Your next errand: it starts once you finish the one you are on. The time to the pickup counts the rest of
              that one.
            </Text>
          ) : null}
          {offer.paired ? (
            <Text variant="small" tone="ink2">
              A second errand to carry with the one you are on: its pickup is near that one&apos;s. The time to the
              pickup goes by way of that one, and Jiffo shows you the order of the stops.
            </Text>
          ) : null}
          {offer.counts === false ? (
            <View style={[styles.free, { borderColor: c.urgent }]}>
              <Text variant="small">Declining this one is free: it doesn't count toward your acceptance rate.</Text>
            </View>
          ) : null}
        </View>

        {ended ? (
          <Text variant="heading" style={{ textAlign: 'center' }} accessibilityLiveRegion="polite">
            {ended}
          </Text>
        ) : (
          <View style={{ gap: 8 }}>
            {error ? (
              <Text tone="danger" accessibilityLiveRegion="polite">
                {error}
              </Text>
            ) : null}
            <Button label="Accept" onPress={() => void accept()} loading={busy === 'accept'} disabled={!!busy} />
            <Button
              kind="plain"
              label="Decline"
              onPress={() => void decline()}
              loading={busy === 'decline'}
              disabled={!!busy}
            />
          </View>
        )}
      </View>
    </Modal>
  );
}

function Distance({ km, label }: { km: number; label: string }) {
  return (
    <Text variant="note" tone="ink2" style={{ fontFamily: fonts.semibold }}>
      {km.toFixed(1)} km {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, paddingHorizontal: 20, gap: 16 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  count: { fontFamily: fonts.extrabold, fontSize: 32, lineHeight: 36, fontVariant: ['tabular-nums'] },
  bar: { height: 6, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3 },
  body: { flex: 1, gap: 16 },
  badges: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  free: { borderWidth: 2, borderRadius: 12, padding: 12 },
  fee: {
    fontFamily: fonts.extrabold,
    fontSize: 44,
    lineHeight: 48,
    letterSpacing: -1.3,
    fontVariant: ['tabular-nums'],
  },
});
