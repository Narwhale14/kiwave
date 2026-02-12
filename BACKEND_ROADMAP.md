# Backend Implementation Roadmap
## Phases 3 & 4: Compilation + Scheduler Integration

**Goal**: Wire up arrangement compilation and channel routing to enable multi-track playback.

---

## Current Scheduler Architecture

### How the Scheduler Works

```typescript
// Current flow (single synth):
Scheduler.setNotes(SchedulerNote[])
  ↓
schedulerTick() runs every 25ms
  ↓
scheduleNoteIfInWindow() checks each note
  ↓
synth.triggerAttack(noteId, pitch, time, velocity)
  ↓
synth.triggerRelease(noteId, time)
```

### Key Scheduler Mechanisms

1. **Lookahead Scheduling** (line 149-179)
   - Runs every 25ms (`scheduleInterval`)
   - Looks ahead 100ms (`lookAhead`)
   - Schedules notes within the window
   - Prevents duplicate scheduling via `Set<string>`

2. **Loop Handling** (line 162-173)
   - Schedules current AND next loop iteration
   - Handles wraparound seamlessly
   - Clamps notes to loop region

3. **Timing Precision** (line 123-126)
   - Converts beats → Web Audio time
   - Uses `AudioContext.currentTime` for accuracy
   - Compensates for playhead position

4. **Current Limitation**
   - Only talks to **one synth** (line 30, 192, 200)
   - No concept of channels or routing

---

## Phase 3: Arrangement Compiler
**Duration**: ~1-2 hours
**Complexity**: Medium

### 3.1 Add `channelId` to SchedulerNote

**File**: `src/audio/Scheduler.ts`

```typescript
export interface SchedulerNote {
    id: string;
    pitch: number;
    startTime: number;
    duration: number;
    velocity: number;
    channelId: string;  // ← ADD THIS
}
```

**Impact**: This is a breaking change for existing code that creates SchedulerNotes.

---

### 3.2 Create ArrangementCompiler

**File**: `src/audio/ArrangementCompiler.ts` (new file)

**What it does**: Unpacks arrangement clips into flat note sequences.

```typescript
import type { Arrangement, ArrangementClip } from './Arrangement';
import type { Pattern } from '../services/patternsListManager';
import type { SchedulerNote } from './Scheduler';

export class ArrangementCompiler {
    /**
     * Compiles arrangement into scheduler notes
     * @param arrangement - The arrangement instance
     * @param patterns - Map of pattern ID → Pattern
     * @param startBeat - Compile from this beat (default 0)
     * @param endBeat - Compile until this beat (default Infinity)
     */
    compile(
        arrangement: Arrangement,
        patterns: Map<string, Pattern>,
        startBeat: number = 0,
        endBeat: number = Infinity
    ): SchedulerNote[] {
        const compiledNotes: SchedulerNote[] = [];
        const clips = arrangement.clips;

        for (const clip of clips) {
            // Skip muted clips
            if (clip.muted) continue;

            // Skip clips outside compile range
            const clipEnd = clip.startBeat + clip.duration;
            if (clipEnd <= startBeat || clip.startBeat >= endBeat) continue;

            // Compile this clip
            const clipNotes = this.compileClip(clip, patterns);
            compiledNotes.push(...clipNotes);
        }

        // Sort by start time for efficient playback
        return compiledNotes.sort((a, b) => a.startTime - b.startTime);
    }

    /**
     * Compiles a single clip into scheduler notes
     */
    private compileClip(
        clip: ArrangementClip,
        patterns: Map<string, Pattern>
    ): SchedulerNote[] {
        const pattern = patterns.get(clip.patternId);
        if (!pattern) {
            console.warn(`Pattern ${clip.patternId} not found for clip ${clip.id}`);
            return [];
        }

        const patternNotes = pattern.roll.getNoteData;
        const schedulerNotes: SchedulerNote[] = [];

        for (const note of patternNotes) {
            // Apply clip offset (trim from start)
            const noteStartInPattern = note.col - clip.offset;
            if (noteStartInPattern < 0) continue; // Note before clip start

            // Apply clip duration (trim from end)
            if (noteStartInPattern >= clip.duration) continue; // Note after clip end

            // Calculate position in arrangement timeline
            const noteStartInArrangement = clip.startBeat + noteStartInPattern;

            // Trim note if it exceeds clip duration
            const noteDuration = Math.min(
                note.length,
                clip.duration - noteStartInPattern
            );

            // Skip zero-duration notes
            if (noteDuration <= 0) continue;

            // Create scheduler note
            schedulerNotes.push({
                id: `${clip.id}-${note.id}`, // Unique per clip instance
                pitch: note.midi,
                startTime: noteStartInArrangement,
                duration: noteDuration,
                velocity: note.velocity,
                channelId: note.channelId
            });
        }

        return schedulerNotes;
    }
}
```

