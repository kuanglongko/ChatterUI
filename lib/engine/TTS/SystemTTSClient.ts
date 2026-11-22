// PATCH: network-tts
import * as Speech from 'expo-speech'

import type { TTSClient, TTSSpeakCallbacks, TTSSpeakOptions } from './TTSClient'

/**
 * Adapter around the existing system engine.
 *
 * This file intentionally contains no new behaviour: every call maps 1:1 to
 * the expo-speech call that used to live in lib/state/TTS.ts, so switching
 * back to the system backend is byte-for-byte the old behaviour.
 */
export class SystemTTSClient implements TTSClient {
    readonly requiresVoice = true

    speak(text: string, options: TTSSpeakOptions = {}, callbacks: TTSSpeakCallbacks = {}) {
        Speech.speak(text, {
            language: options.voice?.language,
            voice: options.voice?.identifier,
            rate: options.rate,
            onDone: callbacks.onDone,
            onStopped: callbacks.onStopped,
        })
    }

    stop(): Promise<void> {
        return Speech.stop()
    }

    isSpeaking(): Promise<boolean> {
        return Speech.isSpeakingAsync()
    }
}
