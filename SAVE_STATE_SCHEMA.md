# WebDAW — IndexedDB Autosave Schema

Full audit of all serializable state in the project and how a save file should be constructed.

---

## Architecture Overview

State in this app is spread across **Vue reactive singletons** (not a Vuex/Pinia store). There is no central store — each subsystem owns its own reactive data:

```
audioEngineManager.ts       ← lazy-init AudioEngine singleton
├── AudioEngine             ← owns AudioContext + AudioGraph + Scheduler
│   ├── Scheduler           ← bpm, loop, pauseTime (playhead position)
│   └── AudioGraph          ← Web Audio nodes (RUNTIME ONLY — not saved)
├── channelManager          ← reactive Channel[] singleton
├── mixerManager            ← reactive MixerTrack[] singleton
└── arrangement             ← reactive ArrangementClip[] + ArrangementTrack[] singleton

patternsListManager.ts      ← patterns: ref<Pattern[]>
│   └── Pattern[]
│       └── PianoRoll       ← NoteBlock[] with automation Map per note

windowManager.ts            ← windows: reactive Window[]
│                           ← arrangementVisible, channelRackVisible, mixerVisible

layoutManager.ts            ← patternsListWidth, headerHeight

snap.ts                     ← snapDivision: ref<number>

HeaderBar.vue               ← globalVolume: local ref (NOT globally exported — see note)
```

---

## What Must Be Saved vs What Is Runtime

### SAVE (persistent user data)
| State | Location | Type |
|-------|----------|------|
| All patterns (name, num, visible) | `patternsListManager.ts` | `Pattern[]` |
| Note data per pattern | `PianoRoll._noteData` | `NoteBlock[]` |
| Automation curves per note | `NoteBlock.automation` | `Map<string, AutomationCurve>` |
| All channels (name, vol, pan, mute, solo, route, synthType) | `ChannelManager` | `Channel[]` |
| All mixer tracks (name, vol, pan, mute, solo, route) | `MixerManager` | `MixerTrack[]` |
| Arrangement clips | `Arrangement._clips` | `ArrangementClip[]` |
| Arrangement tracks | `Arrangement._tracks` | `ArrangementTrack[]` |
| BPM | `Scheduler._bpm` | `number` |
| Loop enabled/start/end | `Scheduler` | `boolean, number, number` |
| Playhead position (pauseTime) | `Scheduler.pauseTime` | `number` |
| Playback mode | `playbackModeManager.ts` | `'pattern' \| 'arrangement'` |
| Snap division | `snap.ts: snapDivision` | `number` (1/2/3/4/6/8/16) |
| Global volume | `HeaderBar.vue: globalVolume` | `number` (0–1) |
| Patterns list panel width | `layoutManager.ts: patternsListWidth` | `number` (px) |
| Header bar height | `layoutManager.ts: headerHeight` | `number` (px) |
| Window positions/sizes/z-order | `windowManager.ts: windows` | `Window[]` |
| Window visibility flags | `windowManager.ts` | `boolean x3` |
| ID counters (for continuity) | Various managers | `number x4` |

### DO NOT SAVE (runtime / derived / non-serializable)
| State | Reason |
|-------|--------|
| `MiniSynth` instrument instances | Web Audio API objects, recreated on load |
| `AudioGraph` nodes | Web Audio API objects, rebuilt from logical state |
| `Scheduler.isPlaying` | Session state — never auto-resume playback |
| `Scheduler.scheduledNoteOns/Offs` | Ephemeral scheduler bookkeeping |
| `MixerTrack.peakDbL/peakDbR` | Real-time metering, computed from audio |
| `CompiledNoteAutomation` / `CompiledParamEvent` | Computed from saved automation data |
| `PianoRoll._keyboardNotes` | Static lookup table, generated from `Keyboard` class |
| `PianoRoll._state.version` | Internal reactivity counter |
| `dragState` in windowManager | Ephemeral pointer interaction state |
| `activeWindowId` | Derived from window z-order on restore |
| Piano roll `colWidth`, `scrollX`, `rowHeight` | Per-component local refs (optional to save) |
| Arrangement `colWidth`, `scrollX` | Per-component local refs (optional to save) |

---

## ID Counter State — Critical for Load Integrity

These internal counters must be saved so that newly created objects after loading don't collide with saved IDs:

| Counter | Location | Controls |
|---------|----------|----------|
| `ChannelManager.nextId` | `ChannelManager` private field | next `channel-N` id |
| Pattern next num | Derived via `getNextPatternNum()` in `patternsListManager` | next `pattern-N` id |
| `Arrangement.nextClipId` | `Arrangement` private field | next `clip-N` id |
| Mixer num | Derived via `getNextMixerNum()` | next `mixer-N` id |

