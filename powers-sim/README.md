# Gesture Power Simulator

Webcam superhero VFX driven by your hands, face and body. Real-time tracking
feeds a gesture state machine that fires repulsors, assembles an Iron Man
suit over your actual body, opens Domain Expansions, snaps half of you into
dust, and turns you green.

Everything runs locally in your browser. No video frame ever leaves your
machine — the only network traffic is downloading the three model files once,
after which the browser caches them.

---

## Run it

The camera is only exposed on a *secure origin*, so opening `index.html`
straight from disk will not work — it has to be served over `localhost`.

**Windows, one click:** double-click `start.bat`.

**Or by hand,** from this folder:

```bash
python serve.py 8777
```

Then open <http://localhost:8777/index.html>, press **START**, and allow the
camera.

`serve.py` is a plain static server that also sends `Cache-Control: no-store`.
That matters: with ordinary caching, editing a file and reloading can silently
keep running the old one, which makes tuning maddening. `python -m http.server`
works too if you do not mind that.

First run downloads ~16 MB of models and takes a few seconds; after that it
starts immediately.

**Browser:** Chrome or Edge. Firefox and Safari work, but their GPU delegate
is less reliable, so expect a lower frame rate.

---

## Two apps in this folder

| | |
|---|---|
| **`index.html`** | The powers sim — everything below |
| **`arlab.html`** | **AR LAB**, standalone |

They are separate **on purpose**. The powers sim runs three tracking models at
once (hands, face, body). That is what it needs, but it costs frame time and
makes the hand gestures less certain. The AR lab loads **only the hand
tracker**, so grabs are faster and steadier — which is the whole point when
your hands are the only input.

### AR LAB

Open <http://localhost:8777/arlab.html>.

A **setup screen** comes first, all mouse-driven. You pick what gets loaded
*before* anything starts: 1 or 2 players, mesh quality, camera resolution,
which model each player begins with, and whether to draw solid faces or
wireframe only. It shows you the cost of your choices — how many shaded faces
per frame — so you can see the trade before you commit.

Eight models, each built from real geometry with named components:
arc reactor (9 parts), MK helmet, repulsor gauntlet, turbine, nano core,
satellite, web-shooter, exo-spine.

| Gesture | |
|---|---|
| **Pinch** | Grab it. Drag to move; the drag also turns it |
| **Both hands pinched** | Spread to scale, twist to roll |
| **Pull your pinched hands apart** | **Opens the model up** — every part flies out along its own axis and labels itself |
| **Open palm** | Closes it back up |
| **Horns** | Next model |
| **Fist, held** | Recentre |

Keys: `N` next model · `R` reset · `D` debug · `H` hide UI · `F` fullscreen ·
`Esc` back to setup.

**Two players:** split screen. Each half is clipped to its own side, gets its
own model, and is driven only by the hands on that half — so blowing your
model up to 3x and pulling it wide open cannot spill into the other person's
side.

---

## Modes (inside the powers sim)

Loadouts are gesture maps. **Modes** are bigger — they change what the whole
app is doing.

**Open the mode wheel** by holding **one open palm + one fist** together for
~0.8 s (or press `Q`). Then **point** at a wedge and **close your hand** to
pick it. Dwelling on a wedge for a second also commits. `Tab` cycles modes
directly; `4`–`7` jump straight to one.

| Mode | What it is |
|---|---|
| **POWERS** | Everything below — the three loadouts |
| **AR LAB** | A holographic model you grab, turn and pull apart |
| **NANO** | The nanotech suit crawling over your real body |
| **PING PONG** | Your hand is the paddle |
| **BADMINTON** | Your hand is the racket |

### AR LAB

Seven models: arc reactor, nano core, helmet, repulsor, web-shooter, genome,
tower. They are real geometry — projected, depth-sorted and shaded per face,
not sprites.

| Gesture | |
|---|---|
| **Pinch** | Grab it. Drag to move; the drag also spins it, so it feels like an object rather than a picture |
| **Both hands pinched** | Spread to scale, twist to roll |
| **Pull your pinched hands apart** | **Opens the model up** — every part flies out along its own axis and labels itself |
| **Open palm** | Closes it back up |
| **Horns** | Next model (or `N`) |

### NANO

| Gesture | |
|---|---|
| **Both palms open** | Deploy — a wavefront leaves the arc reactor and crawls outward |
| **Both fists** | Retract |

Plates ahead of the wavefront are hot and translucent; behind it they lock
down into red-and-gold armour. Coverage is driven by distance from the chest,
so it builds in the order it physically would, torso first and hands last.
Stand back far enough that your shoulders are in frame.

### PING PONG / BADMINTON

Move your hand — that is your paddle. Swing *fast* for a harder shot; the
sideways component of your swing puts spin on the ball. The opponent sharpens
as your rally grows, so it stays winnable but not trivial.

