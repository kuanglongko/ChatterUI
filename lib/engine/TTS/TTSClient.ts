// PATCH: network-tts
/**
 * Minimal contract shared by every TTS backend.
 *
 * The rest of the app (lib/state/TTS.ts) only talks to this interface, so a new
 * backend is one new file plus one factory registration — no call-site changes.
 */

export type TTSVoice = {
    identifier?: string
    language?: string
}

export type TTSSpeakOptions = {
    /** Only meaningful for engines backed by the system voice list. */
    voice?: TTSVoice
    /** Playback rate in the 0.1 - 2.5 range (the store already clamps it). */
    rate?: number
}

export type TTSSpeakCallbacks = {
    onDone?: () => void
    /** Called when playback was interrupted (stop(), new generation, error). */
    onStopped?: () => void
}

export interface TTSClient {
    /**
     * Engines that need a concrete system voice before they can speak.
     * Network engines return false so the store does not block on voice setup.
     */
    readonly requiresVoice: boolean

    /**
     * Fire-and-forget by design: the system engine queues internally and the
     * store calls this once per sentence without awaiting. Network backends
     * must do their own queueing.
     */
    speak: (text: string, options?: TTSSpeakOptions, callbacks?: TTSSpeakCallbacks) => void

    stop: () => Promise<void>

    isSpeaking: () => Promise<boolean>
}

export type TTSErrorCode =
    | 'CONFIG'
    | 'NETWORK'
    | 'TIMEOUT'
    | 'HTTP_STATUS'
    | 'BAD_CONTENT_TYPE'
    | 'DECODE'
    | 'PLAYBACK'
    | 'ABORTED'

export class TTSError extends Error {
    readonly code: TTSErrorCode

    constructor(code: TTSErrorCode, message: string) {
        super(message)
        this.name = 'TTSError'
        this.code = code
    }
}

export const toTTSError = (error: unknown): TTSError => {
    if (error instanceof TTSError) return error
    if (error instanceof Error) return new TTSError('NETWORK', error.message)
    return new TTSError('NETWORK', String(error))
}
