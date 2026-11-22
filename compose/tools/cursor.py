"""Replace a screen recording's real mouse pointer (shaky, flickering, three different shapes) with one smooth pointer.

usage: cursor.py <in.mp4> <templates dir> <out.mp4> [--start S] [--dur D] [--debug dir]
   templates dir: arrow.png, ibeam.png, hand.png  (small crops of the recorder's own pointer shapes, cut from a frame)

Steps (all per frame, 30 fps clips from `vep cut`):
  1. track   find the pointer by masked template matching: a full-frame search to acquire it, then a small window around the last place
  2. erase   paste back the pixels under the pointer from the nearest frame where the pointer is elsewhere and the surroundings match
             (cv2.inpaint when the picture there is changing)
  3. smooth  median filter + Gaussian + "hold still when it is still", gaps closed; the hotspot path becomes the new pointer's path
  4. draw    one clean arrow with a soft halo at the smoothed path (anti-aliased, drawn at 4x and scaled down); a small ring pulses where it dwells
The tracker needs OpenCV + numpy (run it where they are installed); only the clip is read and written."""
import argparse, json, os, subprocess, sys
import cv2
import numpy as np

SEARCH = 90          # px around the last position
ACCEPT = 42.0         # mean gray difference under the template mask above which a match is rejected


