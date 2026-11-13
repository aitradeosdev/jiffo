import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useSession } from '@/auth/session';
import { errorMessage } from '@/api/client';
import { useApplication, type Application } from '@/agent/application';
import { useColors } from '@/theme/theme';
import { fonts } from '@/theme/tokens';
import { Button, Text } from '@/ui/kit';
import { ObScreen, Question } from '@/ui/onboarding';
import { CheckMark, Icon } from '@/ui/parts';

/** How errands work, in four screens, as in the prototype. */
const SLIDES: Array<[icon: string, title: string, body: string]> = [
  [
    'lock',
    'The fee is held before you move',
    "When you accept, the customer's errand fee is locked in escrow. It's paid to you when the customer confirms hand-off.",
  ],
  [
    'play',
    'Agree the price, then Start service',
    'You can send a new price until you tap Start service. After that the fee is fixed.',
  ],
  [
    'camera',
    'Buy, then send the amount with photos',
    'On purchase errands you buy first, then send the item amount with a receipt photo and an items photo. The customer locks it.',
  ],
  [
    'shield',
    'Get paid with the PIN',
    "Mark it delivered, then enter the customer's 4-digit PIN. Item money is yours to withdraw at once.",
  ],
];

const TERMS = [
  "You're an independent contractor, not an employee.",
  'You choose your own hours and which errands you take.',
  'You handle your own tax on what you earn.',
  'On purchase errands, item money is your risk until the customer locks the amount.',
  'Customers rate you, and repeated cancellations add strikes.',
];

/** The four screens, then the short agent terms to agree to. */
export default function Learn() {
  const c = useColors();
  const { api } = useSession();
  const { setApp } = useApplication();
  const [slide, setSlide] = useState(0);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onTerms = slide >= SLIDES.length;

  const agree = async () => {
    setBusy(true);
    setError(null);
    try {
      setApp(await api.post<Application>('/v1/agent/application/terms', { accepted: true }));
      router.dismissTo('/apply');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (onTerms) {
    return (
      <ObScreen
        onBack={() => setSlide(SLIDES.length - 1)}
        footer={<Button label="Agree and finish" onPress={agree} disabled={!agreed} loading={busy} />}
      >
        <Question title="Agent terms" sub="The short version of what you agree to as an agent." />
        <View style={[styles.terms, { backgroundColor: c.surface2 }]}>
          {TERMS.map((t) => (
            <View key={t} style={styles.term}>
              <View style={{ marginTop: 2 }}>
                <Icon name="check" size={16} weight={2.6} />
              </View>
              <Text tone="ink2" style={{ flex: 1, fontSize: 14.5, lineHeight: 21 }}>
                {t}
              </Text>
            </View>
          ))}
        </View>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: agreed }}
          accessibilityLabel="I'm 18 or older and agree to the agent terms."
          onPress={() => setAgreed((a) => !a)}
          style={styles.tick}
        >
          <CheckMark on={agreed} />
          <Text style={{ flex: 1 }}>I&apos;m 18 or older and agree to the agent terms.</Text>
        </Pressable>
        {error ? (
          <Text tone="danger" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
      </ObScreen>
    );
  }

  const [icon, title, body] = SLIDES[slide]!;
  return (
    <ObScreen
      onBack={() => (slide ? setSlide(slide - 1) : router.dismissTo('/apply'))}
      footer={
        <View style={{ gap: 14 }}>
          <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no">
            {[...SLIDES, null].map((_, k) => (
              <View
                key={k}
                style={[
                  styles.dot,
                  { backgroundColor: k === slide ? c.ink : c.surface3 },
                  k === slide && { width: 22 },
                ]}
              />
            ))}
          </View>
          <Button
            label={slide === SLIDES.length - 1 ? 'Last step: the terms' : 'Next'}
            onPress={() => setSlide(slide + 1)}
          />
        </View>
      }
    >
      <Text style={[styles.cap, { color: c.ink3 }]}>
        How errands work · {slide + 1} of {SLIDES.length}
      </Text>
      <View style={styles.slide}>
        <View style={[styles.big, { backgroundColor: c.surface2 }]}>
          <Icon name={icon} size={46} weight={1.6} />
        </View>
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        <Text tone="ink2" style={styles.body}>
          {body}
        </Text>
      </View>
    </ObScreen>
  );
}

const styles = StyleSheet.create({
  cap: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 0.72, textTransform: 'uppercase' },
  slide: { alignItems: 'center', gap: 14, paddingTop: 18, paddingHorizontal: 6 },
  big: { width: 104, height: 104, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.bold, fontSize: 27, lineHeight: 31, letterSpacing: -0.54, textAlign: 'center' },
  body: { fontSize: 15.5, lineHeight: 23, maxWidth: 320, textAlign: 'center' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  terms: { padding: 16, borderRadius: 14, gap: 12 },
  term: { flexDirection: 'row', gap: 10 },
  tick: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
});