The two do not share physics. The ball bounces and arcs. The shuttlecock has
enormous drag: it leaves fast, stalls in the air, then drops nearly straight
down, and it always has to climb over the net first. That difference is the
whole reason badminton feels like badminton.

---

## Loadouts (inside POWERS mode)

There are more powers than there are hand shapes a camera can tell apart
reliably. Rather than make every gesture fragile, the powers are split into
three loadouts. Inside a loadout every gesture is unambiguous.

**Switch with keys `1` `2` `3`, or hold both hands in horns 🤘🤘.**

### 1 — STARK

| Gesture | Power |
|---|---|
| **Open palm** | Charges the repulsor in your palm |
| **…then close to a fist** | **FIRES**, aimed wrist→palm. Bigger charge, bigger blast |
| **Palm over your face → close it** | Suit up — helmet *and* body armour assemble. Repeat to stand down |
| **Fist raised above your head**, 0.7 s | Summons Mjolnir; lightning strikes into your hand |
| **…then open that hand** | Discharges the storm |
| **Thumb on middle finger** | The Infinity Gauntlet forms on that hand |
| **…then snap them apart** | **THE SNAP** — you disintegrate into drifting ash |
| **Both hands pinched**, 0.5 s | Opens the hologram. Pinch-drag to turn it, spread hands to scale |
| **Three fingers** | Captain America's shield on your forearm |
| **…swipe fast** | Throws it — it ricochets off the edges and comes back |

### 2 — MYSTIC

| Gesture | Power |
|---|---|
| **Two fingers** ✌ | Mandala shield, spinning in your palm |
| **Horns** 🤘 | Sling-ring portal |
| **Point** | Eye of Agamotto opens — **hold it and the room runs backwards** |
| **Pinch** | Chaos magic coils around your hand |
| **…close that hand** | Throws it |
| **Three fingers** | Mind stone on your forehead |
| **…close a hand** | Fires the beam |

### 3 — JUJUTSU

| Gesture | Power |
|---|---|
| **Point** | **Lapse: Blue** — a vacuum that drags the room inward |
| **…close that hand** | Implodes |
| **Pinch** | **Reversal: Red** — pressure building outward |
| **…close that hand** | Detonates |
| **Blue in one hand, Red in the other, brought together** | **HOLLOW PURPLE** charges |
| **…close either hand** | Fires it across the whole screen |
| **Three fingers + fast sweep** | **Dismantle** — cuts land across the sweep |
| **Both hands, two fingers, held together** 1.3 s | **DOMAIN EXPANSION: Unlimited Void** |
| **Both hands, three fingers, held together** 1.3 s | **DOMAIN EXPANSION: Malevolent Shrine** |

### Always available

| Gesture | Power |
|---|---|
| **Both fists**, held 1.2 s | HULK — head swells, skin goes green, the screen shakes |
| **Both palms open**, held 1 s | Reverts |
| **Both horns** | Next loadout |

### Keys

| | |
|---|---|
| `Tab` | Next mode |
| `Q` | Mode wheel |
| `1` `2` `3` | Loadout (inside POWERS) |
| `4` `5` `6` `7` | AR / nano / pong / badminton |
| `N` | Next AR model |
| `F` | Fill the screen (cropped) or fit it (letterboxed) |
| `B` | Fullscreen |
| `S` | Save a PNG |
| `V` | Start/stop recording a `.webm` |
| `G` | Hologram on/off |
| `D` | Debug overlay — hand skeleton, face mesh, body sticks |
| `H` | Hide the whole UI (for clean recordings) |
| `M` | Mute |
| `Esc` | Drop every power |

---

## Tuning

Every feel-related number lives in one block at the top of `app.js`
(`const CONFIG = {...}`), plus `TUNING` in `hands.js` for the finger
thresholds. Edit and reload.

You can also change values **live** from the browser console (F12), no reload:

```js
POWER_CONFIG.repulsor.chargeSeconds = 0.5   // much faster charge
POWER_CONFIG.domain.holdSeconds = 0.4       // near-instant domain
POWER_CONFIG.gesture.extendRatio = 1.20     // stricter about open fingers
POWER_CONFIG.bloom.strength = 1.6           // more glow bleed

__sim.power.helmetOn = true                 // force a power on
__sim.power.domainOn = 'VOID'               // or 'SHRINE'
__sim.setLoadout(2)
__sim.step()                                // render exactly one frame
```

### If it feels wrong, change this

