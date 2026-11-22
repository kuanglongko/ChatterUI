// PATCH: network-tts
import { fetch } from 'expo/fetch'

import { parseHeaderLines, parseParamLines } from './NetworkTTSConfig'
import type { NetworkTTSConfig } from './NetworkTTSConfig'
import { resolveSpeed, substituteTemplate, templateNames } from './resolveTemplate'
import { TTSError, toTTSError } from './TTSClient'

const MAX_AUDIO_BYTES = 32 * 1024 * 1024
const ERROR_SNIPPET_BYTES = 512

type FetchResponse = Awaited<ReturnType<typeof fetch>>

export type AudioRequest = {
    /** Final URL, also used as the cache key. */
    url: string
    method: 'GET' | 'POST'
    headers: Record<string, string>
    body?: string
}

export type AudioResult = {
    data: ArrayBuffer
    contentType: string
    /** URL the audio was actually fetched from (may differ in `url` mode). */
    sourceUrl: string
}

const acceptHeader = (expected: string): string => {
    const wanted = expected.trim()
    if (!wanted) return 'audio/*, application/octet-stream'
    return wanted.endsWith('/') ? `${wanted}*` : wanted
}

const setHeader = (headers: Record<string, string>, name: string, value: string) => {
    const existing = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase())
    if (existing) delete headers[existing]
    headers[name] = value
}

const hasTextPlaceholder = (config: NetworkTTSConfig): boolean => {
    if (templateNames(config.urlTemplate).has('text')) return true
    return config.params.some((line) => line.includes('{{text}}'))
}

/**
 * Turns config + text into a concrete HTTP request.
 * Kept separate from `fetchAudio` so the cache key can be computed without
 * doing any I/O.
 */
export const buildAudioRequest = (
    config: NetworkTTSConfig,
    text: string,
    rate?: number
): AudioRequest => {
    if (!config.urlTemplate.trim()) {
        throw new TTSError('CONFIG', 'TTS URL template is empty')
    }
    if (!hasTextPlaceholder(config)) {
        throw new TTSError('CONFIG', 'TTS URL/params do not use {{text}}')
    }

    const params = parseParamLines(config.params)
    const context = {
        text,
        speed: resolveSpeed(rate, config.speedScale, config.speedFormat),
        params,
    }

    const url = substituteTemplate(config.urlTemplate, context, true)
    const method = config.method
    const headers: Record<string, string> = {
        Accept: acceptHeader(config.audioContentType),
    }

    for (const [name, template] of Object.entries(parseHeaderLines(config.headers))) {
        const value = substituteTemplate(template, context, false)
        setHeader(headers, name, value)
    }

    const location = method === 'GET' ? 'query' : config.paramLocation
    const used = templateNames(config.urlTemplate)

    if (location === 'query') {
        const search = new URLSearchParams()
        for (const [name, template] of Object.entries(params)) {
            if (used.has(name)) continue
            search.set(name, substituteTemplate(template, context, false))
        }
        const query = search.toString()
        if (query) {
            const separator = url.includes('?') ? '&' : '?'
            return { url: `${url}${separator}${query}`, method, headers }
        }
        return { url, method, headers }
    }

    if (location === 'form') {
        const form = new URLSearchParams()
        for (const [name, template] of Object.entries(params)) {
            form.set(name, substituteTemplate(template, context, false))
        }
        setHeader(headers, 'Content-Type', 'application/x-www-form-urlencoded')
        return { url, method, headers, body: form.toString() }
    }

    const json: Record<string, string> = {}
    for (const [name, template] of Object.entries(params)) {
        json[name] = substituteTemplate(template, context, false)
    }
    setHeader(headers, 'Content-Type', 'application/json')
    return { url, method, headers, body: JSON.stringify(json) }
}

const parseUrlSafely = (url: string, base?: string): URL => {
    try {
        return new URL(url, base)
    } catch {
        throw new TTSError('CONFIG', `Invalid TTS URL: ${url}`)
    }
}

const isAcceptableContentType = (contentType: string, expected: string): boolean => {
    if (!contentType) return true
    const actual = contentType.toLowerCase()
    const wanted = expected.trim().toLowerCase()
    if (!wanted) return true
    if (actual.startsWith(wanted)) return true
    return actual.startsWith('audio/') || actual.startsWith('application/octet-stream')
}

const readErrorSnippet = async (response: FetchResponse): Promise<string> => {
    try {
        const text = await response.text()
        return text.slice(0, ERROR_SNIPPET_BYTES).replace(/\s+/g, ' ').trim()
    } catch {
        return ''
    }
}