> On load, restore these counters first before restoring any objects.

---

## Important Implementation Notes

### 1. `globalVolume` is not globally exported

`globalVolume` is a local `ref` inside `HeaderBar.vue`. It is not exported from any service. To save/restore it, you need to either:
- **Option A:** Lift it to a new global service (e.g., `src/services/globalSettingsManager.ts`)
- **Option B:** Read it directly from the AudioGraph at save time (the `global` gain node reflects it)

### 2. `automation` Map is not JSON-serializable

`NoteBlock.automation` is a `Map<string, AutomationCurve>`. `JSON.stringify` silently drops Maps. Serialize as an array of entries:

```ts
// Serialize
const automationArray = [...note.automation.entries()].map(([k, v]) => ({ parameterId: k, curve: v }));

// Deserialize
const automationMap = new Map(saved.automation.map(e => [e.parameterId, e.curve]));
```

### 3. `visible` on Pattern means "window is open"

`Pattern.visible` determines whether the piano roll window is open (only one can be visible at a time). Save and restore it — the window system will open the right one.

### 4. Synth type needs to be tracked per channel

`AudioEngine._channelSynths` maps `channelId → { synthId: 'minisynth', num: N }`. This is needed at load time to recreate the correct instrument. Save `synthId` alongside each channel.

### 5. Solo state is derived — save muted, not solo

The `solo` flag is internally managed via `soloChannelId`/`soloMixerId` private fields. Saving `muted` + `solo` per track is sufficient. On load, if any track has `solo: true`, set the internal solo ID accordingly, then sync all mute states via `_syncChannelGains()` / `_syncMixerGains()`.

---

## Complete JSON Save File Schema

```json
{
  "version": "1.0.0",

  "metadata": {
    "projectName": "Untitled Project",
    "created": 1708000000000,
    "lastModified": 1708000000000
  },

  "global": {
    "bpm": 120,
    "globalVolume": 0.75,
    "snapDivision": 4,
    "playbackMode": "pattern"
  },

  "playback": {
    "pauseTime": 0,
    "loopEnabled": false,
    "loopStart": 0,
    "loopEnd": 4
  },

  "patterns": [
    {
      "id": "pattern-1",
      "num": 1,
      "name": "Pattern 1",
      "visible": true,
      "notes": [
        {
          "id": "note-0-1708000000000",
          "row": 48,
          "col": 0,
          "length": 1,
          "velocity": 0.8,
          "channelId": "channel-1",
          "midi": 60,
          "automation": [
            {
              "parameterId": "pitchBend",
              "nodes": [
                { "id": "abc123", "beat": 0, "value": 0.4, "curveTension": 0 },
                { "id": "def456", "beat": 1, "value": 0.6, "curveTension": -0.5 }
              ]
            },
            {
              "parameterId": "volume",
              "nodes": [
                { "id": "ghi789", "beat": 0, "value": 0.5, "curveTension": 0 },
                { "id": "jkl012", "beat": 1, "value": 1.0, "curveTension": 0 }
              ]
            }
          ]
        }
      ]
    }
  ],

  "channels": [
    {
      "id": "channel-1",
      "name": "MiniSynth 1",
      "synthId": "minisynth",
      "synthNum": 1,
      "mixerTrack": 0,
      "volume": 1.0,
      "pan": 0.0,
      "muted": false,
      "solo": false
    }
  ],

  "mixers": [
    {
      "id": "master",
      "name": "Master",
      "route": -1,
      "volume": 1.0,
      "pan": 0.0,
      "muted": false,
      "solo": false
    },
    {
      "id": "mixer-1",
      "name": "Insert 1",
      "route": 0,
      "volume": 1.0,
      "pan": 0.0,
      "muted": false,
      "solo": false
    }
  ],

  "arrangement": {
    "clips": [
      {
        "id": "clip-1",
        "patternId": "pattern-1",
        "track": 1,
        "startBeat": 0,
        "duration": 4,
        "offset": 0,
        "muted": false
      }
    ],
    "tracks": [
      {
        "id": "track-1",
        "name": "Track 1",
        "height": 100,
        "muted": false,
        "solo": false
      },
      {
        "id": "track-2",
        "name": "Track 2",
        "height": 100,
        "muted": false,
        "solo": false
      }
    ]
  },

  "ui": {
    "patternsListWidth": 130,
    "headerHeight": 48,
    "windowVisibility": {
      "arrangementVisible": true,
      "channelRackVisible": true,
      "mixerVisible": true
    },
    "windows": [
      {
        "id": "arrangement-window",
        "x": 130,
        "y": 48,
        "width": 800,
        "height": 300,
        "z": 1,
        "userModified": false
      },
      {
        "id": "channel-rack-window",
        "x": 900,
        "y": 100,
        "width": 400,
        "height": 500,
        "z": 2,
        "userModified": true
      },
      {
        "id": "mixer-window",
        "x": 130,
        "y": 500,
        "width": 600,
        "height": 300,
        "z": 3,
        "userModified": false
      },
      {
        "id": "pattern-1",
        "x": 130,
        "y": 48,
        "width": 1200,
        "height": 500,
        "z": 4,
        "userModified": true
      }
    ]
  },

  "idCounters": {
    "nextChannelId": 2,
    "nextClipId": 2,
    "nextPatternNum": 2,
    "nextMixerNum": 4
  }
}
```

