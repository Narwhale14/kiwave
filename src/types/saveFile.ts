/**
 * TypeScript interface definitions for the WebDAW save file format.
 * Reuses existing domain types where possible; uses Omit + extension
 * only where the serialized form genuinely differs from the runtime type.
 */

import type { ArrangementClip, ArrangementTrack } from '../audio/Arrangement';
import type { MixerTrack } from '../audio/MixerManager';
import type { Channel } from '../audio/ChannelManager';
import type { NoteBlock } from '../audio/PianoRoll';
import type { AutomationCurve } from '../audio/automation/types';
import type { Pattern } from '../services/patternsListManager';
import type { Window } from '../services/windowManager';

export type { ArrangementClip, ArrangementTrack, AutomationCurve, Window };

// MixerTrack minus runtime-only meter fields
export type SavedMixer = Omit<MixerTrack, 'peakDbL' | 'peakDbR'>;

// Channel minus the MiniSynth instance, plus synth identity fields for reconstruction
export type SavedChannel = Omit<Channel, 'instrument'> & { synthId: string; synthNum: number };

// NoteBlock with automation serialized as array instead of Map
export type SavedNote = Omit<NoteBlock, 'automation'> & { automation: AutomationCurve[] };

// Pattern with notes array instead of PianoRoll instance
export type SavedPattern = Omit<Pattern, 'roll'> & { notes: SavedNote[] };

export interface SavedArrangement {
    clips: ArrangementClip[];
    tracks: ArrangementTrack[];
}

export interface SavedUI {
    patternsListWidth: number;
    headerHeight: number;
    windowVisibility: {
        arrangementVisible: boolean;
        channelRackVisible: boolean;
        mixerVisible: boolean;
    };
    windows: Window[];
}

export interface SavedIdCounters {
    nextChannelId: number;
    nextClipId: number;
    nextPatternNum: number;
    nextMixerNum: number;
}

export interface SaveFile {
    version: string;

    metadata: {
        projectName: string;
        created: number;
        lastModified: number;
    };

    global: {
        bpm: number;
        globalVolume: number;
        snapDivision: number;
        playbackMode: 'pattern' | 'arrangement';
    };

    playback: {
        pauseTime: number;
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

export const SAVE_FILE_VERSION = '1.0.0';
export const DB_NAME = 'webdaw';
export const DB_VERSION = 1;
export const AUTOSAVE_STORE = 'autosave';
export const PROJECTS_STORE = 'projects';