export class NesNoiseProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            {
                name: 'frequency',
                defaultValue: 440,
                minValue: 0,
                maxValue: 96000,
                automationRate: 'a-rate'
            },
            {
                name: 'mode',
                defaultValue: 0,
                minValue: 0,
                maxValue: 1,
                automationRate: 'k-rate'
            }
        ];
    }

    constructor() {
        super();
        this.lfsr = 1;
        this.phase = 0;
    }

    process(inputs, outputs, parameters) {
        const channels = outputs[0];
        const freqParam = parameters.frequency;
        const modeParam = parameters.mode;

        for(let i = 0; i < channels[0].length; i++) {
            const frequency = freqParam.length > 1 ? freqParam[i] : freqParam[0];
            const mode = modeParam.length > 1 ? modeParam[i] : modeParam[0];

            const step = frequency / sampleRate;
            this.phase += step;

            while(this.phase >= 1) {
                this.phase -= 1;
                const tap = mode >= 0.5 ? 6 : 1;
                const bit = ((this.lfsr & 1) ^ (this.lfsr >> tap) & 1) & 1;
                this.lfsr = (this.lfsr >> 1) | (bit << 14);
            }

            const sample = (this.lfsr & 1) ? 1 : -1;
            for(let ch = 0; ch < channels.length; ch++) {
                channels[ch][i] = sample;
            }
        }

        return true;
    }
}

registerProcessor('nes-noise', NesNoiseProcessor);