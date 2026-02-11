# Arrangement View Architecture Plan

## Table of Contents
1. [Overview](#overview)
2. [Current Architecture](#current-architecture)
3. [Proposed Architecture](#proposed-architecture)
4. [Signal Flow & Routing](#signal-flow--routing)
5. [Data Structures](#data-structures)
6. [Core Components](#core-components)
7. [Compilation Process](#compilation-process)
8. [UI Components](#ui-components)
9. [Implementation Phases](#implementation-phases)
10. [File Structure](#file-structure)
11. [Examples & Use Cases](#examples--use-cases)

---

## Overview

This document outlines the architecture for adding an **Arrangement View** (playlist/timeline) to the WebDAW, inspired by FL Studio's workflow. The arrangement view will allow users to:

- Place pattern instances (clips) on a timeline
- Organize clips across multiple tracks
- Drag and resize clips with full reactivity
- Compile all clips into a single playback sequence
- Route notes through channels to mixer tracks

### Key Goals

1. **FL Studio-style workflow**: Patterns → Playlist → Playback
2. **Flexible routing**: Note → Channel (instrument) → Mixer Track → Master
3. **Full reactivity**: Changes to patterns instantly update arrangement playback
4. **Professional UX**: Drag, drop, resize, snap-to-grid, zoom
5. **Performance**: Efficient compilation and incremental updates

---

## Current Architecture

### Existing System

```
┌─────────────┐
│  Pattern    │  Contains PianoRoll with notes
│  Manager    │  Manages list of patterns
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ PianoRoll   │  Stores note data (NoteBlock[])
│   (.ts)     │  Handles note manipulation
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ PianoRoll   │  Visual editor component
│   (.vue)    │  Drag, resize, place notes
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Scheduler  │  Plays notes with precise timing
│             │  Handles looping, BPM, playhead
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  MiniSynth  │  Audio synthesis
│             │  Note on/off, envelope
└─────────────┘
```

### Current Limitations

- ✗ Only one pattern can play at a time
- ✗ No timeline/arrangement view
- ✗ No multi-track composition
- ✗ Notes don't have instrument assignment
- ✗ No mixer routing

---

## Proposed Architecture

### New System Flow

```
┌──────────────────────────────────────────────────────────────┐
│                     ARRANGEMENT VIEW                          │
│  ┌────────────────────────────────────────────────────┐      │
│  │ Track 1: │ [Pattern 1]     [Pattern 2]             │      │
│  │ Track 2: │         [Pattern 3]      [Pattern 1]    │      │
│  │ Track 3: │                                          │      │
│  └────────────────────────────────────────────────────┘      │
└────────────┬─────────────────────────────────────────────────┘
             │
             ▼
┌────────────────────────┐
│  ArrangementCompiler   │  Unpacks all clips into flat note list
│                        │  Handles offset, trimming, merging
└────────┬───────────────┘
         │
         ▼
┌────────────────────────┐
│      Scheduler         │  Plays compiled notes
│                        │  Routes to correct channels
└────────┬───────────────┘
         │
         ▼
┌────────────────────────────────────────────────────────┐
│                   CHANNEL RACK                          │
│  Channel 1: Kick    → Mixer Track 1 (Drums)            │
│  Channel 2: Snare   → Mixer Track 1 (Drums)            │
│  Channel 3: Bass    → Mixer Track 2                    │
│  Channel 4: Lead    → Mixer Track 3 (Synths)           │
└────────┬───────────────────────────────────────────────┘
         │
         ▼
┌────────────────────────┐
│    MIXER TRACKS        │  Volume, Pan, Effects, Routing
│  Track 1: Drums Bus    │  Can have multiple channels
│  Track 2: Bass         │  Can route to other tracks
│  Track 3: Synths Bus   │  Final output to Master
│  Track 0: Master       │
└────────┬───────────────┘
         │
         ▼
    Audio Output
```

---

## Signal Flow & Routing

### Three-Tier Routing System

```
Note → Channel (Instrument) → Mixer Track → Master
```

### 1. Note Level
Each note specifies **which channel** (instrument) to trigger:

```typescript
{
  midi: 60,           // C4
  channelId: 'ch-3',  // Bass synth
  velocity: 0.8,
  // ...
}
```

### 2. Channel Level
Each channel is a unique instrument that routes to a mixer track:

```typescript
{
  id: 'ch-3',
  name: 'Bass',
  synth: bassSynthInstance,
  mixerTrack: 2,      // Routes to mixer track 2
  volume: 0.8,
  muted: false
}
```

### 3. Mixer Level
Mixer tracks receive audio from multiple channels:

```typescript
{
  id: 1,
  name: 'Drums Bus',
  volume: 0.9,
  pan: 0.0,
  routeTo: 0,         // Routes to master (track 0)
  effects: [reverb, eq]
}
```

### Example Signal Flow

```
Pattern has notes:
  Note A: channelId='ch-1' (Kick)
  Note B: channelId='ch-2' (Snare)
  Note C: channelId='ch-3' (Bass)

Channels route to mixer:
  ch-1 (Kick)  → Mixer Track 1 (Drums Bus)
  ch-2 (Snare) → Mixer Track 1 (Drums Bus)
  ch-3 (Bass)  → Mixer Track 2 (Bass)

Mixer tracks route to master:
  Track 1 (Drums Bus) → Track 0 (Master)
  Track 2 (Bass)      → Track 0 (Master)
  Track 0 (Master)    → Audio Output
```

### Benefits

✅ **Flexible grouping**: Multiple instruments → one mixer track (busses)
✅ **Unique instruments**: Each channel is independent
✅ **Per-channel effects**: Before mixer (synth-specific processing)
✅ **Per-bus effects**: After summing (shared reverb, compression)
✅ **Sub-mixing**: Mixer tracks can route to other mixer tracks

---

## Data Structures

### Note Data

```typescript
// src/audio/PianoRoll.ts
export interface NoteBlock {
  id: string;
  row: number;          // Visual row in piano roll
  col: number;          // Start beat in pattern
  length: number;       // Duration in beats
  midi: number;         // MIDI note number (0-127)
  channelId: string;    // Which instrument channel to trigger
  velocity: number;     // Note velocity (0.0-1.0)
}
```

### Pattern Data

```typescript
// src/services/patternsListManager.ts
export interface Pattern {
  id: string;           // Unique pattern ID
  num: number;          // User-facing pattern number
  name: string;         // "Drum Beat", "Bass Line", etc.
  roll: PianoRoll;      // Contains NoteBlock[]
  visible: boolean;     // Is editor window open?
  color?: string;       // Visual color
}
```

### Arrangement Clip

```typescript
// src/audio/Arrangement.ts
export interface ArrangementClip {
  id: string;           // Unique clip instance ID
  patternId: string;    // References a Pattern
  track: number;        // Which arrangement track (0, 1, 2...)
  startBeat: number;    // When clip starts in arrangement timeline
  duration: number;     // How many beats of pattern to play
  offset: number;       // Start offset into pattern (for trimming start)
  muted: boolean;       // Clip mute state
  color?: string;       // Override pattern color
}
```

### Arrangement Track

```typescript
// src/audio/Arrangement.ts
export interface ArrangementTrack {
  id: string;
  name: string;         // "Track 1", "Melody", etc.
  height: number;       // Visual height in pixels (resizable)
  muted: boolean;       // Mute entire track
  color?: string;       // Track color
}
```

### Channel (Instrument)

```typescript
// src/audio/AudioEngine.ts or src/audio/Channel.ts
export interface Channel {
  id: string;           // Unique channel ID
  name: string;         // "Kick", "Bass Synth", "Lead"
  synth: MiniSynth;     // Instrument instance
  mixerTrack: number;   // Which mixer track it routes to
  volume: number;       // Channel volume (0.0-1.0)
  pan: number;          // Stereo pan (-1.0 to 1.0)
  muted: boolean;
  solo: boolean;
  color: string;        // Visual color
}
```

### Mixer Track

```typescript
// src/audio/MixerTrack.ts
export interface MixerTrack {
  id: number;           // 0 = Master, 1-127 = Insert tracks
  name: string;         // "Master", "Drums", "Synths Bus"
  volume: number;       // Track volume (0.0-1.0)
  pan: number;          // Stereo pan (-1.0 to 1.0)
  muted: boolean;
  solo: boolean;
  routeTo: number;      // Which track to route to (-1 = none)
  effects: Effect[];    // Effect chain
}
```

### Scheduler Note

```typescript
// src/audio/Scheduler.ts
export interface SchedulerNote {
  id: string;           // Unique note ID for this instance
  pitch: number;        // MIDI note number
  startTime: number;    // When to play (in beats)
  duration: number;     // How long to play (in beats)
  velocity: number;     // Note velocity (0.0-1.0)
  channelId: string;    // Which channel to trigger
}
```

---

## Core Components

### Arrangement Class

**File**: `src/audio/Arrangement.ts`

Manages the arrangement timeline and clips.

```typescript
export class Arrangement {
  private clips: ArrangementClip[] = reactive([]);
  private tracks: ArrangementTrack[] = reactive([]);
  private snapDivision: number = 4; // 1/4 beat grid

  // Clip management
  addClip(clip: ArrangementClip): void;
  removeClip(clipId: string): void;
  updateClip(clipId: string, updates: Partial<ArrangementClip>): void;

  // Movement and resizing
  moveClip(clipId: string, newTrack: number, newStartBeat: number): void;
  resizeClip(clipId: string, newDuration: number, newOffset?: number): void;

  // Queries
  getClipsInRange(startBeat: number, endBeat: number): ArrangementClip[];
  getClipsOnTrack(trackNumber: number): ArrangementClip[];
  getClipAt(track: number, beat: number): ArrangementClip | null;

  // Track management
  addTrack(name: string): void;
  removeTrack(trackId: string): void;
  resizeTrack(trackId: string, height: number): void;

  // Grid snapping
  snap(value: number): number;
  setSnapDivision(division: number): void; // 1, 2, 4, 8, 16, 32

  // Getters
  getClips(): ArrangementClip[];
  getTracks(): ArrangementTrack[];
  getEndBeat(): number; // Latest clip end time
}
```

### ArrangementCompiler Class

**File**: `src/audio/ArrangementCompiler.ts`

Compiles arrangement clips into a flat note sequence for the scheduler.

```typescript
export class ArrangementCompiler {
  /**
   * Main compilation method
   * Takes all clips in range and produces a flat list of scheduler notes
   */
  compile(
    arrangement: Arrangement,
    patterns: Map<string, Pattern>,
    startBeat: number = 0,
    endBeat: number = Infinity
  ): SchedulerNote[];

  /**
   * Compiles a single clip into scheduler notes
   */
  private compileClip(
    clip: ArrangementClip,
    pattern: Pattern
  ): SchedulerNote[];

  /**
   * Incremental compilation - only recompile changed clips
   * Optimization for live editing
   */
  incrementalCompile(
    arrangement: Arrangement,
    patterns: Map<string, Pattern>,
    changedClipIds: Set<string>,
    previousNotes: SchedulerNote[]
  ): SchedulerNote[];
}
```

### Channel Manager

**File**: `src/audio/ChannelManager.ts`

Manages instrument channels and routing.

```typescript
export class ChannelManager {
  private channels: Map<string, Channel> = reactive(new Map());

  addChannel(name: string, synth: MiniSynth, mixerTrack: number): Channel;
  removeChannel(channelId: string): void;
  getChannel(channelId: string): Channel | undefined;
  getAllChannels(): Channel[];

  // Routing
  setMixerRoute(channelId: string, mixerTrack: number): void;

  // Playback control
  mute(channelId: string): void;
  unmute(channelId: string): void;
  solo(channelId: string): void; // Mutes all others

  // Volume control
  setVolume(channelId: string, volume: number): void;
  setPan(channelId: string, pan: number): void;
}
```

### Mixer Manager

**File**: `src/audio/MixerManager.ts`

Manages mixer tracks and routing.

```typescript
export class MixerManager {
  private tracks: Map<number, MixerTrack> = reactive(new Map());

  constructor() {
    // Initialize with master track
    this.tracks.set(0, {
      id: 0,
      name: 'Master',
      volume: 0.8,
      pan: 0,
      muted: false,
      solo: false,
      routeTo: -1,
      effects: []
    });
  }

  addTrack(name: string): MixerTrack;
  removeTrack(trackId: number): void;
  getTrack(trackId: number): MixerTrack | undefined;

  // Routing
  setRoute(trackId: number, routeTo: number): void;

  // Control
  setVolume(trackId: number, volume: number): void;
  setPan(trackId: number, pan: number): void;
  mute(trackId: number): void;
  unmute(trackId: number): void;
  solo(trackId: number): void;

  // Effects
  addEffect(trackId: number, effect: Effect): void;
  removeEffect(trackId: number, effectId: string): void;
}
```

---

## Compilation Process

### How Clips Become Notes

The compiler transforms arrangement clips into playable notes:

```typescript
// STEP 1: Get all clips in playback range
const clips = arrangement.getClipsInRange(0, 32); // First 32 beats

// STEP 2: For each clip, get the pattern
for (const clip of clips) {
  if (clip.muted) continue;

  const pattern = patterns.get(clip.patternId);
  if (!pattern) continue;

  // STEP 3: Get pattern's notes
  const patternNotes = pattern.roll.getNoteData;

  // STEP 4: Transform each note
  for (const note of patternNotes) {
    // Apply clip offset (trim from start)
    const noteStartInPattern = note.col - clip.offset;
    if (noteStartInPattern < 0) continue; // Note before clip start

    // Apply clip duration (trim from end)
    if (noteStartInPattern >= clip.duration) continue; // Note after clip end

    // Calculate position in arrangement timeline
    const noteStartInArrangement = clip.startBeat + noteStartInPattern;

    // Trim note if it exceeds clip duration
    const trimmedDuration = Math.min(
      note.length,
      clip.duration - noteStartInPattern
    );

    // STEP 5: Create scheduler note
    compiledNotes.push({
      id: `${clip.id}-${note.id}`, // Unique per clip instance
      pitch: note.midi,
      startTime: noteStartInArrangement,
      duration: trimmedDuration,
      velocity: note.velocity,
      channelId: note.channelId
    });
  }
}

// STEP 6: Sort by start time for efficient playback
return compiledNotes.sort((a, b) => a.startTime - b.startTime);
```

### Example Compilation

**Input:**
```
Pattern 1 Notes:
  Note A: col=0, length=1, midi=60, channelId='ch-1'
  Note B: col=2, length=1, midi=62, channelId='ch-1'
  Note C: col=4, length=2, midi=64, channelId='ch-2'

Clip 1: patternId='p1', startBeat=0, duration=4, offset=0
Clip 2: patternId='p1', startBeat=8, duration=6, offset=0
```

**Output:**
```
Scheduler Notes:
  [0]  Note A from Clip 1: start=0,  dur=1, ch='ch-1', midi=60
  [1]  Note B from Clip 1: start=2,  dur=1, ch='ch-1', midi=62
  [2]  Note A from Clip 2: start=8,  dur=1, ch='ch-1', midi=60
  [3]  Note B from Clip 2: start=10, dur=1, ch='ch-1', midi=62
  [4]  Note C from Clip 2: start=12, dur=2, ch='ch-2', midi=64
```

**Note**: Clip 1 doesn't include Note C because it's at col=4, which exceeds Clip 1's duration of 4 beats (with offset).

---

## UI Components

### Arrangement.vue

**File**: `src/components/Arrangement.vue`

Main arrangement view component.

**Layout:**
```
┌────────────────────────────────────────────────────────────┐
│  [Ruler: 0 | 4 | 8 | 12 | 16 | 20 | 24 | 28 | 32]         │
├──────────┬─────────────────────────────────────────────────┤
│ Track 1  │ ┌───────┐           ┌──────────┐               │
│  [M][S]  │ │  P1   │           │    P2    │               │
├──────────┼─────────────────────────────────────────────────┤
│ Track 2  │          ┌─────────────┐         ┌────┐        │
│  [M][S]  │          │     P3      │         │ P1 │        │
├──────────┼─────────────────────────────────────────────────┤
│ Track 3  │                                                 │
│  [M][S]  │                 (empty)                         │
└──────────┴─────────────────────────────────────────────────┘
```

**Features:**
- Horizontal scrolling (time axis)
- Vertical scrolling (track axis)
- Zoom in/out horizontally and vertically
- Grid snapping (1/1, 1/2, 1/4, 1/8, 1/16, 1/32)
- Playhead with auto-scroll
- Drag patterns from PatternsList to create clips
- Drag clips to move them
- Resize clips from edges
- Right-click to delete clips
- Track mute/solo buttons
- Resizable track heights

**Key Methods:**
```typescript
// Grid conversion
function beatToPixel(beat: number): number;
function pixelToBeat(pixel: number): number;
function trackToPixel(track: number): number;
function pixelToTrack(pixel: number): number;

// Drag & drop
function handlePatternDragStart(pattern: Pattern, event: DragEvent): void;
function handleDrop(event: DragEvent): void;
function handleClipDragStart(clip: ArrangementClip, event: PointerEvent): void;
function handleClipDrag(event: PointerEvent): void;
function handleClipDragEnd(): void;

// Resizing
function handleClipResizeStart(clip: ArrangementClip, edge: 'left' | 'right'): void;
function handleClipResize(event: PointerEvent): void;

// Compilation trigger
function recompileArrangement(): void;
```

### ChannelRack.vue

**File**: `src/components/ChannelRack.vue`

Channel rack for managing instruments.

**Layout:**
```
┌─────────────────────────────────────────────────────┐
│ Channel Rack                                   [+]  │
├────┬──────────────┬──────┬────┬────┬──────────────┤
│ 01 │ Kick         │ [●]  │ M  │ S  │ Mix: 1       │
│ 02 │ Snare        │ [●]  │ M  │ S  │ Mix: 1       │
│ 03 │ Bass Synth   │ [▶]  │ M  │ S  │ Mix: 2       │
│ 04 │ Lead         │ [▶]  │ M  │ S  │ Mix: 3       │
└────┴──────────────┴──────┴────┴────┴──────────────┘
```

**Features:**
- Add/remove channels
- Rename channels
- Select instrument type (synth, sampler, etc.)
- Route to mixer track
- Mute/solo individual channels
- Visual indicators
- Color coding

### Mixer.vue

**File**: `src/components/Mixer.vue`

Mixer view for mixing and effects.

**Layout:**
```
┌────────────────────────────────────────────────────────┐
│                      MIXER                             │
├──────┬──────┬──────┬──────┬──────────────────────────┤
│      │  1   │  2   │  3   │  Master                  │
│      │ Drums│ Bass │Synths│                          │
│  FX  │ [  ] │ [  ] │ [  ] │ [  ]                     │
│  FX  │ [  ] │ [  ] │ [  ] │ [  ]                     │
│      │      │      │      │                          │
│ [||] │ [||] │ [||] │ [||] │ [||]  ← Faders          │
│      │  │   │  │   │  │   │   │                     │
│ [●]  │  │   │  │   │  │   │   │   ← Pan             │
│ M S  │ M S  │ M S  │ M S  │  M    ← Mute/Solo       │
│      │      │      │      │                          │
│Route:│Route:│Route:│Route:│                          │
│Master│Master│Master│ ---  │                          │
└──────┴──────┴──────┴──────┴──────────────────────────┘
```

**Features:**
- Volume faders
- Pan knobs
- Mute/solo per track
- Effects slots (expandable)
- Routing dropdown
- VU meters
- Track naming

### PatternsList.vue (Enhanced)

**File**: `src/components/PatternsList.vue`

Enhanced to support drag-to-arrangement.

**New features:**
```typescript
// Make patterns draggable
function handlePatternDragStart(pattern: Pattern, event: DragEvent) {
  event.dataTransfer!.setData('pattern-id', pattern.id);
  event.dataTransfer!.effectAllowed = 'copy';
}
```

---

## Implementation Phases

### Phase 1: Data Layer Foundation
**Goal**: Set up core data structures

**Tasks:**
1. Add `channelId` and `velocity` to `NoteBlock` type
2. Create `src/audio/Channel.ts` with Channel interface
3. Create `src/audio/MixerTrack.ts` with MixerTrack interface
4. Create `src/audio/ChannelManager.ts` with basic channel management
5. Create `src/audio/MixerManager.ts` with basic mixer management
6. Update `AudioEngine.ts` to include ChannelManager and MixerManager
7. Create default channels and mixer tracks in AudioEngine initialization

**Deliverable**: Core data structures in place, no UI yet.

---

### Phase 2: Arrangement Data Structures
**Goal**: Create arrangement data model

**Tasks:**
1. Create `src/audio/Arrangement.ts` with ArrangementClip and ArrangementTrack interfaces
2. Implement Arrangement class with clip management methods
3. Add reactive state management for clips and tracks
4. Implement grid snapping logic
5. Create `src/services/arrangementManager.ts` for global arrangement state
6. Add 3 default tracks

**Deliverable**: Arrangement data model ready to use.

---

### Phase 3: Arrangement Compiler
**Goal**: Implement note compilation logic

**Tasks:**
1. Create `src/audio/ArrangementCompiler.ts`
2. Implement `compile()` method
3. Implement `compileClip()` helper
4. Add note offset and trimming logic
5. Add sorting by start time
6. Write unit tests for compilation edge cases
7. Test with mock data

**Deliverable**: Working compiler that produces SchedulerNote[] from arrangement.

---

### Phase 4: Scheduler Integration
**Goal**: Update scheduler to handle compiled notes and channel routing

**Tasks:**
1. Update `Scheduler.ts` to accept ChannelManager reference
2. Modify `scheduleNoteIfInWindow()` to route notes by channelId
3. Add mixer volume/mute checks
4. Update `setNotes()` to clear and set new compiled notes
5. Add `updateFromArrangement()` helper method
6. Test playback with multiple channels

**Deliverable**: Scheduler can play back compiled arrangement with proper routing.

---

### Phase 5: Basic Arrangement UI
**Goal**: Display arrangement timeline and clips

**Tasks:**
1. Create `src/components/Arrangement.vue` component
2. Implement timeline ruler (beat markers)
3. Implement track lanes (visual only)
4. Render clips as colored rectangles
5. Add horizontal/vertical scrolling
6. Implement `beatToPixel()` and `pixelToBeat()` helpers
7. Add playhead rendering
8. Wire up playhead callback from scheduler

**Deliverable**: Static arrangement view that displays clips and playhead.

---

### Phase 6: Drag & Drop from PatternsList
**Goal**: Allow dragging patterns into arrangement

**Tasks:**
1. Update `PatternsList.vue` to support drag start
2. Implement drop zone in `Arrangement.vue`
3. Calculate drop position (track + beat)
4. Create new clip on drop
5. Trigger arrangement recompile
6. Update scheduler with new notes
7. Add visual feedback during drag

**Deliverable**: Can drag patterns from list to arrangement.

---

### Phase 7: Clip Manipulation
**Goal**: Drag and resize clips in arrangement

**Tasks:**
1. Implement clip drag start/move/end
2. Add grid snapping during drag
3. Prevent track overflow
4. Implement clip resize from right edge (duration)
5. Implement clip resize from left edge (offset + start)
6. Add visual feedback (hover, drag preview)
7. Trigger recompile on move/resize
8. Add right-click to delete clip

**Deliverable**: Full clip manipulation (drag, resize, delete).

---

### Phase 8: Arrangement Controls
**Goal**: Add arrangement-specific controls

**Tasks:**
1. Add zoom controls (horizontal and vertical)
2. Implement snap-to-grid dropdown (1/1, 1/2, 1/4, etc.)
3. Add track mute/solo buttons
4. Implement track height resizing
5. Add play/pause/stop controls
6. Add loop region markers
7. Implement click-to-seek on timeline ruler

**Deliverable**: Full arrangement view controls.

---

### Phase 9: Channel Rack UI
**Goal**: Build channel rack component

**Tasks:**
1. Create `src/components/ChannelRack.vue`
2. Display list of channels
3. Add channel name editing
4. Implement mixer routing dropdown
5. Add mute/solo buttons
6. Add volume/pan controls
7. Implement add/remove channel
8. Add color picker for channels

**Deliverable**: Working channel rack for instrument management.

---

### Phase 10: Mixer UI
**Goal**: Build mixer component

**Tasks:**
1. Create `src/components/Mixer.vue`
2. Render mixer channel strips
3. Implement volume faders
4. Implement pan knobs
5. Add mute/solo buttons
6. Implement routing dropdown
7. Add effects slots (placeholder)
8. Add VU meters (optional)

**Deliverable**: Working mixer UI.

---

### Phase 11: App Layout Integration
**Goal**: Integrate all views into main app

**Tasks:**
1. Update `App.vue` layout
2. Add arrangement view (60% top)
3. Add pattern editor + patterns list (40% bottom)
4. Add channel rack (left sidebar or bottom panel)
5. Add mixer (right sidebar or separate window)
6. Implement panel resizing
7. Add view toggle buttons (hide/show panels)

**Deliverable**: Complete integrated DAW interface.

---

### Phase 12: Reactivity & Performance
**Goal**: Optimize and ensure reactivity

**Tasks:**
1. Add watchers for pattern edits → recompile
2. Add watchers for clip changes → recompile
3. Implement incremental compilation (only changed clips)
4. Add debouncing for rapid changes
5. Optimize rendering (virtual scrolling for many clips)
6. Add performance profiling
7. Optimize scheduler note lookup

**Deliverable**: Smooth, reactive, performant system.

---

### Phase 13: Polish & UX
**Goal**: Professional user experience

**Tasks:**
1. Add keyboard shortcuts (Space=play, Ctrl+D=duplicate, etc.)
2. Implement multi-select clips (Shift/Ctrl click)
3. Add copy/paste for clips
4. Add undo/redo system
5. Implement clip colors (inherit from pattern or custom)
6. Add tooltips
7. Add loading states
8. Add error handling and user feedback
9. Improve accessibility

**Deliverable**: Polished, professional DAW interface.

---

## File Structure

```
src/
├── audio/
│   ├── Arrangement.ts           # NEW: Arrangement data model
│   ├── ArrangementCompiler.ts   # NEW: Compiles clips to notes
│   ├── AudioEngine.ts           # UPDATED: Add channel/mixer managers
│   ├── Channel.ts               # NEW: Channel interface
│   ├── ChannelManager.ts        # NEW: Channel management
│   ├── Keyboard.ts
│   ├── MidiUtils.ts
│   ├── MiniSynth.ts             # UPDATED: Support multiple instances
│   ├── MixerManager.ts          # NEW: Mixer management
│   ├── MixerTrack.ts            # NEW: MixerTrack interface
│   ├── PianoRoll.ts             # UPDATED: Add channelId to notes
│   └── Scheduler.ts             # UPDATED: Channel routing
│
├── components/
│   ├── Arrangement.vue          # NEW: Arrangement timeline view
│   ├── ChannelRack.vue          # NEW: Channel rack panel
│   ├── ConfirmationModal.vue
│   ├── Mixer.vue                # NEW: Mixer view
│   ├── PatternsList.vue         # UPDATED: Drag support
│   ├── PianoRoll.vue            # UPDATED: Channel assignment UI
│   └── Window.vue
│
├── services/
│   ├── arrangementManager.ts   # NEW: Global arrangement state
│   ├── audioEngineManager.ts
│   ├── patternsListManager.ts
│   └── windowManager.ts
│
├── App.vue                      # UPDATED: New layout
└── main.ts
```

---

## Examples & Use Cases

### Example 1: Simple Beat Loop

**Setup:**
```typescript
// Create channels
channels.add('ch-1', 'Kick',  kickSynth,  mixerTrack: 1);
channels.add('ch-2', 'Snare', snareSynth, mixerTrack: 1);
channels.add('ch-3', 'Hat',   hatSynth,   mixerTrack: 1);

// Create pattern
const pattern1 = createPattern('Drum Beat');
pattern1.roll.addNote({ col: 0, midi: 36, channelId: 'ch-1' }); // Kick on 1
pattern1.roll.addNote({ col: 2, midi: 38, channelId: 'ch-2' }); // Snare on 3
pattern1.roll.addNote({ col: 0.5, midi: 42, channelId: 'ch-3' }); // Hat
pattern1.roll.addNote({ col: 1.5, midi: 42, channelId: 'ch-3' }); // Hat
pattern1.roll.addNote({ col: 2.5, midi: 42, channelId: 'ch-3' }); // Hat
pattern1.roll.addNote({ col: 3.5, midi: 42, channelId: 'ch-3' }); // Hat

// Add to arrangement (loop 4 times)
arrangement.addClip({ patternId: 'p1', track: 0, startBeat: 0,  duration: 4 });
arrangement.addClip({ patternId: 'p1', track: 0, startBeat: 4,  duration: 4 });
arrangement.addClip({ patternId: 'p1', track: 0, startBeat: 8,  duration: 4 });
arrangement.addClip({ patternId: 'p1', track: 0, startBeat: 12, duration: 4 });
```

**Result**: 16 beats of looping drum pattern.

---

### Example 2: Layered Composition

**Setup:**
```typescript
// Channels
channels.add('ch-1', 'Drums', drumSynth, mixerTrack: 1);
channels.add('ch-2', 'Bass',  bassSynth, mixerTrack: 2);
channels.add('ch-3', 'Lead',  leadSynth, mixerTrack: 3);

// Patterns
const drums = createPattern('Drums');     // 4-beat drum loop
const bass  = createPattern('Bassline');  // 8-beat bassline
const lead  = createPattern('Melody');    // 16-beat melody

// Arrangement
arrangement.addClip({ patternId: drums.id, track: 0, startBeat: 0,  duration: 16 });
arrangement.addClip({ patternId: bass.id,  track: 1, startBeat: 4,  duration: 8 });
arrangement.addClip({ patternId: bass.id,  track: 1, startBeat: 12, duration: 8 });
arrangement.addClip({ patternId: lead.id,  track: 2, startBeat: 8,  duration: 16 });
```

**Timeline:**
```
Track 0 (Drums): [========Drums========]
Track 1 (Bass):      [==Bass==][==Bass==]
Track 2 (Lead):              [====Lead=====]
Beats:           0    4    8    12   16   20
```

---

### Example 3: Clip Trimming

**Setup:**
```typescript
// Pattern has 8 beats of notes
const pattern = createPattern('Long Pattern');
// ... add notes from beat 0 to 8

// Only use beats 2-6 of the pattern
arrangement.addClip({
  patternId: pattern.id,
  track: 0,
  startBeat: 0,
  duration: 4,    // Only 4 beats long
  offset: 2       // Start at beat 2 of pattern
});
```

**Result**: Plays beats 2-6 of the pattern, starting at beat 0 in the arrangement.

---

### Example 4: Mixer Routing (Drums Bus)

**Setup:**
```typescript
// Create drum channels, all routing to mixer track 1
channels.add('ch-kick',  'Kick',  kickSynth,  mixerTrack: 1);
channels.add('ch-snare', 'Snare', snareSynth, mixerTrack: 1);
channels.add('ch-hat',   'Hat',   hatSynth,   mixerTrack: 1);

// Mixer track 1 = Drums bus with compression
mixer.getTrack(1).name = 'Drums Bus';
mixer.getTrack(1).addEffect(compressor);
mixer.getTrack(1).routeTo = 0; // Route to master

// All drum sounds go through the same compressor
```

---

## Technical Considerations

### Performance Optimization

1. **Incremental Compilation**: Only recompile changed clips
2. **Note Caching**: Cache compiled notes until arrangement changes
3. **Virtual Scrolling**: Only render visible clips
4. **Debouncing**: Debounce recompile during rapid edits
5. **Web Workers**: Move compilation to worker thread (future)

### Reactivity Strategy

```typescript
// Watch pattern edits
watch(() => pattern.roll._noteData, () => {
  recompileArrangement();
}, { deep: true });

// Watch clip changes
watch(() => arrangement.clips, () => {
  recompileArrangement();
}, { deep: true });

// Watch channel routing
watch(() => channelManager.channels, () => {
  // Update scheduler routing
}, { deep: true });
```

### Edge Cases to Handle

1. **Empty clips**: Clips with no notes in range
2. **Overlapping clips**: Multiple clips at same position
3. **Deleted patterns**: Clips referencing non-existent patterns
4. **Circular routing**: Mixer track routing to itself
5. **Very long arrangements**: Memory and performance with 1000+ clips
6. **Negative offsets**: Handle invalid offset values
7. **Zero-duration clips**: Clips with duration ≤ 0

---

## Future Enhancements

### Phase 14+ (Future)
- Audio recording and audio clips
- Automation lanes (volume, pan, effects over time)
- Time signature changes
- Tempo automation
- Audio effects (reverb, delay, EQ, compression)
- VST/plugin support
- MIDI controller support
- Project save/load
- Export to WAV/MP3
- Collaboration features

---

## Conclusion

This architecture provides a solid foundation for a professional-grade DAW arrangement system. The three-tier routing (Note → Channel → Mixer) offers flexibility while maintaining clarity. The compilation process efficiently transforms arrangement clips into playable sequences, and the component structure supports incremental development.

By following the phased implementation plan, you can build and test each piece independently, ensuring a stable and maintainable codebase.

**Key Principles:**
- ✅ **Separation of concerns**: Data, logic, and UI are distinct
- ✅ **Reactivity**: Vue's reactive system keeps everything in sync
- ✅ **Flexibility**: Routing and mixing match professional DAWs
- ✅ **Performance**: Optimized compilation and rendering
- ✅ **User experience**: Familiar workflow inspired by FL Studio
