import { useEffect, useState } from 'react';
import { LayoutChangeEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { G, Rect, Text as SvgText } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadRuns, Run } from './history';
import { bestOverall, effortLabel } from './efforts';
import { fmtDuration, monthGrid, monthName, monthShort, monthTotals, runDays, streak, weeklyTotals } from './stats';
import { fmtPace, fmtTime } from './session';
import { useSettings } from './settings';
import { distText, kmToUnit, paceLabel, unitName, unitToKm } from './units';

const GOAL_KEY = 'runbutan.goalKm';
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export default function YouScreen() {
  useSettings(); // redraw when the unit changes
  const [runs, setRuns] = useState<Run[]>([]);
  const [goalKm, setGoalKm] = useState(10);
  const now = new Date();
  const [cal, setCal] = useState({ y: now.getFullYear(), m: now.getMonth() });

  useEffect(() => {
    loadRuns().then(setRuns);
    AsyncStorage.getItem(GOAL_KEY)
      .then((v) => v && setGoalKm(Math.max(1, Number(v) || 10)))
      .catch(() => {});
  }, []);

  const changeGoal = (delta: number) => {
    const next = Math.max(1, Math.min(300, goalKm + unitToKm(delta)));
    setGoalKm(next);
    AsyncStorage.setItem(GOAL_KEY, String(next)).catch(() => {});
  };

  const weeks = weeklyTotals(runs, 12);
  const thisWeek = weeks[weeks.length - 1];
  const thisKm = thisWeek.distanceM / 1000; // the goal and this are both in km; shown converted below
  const goalU = kmToUnit(goalKm);
  const thisU = kmToUnit(thisKm);
  const sk = streak(runs);
  const efforts = bestOverall(runs);
  const days = runDays(runs, cal.y, cal.m);
  const grid = monthGrid(cal.y, cal.m);
  const tot = monthTotals(runs, cal.y, cal.m);
  const prevY = cal.m === 0 ? cal.y - 1 : cal.y;
  const prevM = cal.m === 0 ? 11 : cal.m - 1;
  const prevTot = monthTotals(runs, prevY, prevM);
  const delta = prevTot.distanceM > 0 ? Math.round(((tot.distanceM - prevTot.distanceM) / prevTot.distanceM) * 100) : null;
  const stepMonth = (n: number) => {
    const d = new Date(cal.y, cal.m + n, 1);
    setCal({ y: d.getFullYear(), m: d.getMonth() });
  };
  const isToday = (d: number) => cal.y === now.getFullYear() && cal.m === now.getMonth() && d === now.getDate();

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ gap: 14, paddingBottom: 12 }} showsVerticalScrollIndicator={false}>
      {/* Weekly goal */}
      <View style={styles.card}>
        <Text style={styles.label}>WEEKLY GOAL</Text>
        <View style={styles.rowBetween}>
          <Text style={styles.big}>
            {thisU.toFixed(1)}
            <Text style={styles.bigSub}> / {+goalU.toFixed(1)} {unitName()}</Text>
          </Text>
          <View style={styles.stepper}>
            <Pressable onPress={() => changeGoal(-1)} style={styles.stepBtn} hitSlop={8}>
              <Text style={styles.stepText}>−</Text>
            </Pressable>
            <Pressable onPress={() => changeGoal(1)} style={styles.stepBtn} hitSlop={8}>
              <Text style={styles.stepText}>+</Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.min(100, (thisKm / goalKm) * 100)}%` }]} />
        </View>
        <Text style={styles.hint}>{thisKm >= goalKm ? 'Goal reached! 🎉' : `${(goalU - thisU).toFixed(1)} ${unitName()} to go this week`}</Text>
      </View>

      {/* This week + 12-week chart */}
      <View style={styles.card}>
        <Text style={styles.label}>THIS WEEK</Text>
        <View style={styles.row}>
          <Stat label="DISTANCE" value={distText(thisWeek.distanceM)} />
          <Stat label="TIME" value={fmtDuration(thisWeek.elapsedSec)} />
          <Stat label="ELEV GAIN" value={`${Math.round(thisWeek.elevM)} m`} />
        </View>
        <Text style={[styles.label, { marginTop: 18 }]}>PAST 12 WEEKS · {unitName().toUpperCase()}</Text>
        <WeekChart weeks={weeks.map((w) => ({ start: w.start, km: kmToUnit(w.distanceM / 1000) }))} />
      </View>

      {/* Streak + calendar + monthly recap */}
      <View style={styles.card}>
        <View style={styles.row}>
          <Stat label="YOUR STREAK" value={`${sk.weeks} ${sk.weeks === 1 ? 'week' : 'weeks'}`} />
          <Stat label="STREAK ACTIVITIES" value={String(sk.activities)} />
        </View>
        <View style={[styles.rowBetween, { marginTop: 18 }]}>
          <Pressable onPress={() => stepMonth(-1)} hitSlop={12}><Text style={styles.nav}>‹</Text></Pressable>
          <Text style={styles.month}>{monthName(cal.m)} {cal.y}</Text>
          <Pressable onPress={() => stepMonth(1)} hitSlop={12}><Text style={styles.nav}>›</Text></Pressable>
        </View>
        <View style={styles.weekdays}>
          {WEEKDAYS.map((d, i) => <Text key={i} style={styles.weekday}>{d}</Text>)}
        </View>
        <View style={styles.grid}>
          {grid.map((d, i) => (
            <View key={i} style={styles.cell}>
              {d !== null && (
                <View style={[styles.day, days.has(d) && styles.dayRun, isToday(d) && styles.dayToday]}>
                  <Text style={[styles.dayText, days.has(d) && styles.dayTextRun]}>{d}</Text>
                </View>
              )}
            </View>
          ))}
        </View>
        <View style={styles.recap}>
          <Text style={styles.label}>{monthName(cal.m).toUpperCase()} RECAP</Text>
          <View style={styles.row}>
            <Stat label="RUNS" value={String(tot.runs)} />
            <Stat label="DISTANCE" value={distText(tot.distanceM, 1)} />
            <Stat label="TIME" value={fmtDuration(tot.elapsedSec)} />
          </View>
          <Text style={styles.hint}>
            {delta === null
              ? `${Math.round(tot.elevM)} m climbed`
              : `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)}% distance vs ${monthShort(prevM)} · ${Math.round(tot.elevM)} m climbed`}
          </Text>
        </View>
      </View>

      {/* Best efforts */}
      <View style={styles.card}>
        <Text style={styles.label}>BEST EFFORTS</Text>
        {efforts.length === 0 && <Text style={styles.hint}>Your fastest 400 m, 1 km, 5 km… show up here after a few runs with a saved route.</Text>}
        {efforts.map((e) => (
          <View key={e.d} style={styles.effort}>
            <View>
              <Text style={styles.effortName}>{effortLabel(e.d)}</Text>
              <Text style={styles.effortDate}>{new Date(e.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.effortTime}>{fmtTime(e.s)}</Text>
              <Text style={styles.effortDate}>{fmtPace(e.s / (e.d / 1000))} {paceLabel()}</Text>
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function WeekChart({ weeks }: { weeks: { start: number; km: number }[] }) {
  const [w, setW] = useState(0);
  const H = 120;
  const max = Math.max(5, ...weeks.map((x) => x.km));
  const gap = 6;
  const bw = w ? (w - gap * (weeks.length - 1)) / weeks.length : 0;
  return (
    <View onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)} style={{ marginTop: 10 }}>
      {w > 0 && (
        <Svg width={w} height={H + 20}>
          {weeks.map((x, i) => {
            const h = Math.max(x.km > 0 ? 3 : 1, (x.km / max) * H);
            const left = i * (bw + gap);
            const d = new Date(x.start);
            const newMonth = i === 0 || d.getDate() <= 7;
            const last = i === weeks.length - 1;
            return (
              <G key={x.start}>
                <Rect x={left} y={H - h} width={bw} height={h} rx={3} fill={last ? '#FF4D2E' : x.km > 0 ? '#8A3A2A' : '#26262F'} />
                {newMonth && (
                  <SvgText x={left} y={H + 15} fill="#8A8A96" fontSize={10} fontWeight="700">
                    {monthShort(d.getMonth())}
                  </SvgText>
                )}
              </G>
            );
          })}
        </Svg>
      )}
    </View>
  );
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <View style={styles.stat}>
    <Text style={styles.label}>{label}</Text>
    <Text style={styles.statValue}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  root: { flex: 1, marginTop: 4 },
  card: { backgroundColor: '#17171F', borderRadius: 18, padding: 16 },
  label: { color: '#8A8A96', fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  stat: { flex: 1 },
  statValue: { color: '#fff', fontSize: 20, fontWeight: '800', marginTop: 2, fontVariant: ['tabular-nums'] },
  big: { color: '#fff', fontSize: 34, fontWeight: '900', marginTop: 4, fontVariant: ['tabular-nums'] },
  bigSub: { color: '#8A8A96', fontSize: 18, fontWeight: '700' },
  stepper: { flexDirection: 'row', gap: 8 },
  stepBtn: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#2A2A35', alignItems: 'center', justifyContent: 'center' },
  stepText: { color: '#fff', fontSize: 22, fontWeight: '800', marginTop: -2 },
  track: { height: 8, borderRadius: 4, backgroundColor: '#26262F', marginTop: 12, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: '#FF4D2E' },
  hint: { color: '#8A8A96', fontSize: 13, marginTop: 8 },
  nav: { color: '#FF4D2E', fontSize: 30, fontWeight: '800', paddingHorizontal: 8 },
  month: { color: '#fff', fontSize: 18, fontWeight: '800' },
  weekdays: { flexDirection: 'row', marginTop: 10 },
  weekday: { width: '14.2857%', textAlign: 'center', color: '#55555F', fontSize: 11, fontWeight: '800' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
  cell: { width: '14.2857%', alignItems: 'center', paddingVertical: 3 },
  day: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  dayRun: { borderColor: '#FF4D2E', backgroundColor: 'rgba(255,77,46,0.2)' },
  dayToday: { backgroundColor: '#2A2A35' },
  dayText: { color: '#8A8A96', fontSize: 13, fontWeight: '700' },
  dayTextRun: { color: '#fff' },
  recap: { marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: '#26262F' },
  effort: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#26262F', marginTop: 4 },
  effortName: { color: '#fff', fontSize: 16, fontWeight: '800' },
  effortTime: { color: '#fff', fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },
  effortDate: { color: '#8A8A96', fontSize: 12, marginTop: 2 },
});