**Key Logic**:
- **Offset handling**: `note.col - clip.offset` shifts pattern notes
- **Duration trimming**: Clips notes that exceed clip bounds
- **Timeline placement**: `clip.startBeat + noteStartInPattern`
- **Unique IDs**: `${clip.id}-${note.id}` prevents collisions

---

### 3.3 Test Compilation Logic

**Test scenarios**:

```typescript
// Scenario 1: Simple clip placement
Pattern 1 Notes: col=0, length=1, midi=60
Clip: startBeat=0, duration=4, offset=0
Expected: Note at startTime=0, duration=1, pitch=60

// Scenario 2: Offset (trim from start)
Pattern 1 Notes: col=0, length=1, midi=60
Clip: startBeat=0, duration=2, offset=1
Expected: Note is OUTSIDE clip range (col=0 < offset=1) → NO OUTPUT

// Scenario 3: Duration trim (trim from end)
Pattern 1 Notes: col=2, length=3, midi=64
Clip: startBeat=0, duration=4, offset=0
Expected: Note at startTime=2, duration=2 (trimmed from 3 to 2)

// Scenario 4: Multiple clip instances
Pattern 1 Notes: col=0, length=1, midi=60
Clip A: startBeat=0, duration=2
Clip B: startBeat=4, duration=2
Expected:
  - Note from Clip A: startTime=0, id="clip-a-note-1"
  - Note from Clip B: startTime=4, id="clip-b-note-1"
```

**Testing approach**:
1. Create test patterns with known notes
2. Create test arrangement with clips
3. Compile and verify output matches expectations
4. Test edge cases (offset=0, duration=0, missing patterns)

---

## Phase 4: Scheduler Integration
**Duration**: ~2-3 hours
**Complexity**: High (involves refactoring playback logic)

### 4.1 Update Scheduler to Accept ChannelManager

**File**: `src/audio/Scheduler.ts`

**Changes needed**:

```typescript
import type { ChannelManager } from './channelManager';

export class Scheduler {
    private channelManager: ChannelManager;  // ← ADD THIS
    private synth: MiniSynth;  // ← KEEP for backward compatibility
    private audioContext: AudioContext;

    constructor(
        synth: MiniSynth,
        channelManager: ChannelManager,  // ← ADD PARAM
        options: SchedulerOptions = {}
    ) {
        this.synth = synth;
        this.channelManager = channelManager;  // ← STORE IT
        this.audioContext = synth.getAudioContext();

        // ... rest of constructor
    }
```

**Why keep `synth`?**
- Backward compatibility for existing piano roll playback
- Fallback when channelId is missing or invalid

---

### 4.2 Update Note Scheduling to Route by Channel

**File**: `src/audio/Scheduler.ts` (line 181-203)

**Current code**:
```typescript
this.synth.triggerAttack(note.id, note.pitch, scheduleTime, note.velocity);
this.synth.triggerRelease(note.id, scheduleTime);
```

