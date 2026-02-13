import { midiToFrequency } from "../util/midiUtils";

/**
 * interface for a voice
 */
interface ActiveVoice { 
    oscillator: OscillatorNode;
    gainNode: GainNode;
    pitch: number;
}

/**
 * basic sine synth - no env manipulating yet
 */
export class MiniSynth {
    private audioContext: AudioContext;
    private masterGain: GainNode;
    private scheduledVoices: Map<string, ActiveVoice> = new Map(); // maped by id (workspace notes)
    private liveVoices: Map<number, ActiveVoice> = new Map(); // mapped by pitch (for keyboard sampling)

    // env settings
    private attackTime = 0.005;
    private releaseTime = 0.005;
    
    constructor() {
        this.audioContext = new AudioContext();

        // master gain
        this.masterGain = this.audioContext!.createGain();
        this.masterGain.gain.value = 0.3;
        this.masterGain.connect(this.audioContext!.destination);
    }

    async resume() {
      if(this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
    }

    getAudioContext(): AudioContext {
      return this.audioContext;
    }

    // scheduled playback

    triggerAttack(noteId: string, pitch: number, time: number, velocity: number = 0.8) {
      if(this.scheduledVoices.has(noteId)) {
        this.triggerRelease(noteId, time);
      }

      const clampedVelocity = Math.max(0, Math.min(1, velocity));

      const oscillator = this.audioContext.createOscillator();
      const gainNode = this.audioContext.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(midiToFrequency(pitch), time);

      // osc -> gain -> master
      oscillator.connect(gainNode);
      gainNode.connect(this.masterGain);

      // attack env
      gainNode.gain.setValueAtTime(0.001, time);
      gainNode.gain.setTargetAtTime(clampedVelocity, time, this.attackTime / 3);

      // start
      oscillator.start(time);

      this.scheduledVoices.set(noteId, { oscillator, gainNode, pitch });
    }

    triggerRelease(noteId: string, time: number) {
      const voice = this.scheduledVoices.get(noteId);
      if(!voice) return;

      const { oscillator, gainNode } = voice;

      gainNode.gain.cancelAndHoldAtTime(time);
      gainNode.gain.setTargetAtTime(0, time, this.releaseTime / 3);

      oscillator.stop(time + this.releaseTime + 0.01)

      oscillator.onended = () => {
        if(this.scheduledVoices.get(noteId) === voice) {
          this.scheduledVoices.delete(noteId);
        }
        gainNode.disconnect();
        oscillator.disconnect();
      }
    }

    // live playback (for keyboard playback)

    noteOn(pitch: number, velocity: number = 0.8) {
      if(this.liveVoices.has(pitch)) return;

      const now = this.audioContext.currentTime;
      const clampedVelocity = Math.max(0, Math.min(1, velocity));

      const oscillator = this.audioContext.createOscillator();
      const gainNode = this.audioContext.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(midiToFrequency(pitch), now);

      oscillator.connect(gainNode);
      gainNode.connect(this.masterGain);
      
      gainNode.gain.setValueAtTime(0.001, now);
      gainNode.gain.setTargetAtTime(clampedVelocity, now, this.attackTime / 3);

      oscillator.start(now);
      this.liveVoices.set(pitch, { oscillator, gainNode, pitch });
    }

    noteOff(pitch: number) {
      const voice = this.liveVoices.get(pitch);
      if(!voice) return;

      const now = this.audioContext.currentTime;
      const { oscillator, gainNode } = voice;

      gainNode.gain.cancelAndHoldAtTime(now);
      gainNode.gain.setTargetAtTime(0, now, this.releaseTime / 3);

      oscillator.stop(now + this.releaseTime + 0.01)

      oscillator.onended = () => {
        if(this.liveVoices.get(pitch) === voice) {
          this.liveVoices.delete(pitch);
        }
        gainNode.disconnect();
        oscillator.disconnect();
      }
    }

    // util

    panic() {
      const now = this.audioContext.currentTime;
      for(const noteId of this.scheduledVoices.keys()) {
        this.triggerRelease(noteId, now);
      }
    }

    killAll() {
      const now = this.audioContext.currentTime;
      
      for(const voice of this.scheduledVoices.values()) {
        voice.gainNode.gain.cancelScheduledValues(now);
        voice.gainNode.gain.setValueAtTime(0, now);
        voice.oscillator.stop(now);
        voice.gainNode.disconnect();
        voice.oscillator.disconnect();
      }

      this.scheduledVoices.clear();

      for(const voice of this.liveVoices.values()) {
        voice.gainNode.gain.cancelScheduledValues(now);
        voice.gainNode.gain.setValueAtTime(0, now);
        voice.oscillator.stop(now);
        voice.gainNode.disconnect();
        voice.oscillator.disconnect();
      }

      this.liveVoices.clear();
    }

    setMasterVolume(volume: number) {
      const clamped = Math.max(0, Math.min(1, volume));
      this.masterGain.gain.setTargetAtTime(clamped, this.audioContext.currentTime, 0.01);
    }

    getActiveVoiceCount(): number {
      return this.scheduledVoices.size + this.liveVoices.size;
    }

    async dispose() {
      this.killAll();
      await this.audioContext.close();
    }
}