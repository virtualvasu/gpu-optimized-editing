// Two compositions serve every project: `Episode` (the video) and `Thumb` (its thumbnail). vep passes the props: the project's
// resolved theme, the episode's storyboard, the voice timings (blocks) and the clip info.
import React from 'react';
import { Composition } from 'remotion';
import { FPS, W, H, sec } from './theme';
import { Story, StoryProps } from './story/Story';
import { Thumb } from './Thumb';
import { buildTimeline } from './story/timeline';

const EMPTY = { theme: null, storyboard: { labels: [], scenes: [] }, blocks: {}, clips: {} } as unknown as StoryProps;
const episodeMeta = async ({ props }: { props: StoryProps }) =>
  props.storyboard.scenes.length ? { durationInFrames: sec(buildTimeline(props.storyboard, props.blocks, props.clips).TOTAL) } : {};

export const Root: React.FC = () => (
  <>
    <Composition id="Episode" component={Story as any} durationInFrames={30} fps={FPS} width={W} height={H} defaultProps={EMPTY} calculateMetadata={episodeMeta as any} />
    <Composition id="Thumb" component={Thumb as any} durationInFrames={1} fps={FPS} width={W} height={H} defaultProps={EMPTY} />
  </>
);
