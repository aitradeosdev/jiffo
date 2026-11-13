import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { goBack } from '@/nav';
import { useSession } from '@/auth/session';
import { errorMessage } from '@/api/client';
import { pickPhoto, uploadPhoto, type UploadPurpose } from '@/api/upload';
import { useErrand } from '@/errands/use-errand';
import { naira, parseNaira } from '@/money';
import { useColors } from '@/theme/theme';
import { fonts } from '@/theme/tokens';
import { Button, Field, Text } from '@/ui/kit';
import { Icon, Toggle } from '@/ui/parts';
import { PageFooter, PageHeader } from '@/ui/floating';

type Shot = { uri: string; mimeType: string };

/**
 * The item amount, after the prototype: a photo of the receipt (or the price tags, where there is none)
 * and of the items, and the total, sent together for the customer to lock.
 */
export default function ItemAmount() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const { api } = useSession();
  const { errand, act, busy } = useErrand(id);
  const [receipt, setReceipt] = useState<Shot | null>(null);
  const [items, setItems] = useState<Shot | null>(null);
  const [noReceipt, setNoReceipt] = useState(false);
  const [total, setTotal] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kobo = parseNaira(total);
  const name = errand?.customer?.firstName ?? 'The customer';

  const take = async (set: (s: Shot) => void) => {
    const file = await pickPhoto('camera');
    if (file) set(file);
  };
  const send = async () => {
    if (!receipt || !items || !kobo || !errand) return;
    setSending(true);
    setError(null);
    try {
      const upload = (purpose: UploadPurpose, s: Shot) => uploadPhoto(api, errand.id, purpose, s);
      const photos = await Promise.all([upload('receipt', receipt), upload('item_photo', items)]);
      if (await act('send_item_amount', { amountKobo: kobo, photos })) router.back();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  const label =
    !receipt || !items ? 'Add both photos to send' : !kobo ? 'Enter the total' : `Send to ${name} · ${naira(kobo)}`;
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.surface }]} edges={['top', 'bottom']}>
      <PageHeader title="Item amount" onBack={goBack} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text tone="ink2">
          Add the photos, check the amount, then send it. {name} checks your photos before locking the money.
        </Text>
        <View style={styles.slots}>
          <Slot
            shot={receipt}
            title={noReceipt ? 'Price tags photo' : 'Receipt photo'}
            hint={noReceipt ? 'The prices, or the vendor' : 'The whole receipt in frame'}
            onTake={() => take(setReceipt)}
          />
          <Slot shot={items} title="Items photo" hint="Everything you bought" onTake={() => take(setItems)} />
        </View>
        <View style={styles.toggleRow}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.toggleTitle}>No receipt?</Text>
            <Text variant="note" tone="ink3">
              Open markets often give none. Use a photo of the price tags or the vendor instead.
            </Text>
          </View>
          <Toggle label="No receipt" value={noReceipt} onChange={setNoReceipt} />
        </View>
        <Field
          label={noReceipt ? 'Total you paid' : 'Receipt total'}
          prefix="₦"
          value={total}
          onChangeText={(t) => setTotal(t.replace(/[^\d.,]/g, ''))}
          keyboardType="decimal-pad"
          placeholder="0"
        />
        <Text variant="note" tone="ink3">
          You&apos;ve paid with your own money. Once {name} locks it, it&apos;s paid back to you at hand-off,
          withdrawable at once.
        </Text>
        {error ? (
          <Text tone="danger" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
      </ScrollView>
      <PageFooter>
        <Button
          label={label}
          disabled={!receipt || !items || !kobo}
          loading={sending || busy === 'send_item_amount'}
          onPress={send}
        />
      </PageFooter>
    </SafeAreaView>
  );
}

/** A dashed photo slot that becomes the photo, with a tick and Retake. */
function Slot({ shot, title, hint, onTake }: { shot: Shot | null; title: string; hint: string; onTake: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={shot ? `${title}, taken. Retake` : `Take ${title.toLowerCase()}`}
      onPress={onTake}
      style={[
        styles.slot,
        shot ? { backgroundColor: c.surface2 } : { borderColor: c.line2, borderWidth: 2, borderStyle: 'dashed' },
      ]}
    >
      {shot ? (
        <>
          <Image source={{ uri: shot.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          <View style={[styles.tick, { backgroundColor: c.brand2 }]}>
            <Icon name="check" size={16} weight={3} color="#FFFFFF" />
          </View>
          <View style={styles.retake}>
            <Icon name="camera" size={12} color="#FFFFFF" />
            <Text style={styles.retakeText}>Retake</Text>
          </View>
        </>
      ) : (
        <>
          <View style={[styles.cam, { backgroundColor: c.ink }]}>
            <Icon name="camera" size={20} color={c.onInk} />
          </View>
          <Text style={styles.slotTitle}>{title}</Text>
          <Text variant="note" tone="ink3" style={{ textAlign: 'center' }}>
            {hint}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  body: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 28, gap: 16 },
  slots: { flexDirection: 'row', gap: 10 },
  slot: {
    flex: 1,
    aspectRatio: 0.75,
    borderRadius: 14,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 10,
  },
  cam: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  slotTitle: { fontFamily: fonts.bold, fontSize: 15 },
  tick: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retake: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.66)',
  },
  retakeText: { color: '#FFFFFF', fontFamily: fonts.semibold, fontSize: 12 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  toggleTitle: { fontFamily: fonts.bold, fontSize: 15.5 },
});
