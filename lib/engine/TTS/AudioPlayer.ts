// PATCH: network-tts
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio'

import { TTSError, toTTSError } from './TTSClient'

type Player = ReturnType<typeof createAudioPlayer>
type Subscription = { remove: () => void }

const LOAD_TIMEOUT_MS = 20000

/**
 * Thin wrapper around expo-audio for one-at-a-time playback.
 *
 * NetworkTTSClient owns queueing; this class only guarantees that:
 * - a new `play()` replaces the previous player (no overlapping speech),
 * - `play()` resolves exactly once (finished / failed / stopped),
 * - `stop()` always releases the native player.
 */
export class AudioPlayer {
    private player: Player | null = null
    private subscription: Subscription | null = null
    private settle: ((error?: TTSError) => void) | null = null
    private loadTimer: ReturnType<typeof setTimeout> | null = null
    private audioModeReady = false

    private async ensureAudioMode() {
        if (this.audioModeReady) return
        try {
            await setAudioModeAsync({ playsInSilentMode: true })
        } catch {
            // Playback still works with the default mode on most devices.
        }
        this.audioModeReady = true
    }

    private release() {
        if (this.loadTimer) {
            clearTimeout(this.loadTimer)
            this.loadTimer = null
        }
        try {
            this.subscription?.remove()
        } catch {
            // Already disposed.
        }
        this.subscription = null
        try {
            this.player?.remove()
        } catch {
            // Already disposed.
        }
        this.player = null
    }

    async play(uri: string): Promise<void> {
        await this.ensureAudioMode()

        const previous = this.settle
        this.settle = null
        this.release()
        previous?.(new TTSError('ABORTED', 'TTS playback replaced'))

        return new Promise<void>((resolve, reject) => {
            let settled = false
            const finish = (error?: TTSError) => {
                if (settled) return
                settled = true
                this.settle = null
                this.release()
                if (error) reject(error)
                else resolve()
            }
            this.settle = finish

            try {
                const player = createAudioPlayer({ uri }, { updateInterval: 100 })
                this.player = player

                this.loadTimer = setTimeout(() => {
                    finish(new TTSError('PLAYBACK', 'TTS audio did not load in time'))
                }, LOAD_TIMEOUT_MS)

                this.subscription = player.addListener('playbackStatusUpdate', (status) => {
                    if (status.isLoaded && this.loadTimer) {
                        clearTimeout(this.loadTimer)
                        this.loadTimer = null
                    }
                    if (status.error) {
                        finish(new TTSError('PLAYBACK', status.error))
                    } else if (status.didJustFinish) {
                        finish()
                    }
                })
                player.play()
            } catch (error) {
                finish(toTTSError(error))
            }
        })
    }

    async stop(): Promise<void> {
        const finish = this.settle
        this.settle = null
        this.release()
        finish?.(new TTSError('ABORTED', 'TTS playback stopped'))
    }
}