def load_templates(d):
    """clean templates: the recorder's own arrow and hand (everything outside the pointer whitened) and a drawn I-beam"""
    T = {}
    for name in ('arrow', 'hand'):
        p = os.path.join(d, name + '.png')
        if not os.path.exists(p):
            continue
        g = cv2.cvtColor(cv2.imread(p), cv2.COLOR_BGR2GRAY)
        core = (g < (70 if name == 'hand' else 100)).astype(np.uint8)
        if name == 'hand':   # keep only the biggest dark blob (the neighbouring text is dark too)
            n, lab, st, _ = cv2.connectedComponentsWithStats(core); k = 1 + int(np.argmax(st[1:, 4])); core = (lab == k).astype(np.uint8)
        keep = cv2.dilate(core, np.ones((5, 5), np.uint8))
        g2 = np.where(keep > 0, g, 255).astype(np.uint8)
        ys, xs = np.where(core > 0); top = ys.min(); hx = int(xs[ys == top].mean())
        T[name] = {'g': g2, 'hot': (hx, int(top)), 'thr': 0.88 if name == 'hand' else 0.72, 'core': core.copy()}
    p = os.path.join(d, 'ibeam.png')     # the text cursor sits on text: keep only its own column (stem + serifs) of the crop, whiten the rest
    if os.path.exists(p):
        g = cv2.cvtColor(cv2.imread(p), cv2.COLOR_BGR2GRAY); col = int(np.argmax((g < 120).sum(0)))
        keep = np.zeros_like(g, bool); keep[:, max(0, col - 3):col + 4] = True
        g2 = np.where(keep, g, 255).astype(np.uint8); ys, xs = np.where((g < 120) & keep)
        T['ibeam_ref'] = {'g': g2, 'hot': (col, int((ys.min() + ys.max()) // 2)), 'thr': 9.0, 'local': True, 'core': ((g < 120) & keep).astype(np.uint8)}   # reference only (never matches): sets the size and hotspot of a text cursor found by difference
    return T


def match(gray, T, roi=None, relax=1.0):
    """best (score, name, x, y): zero-mean normalised correlation of each template inside roi=(x0,y0,x1,y1); score is 0..1 (1 = identical)"""
    x0, y0, x1, y1 = roi if roi else (0, 0, gray.shape[1], gray.shape[0])
    sub = gray[y0:y1, x0:x1]
    best = None
    for name, t in T.items():
        th, tw = t['g'].shape
        if sub.shape[0] < th or sub.shape[1] < tw or (roi is None and t.get('local')):
            continue                       # the text cursor is only looked for near where the pointer just was
        r = cv2.matchTemplate(sub, t['g'], cv2.TM_CCOEFF_NORMED)
        _, mx, _, loc = cv2.minMaxLoc(r)
        if mx >= t['thr'] * relax and (best is None or mx > best[0]):
            best = (float(mx), name, x0 + loc[0], y0 + loc[1])
    return best


def diff_detect(gs, i, last):
    """the pointer when no template fits (a text cursor over text): the small thing in this frame that is not in its neighbours (temporal median of nearby frames)"""
    n = len(gs); x, y = last
    x0, y0, x1, y1 = max(0, x - SEARCH), max(0, y - SEARCH), min(gs[i].shape[1], x + SEARCH), min(gs[i].shape[0], y + SEARCH)
    nb = [gs[j][y0:y1, x0:x1] for j in range(i - 14, i + 15, 4) if j != i and 0 <= j < n]
    if len(nb) < 4:
        return None
    bg = np.median(np.stack(nb), axis=0).astype(np.uint8)
    d = cv2.absdiff(gs[i][y0:y1, x0:x1], bg)
    m = cv2.dilate((d > 55).astype(np.uint8), np.ones((3, 3), np.uint8))
    k, lab, st, cen = cv2.connectedComponentsWithStats(m)
    best = None
    for c in range(1, k):
        bx, by, bw, bh, ar = st[c]
        if 5 <= bw <= 26 and 12 <= bh <= 42 and ar >= 30:
            cx, cy = x0 + bx + bw / 2, y0 + by + bh / 2
            dist = np.hypot(cx - x, cy - y)
            if best is None or dist < best[0]:
                best = (dist, cx, cy)
    return best


def track(frames_gray, T, log=print):
    n = len(frames_gray); pos = [None] * n; last = None; miss = 0; seen = -999
    for i, g in enumerate(frames_gray):
        res = None
        if last is not None and miss < 15:
            x, y = last
            res = match(g, T, (max(0, x - SEARCH), max(0, y - SEARCH), min(g.shape[1], x + SEARCH + 40), min(g.shape[0], y + SEARCH + 40)), relax=0.96)
        if res is None and (i % 4 == 0 or last is None):
            res = match(g, T)
        if res is not None:
            sc, name, x, y = res
            pos[i] = (name, x, y, sc); last = (x, y); miss = 0; seen = i
            continue
        miss += 1
        if last is not None and i - seen < 150:   # text cursor / pointer the templates do not fit: look for it by what moved
            h = diff_detect(frames_gray, i, last)
            if h is not None:
                hx, hy = T['ibeam_ref']['hot'] if 'ibeam_ref' in T else (7, 14)
                pos[i] = ('ibeam_ref', int(h[1] - hx), int(h[2] - hy), 0.3); last = (int(h[1] - hx), int(h[2] - hy))
    return pos


def hotspots(pos, T):
    hs = np.full((len(pos), 2), np.nan)
    for i, p in enumerate(pos):
        if p:
            name, x, y, _ = p
            hx, hy = T[name]['hot']
            hs[i] = (x + hx, y + hy)
    return hs


def smooth_path(hs, fps=30, max_gap=12):
    n = len(hs); ok = ~np.isnan(hs[:, 0]); out = hs.copy()
    idx = np.arange(n)
    if ok.sum() < 3:
        return out, ok
    # close gaps up to max_gap frames by linear interpolation; longer gaps stay empty (pointer hidden)
    vis = np.zeros(n, bool); known = idx[ok]
    for a, b in zip(known[:-1], known[1:]):
        if b - a <= max_gap + 1:
            vis[a:b + 1] = True
    vis[known[0]] = vis[known[-1]] = True
    for k in (0, 1):
        out[:, k] = np.interp(idx, known, hs[known, k])
    # median (removes single-frame mismatches), then Gaussian (removes hand tremor)
    def med(v, w=7):
        p = np.pad(v, (w // 2, w // 2), mode='edge'); return np.array([np.median(p[i:i + w]) for i in range(len(v))])
    for k in (0, 1):
        out[:, k] = med(out[:, k])
    sig = 3.2
    r = int(sig * 3); ker = np.exp(-0.5 * (np.arange(-r, r + 1) / sig) ** 2); ker /= ker.sum()
    for k in (0, 1):
        p = np.pad(out[:, k], (r, r), mode='edge'); out[:, k] = np.convolve(p, ker, mode='valid')
    # hold still when it is still: runs of slow movement snap to their mean (no crawling jitter)
    sp = np.r_[0, np.hypot(*np.diff(out, axis=0).T)]
    i = 0
    while i < n:
        if sp[i] < 0.9:
            j = i
            while j < n and sp[j] < 1.4:
                j += 1
            if j - i >= 6:
                out[i:j] = out[i:j].mean(0)
            i = max(j, i + 1)
        else:
            i += 1
    return out, vis


def erase(frames, pos, T, i):
    """the frame with the pointer painted out"""
    f = frames[i].copy(); p = pos[i]
    if not p:
        return f
    name, x, y, _ = p; th, tw = T[name]['g'].shape
    m = 4; x0, y0, x1, y1 = max(0, x - m), max(0, y - m), min(f.shape[1], x + tw + m), min(f.shape[0], y + th + m)
    ring = (max(0, x0 - 6), max(0, y0 - 6), min(f.shape[1], x1 + 6), min(f.shape[0], y1 + 6))
    best = None
    for d in range(1, 151):
        for j in (i - d, i + d):
            if j < 0 or j >= len(frames):
                continue
            q = pos[j]
            if q:
                qn, qx, qy, _ = q; qh, qw = T[qn]['g'].shape
                if not (qx + qw + m < x0 - 1 or qx - m > x1 + 1 or qy + qh + m < y0 - 1 or qy - m > y1 + 1):
                    continue                   # the pointer is still (partly) there
            a = frames[i][ring[1]:ring[3], ring[0]:ring[2]].astype(np.int16); b = frames[j][ring[1]:ring[3], ring[0]:ring[2]].astype(np.int16)
            msk = np.ones(a.shape[:2], bool); msk[y0 - ring[1]:y1 - ring[1], x0 - ring[0]:x1 - ring[0]] = False   # only the ring around the patch
            cost = float(np.abs(a - b).mean(2)[msk].mean())
            if best is None or cost < best[0]:
                best = (cost, j)
        if best and best[0] < 2.5:
            break
    if best and best[0] < 22:
        j = best[1]; patch = frames[j][y0:y1, x0:x1].astype(np.float32); cur = f[y0:y1, x0:x1].astype(np.float32)
        a = np.ones((y1 - y0, x1 - x0), np.float32); k = 3
        a[:k] *= np.linspace(0.2, 1, k)[:, None]; a[-k:] *= np.linspace(1, 0.2, k)[:, None]; a[:, :k] *= np.linspace(0.2, 1, k)[None]; a[:, -k:] *= np.linspace(1, 0.2, k)[None]
        f[y0:y1, x0:x1] = (patch * a[..., None] + cur * (1 - a[..., None])).astype(np.uint8)
    else:
        mk = np.zeros(f.shape[:2], np.uint8); core = cv2.dilate(T[name]['core'], np.ones((3, 3), np.uint8), iterations=2); ch, cw = core.shape
        yy1, xx1 = min(f.shape[0], y + ch), min(f.shape[1], x + cw)
        if yy1 > max(0, y) and xx1 > max(0, x):
            mk[max(0, y):yy1, max(0, x):xx1] = core[max(0, y) - y:yy1 - y, max(0, x) - x:xx1 - x] * 255   # only the pointer's own pixels, not a block of the page
        f = cv2.inpaint(f, mk, 3, cv2.INPAINT_TELEA)
    return f


def sprite(scale=4):
    """a clean purple arrow pointer with a white outline and a soft violet halo, drawn big and scaled down: returns (bgr, alpha, hotspot)"""
    S = scale; W, H = 44 * S, 56 * S; hx, hy = 10 * S, 8 * S
    pts = np.array([[0, 0], [0, 19], [4.6, 15], [8, 22.5], [11, 21.2], [7.6, 14], [13.5, 14]], np.float32) * S + np.array([hx, hy], np.float32)
    halo = np.zeros((H, W), np.float32); cv2.circle(halo, (hx + 2 * S, hy + 3 * S), int(15 * S), 1.0, -1, cv2.LINE_AA); halo = cv2.GaussianBlur(halo, (0, 0), 5 * S)
    outline = np.zeros((H, W), np.uint8); cv2.fillPoly(outline, [pts.astype(np.int32)], 255, cv2.LINE_AA); outline = cv2.dilate(outline, np.ones((int(1.8 * S), int(1.8 * S)), np.uint8))
    fill = np.zeros((H, W), np.uint8); cv2.fillPoly(fill, [pts.astype(np.int32)], 255, cv2.LINE_AA)
    shadow = cv2.GaussianBlur(outline.astype(np.float32) / 255, (0, 0), 1.6 * S)
    bgr = np.zeros((H, W, 3), np.float32); al = np.zeros((H, W), np.float32)
    def over(col, a):
        nonlocal bgr, al
        a = a[..., None]; bgr = bgr * (1 - a) + np.array(col, np.float32) * a; al = al + (1 - al) * a[..., 0]
    over((237, 58, 124), halo * 0.28)                     # violet halo (BGR of #7C3AED)
    over((0, 0, 0), np.roll(np.roll(shadow, int(1.2 * S), 0), int(1.0 * S), 1) * 0.35)
    over((255, 255, 255), outline.astype(np.float32) / 255)
    over((237, 58, 124), fill.astype(np.float32) / 255)       # brand purple #7C3AED (BGR), white edge around it
    sm = lambda a: cv2.resize(a, (W // S, H // S), interpolation=cv2.INTER_AREA)
    return sm(bgr), sm(al), (hx // S, hy // S)


def draw(f, spr, x, y, a=1.0):
    bgr, al, (hx, hy) = spr; h, w = al.shape
    X, Y = int(round(x - hx)), int(round(y - hy))
    x0, y0, x1, y1 = max(0, X), max(0, Y), min(f.shape[1], X + w), min(f.shape[0], Y + h)
    if x1 <= x0 or y1 <= y0:
        return
    s = al[y0 - Y:y1 - Y, x0 - X:x1 - X, None] * a
    f[y0:y1, x0:x1] = (bgr[y0 - Y:y1 - Y, x0 - X:x1 - X] * s + f[y0:y1, x0:x1].astype(np.float32) * (1 - s)).astype(np.uint8)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('src'); ap.add_argument('tpl'); ap.add_argument('out')
    ap.add_argument('--start', type=float, default=0); ap.add_argument('--dur', type=float, default=0); ap.add_argument('--debug', default='')
    a = ap.parse_args()
    cap = cv2.VideoCapture(a.src); fps = cap.get(cv2.CAP_PROP_FPS) or 30; W, H = int(cap.get(3)), int(cap.get(4))
    frames = []; skip = int(a.start * fps)
    while True:
        ok, f = cap.read()
        if not ok or (a.dur and len(frames) >= int(a.dur * fps)):
            break
        if skip > 0:
            skip -= 1; continue
        frames.append(f)
    T = load_templates(a.tpl); print('frames', len(frames), 'templates', list(T))
    gray = [cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) for f in frames]
    pos = track(gray, T); found = sum(1 for p in pos if p); print('found in', found, 'of', len(pos), 'frames', {k: sum(1 for p in pos if p and p[0] == k) for k in T})
    hs = hotspots(pos, T); path, vis = smooth_path(hs, fps)
    spr = sprite()
    enc = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{W}x{H}', '-r', str(fps), '-i', '-', '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '12', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', a.out], stdin=subprocess.PIPE)
    for i in range(len(frames)):
        f = erase(frames, pos, T, i)
        # fade in/out at the edges of a tracked stretch
        al = 1.0
        if vis[i]:
            j = i
            while j > 0 and vis[j - 1] and i - j < 8: j -= 1
            k = i
            while k < len(vis) - 1 and vis[k + 1] and k - i < 8: k += 1
            al = min(1.0, (i - j + 1) / 8, (k - i + 1) / 8)
            draw(f, spr, path[i, 0], path[i, 1], al)
        enc.stdin.write(f.tobytes())
    enc.stdin.close(); enc.wait()
    if a.debug:
        os.makedirs(a.debug, exist_ok=True)
        json.dump({'pos': [None if p is None else [p[0], int(p[1]), int(p[2]), round(p[3], 1)] for p in pos], 'raw': hs.tolist(), 'smooth': path.tolist()}, open(os.path.join(a.debug, 'track.json'), 'w'))
    print('wrote', a.out)


if __name__ == '__main__':
    main()