const readBody = async (
    response: FetchResponse,
    expectedContentType: string,
    controller: AbortController,
    isTimeout: () => boolean,
    isExternalAbort: () => boolean
): Promise<{ data: ArrayBuffer; contentType: string }> => {
    const contentType = response.headers.get('content-type') ?? ''
    if (!response.ok) {
        const snippet = await readErrorSnippet(response)
        throw new TTSError(
            'HTTP_STATUS',
            `TTS request failed: HTTP ${response.status}${snippet ? ` - ${snippet}` : ''}`
        )
    }
    if (!isAcceptableContentType(contentType, expectedContentType)) {
        const snippet = await readErrorSnippet(response)
        throw new TTSError(
            'BAD_CONTENT_TYPE',
            `Unexpected TTS content type: ${contentType}${snippet ? ` - ${snippet}` : ''}`
        )
    }

    const length = Number(response.headers.get('content-length') ?? '0')
    if (Number.isFinite(length) && length > MAX_AUDIO_BYTES) {
        throw new TTSError('DECODE', `TTS audio too large: ${length} bytes`)
    }

    try {
        const data = await response.arrayBuffer()
        if (data.byteLength === 0) throw new TTSError('DECODE', 'TTS returned empty audio')
        if (data.byteLength > MAX_AUDIO_BYTES) {
            throw new TTSError('DECODE', `TTS audio too large: ${data.byteLength} bytes`)
        }
        return { data, contentType }
    } catch (error) {
        if (controller.signal.aborted) {
            throw new TTSError(
                isTimeout() ? 'TIMEOUT' : 'ABORTED',
                isTimeout() ? 'TTS request timed out' : 'TTS request aborted'
            )
        }
        if (isExternalAbort()) {
            throw new TTSError('ABORTED', 'TTS request aborted')
        }
        throw toTTSError(error)
    }
}

/**
 * Executes the request with a hard timeout and an optional external abort
 * signal. All failures are normalized to `TTSError`.
 */
export const fetchAudio = async (
    request: AudioRequest,
    config: NetworkTTSConfig,
    externalSignal?: AbortSignal
): Promise<AudioResult> => {
    parseUrlSafely(request.url)

    const controller = new AbortController()
    let timedOut = false
    let externalAborted = externalSignal?.aborted ?? false

    const onExternalAbort = () => {
        externalAborted = true
        controller.abort()
    }
    if (externalSignal) {
        if (externalSignal.aborted) onExternalAbort()
        else externalSignal.addEventListener('abort', onExternalAbort)
    }

    const timeoutMs = Math.min(120000, Math.max(1000, config.timeoutMs))
    const timer = setTimeout(() => {
        timedOut = true
        controller.abort()
    }, timeoutMs)

    try {
        let response: FetchResponse
        try {
            response = await fetch(request.url, {
                method: request.method,
                headers: request.headers,
                body: request.body,
                signal: controller.signal,
            })
        } catch (error) {
            if (timedOut) throw new TTSError('TIMEOUT', 'TTS request timed out')
            if (externalAborted) throw new TTSError('ABORTED', 'TTS request aborted')
            throw toTTSError(error)
        }

        const first = await readBody(
            response,
            config.responseMode === 'url' ? '' : config.audioContentType,
            controller,
            () => timedOut,
            () => externalAborted
        )

        if (config.responseMode === 'binary') {
            return {
                data: first.data,
                contentType: first.contentType,
                sourceUrl: request.url,
            }
        }

        // `url` mode: the endpoint answers with JSON pointing at the audio file.
        let audioUrl: string
        try {
            const text = new TextDecoder().decode(first.data)
            const json = JSON.parse(text) as Record<string, unknown>
            const value = json[config.urlField]
            if (typeof value !== 'string' || !value) {
                throw new TTSError('DECODE', `TTS response is missing "${config.urlField}"`)
            }
            audioUrl = parseUrlSafely(value, request.url).toString()
        } catch (error) {
            throw toTTSError(error)
        }

        const audioHeaders: Record<string, string> = {
            Accept: acceptHeader(config.audioContentType),
        }
        let audioResponse: FetchResponse
        try {
            audioResponse = await fetch(audioUrl, {
                headers: audioHeaders,
                signal: controller.signal,
            })
        } catch (error) {
            if (timedOut) throw new TTSError('TIMEOUT', 'TTS audio download timed out')
            if (externalAborted) throw new TTSError('ABORTED', 'TTS request aborted')
            throw toTTSError(error)
        }
        const second = await readBody(
            audioResponse,
            config.audioContentType,
            controller,
            () => timedOut,
            () => externalAborted
        )
        return { data: second.data, contentType: second.contentType, sourceUrl: audioUrl }
    } finally {
        clearTimeout(timer)
        externalSignal?.removeEventListener('abort', onExternalAbort)
    }
}