**New code**:
```typescript
private scheduleNoteIfInWindow(
    note: SchedulerNote,
    noteStartBeat: number,
    currentBeat: number,
    scheduleUntilBeat: number,
    now: number
) {
    const noteEndBeat = noteStartBeat + note.duration;
    if (noteEndBeat < currentBeat) return;

    const noteOnKey = `${note.id}-on-${noteStartBeat.toFixed(4)}`;
    const noteOffKey = `${note.id}-off-${noteEndBeat.toFixed(4)}`;

    const lookBehindTolerance = 0.05;

    // Schedule note ON
    if (noteStartBeat >= currentBeat - lookBehindTolerance &&
        noteStartBeat < scheduleUntilBeat &&
        !this.scheduledNoteOns.has(noteOnKey)) {

        const scheduleTime = Math.max(now, this.beatToAudioTime(noteStartBeat));

        // ┌─────────────────────────────────────────┐
        // │ NEW: Route to correct channel/instrument │
        // └─────────────────────────────────────────┘
        const synth = this.getSynthForNote(note);
        if (synth) {
            synth.triggerAttack(note.id, note.pitch, scheduleTime, note.velocity);
            this.scheduledNoteOns.add(noteOnKey);
        }
    }

    // Schedule note OFF
    if (noteEndBeat >= currentBeat &&
        noteEndBeat < scheduleUntilBeat &&
        !this.scheduledNoteOffs.has(noteOffKey)) {

        const scheduleTime = Math.max(now, this.beatToAudioTime(noteEndBeat));

        // ┌─────────────────────────────────────────┐
        // │ NEW: Route to correct channel/instrument │
        // └─────────────────────────────────────────┘
        const synth = this.getSynthForNote(note);
        if (synth) {
            synth.triggerRelease(note.id, scheduleTime);
            this.scheduledNoteOffs.add(noteOffKey);
        }
    }
}

/**
 * Gets the synth instance for a note based on its channelId
 * Falls back to default synth if channel not found
 */
private getSynthForNote(note: SchedulerNote): MiniSynth | null {
    // If note has a channelId, look it up
    if (note.channelId) {
        const channel = this.channelManager.getChannel(note.channelId);

        // Check if channel is muted
        if (channel && !channel.muted) {
            // TODO: Check mixer track mute/solo as well
            return channel.instrument;
        }
    }

    // Fallback to default synth (for backward compatibility)
    return this.synth;
}
```

**Key changes**:
1. Extract synth lookup to `getSynthForNote()`
2. Route based on `note.channelId`
3. Check channel mute state
4. Fallback to default synth if channel missing

---

### 4.3 Add Mixer Routing (Optional for Phase 4)

**Complexity**: High (requires understanding audio graph routing)

**Defer to later** if you want to keep Phase 4 simple. For now, channels play directly to master.

**Full mixer routing** would require:
- Audio nodes per mixer track (GainNode, PannerNode)
- Connecting channel outputs → mixer track inputs
- Daisy-chaining mixer tracks for sub-mixing
- Handling solo/mute logic across tracks

**Recommendation**: Skip mixer routing for Phase 4, add in Phase 14+.

---

### 4.4 Update AudioEngine to Pass ChannelManager

**File**: `src/audio/AudioEngine.ts`

```typescript
export class AudioEngine {
    private _synth = new MiniSynth();
    private _scheduler = new Scheduler(
        this._synth,
        channelManager,  // ← ADD THIS
        { bpm: 120 }
    );

    constructor() {
        mixerManager.addMixer('Insert 1');
        mixerManager.addMixer('Insert 2');  // Fix typo: "Inset" → "Insert"
        mixerManager.addMixer('Insert 3');

        channelManager.addChannel(this._synth, 'Synth 1');
    }

    // ... rest of class
}
```

---

### 4.5 Update Pattern Playback (PianoRoll.vue)

**File**: `src/components/PianoRoll.vue`

**Current issue**: When you play a pattern directly (not through arrangement), it still needs to work.

**Solution**: Convert PianoRoll notes → SchedulerNotes with channelId.

```typescript
// In updatePatternLoop() or wherever notes are set
function updatePatternLoop() {
    const notes: SchedulerNote[] = props.roll.getNoteData.map(note => ({
        id: note.id,
        pitch: note.midi,
        startTime: note.col,
        duration: note.length,
        velocity: note.velocity,
        channelId: note.channelId  // ← NOW REQUIRED
    }));

    engine.scheduler.setNotes(notes);
    engine.scheduler.setLoop(true, 0, props.roll.getEndBeat(beatsPerBar));
}
```

---

## Testing Strategy

### Unit Tests (Optional but Recommended)

**Test ArrangementCompiler**:
- Clip offset edge cases
- Clip duration trimming
- Multiple clips of same pattern
- Muted clips are skipped
- Missing pattern handling

**Test Scheduler Routing**:
- Notes route to correct channels
- Fallback to default synth works
- Muted channels don't play
- Invalid channelId doesn't crash

---

### Integration Test (Manual)

**Test scenario**: Two-track arrangement

