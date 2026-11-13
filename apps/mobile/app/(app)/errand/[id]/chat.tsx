import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Crypto from 'expo-crypto';
import { goBack } from '@/nav';
import { VARIANT } from '@/config';
import { useSession } from '@/auth/session';
import { errorMessage } from '@/api/client';
import { pickPhoto, uploadPhoto } from '@/api/upload';
import { useRealtimeEvent } from '@/realtime/realtime';
import { CustomerCards } from '@/errands/chat-cards';
import { Segments } from '@/errands/progress';
import { customerStage } from '@/errands/stage';
import { AGENT_STATUS, stepOf, type ErrandView } from '@/errands/types';
import { useErrand, useHandoffPin } from '@/errands/use-errand';
import { useColors } from '@/theme/theme';
import { fonts } from '@/theme/tokens';
import { noWebOutline, Text } from '@/ui/kit';
import { Avatar, Icon } from '@/ui/parts';

export interface ChatMessage {
  id: number;
  senderId: string | null;
  senderRole: 'customer' | 'agent' | 'system';
  kind: 'text' | 'system' | 'photo';
  body: string;
  photoUrl: string | null;
  clientId: string | null;
  createdAt: string;
}

interface Thread {
  conversation: { id: string; open: boolean };
  messages: ChatMessage[];
}

/** One-tap messages, as in the prototype. */
const HINTS =
  VARIANT === 'agent'
    ? ["I'm at the pickup", 'On my way to you', 'Please confirm the items']
    : ['Where are you now?', 'Call me when you arrive', 'Please take a photo of the items'];

/**
 * The errand chat, for both apps. Messages arrive live; sends are safe to retry (each carries a client
 * id). In the customer app, what waits on the customer (a new price, the item amount, the PIN, the
 * drop-off photo) shows as cards at the end of the thread.
 */