---

## Data Dependency Chain

The correct order to reconstruct state on load (later steps depend on earlier ones):

```
1. idCounters
   └── Set ChannelManager.nextId, Arrangement.nextClipId, MixerManager num counter

2. global settings
   └── bpm → Scheduler.setBpm()
   └── globalVolume → AudioGraph.setGain('global', ...)
   └── snapDivision → snapDivision.value = ...
   └── playbackMode → playbackMode.value = ...

3. channels
   └── For each channel:
       a. Create MiniSynth instrument via AudioEngine.addChannel('minisynth')
       b. Override the auto-generated channel with saved id/name/volume/pan/muted/solo
       c. Wire panner node into audio graph at correct mixerTrack
   └── Restore soloChannelId if any channel.solo === true

4. mixers
   └── For each non-master mixer: AudioEngine.addMixer(name)
   └── Restore volume, pan, muted, solo, route per mixer
   └── Restore soloMixerId if any mixer.solo === true
   └── Call AudioEngine._syncMixerGains() to apply mute/volume state

5. patterns
   └── For each pattern:
       a. Create Pattern with new PianoRoll (Keyboard C0–C10 range)
       b. Set pattern.id, pattern.num, pattern.name, pattern.visible
       c. For each note: push NoteBlock into PianoRoll._noteData
          - Reconstruct automation: new Map(saved.automation.map(e => [e.parameterId, e.curve]))

6. arrangement
   └── Restore tracks (clear 4 default tracks first, then push saved ones)
   └── Restore clips (push each clip into Arrangement._clips)
   └── Restore Arrangement.nextClipId from idCounters

7. playback state
   └── Scheduler.pauseTime = playback.pauseTime
   └── Scheduler.setLoop(loopEnabled, loopStart, loopEnd)

8. UI state
   └── patternsListWidth.value = ui.patternsListWidth
   └── headerHeight.value = ui.headerHeight
   └── arrangementVisible.value, channelRackVisible.value, mixerVisible.value
   └── After windows mount: call positionWindow() for each saved window that has userModified: true
       (windows with userModified: false get default layout positions from layoutManager computed values)
```

---

## TypeScript Interface for the Save File

