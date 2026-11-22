// PATCH: network-tts
import { t } from 'i18next'

import { Logger } from '@lib/state/Logger'

import { cacheAudio, findCachedUri, getMemoryCached, hashKey, purgeOldCache } from './AudioCache'
import { AudioPlayer } from './AudioPlayer'
import { buildAudioRequest, fetchAudio } from './fetchAudio'
import type { NetworkTTSConfig } from './NetworkTTSConfig'
import type { TTSClient, TTSSpeakCallbacks, TTSSpeakOptions } from './TTSClient'
import { toTTSError } from './TTSClient'

type Job = {
    text: string
    options: TTSSpeakOptions
    callbacks: TTSSpeakCallbacks
    /** True for the last sub-chunk of one speak() call (fires onDone). */
    final: boolean
}

/**
 * Splits long text at sentence boundaries first, then hard-wraps anything that
 * is still too long. Keeps each request small enough for latency-sensitive
 * servers without cutting words in the common case.
 */
export const splitText = (text: string, maxChars: number): string[] => {
    const limit = Math.max(50, maxChars)
    if (text.length <= limit) return [text]

    const sentences = text.match(/[^。…！？!?.\n]+[。…！？!?.]?|\n+/g) ?? [text]
    const chunks: string[] = []
    let current = ''

    const flush = () => {
        const trimmed = current.trim()
        if (trimmed) chunks.push(trimmed)
        current = ''
    }

    for (const sentence of sentences) {
        if (sentence.length > limit) {
            flush()
            for (let index = 0; index < sentence.length; index += limit) {
                const part = sentence.slice(index, index + limit).trim()
                if (part) chunks.push(part)
            }
            continue
        }
        if ((current + sentence).length > limit) flush()
        current += sentence
    }
    flush()

    return chunks.length > 0 ? chunks : [text]
}

/**
 * Generic HTTP TTS backend.
 *
 * Queue semantics mirror the system engine from the caller's point of view:
 * - `speak()` returns immediately and queues the text,
 * - chunks play strictly in order,
 * - `stop()` aborts the in-flight request and clears the queue,
 * - every job ends with exactly one of onDone / onStopped (unless stopped).
 */
export class NetworkTTSClient implements TTSClient {
    readonly requiresVoice = false

    private readonly config: NetworkTTSConfig
    private readonly player = new AudioPlayer()
    private queue: Job[] = []
    private running = false
    private generation = 0
    private controller: AbortController | null = null

    constructor(config: NetworkTTSConfig) {
        this.config = config
        purgeOldCache(config.keepCacheDays)
    }

    speak(text: string, options: TTSSpeakOptions = {}, callbacks: TTSSpeakCallbacks = {}) {
        const trimmed = text.trim()
        if (!trimmed) {
            callbacks.onDone?.()
            return
        }
        const chunks = splitText(trimmed, this.config.maxCharsPerRequest)
        chunks.forEach((chunk, index) => {
            this.queue.push({
                text: chunk,
                options,
                callbacks,
                final: index === chunks.length - 1,
            })
        })
        void this.pump()
    }

    async stop(): Promise<void> {
        this.generation++
        this.queue = []
        this.controller?.abort()
        this.controller = null
        await this.player.stop()
    }

    async isSpeaking(): Promise<boolean> {
        return this.running || this.queue.length > 0
    }

    private async pump() {
        if (this.running) return
        this.running = true
        const generation = this.generation
        try {
            while (generation === this.generation) {
                const job = this.queue.shift()
                if (!job) break
                try {
                    await this.runJob(job, generation)
                } catch (error) {
                    if (generation !== this.generation) break
                    this.reportFailure(job, error)
                    this.queue = []
                    break
                }
            }
        } finally {
            this.running = false
            // speak() may have been called while the previous loop was still
            // unwinding (e.g. right after stop()); never strand the queue.
            if (this.queue.length > 0) void this.pump()
        }
    }

    private async runJob(job: Job, generation: number) {
        const request = buildAudioRequest(this.config, job.text, job.options.rate)
        const key = hashKey(`${request.url}|${this.config.audioContentType}`)
        const contentType = this.config.audioContentType || 'audio/wav'

        let uri: string | null = null
        let dispose = () => {}

        if (this.config.cacheMode === 'file') {
            uri = findCachedUri(key)
        }

        if (!uri && this.config.cacheMode === 'memory') {
            const cached = getMemoryCached(key)
            if (cached) {
                const audio = cacheAudio({
                    key,
                    data: cached.data,
                    contentType: cached.contentType,
                    mode: 'memory',
                })
                uri = audio.uri
                dispose = audio.dispose
            }
        }

        if (!uri) {
            const controller = new AbortController()
            this.controller = controller
            let result: Awaited<ReturnType<typeof fetchAudio>>
            try {
                result = await fetchAudio(request, this.config, controller.signal)
            } finally {
                if (this.controller === controller) this.controller = null
            }
            if (generation !== this.generation) return

            const audio = cacheAudio({
                key,
                data: result.data,
                contentType: result.contentType || contentType,
                mode: this.config.cacheMode,
            })
            uri = audio.uri
            dispose = audio.dispose
        }

        if (generation !== this.generation) {
            dispose()
            return
        }

        try {
            if (generation !== this.generation) return
            await this.player.play(uri)
            // Sub-chunk callbacks stay silent until the last one finishes.
            if (generation === this.generation && job.final) job.callbacks.onDone?.()
        } finally {
            dispose()
        }
    }

    private reportFailure(job: Job, error: unknown) {
        const ttsError = toTTSError(error)
        Logger.error(`Network TTS failed [${ttsError.code}]: ${ttsError.message}`)
        Logger.errorToast(t('tts.network.failed'), ttsError.message)
        job.callbacks.onStopped?.()
    }
}
