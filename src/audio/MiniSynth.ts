import { midiToFrequency } from "./midiUtils";
import { getAudioContext } from "./audio";

export class MiniSynth {
  private context: AudioContext;
  private voices = new Map<number, {oscNode: OscillatorNode; gainNode: GainNode; volume: number}>();
  private masterGain: GainNode;
  private readonly declick: number = 0.002;

  constructor() {
    this.context = getAudioContext();

    this.masterGain = this.context.createGain();
    this.masterGain.gain.value = 1;
    this.masterGain.connect(this.context.destination);
  }

  public noteOn(midi: number, type: OscillatorType = 'sine', volume = 0.2) {
    if(this.voices.has(midi)) this.noteOff(midi);

    const oscNode = this.context.createOscillator();
    const gainNode = this.context.createGain();
    const now = this.context.currentTime;

    oscNode.type = type;
    oscNode.frequency.value = midiToFrequency(midi);

    const normalization = volume / (this.voices.size + 1);

    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(normalization, now + this.declick);

    oscNode.connect(gainNode);
    gainNode.connect(this.masterGain);

    oscNode.start();
    this.voices.set(midi, {oscNode, gainNode, volume: normalization});
  }

  public noteOff(midi: number) {
    const voice = this.voices.get(midi);
    if(!voice) return;

    const { oscNode, gainNode, volume } = voice;
    const now = this.context.currentTime;

    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(volume, now);
    gainNode.gain.linearRampToValueAtTime(0, now + this.declick);

    oscNode.stop(now + this.declick);

    this.voices.delete(midi);
  }

  public noteOnAtTime(midi: number, time: number, type: OscillatorType = 'sine', volume = 0.2) {
    if(this.voices.has(midi)) return;

    const oscNode = this.context.createOscillator();
    const gainNode = this.context.createGain();

    oscNode.type = type;
    oscNode.frequency.value = midiToFrequency(midi);

    gainNode.gain.setValueAtTime(0, time);
    gainNode.gain.linearRampToValueAtTime(volume, time + this.declick);

    oscNode.connect(gainNode);
    gainNode.connect(this.masterGain);

    oscNode.start(time);
    this.voices.set(midi, {oscNode, gainNode, volume});
  }

  public noteOffAtTime(midi: number, time: number) {
    const voice = this.voices.get(midi);
    if(!voice) return;

    const { oscNode, gainNode, volume } = voice;

    gainNode.gain.setValueAtTime(volume, time - this.declick);
    gainNode.gain.linearRampToValueAtTime(0, time);

    oscNode.stop(time);

    oscNode.onended = () => {
      if(this.voices.get(midi)?.oscNode === oscNode) {
        this.voices.delete(midi);
      }
    };
  }
}