```typescript
export interface SaveFile {
  version: string;

  metadata: {
    projectName: string;
    created: number;        // Date.now()
    lastModified: number;
  };

  global: {
    bpm: number;
    globalVolume: number;   // 0–1
    snapDivision: number;   // 1 | 2 | 3 | 4 | 6 | 8 | 16
    playbackMode: 'pattern' | 'arrangement';
  };

  playback: {
    pauseTime: number;       // beat position of stopped playhead
    loopEnabled: boolean;
    loopStart: number;
    loopEnd: number;
  };

  patterns: SavedPattern[];
  channels: SavedChannel[];
  mixers: SavedMixer[];
  arrangement: SavedArrangement;
  ui: SavedUI;
  idCounters: SavedIdCounters;
}

export interface SavedPattern {
  id: string;               // "pattern-1"
  num: number;              // 1, 2, 3...
  name: string;
  visible: boolean;         // is the piano roll window open
  notes: SavedNote[];
}

export interface SavedNote {
  id: string;
  row: number;              // 0 = top of keyboard (C10), increases downward
  col: number;              // beat position (can be fractional)
  length: number;           // duration in beats
  velocity: number;         // 0–1
  channelId: string;        // "channel-1"
  midi: number;             // 12 (C0) to 132 (C10)
  automation: SavedAutomationEntry[];   // serialized from Map
}

export interface SavedAutomationEntry {
  parameterId: string;      // 'pitchBend' | 'volume' | 'pan'
  nodes: SavedAutomationNode[];
}

export interface SavedAutomationNode {
  id: string;               // nanoid
  beat: number;             // 0 to note.length
  value: number;            // 0–1 normalized
  curveTension: number;     // -1 to 1
}

export interface SavedChannel {
  id: string;               // "channel-1"
  name: string;
  synthId: string;          // "minisynth" (instrument type for reconstruction)
  synthNum: number;         // used for "MiniSynth 1", "MiniSynth 2" naming
  mixerTrack: number;       // 0 = master, N = mixer-N
  volume: number;           // 0–1
  pan: number;              // -1 to 1
  muted: boolean;
  solo: boolean;
}

export interface SavedMixer {
  id: string;               // "master" | "mixer-1" | "mixer-2" ...
  name: string;
  route: number;            // -1 = no route (master only), 0 = master, N = mixer-N
  volume: number;           // 0–1
  pan: number;              // -1 to 1
  muted: boolean;
  solo: boolean;
  // peakDbL and peakDbR are NOT saved (runtime metering)
}

export interface SavedArrangement {
  clips: SavedClip[];
  tracks: SavedTrack[];
}

export interface SavedClip {
  id: string;               // "clip-1"
  patternId: string;        // "pattern-1"
  track: number;            // arrangement track number (matches track-N)
  startBeat: number;
  duration: number;
  offset: number;           // trim from start of pattern
  muted: boolean;
}

export interface SavedTrack {
  id: string;               // "track-1"
  name: string;
  height: number;           // px (default 100)
  muted: boolean;
  solo: boolean;
}

export interface SavedUI {
  patternsListWidth: number;
  headerHeight: number;
  windowVisibility: {
    arrangementVisible: boolean;
    channelRackVisible: boolean;
    mixerVisible: boolean;
  };
  windows: SavedWindow[];
}

export interface SavedWindow {
  id: string;               // "arrangement-window" | "channel-rack-window" | "mixer-window" | "pattern-1" ...
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  userModified: boolean;    // if false, use default layout positions on load
}

export interface SavedIdCounters {
  nextChannelId: number;    // ChannelManager.nextId
  nextClipId: number;       // Arrangement.nextClipId
  nextPatternNum: number;   // next value from getNextPatternNum()
  nextMixerNum: number;     // next value from MixerManager.getNextMixerNum()
}
```

---

## IndexedDB Strategy

Suggested IndexedDB structure:

```
Database: "webdaw"
├── Object Store: "projects"
│   ├── keyPath: "id" (auto-increment or uuid)
│   ├── index: "lastModified"
│   └── value: SaveFile (the full JSON above)
│
└── Object Store: "autosave"
    ├── keyPath: "id" (single record, always id = 1)
    └── value: SaveFile (the current working state)
```

**Autosave trigger:** Watch the reactive singletons with Vue `watch`/`watchEffect` and debounce writes to IndexedDB by ~2 seconds to avoid excessive writes on rapid edits (e.g. dragging notes).

**Items to watch for triggering autosave:**
- `patterns` ref (note edits trigger `PianoRoll._state.version` increment)
- `channelManager` (exposed via computed/reactive access)
- `mixerManager` (same)
- `arrangement.clips` / `arrangement.tracks`
- `scheduler.bpm`, `scheduler.loopEnabled`, etc.
- `snapDivision`, `patternsListWidth`, `headerHeight`
- `windows` reactive array

---

## Pitfalls & Edge Cases

| Issue | Solution |
|-------|----------|
| `Map` not JSON-serializable | Serialize automation as `SavedAutomationEntry[]` array |
| `Infinity` / `-Infinity` not JSON-serializable | `peakDbL/R` — just don't save them |
| `Float32Array` in `CompiledParamEvent` | These are computed at playback, never save them |
| Pattern window positions use pattern ID as window ID | Save window by `id: "pattern-1"` etc. |
| Default layout vs user-modified windows | Check `userModified` flag — only restore position if `true` |
| Solo state is transient | Save `muted` + `solo` booleans, reconstruct `soloChannelId` on load by finding `solo: true` |
| `Arrangement` initializes with 4 default tracks | On load: clear `_tracks` before pushing saved tracks |
| `AudioEngine` constructor creates default channel + 3 mixers | On load: dispose default state before restoring saved state, or build a "load mode" that skips defaults |
| Note `row` is from top (row 0 = C10 visually) | `midi` is saved directly — can re-derive row from `keyboard.getKeyboardInfo()` if needed |