```typescript
// Setup
const drums = createPattern('Drums');
drums.roll.addNote({ col: 0, length: 0.5, midi: 36, channelId: 'channel-1' }); // Kick
drums.roll.addNote({ col: 2, length: 0.5, midi: 38, channelId: 'channel-1' }); // Snare

const bass = createPattern('Bass');
bass.roll.addNote({ col: 0, length: 1, midi: 48, channelId: 'channel-2' }); // Bass C
bass.roll.addNote({ col: 2, length: 1, midi: 50, channelId: 'channel-2' }); // Bass D

// Create channels
channelManager.addChannel(new MiniSynth(), 'Drums');  // channel-1
channelManager.addChannel(new MiniSynth(), 'Bass');   // channel-2

// Add to arrangement
arrangement.addClip(drums.id, 0, 0, 4);  // Track 0, beat 0-4
arrangement.addClip(bass.id, 1, 0, 4);   // Track 1, beat 0-4

// Compile
const compiler = new ArrangementCompiler();
const patterns = new Map([
    [drums.id, drums],
    [bass.id, bass]
]);
const compiledNotes = compiler.compile(arrangement, patterns);

// Set scheduler
engine.scheduler.setNotes(compiledNotes);
engine.scheduler.setLoop(true, 0, 4);
engine.scheduler.play();
```

**Expected result**:
- Kick plays at beat 0, 4 (looping) on channel-1
- Snare plays at beat 2 on channel-1
- Bass C plays at beat 0 on channel-2
- Bass D plays at beat 2 on channel-2
- Both instruments play simultaneously

---

## File Checklist

### Files to Create
- [ ] `src/audio/ArrangementCompiler.ts`

### Files to Modify
- [ ] `src/audio/Scheduler.ts`
  - [ ] Add `channelId` to `SchedulerNote`
  - [ ] Add `channelManager` constructor param
  - [ ] Add `getSynthForNote()` helper
  - [ ] Update `scheduleNoteIfInWindow()` to route by channel
- [ ] `src/audio/AudioEngine.ts`
  - [ ] Pass `channelManager` to Scheduler constructor
  - [ ] Fix typo: "Inset 2" → "Insert 2"
- [ ] `src/components/PianoRoll.vue`
  - [ ] Ensure `channelId` is set when converting to SchedulerNotes

---

## Potential Issues & Solutions

### Issue 1: Default channelId for Existing Notes

**Problem**: Old notes in patterns might not have `channelId` set.

**Solution**:
```typescript
// In PianoRoll.addNote() (line 70-76)
addNote(cell: Cell, id: string, length: number, velocity: number): number {
    if(cell.row < 0 || cell.row > (this.range.max - this.range.min))
        return -1;

    const midi = this.rowToMidi(cell.row);
    const defaultChannelId = 'channel-1'; // ← Use first channel as default
    this._noteData.push({
        id,
        ...cell,
        length,
        velocity,
        channelId: defaultChannelId,  // ← Changed from hardcoded 'synth'
        midi
    });
    return midi;
}
```

---

### Issue 2: Synth Instance Management

**Problem**: Each channel needs its own MiniSynth instance, but they all share the same AudioContext.

**Solution**: MiniSynth already supports this! Just make sure all synths use the same AudioContext:

```typescript
// In channelManager
const audioContext = existingSynth.getAudioContext();
const newSynth = new MiniSynth(audioContext); // Pass context to constructor
```

**Check if MiniSynth constructor accepts AudioContext**. If not, you might need to refactor it.

---

### Issue 3: Performance with Many Channels

**Problem**: Looping through all notes × all channels every 25ms could get expensive.

**Solution**: Not a problem yet. Optimize later if needed. Current architecture is fine for <100 channels.

---

## Success Criteria

After completing Phases 3 & 4, you should be able to:

✅ **Compile arrangement into playable notes**
- ArrangementCompiler converts clips → SchedulerNotes
- Offset and duration trimming works correctly
- Multiple clip instances of same pattern work

✅ **Play multiple instruments simultaneously**
- Notes route to correct channels
- Each channel uses independent synth
- Muted channels don't play

✅ **Pattern editor still works**
- Direct pattern playback (without arrangement) still functions
- Notes play on correct channel

✅ **Backend is complete**
- No UI needed yet
- Can trigger playback programmatically via console

---

## Next Steps After Phase 4

Once the backend is done, you can move to **Phase 5: Basic Arrangement UI**:
- Build the timeline component
- Render clips visually
- Display playhead
- No interaction yet (just visual display)

But for now, **focus on getting compilation + routing working**. Test it thoroughly in the console before building UI.

---

## Estimated Time

- **Phase 3**: 1-2 hours (compiler logic is straightforward)
- **Phase 4**: 2-3 hours (scheduler refactor is tricky)
- **Testing**: 1 hour (manual testing + debugging)

**Total**: ~4-6 hours to complete backend

Good luck! 🚀
