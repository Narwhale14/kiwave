import { midiToFrequency } from "./midiUtils";
import { getAudioContext } from "./audio";

export class MiniSynth {
  private actx: AudioContext;
  private activeVoices = new Map<number, {osc: OscillatorNode; gain: GainNode}>();
  private readonly declick: number = 0.001; // 0.1 ms

  constructor() {
    this.actx = getAudioContext();
  }

  public noteOn(midi: number, type: OscillatorType = 'sine', volume = 0.2) {
    if(this.activeVoices.has(midi)) return;

    const osc = this.actx.createOscillator();
    const gain = this.actx.createGain();
    const now = this.actx.currentTime;

    osc.type = type;
    osc.frequency.value = midiToFrequency(midi);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + this.declick);

    osc.connect(gain);
    gain.connect(this.actx.destination);

    osc.start();
    this.activeVoices.set(midi, {osc, gain});
  }

  public noteOff(midi: number) {
    const voice = this.activeVoices.get(midi);
    if(!voice) return;

    const { osc, gain } = voice;
    const now = this.actx.currentTime;
    
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + this.declick);

    osc.stop(now + this.declick);

    this.activeVoices.delete(midi);
  }
}