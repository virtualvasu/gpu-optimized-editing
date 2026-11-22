# Pipeline improvement ideas (later; nothing implemented)

Moved from memory 2026-11-22. Owner OK'd adding these LATER (2026-11-06).


Owner (2026-11-06): "We'll add these Remotion changes to the video editing pipeline later" — brainstorm only, do NOT implement until asked. The pipeline (`~/Desktop/phinite/video-editing-pipeline`) already runs on Remotion 4.0.532 (`compose/`), `vep studio` = Remotion Studio, render on the GPU machine.

Ranked ideas (from the Ep 11/19 fix night):
1. `vep lint` for storyboard.json (schema/Zod): unknown marks, `mark:undefined` from callouts without a mark, anchor words missing in the block, hl marks without a recorded box, beats out of narration order (causes duplicate captions / "captions outside the voice"), numeric clip times that went stale after a re-record.
2. Box audit from the data (props + voice json), not pixels: `boxscan` cannot see ring-style boxes; output one still per box + flags (blank canvas, word at sentence end gives <1 s box, picture already past the mark).
3. Non-destructive trimming: cut list next to the raw clip instead of `tighten_clips.py` re-encoding (it collapsed Ep 19's code typing to ~1 s; use only on clips whose frozen spans are real waits, never on typing).
4. Recording drift check: replay every capture.json against the portal in rehearse mode (Dev Studio sidebar/Logs redesign broke Ep 19's plan in ~5 places).
5. Word timing by forced alignment (whisper.cpp) instead of `voice_from_final` caption matching (tripped on `[[x|y]]` before punctuation; workaround = plain text in narration.json when only reusing audio).
6. Sharded render across machines (`--frames A-B` + ffmpeg concat); Ep 19 6-min render took 7:43.
7. Publishing kit from the storyboard: chapters.txt, description, tags (chapters were derived from captions by hand).
8. Thumbnail variants (checklist has thumbs 2 and 3) via Remotion stills for YouTube Test & Compare.
9. Visual box tuner in Remotion Studio (drag box -> writes explicit `box` into storyboard).
10. Later: 9:16 shorts, other languages from the same storyboard.

**Why:** ideas came from the failures hit while fixing Ep 11 and Ep 19 (2026-11-05/06); owner wants them added later, not now.
**How to apply:** when the owner says to improve the pipeline, start from this list (suggested first three: 1, 3, 2). Related [[series-fix-batch-5-videos]].

**Also (owner 2026-11-06: idea good, NO changes for now):** Drive uploads are slow because the rclone remote `gdrive` uses the shared rclone Google client (no client_id), so Google rate-limits requests per minute, and our safe flags (--tpslimit 1-2, pacer 1-2 s, 3 transfers) make artifacts (70-180 small files) request-bound; big videos are fast. Fix later: own Google Cloud OAuth client id/secret in the remote (own quota, drop the throttles), or zip artifacts into one archive per episode. Do not change until the owner asks.
