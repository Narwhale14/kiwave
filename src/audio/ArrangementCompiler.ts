import { type Pattern } from '../services/patternsListManager'
import type { Arrangement, ArrangementClip } from './Arrangement';
import type { SchedulerNote } from './Scheduler';

export class ArrangementCompiler {
    private clipCache = new Map<string, SchedulerNote[]>();
    private arrangement: Arrangement;

    constructor(arr: Arrangement) {
        this.arrangement = arr;
    }

    compile(
        patterns: Map<string, Pattern>, 
        startBeat: number = 0, 
        endBeat: number = Infinity
    ): SchedulerNote[] {
        const compiledNotes: SchedulerNote[] = [];
        const clips = this.arrangement.clips;

        for(const clip of clips) {
            if(clip.muted) continue;
            
            const track = this.arrangement.tracks[clip.track];
            if(track && track.muted) continue;

            const clipEnd = clip.startBeat + clip.duration;
            if(clipEnd <= startBeat || clip.startBeat >= endBeat) continue;

            let clipNotes = this.clipCache.get(clip.id);
            if(!clipNotes) {
                clipNotes = this.compileClip(clip, patterns);
                this.clipCache.set(clip.id, clipNotes);
            }

            compiledNotes.push(...clipNotes);
        }

        return compiledNotes.sort((a, b) => a.startTime - b.startTime);
    }

    invalidateClip(id: string) {
        this.clipCache.delete(id);
    }

    invalidatePattern(id: string) {
        const clips = this.arrangement.clips.filter(c => c.patternId === id);
        clips.forEach(c => this.clipCache.delete(c.id));
    }

    clearCache() {
        this.clipCache.clear();
    }

    private compileClip(clip: ArrangementClip, patterns: Map<string, Pattern>): SchedulerNote[] {
        const pattern = patterns.get(clip.patternId);
        if(!pattern) {
            console.warn(`Pattern ${clip.patternId} not found`);
            return [];
        }

        const patternNotes = pattern.roll.getNoteData;
        const schedulerNotes: SchedulerNote[] = [];

        for(const note of patternNotes) {
            const noteStartInPattern = note.col - clip.offset;
            if(noteStartInPattern < 0 || noteStartInPattern >= clip.duration) continue;

            const noteStartInArrangement = clip.startBeat + noteStartInPattern;
            const noteDuration = Math.min(note.length, clip.duration - noteStartInPattern);
            if(noteDuration <= 0) continue;

            schedulerNotes.push({
                id: `${clip.id}-${note.id}`,
                pitch: note.midi,
                startTime: noteStartInArrangement,
                duration: noteDuration,
                velocity: note.velocity,
                channel: note.channelId
            });
        }

        return schedulerNotes;
    }
}