| Symptom | Knob | Try |
|---|---|---|
| Repulsor takes too long to charge | `repulsor.chargeSeconds` | `0.6` |
| It fires when you didn't mean to | `repulsor.minFire` | `0.45` |
| Half-curled fingers read as "open" | `gesture.extendRatio` | `1.20` |
| A deliberately open hand is missed | `gesture.extendRatio` | `1.05` |
| Pinch or snap won't register | `gesture.gripReach` | `0.80` |
| A fist is misread as a pinch | `gesture.gripReach` | `1.00` |
| Gestures flicker between two readings | `gesture.voteFrames` / `voteMajority` | `7` / `4` |
| Tracking feels laggy | `gesture.smoothing` | `34` (higher = snappier) |
| Tracking feels jittery | `gesture.smoothing` | `14` (lower = smoother) |
| Hulk triggers by accident | `gamma.holdToTransform` | `2.0` |
| Domain triggers by accident | `domain.holdSeconds` | `2.2` |
| Hands won't merge into Purple | `purple.mergeDistance` | `4.5` |
| Dismantle fires on slow moves | `dismantle.minSpeed` | `1400` |
| Helmet toggles when reaching past your face | `helmet.faceRadius` | `0.55` |
| Suit assembles too fast to enjoy | `suit.riseRate` | `0.9` |
| Everything glows too much | `bloom.strength` | `0.5` |
| Too grainy | `bloom.grain` | `0.02` |
| Model too hard to pull apart | `ar.explodeGain` | `0.004` |
| Model spins too much when dragged | `ar.rotateGain` | `0.006` |
| Nano suit deploys too fast | `nano.riseRate` | `0.3` |
| Mode wheel opens by accident | `menu.holdToOpen` | `1.4` |
| Too loud | `audio.volume` | `0.15` |

### Getting better tracking

Lighting matters far more than any setting. A lamp *in front of you* beats a
bright window *behind you*, which turns you into a silhouette the model cannot
read. Keep your hand fully in frame — if the wrist leaves the picture the pose
flips around. A plain wall behind you helps. For the body armour, stand back
far enough that your shoulders are in frame.

---

## How it works

```
webcam ─→ HandLandmarker   (21 points × 2 hands, every frame)
       ├→ FaceLandmarker   (478 points)
       └→ PoseLandmarker   (33 points — only while the suit is up)
              │
              ▼
      gesture state machine   (hands.js)
              │
              ▼
      power state machine     (app.js)
              │
              ▼
      effect layer  →  bloom  →  camera frame     (render.js)
```

### Gesture detection

A finger counts as extended when its tip is further from the wrist than its
middle joint. Because it is a *ratio*, it holds whether your hand fills the
frame or is far away, anywhere in the picture, at any rotation.

The two thumb gestures were the hard part. A pinch is thumb-to-index; the
snap grip is thumb-to-**middle** — deliberately different fingers so Red and
the Gauntlet can never collide. But gap alone is not enough: **in a closed
fist the thumb also rests against the index**, and in horns it rests against
the folded middle finger. So a grip additionally requires that fingertip to
*reach past the knuckles* — gripped tips are out in front of the hand, tucked
ones are inside the palm. When both grips are plausible, the fingertip the
thumb is actually closer to wins.

A gesture must also win a majority of the last 5 frames before it counts, so
one bad frame can never fire a blast. The open→closed edge is consumed on
read, so a single hand-close fires exactly once even though the render loop
runs faster than the camera.

### Making it look composited rather than pasted on

Effects are never drawn straight onto the video. They go onto their own layer
which is downsampled, blurred twice and added back. That one change is most of
the difference between "a bright shape on top of video" and "a light source in
the room" — real glow bleeds past its edges and blows out its own core.

On top of that:

- **Light spill** — whatever is in your hand throws coloured light onto the
  scene, so your face actually picks up the blue of a charging repulsor.
- **Film grain** — real footage is never clean, so perfectly smooth CG on top
  of it is the biggest giveaway. Matching the sensor noise hides the seam.
- **The Hulk effect** does not paint a green mask. It redraws your real face
  larger from the camera frame so the skull broadens, then recolours it with
  the canvas `color` blend mode, which replaces hue while keeping the original
  luminance — your actual lighting, shadows and expression survive. It is
  composited through a feathered mask so the new head melts into your real one.
- **The Snap** does not spawn generic dust. Every flake carries a real patch of
  the camera frame and drifts off with it, so you come apart into pieces of
  yourself.
- **The time rewind** keeps a ring of the last ~80 frames and plays them back
  over the live picture, so the room genuinely runs backwards.
- **The helmet and armour** are built on face- and body-local coordinate
  frames, so they track head roll, distance and your arms for free. Plates
  fly in from outside on an ease-out-back curve to read as assembly.

**The AR bench** is a small 3D engine rather than a picture of one: vertices
are rotated and perspective-projected, faces are depth-sorted and painted back
to front, and edge brightness falls off with distance. Each part carries the
direction it travels when the model opens, so pulling your hands apart
disassembles it along sensible axes instead of just scaling it up.

