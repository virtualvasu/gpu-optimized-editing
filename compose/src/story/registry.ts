// Storyboard episodes: one line per episode (composition id -> storyboard). Everything else (narration, clips) is looked up by
// the storyboard's `ep` folder at render time; see EPISODE_PLAYBOOK.md section 11.
import ep12 from '../../episodes/ep12/storyboard.json';
import ep39 from '../../episodes/ep39/storyboard.json';

export const STORIES: Record<string, any> = { Ep12: ep12, Ep39: ep39 };
