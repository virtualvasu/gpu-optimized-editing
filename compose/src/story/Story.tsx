// One composition for every episode of every project: backdrop, title/screen/recap/end scenes, a macOS window around every
// screen recording, word-synced captions, music ducked under the voice. Everything topic-specific comes in as props: the
// project's theme, the episode's storyboard, the voice timings and the clip info (vep builds them). Custom diagram scenes are the
// project's own (its scenes/index.tsx, bundled in as @project-scenes).
import React, { useMemo } from 'react';
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile } from 'remotion';
import { Backdrop } from '../Backdrop';
import { TitleScene, SectionScene, EndScene } from '../scenes';
import { RecapScene } from '../Recap';
import { Captions, buildChunks } from '../Captions';
import { Chrome, Interval } from '../Chrome';
import { C, TH, Theme, applyTheme, sec } from '../theme';
import { Phrase } from '../fit';
import { MacScreen } from '../MacScreen';
import { CUSTOM } from '@project-scenes';
import { ClipInfo, Storyboard, at, buildTimeline, prepScreen } from './timeline';

export type StoryProps = { theme: Theme; storyboard: Storyboard; blocks: Record<string, any>; clips: Record<string, ClipInfo> };

export const Story: React.FC<StoryProps> = ({ theme, storyboard: sb, blocks, clips }) => {
  applyTheme(theme);
  const { BLOCKS, TIMELINE, TOTAL } = useMemo(() => buildTimeline(sb, blocks, clips), [sb, blocks, clips]);
  const frames = sec(TOTAL);

  const chunks = useMemo(() => buildChunks(TIMELINE.flatMap((sc) => sc.phrases.map((p) => ({ start: sc.start + p.A - p.a0, words: BLOCKS[p.b].words.filter((w) => w.s >= p.a0 - 0.06 && w.s < p.a1 + 0.06) })))), [TIMELINE, BLOCKS]);
  const prepped = useMemo(() => TIMELINE.map((sc) => (sc.type === 'screen' ? prepScreen(BLOCKS, sc) : null)), [TIMELINE, BLOCKS]);
  const trans = TIMELINE.map((sc) => sec(sc.start + 0.3));
  const voIv = TIMELINE.flatMap((sc) => sc.phrases.map((p) => [sec(sc.start + p.A), sec(sc.start + p.A + (p.a1 - p.a0))] as const));
  const duck = (f: number) => { let a = 0; for (const [s, e] of voIv) { if (f < s - 14 || f > e + 26) continue; a = Math.max(a, interpolate(f, [s - 12, s + 6, Math.max(e - 6, s + 7), Math.max(e + 24, s + 8)], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })); } return 1 - TH.audio.duck * a; };
  const musicVol = (f: number) => (sb.music ?? TH.audio.music) * duck(f) * interpolate(f, [0, sec(2.5)], [0, 1], { extrapolateRight: 'clamp' }) * interpolate(f, [sec(TOTAL - 5), sec(TOTAL)], [1, 0], { extrapolateLeft: 'clamp' });

  const sfx: [string, number, number][] = [[TH.assets.sting, 0.25, TH.audio.sting]];
  TIMELINE.forEach((sc, i) => { if (i) sfx.push([sc.type === 'end' || sc.type === 'title' ? TH.assets.whoosh : TH.assets.whooshSoft, sc.start + 0.08, sc.type === 'end' ? TH.audio.endTransition : TH.audio.transition]); });

  const chrome: Interval[] = TIMELINE.filter((s) => s.type === 'screen').map((s) => ({ from: s.start + 0.6, to: s.start + s.len - 0.2, label: sb.labels[s.chapter], idx: s.chapter }));
  const seq = (sc: any, node: React.ReactNode) => <Sequence key={sc.id} from={sec(sc.start)} durationInFrames={sec(sc.len)}>{node}</Sequence>;

  return (
    <AbsoluteFill style={{ background: C.bgBot }}>
      <Backdrop boosts={trans} total={frames} />
      {TIMELINE.map((sc, i) => {
        const d = sec(sc.len);
        if (sc.type === 'title') return seq(sc, <TitleScene dur={d} eyebrow={sc.eyebrow} line1={sc.line1} line2={sc.line2} />);
        if (sc.type === 'section') return seq(sc, <SectionScene dur={d} num={String(sc.chapter + 1).padStart(2, '0')} title={sc.title} tagline={sc.tagline ?? ''} index={sc.chapter} labels={sb.labels} />);
        if (sc.type === 'screen') { const p = prepped[i]!; return seq(sc, <MacScreen dur={d} src={`clips/${sc.clip}.mp4`} segs={sc.segs!} zooms={p.zooms} overlays={p.overlays} highlights={p.highlights} url={sc.url} />); }
        if (sc.type === 'recap') return seq(sc, <RecapScene dur={d} items={sc.items.map((it: any) => ({ at: at(BLOCKS, sc, it.b, it.w), title: it.title, sub: it.sub }))} cta={{ at: at(BLOCKS, sc, sc.cta.b, sc.cta.w), text: sc.cta.text }} />);
        if (sc.type === 'end') return seq(sc, <EndScene dur={d} line1={sc.line1} line2={sc.line2} cta={sc.cta} card={sc.card === true ? TH.endCard : sc.card} />);
        const Custom = CUSTOM[sc.type];
        if (!Custom) throw new Error(`scene ${sc.id}: unknown scene type "${sc.type}" (add it to the project's scenes/index.tsx)`);
        const cues: Record<string, number> = {};
        for (const k of Object.keys(sc.cues || {})) { const [b, w, n] = sc.cues[k]; cues[k] = at(BLOCKS, sc, b, w, n ?? 0); }
        return seq(sc, <Custom dur={d} {...cues} />);
      })}
      <Chrome intervals={chrome} total={TOTAL} labels={sb.labels} />
      <Captions chunks={chunks} />
      <Audio src={staticFile(TH.assets.music)} volume={musicVol} loop />
      {TIMELINE.flatMap((sc) => sc.phrases.map((p: Phrase, i: number) => <Sequence key={'vo' + sc.start + p.b + i} from={sec(sc.start + p.A)}><Audio src={staticFile(`voice/${p.b}.mp3`)} startFrom={sec(p.a0)} endAt={sec(p.a1)} volume={1} /></Sequence>))}
      {sfx.map(([n, t, v], i) => <Sequence key={'s' + i} from={sec(t)}><Audio src={staticFile(n)} volume={v} /></Sequence>)}
    </AbsoluteFill>
  );
};