**The games** run in a shared court space (x across, y up, z away from you)
and project into it, so the ball genuinely travels *away* from you and its
shadow on the table is what sells the height.

### Files

| | |
|---|---|
| `index.html` | Shell, HUD, styles |
| `app.js` | Camera, models, loadouts, power state machine, render loop, `CONFIG` |
| `hands.js` | Landmarks → gesture. No DOM, so it is directly testable |
| `render.js` | Compositor: bloom, light spill, grain, grading, disintegration |
| `fx.js` | Particles, beams, helmet, mandala, portal, gamma |
| `jjk.js` | Blue, Red, Hollow Purple, Dismantle, both Domain Expansions |
| `marvel.js` | Lightning, Mjolnir, Gauntlet, chaos magic, shield, Eye, mind stone |
| `stark.js` | Body armour from pose landmarks, and the hologram |
| `ar.js` | The 3D engine, the model library, and the grab/turn/pull-apart interaction |
| `nano.js` | The nanotech suit wavefront |
| `games.js` | Ping pong and badminton |
| `menu.js` | The radial mode wheel |
| `arlab.html` / `arlab.js` | The standalone AR lab and its setup screen |
| `models3d.js` | Solid-geometry primitives and the eight-model library |
| `selftest.html` | Test page — open it to verify everything |
| `serve.py` / `start.bat` | No-cache dev server and a one-click launcher |

---

## Verifying it

> The AR lab, nano suit, games and mode wheel were built without the browser
> verification pass — you asked me to build rather than test. They are
> syntax-checked and their imports resolve, but unlike the rest of the app
> they have not been exercised in a running browser. If something misbehaves,
> that is where to look first.


Open <http://localhost:8777/selftest.html>. It renders every effect against
synthetic landmarks and runs the gesture logic against synthetic hand poses,
then prints a pass/fail list. **All 66 checks pass** as shipped:

- every effect renders without throwing — helmet, body armour (assembling and
  complete), gamma, repulsor, mandala, portal, Blue, Red, Hollow Purple and
  its beam, Dismantle, both domains, the barrier burst, Mjolnir and lightning,
  the Gauntlet, the Snap, chaos magic, the shield held and thrown, the Eye,
  the mind stone, the hologram, bloom, light spill
- the face frame matches the head geometry; `drawArmor` bails out cleanly when
  a shoulder is not visible
- all seven poses classify correctly, at hand sizes from 40 px to 320 px and
  anywhere in the frame
- a pinch is thumb-to-index and a snap grip is thumb-to-middle, and neither is
  confused with the other
- one glitched frame does not fire; a real close fires exactly once; holding a
  fist does not repeat-fire; re-polling a stale frame does not re-fire
- the snap fires exactly once on release and not while gripped
- a fast sweep registers speed and a still hand does not
- particles, every actor type, ash flakes and screen shake all expire

It needs no camera, so it is also the fastest way to check a change you make.

---

## Troubleshooting

**"getUserMedia is unavailable"** — you opened the file directly. Serve it over
`http://localhost` (see *Run it*).

**Camera permission blocked** — click the camera icon in Chrome's address bar,
allow it, then press RETRY.

**Stuck on "Downloading models"** — the CDN is unreachable. The app already
falls back from jsDelivr to unpkg; if both are blocked, download the three
`.task` files and point `HAND_MODEL` / `FACE_MODEL` / `POSE_MODEL` in `app.js`
at local copies.

**Body armour never appears** — it needs the pose model *and* your shoulders in
frame. Stand further back. If the pose model failed to load, the app logs a
warning and everything else still works.

**Nothing happens when you gesture** — press `D`. If no skeleton is drawn on
your hand, it is a tracking problem (lighting, or the hand is cropped), not a
gesture problem. If the skeleton is there but the HUD shows the wrong pose,
adjust `gesture.extendRatio`.

**Low frame rate** — the HUD shows fps. The app already sheds bloom below
26 fps and halves face tracking below 24. Below that, drop the camera
resolution in `startCamera()` from 1280×720 to 640×480.

**I edited a file and nothing changed** — you are not using `serve.py`. Use it,
or hard-reload with Ctrl+Shift+R.

---

## What this is, and what it isn't

These are canvas-drawn effects composited over your camera feed in real time —
the comic-book kind, not a physical simulation. The helmet and armour are
vector art tracking your landmarks; the Hulk and Snap effects are a recolour,
a warp and a dissolve of your own real image. Nothing here is a deepfake or a
face swap: it never replaces your face with anyone else's.

The characters and powers referenced are other people's intellectual property.
This is a personal toy for pointing a webcam at yourself — it is not something
to publish or sell.
