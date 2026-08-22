import {
  createRenderTracker,
  installNetworkObserver,
  reportAppData,
  reportJsTask,
  reportNetworkRequest,
  reportRoute,
} from '@rn-agent-observer/rn-instrumentation';
import { StatusBar } from 'expo-status-bar';
import {
  Profiler,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

type Route =
  | 'Home'
  | 'PerformanceLab'
  | 'NetworkLab'
  | 'RenderLab'
  | 'AnimationLab'
  | 'ErrorLab'
  | 'VisualLab';

const ROUTES: Route[] = [
  'PerformanceLab',
  'NetworkLab',
  'RenderLab',
  'AnimationLab',
  'ErrorLab',
  'VisualLab',
];

function Button({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

function Screen({
  title,
  children,
  onBack,
}: {
  title: string;
  children: ReactNode;
  onBack: () => void;
}) {
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Button label="Back" testID="back-button" onPress={onBack} />
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
      </View>
      {children}
    </View>
  );
}

function PerformanceLab({ onBack }: { onBack: () => void }) {
  const [lastBlockMs, setLastBlockMs] = useState(0);
  const triggerBlock = () => {
    const started = performance.now();
    while (performance.now() - started < 100) {
      Math.sqrt(Math.random() * 1000);
    }
    const durationMs = performance.now() - started;
    reportJsTask(durationMs, 'PerformanceLab 100ms fixture');
    setLastBlockMs(durationMs);
  };
  return (
    <Screen title="PerformanceLab" onBack={onBack}>
      <Button
        label="Trigger 100ms JS task"
        testID="trigger-js-block"
        onPress={triggerBlock}
      />
      <Text testID="last-block">Last block: {lastBlockMs.toFixed(1)}ms</Text>
      <FlatList
        style={styles.list}
        data={Array.from({ length: 500 }, (_, index) => index)}
        keyExtractor={(item) => String(item)}
        renderItem={({ item }) => (
          <Text style={styles.row}>Performance row {item}</Text>
        )}
      />
    </Screen>
  );
}

function NetworkLab({ onBack }: { onBack: () => void }) {
  const [result, setResult] = useState('idle');
  const request = async (status: number, delay: number) => {
    setResult('loading');
    const started = performance.now();
    await new Promise((resolve) => setTimeout(resolve, delay));
    const durationMs = performance.now() - started;
    reportNetworkRequest({
      method: 'GET',
      url: `/fixtures/network/${status}?delay=${delay}&access_token=demo-secret`,
      status,
      durationMs,
      responseBytes: status >= 400 ? 128 : 2048,
      ...(status >= 500 ? { error: `HTTP ${status}` } : {}),
    });
    setResult(`${status} in ${durationMs.toFixed(0)}ms fixture`);
  };
  const requestWithBody = async () => {
    setResult('loading');
    const started = performance.now();
    await new Promise((resolve) => setTimeout(resolve, 60));
    const durationMs = performance.now() - started;
    reportNetworkRequest({
      method: 'POST',
      url: '/fixtures/network/echo?access_token=demo-secret',
      status: 200,
      durationMs,
      responseBytes: 512,
      requestBodyPreview:
        '{"access_token":"demo-secret","item":"widget","quantity":2}',
      responseBodyPreview: '{"ok":true,"email":"user@example.test"}',
    });
    setResult(`body fixture in ${durationMs.toFixed(0)}ms`);
  };
  const realFetch = async () => {
    setResult('loading');
    try {
      const response = await fetch('http://localhost:8081/status');
      setResult(`real fetch HTTP ${response.status}`);
    } catch (error) {
      setResult(
        `real fetch failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  };
  return (
    <Screen title="NetworkLab" onBack={onBack}>
      <Button
        label="Fast request"
        testID="network-fast"
        onPress={() => void request(200, 0)}
      />
      <Button
        label="500ms request"
        testID="network-500"
        onPress={() => void request(200, 500)}
      />
      <Button
        label="2s request"
        testID="network-2000"
        onPress={() => void request(200, 2000)}
      />
      <Button
        label="Failing request"
        testID="network-fail"
        onPress={() => void request(503, 100)}
      />
      <Button
        label="Body capture fixture"
        testID="network-body"
        onPress={() => void requestWithBody()}
      />
      <Button
        label="Real fetch (Metro /status)"
        testID="network-real"
        onPress={() => void realFetch()}
      />
      <Text testID="network-result">{result}</Text>
    </Screen>
  );
}

function BadRow({ index, tick }: { index: number; tick: number }) {
  return (
    <Text style={styles.row}>
      Row {index} rendered at tick {tick}
    </Text>
  );
}

function RenderLab({ onBack }: { onBack: () => void }) {
  const [tick, setTick] = useState(0);
  return (
    <Screen title="RenderLab" onBack={onBack}>
      <Button
        label="Rerender all rows"
        testID="rerender-list"
        onPress={() => setTick((value) => value + 1)}
      />
      <Button
        label="Dump app state"
        testID="dump-state"
        onPress={() =>
          reportAppData('render-lab', {
            route: 'RenderLab',
            tick,
            rowArrayLength: 100,
          })
        }
      />
      <Text testID="render-count">Parent tick: {tick}</Text>
      <ScrollView style={styles.list}>
        {Array.from({ length: 100 }, (_, index) => (
          <BadRow key={index} index={index} tick={tick} />
        ))}
      </ScrollView>
    </Screen>
  );
}

function AnimationLab({ onBack }: { onBack: () => void }) {
  const translate = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let animation: Animated.CompositeAnimation | undefined;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduceMotion) => {
      if (reduceMotion) return;
      animation = Animated.loop(
        Animated.sequence([
          Animated.timing(translate, {
            toValue: 220,
            duration: 900,
            useNativeDriver: true,
          }),
          Animated.timing(translate, {
            toValue: 0,
            duration: 900,
            useNativeDriver: true,
          }),
        ]),
      );
      animation.start();
    });
    return () => animation?.stop();
  }, [translate]);
  return (
    <Screen title="AnimationLab" onBack={onBack}>
      <Animated.View
        testID="animated-box"
        style={[styles.animatedBox, { transform: [{ translateX: translate }] }]}
      />
    </Screen>
  );
}

function ErrorLab({ onBack }: { onBack: () => void }) {
  const [handled, setHandled] = useState(false);
  return (
    <Screen title="ErrorLab" onBack={onBack}>
      <Button
        label="Console error"
        testID="console-error"
        onPress={() => console.error('RN Agent Observer demo console error')}
      />
      <Button
        label="Handled exception"
        testID="handled-error"
        onPress={() => {
          try {
            throw new Error('Demo handled exception');
          } catch (error) {
            console.error(error);
            setHandled(true);
          }
        }}
      />
      <Button
        label="Unhandled exception"
        testID="unhandled-error"
        onPress={() => {
          setTimeout(() => {
            throw new Error('Demo unhandled exception');
          }, 0);
        }}
      />
      <Text>
        {handled ? 'Handled exception captured' : 'No handled exception yet'}
      </Text>
    </Screen>
  );
}

function VisualLab({ onBack }: { onBack: () => void }) {
  const [regressed, setRegressed] = useState(false);
  return (
    <Screen title="VisualLab" onBack={onBack}>
      <Button
        label="Toggle regression"
        testID="toggle-regression"
        onPress={() => setRegressed((value) => !value)}
      />
      <View
        testID="visual-fixture"
        style={[
          styles.visualFixture,
          regressed && styles.visualFixtureRegressed,
        ]}
      >
        <Text style={styles.fixtureText}>
          {regressed ? 'REGRESSED' : 'BASELINE'}
        </Text>
      </View>
    </Screen>
  );
}

export default function App() {
  const [route, setRoute] = useState<Route>('Home');
  const onRender = useMemo(() => createRenderTracker('DemoApp'), []);

  useEffect(() => installNetworkObserver(), []);
  useEffect(() => reportRoute(route), [route]);

  const content =
    route === 'Home' ? (
      <View style={styles.screen}>
        <Text accessibilityRole="header" style={styles.title}>
          RN Agent Observer Demo
        </Text>
        <Text style={styles.subtitle}>
          Deterministic runtime observability labs
        </Text>
        {ROUTES.map((item) => (
          <Button
            key={item}
            label={item}
            testID={`open-${item}`}
            onPress={() => setRoute(item)}
          />
        ))}
      </View>
    ) : route === 'PerformanceLab' ? (
      <PerformanceLab onBack={() => setRoute('Home')} />
    ) : route === 'NetworkLab' ? (
      <NetworkLab onBack={() => setRoute('Home')} />
    ) : route === 'RenderLab' ? (
      <RenderLab onBack={() => setRoute('Home')} />
    ) : route === 'AnimationLab' ? (
      <AnimationLab onBack={() => setRoute('Home')} />
    ) : route === 'ErrorLab' ? (
      <ErrorLab onBack={() => setRoute('Home')} />
    ) : (
      <VisualLab onBack={() => setRoute('Home')} />
    );

  return (
    <Profiler id="DemoApp" onRender={onRender}>
      <View style={styles.container}>
        {content}
        <StatusBar style="light" />
      </View>
    </Profiler>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  screen: { flex: 1, padding: 24, paddingTop: 64, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  title: { color: '#f8fafc', fontSize: 28, fontWeight: '700', flexShrink: 1 },
  subtitle: { color: '#94a3b8', fontSize: 16, marginBottom: 12 },
  button: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 12,
  },
  buttonPressed: { opacity: 0.7 },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  list: { flex: 1, marginTop: 8 },
  row: {
    color: '#cbd5e1',
    paddingVertical: 8,
    borderBottomColor: '#334155',
    borderBottomWidth: 1,
  },
  animatedBox: {
    width: 80,
    height: 80,
    backgroundColor: '#22c55e',
    borderRadius: 16,
    marginTop: 80,
  },
  visualFixture: {
    height: 220,
    borderRadius: 24,
    backgroundColor: '#14b8a6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  visualFixtureRegressed: {
    backgroundColor: '#ef4444',
    transform: [{ translateX: 24 }],
    borderRadius: 4,
  },
  fixtureText: { color: '#ffffff', fontSize: 28, fontWeight: '800' },
});