export default function Chat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const { api, user } = useSession();
  const errandState = useErrand(id);
  const { errand } = errandState;
  const pin = useHandoffPin(errand);
  const [thread, setThread] = useState<Thread | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const list = useRef<FlatList<ChatMessage>>(null);
  const input = useRef<ComponentRef<typeof TextInput>>(null);

  const load = useCallback(async () => {
    try {
      setThread(await api.get<Thread>(`/v1/errands/${id}/messages?limit=200`));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [api, id]);
  // Photo links expire after 15 minutes: reload the thread every 10 so open photos keep working.
  useEffect(() => {
    load();
    const timer = setInterval(load, 10 * 60_000);
    return () => clearInterval(timer);
  }, [load]);

  const add = (m: ChatMessage) =>
    setThread((t) => (t && !t.messages.some((x) => x.id === m.id) ? { ...t, messages: [...t.messages, m] } : t));
  useRealtimeEvent<{ errandId: string; message: ChatMessage }>('message.created', (e) => {
    if (e.errandId === id) add(e.message);
  });
  const scrollKey = `${thread?.messages.length ?? 0}:${errand?.status}:${errand?.pendingOfferKobo}`;
  useEffect(() => {
    if (thread?.messages.length || errand) setTimeout(() => list.current?.scrollToEnd({ animated: true }), 80);
  }, [scrollKey]);

  const send = async (payload: { body?: string; photo?: string }) => {
    setSending(true);
    setError(null);
    try {
      add(await api.post<ChatMessage>(`/v1/errands/${id}/messages`, { ...payload, clientId: Crypto.randomUUID() }));
      if (payload.body === text.trim()) setText('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  const sendPhoto = async () => {
    const file = await pickPhoto('library');
    if (!file) return;
    setSending(true);
    try {
      await send({ photo: await uploadPhoto(api, id, 'chat_photo', file) });
    } catch (e) {
      setError(errorMessage(e));
      setSending(false);
    }
  };

  const open = thread?.conversation.open ?? false;
  const other = VARIANT === 'agent' ? errand?.customer : errand?.agent;
  const otherName = other?.firstName ?? (VARIANT === 'agent' ? 'Customer' : 'Your agent');
  const status = errand ? (VARIANT === 'agent' ? AGENT_STATUS[errand.status] : customerStage(errand).big) : '';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.head, { borderBottomColor: c.line }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => goBack()} style={styles.ib}>
            <Icon name="back" size={24} />
          </Pressable>
          <Avatar name={otherName} size={40} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.headName} numberOfLines={1}>
              {otherName}
            </Text>
            <Text variant="note" tone="ink3" numberOfLines={1}>
              {status}
            </Text>
          </View>
        </View>
        {errand ? <Pinned errand={errand} /> : null}

        {!thread ? (
          <View style={styles.center}>{error ? <Text tone="danger">{error}</Text> : <ActivityIndicator />}</View>
        ) : (
          <FlatList
            ref={list}
            data={thread.messages}
            keyExtractor={(m) => String(m.id)}
            contentContainerStyle={styles.thread}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={
              <SysLine icon="lock" text="Messages and cards here are kept as evidence if there's ever a dispute." />
            }
            renderItem={({ item, index }) => {
              const prev = thread.messages[index - 1];
              const first = !prev || prev.senderId !== item.senderId || prev.kind === 'system';
              return <Message message={item} mine={item.senderId === user?.id} first={first} otherName={otherName} />;
            }}
            ListFooterComponent={
              VARIANT === 'customer' && errand ? (
                <CustomerCards
                  errand={errand}
                  pin={pin}
                  actions={errandState}
                  shortKobo={errandState.shortKobo}
                  onAsk={() => input.current?.focus()}
                />
              ) : undefined
            }
          />
        )}

        {error && thread ? (
          <Text tone="danger" variant="small" style={{ paddingHorizontal: 16 }} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        {open ? (
          <View style={[styles.dock, { backgroundColor: c.bg, borderTopColor: c.line }]}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.hints}
              keyboardShouldPersistTaps="handled"
            >
              {HINTS.map((h) => (
                <Pressable
                  key={h}
                  accessibilityRole="button"
                  accessibilityLabel={`Send: ${h}`}
                  disabled={sending}
                  onPress={() => send({ body: h })}
                  style={[styles.hint, { backgroundColor: c.surface2 }]}
                >
                  <Text style={styles.hintText}>{h}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <View style={[styles.composer, { backgroundColor: c.surface2 }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send a photo"
                onPress={sendPhoto}
                disabled={sending}
                style={styles.cb}
              >
                <Icon name="plus" />
              </Pressable>
              <TextInput
                ref={input}
                accessibilityLabel="Message"
                value={text}
                onChangeText={setText}
                placeholder={`Message ${otherName}`}
                placeholderTextColor={c.ink3}
                multiline
                // The web build draws a textarea, two rows tall unless told otherwise.
                numberOfLines={Platform.OS === 'web' ? 1 : undefined}
                maxLength={2000}
                style={[styles.input, { color: c.ink }]}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send"
                disabled={sending || !text.trim()}
                onPress={() => send({ body: text.trim() })}
                style={[styles.cb, { backgroundColor: sending || !text.trim() ? c.surface3 : c.ink }]}
              >
                {sending ? (
                  <ActivityIndicator color={c.onInk} />
                ) : (
                  <Icon name="up" size={20} weight={2.4} color={sending || !text.trim() ? c.ink3 : c.onInk} />
                )}
              </Pressable>
            </View>
          </View>
        ) : thread ? (
          <Text tone="ink3" style={{ textAlign: 'center', padding: 16 }}>
            This chat has ended.
          </Text>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** .pinned: the errand's route and progress above the thread; tap to go back to it. */
function Pinned({ errand }: { errand: ErrandView }) {
  const c = useColors();
  const pickup = errand.stops.find((s) => s.kind === 'pickup');
  const dropoff = errand.stops.find((s) => s.kind === 'dropoff');
  const title = `${pickup?.label ?? pickup?.address} to ${dropoff?.label ?? dropoff?.address}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. Open the errand`}
      // Back to the errand if it is underneath, otherwise open it.
      onPress={() => router.dismissTo(`/errand/${errand.id}`)}
      style={[styles.pinned, { backgroundColor: c.bg2 }]}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
        <Text style={styles.pinnedTitle} numberOfLines={1}>
          {title}
        </Text>
        <Segments step={stepOf(errand.status)} />
      </View>
      <Icon name="map" size={18} />
    </Pressable>
  );
}

function SysLine({ icon, text }: { icon: string; text: string }) {
  const c = useColors();
  return (
    <View style={styles.sysline}>
      <Icon name={icon} size={14} weight={2} color={c.ink3} />
      <Text style={[styles.sysText, { color: c.ink3 }]}>{text}</Text>
    </View>
  );
}

function Message({
  message,
  mine,
  first,
  otherName,
}: {
  message: ChatMessage;
  mine: boolean;
  first: boolean;
  otherName: string;
}) {
  const c = useColors();
  if (message.kind === 'system') return <SysLine icon="info" text={message.body} />;
  const bubble = (
    <View
      style={[
        styles.bubble,
        mine
          ? { backgroundColor: c.ink, borderBottomRightRadius: 6 }
          : { backgroundColor: c.surface2, borderBottomLeftRadius: 6 },
      ]}
    >
      {message.photoUrl ? (
        <Image source={{ uri: message.photoUrl }} style={styles.photo} accessibilityLabel="Photo" resizeMode="cover" />
      ) : null}
      {message.body ? <Text style={[styles.bubbleText, { color: mine ? c.onInk : c.ink }]}>{message.body}</Text> : null}
    </View>
  );
  if (mine) return <View style={[styles.m, { justifyContent: 'flex-end' }]}>{bubble}</View>;
  return (
    <View style={styles.m}>
      {first ? <Avatar name={otherName} size={32} /> : <View style={{ width: 32 }} />}
      <View style={styles.col}>
        {first ? <Text style={[styles.who, { color: c.ink3 }]}>{otherName}</Text> : null}
        {bubble}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 64,
    paddingVertical: 6,
    paddingLeft: 10,
    paddingRight: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  ib: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  headName: { fontFamily: fonts.bold, fontSize: 17 },
  pinned: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 10,
    paddingBottom: 12,
    paddingHorizontal: 16,
  },
  pinnedTitle: { fontFamily: fonts.bold, fontSize: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  thread: { paddingHorizontal: 16, paddingVertical: 16, gap: 14 },
  sysline: { alignSelf: 'center', flexDirection: 'row', alignItems: 'flex-start', gap: 6, maxWidth: '92%' },
  sysText: { fontSize: 12.5, lineHeight: 17, textAlign: 'center', flexShrink: 1 },
  m: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  col: { flex: 1, minWidth: 0, gap: 6, alignItems: 'flex-start' },
  who: { fontFamily: fonts.semibold, fontSize: 12, paddingLeft: 4 },
  bubble: { maxWidth: '80%', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 20, gap: 6 },
  bubbleText: { fontSize: 15.5, lineHeight: 21 },
  photo: { width: 200, height: 200, borderRadius: 12 },
  dock: { paddingTop: 8, paddingBottom: 12, paddingHorizontal: 16, borderTopWidth: StyleSheet.hairlineWidth },
  hints: { gap: 8, paddingBottom: 8 },
  hint: { height: 34, paddingHorizontal: 13, borderRadius: 999, justifyContent: 'center' },
  hintText: { fontFamily: fonts.semibold, fontSize: 13.5 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, padding: 4, borderRadius: 24, minHeight: 48 },
  cb: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  input: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 10,
    paddingHorizontal: 6,
    fontSize: 16,
    lineHeight: 22,
    maxHeight: 120,
    fontFamily: fonts.regular,
    ...noWebOutline,
  },
});
