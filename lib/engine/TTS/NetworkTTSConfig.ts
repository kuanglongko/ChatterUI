// PATCH: network-tts
import { z } from 'zod'

/**
 * Persisted configuration for the generic HTTP TTS backend.
 *
 * Everything here is intentionally "dumb data": templates and strings only, so
 * the config survives app updates and can be edited by hand in an export.
 * Validation lives in the schema; runtime parsing is tolerant (bad/old data
 * falls back to defaults instead of breaking TTS entirely).
 */

export const networkTTSMethodSchema = z.enum(['GET', 'POST'])
export const networkTTSParamLocationSchema = z.enum(['query', 'form', 'json'])
export const networkTTSSpeedFormatSchema = z.enum(['raw', 'percent', 'int'])
export const networkTTSCacheModeSchema = z.enum(['none', 'memory', 'file'])
export const networkTTSResponseModeSchema = z.enum(['binary', 'url'])

export const networkTTSConfigSchema = z.object({
    /** Base URL or full template. `{{text}}` is always URI encoded here. */
    urlTemplate: z
        .string()
        .trim()
        .default('http://127.0.0.1:8080/tts?text={{text}}&speed={{speed}}'),
    method: networkTTSMethodSchema.default('GET'),
    /** Where `params` go. GET always uses the query string. */
    paramLocation: networkTTSParamLocationSchema.default('query'),
    /**
     * Expected audio content type prefix, e.g. `audio/wav` or just `audio/`.
     * Empty string disables the check.
     */
    audioContentType: z.string().trim().default('audio/'),
    /** Multiplier applied to the app's playback rate before formatting. */
    speedScale: z.number().min(0.1).max(5).default(1),
    speedFormat: networkTTSSpeedFormatSchema.default('raw'),
    timeoutMs: z.number().int().min(1000).max(120000).default(20000),
    /** `Name: value` lines. Values may reference `{{text}}`, `{{speed}}`, `{{key}}`. */
    headers: z.array(z.string()).default([]),
    /** `key=value` lines. Values may reference `{{text}}`, `{{speed}}`, `{{key}}`. */
    params: z.array(z.string()).default([]),
    cacheMode: networkTTSCacheModeSchema.default('file'),
    /**
     * `binary` = the response body is audio.
     * `url` = the response is JSON and the audio is fetched from `urlField`.
     */
    responseMode: networkTTSResponseModeSchema.default('binary'),
    urlField: z.string().trim().default('url'),
    /** Long text is split at sentence boundaries before each request. */
    maxCharsPerRequest: z.number().int().min(50).max(4000).default(500),
    keepCacheDays: z.number().int().min(0).max(365).default(7),
})

export type NetworkTTSConfig = z.infer<typeof networkTTSConfigSchema>

export const defaultNetworkTTSConfig: NetworkTTSConfig = networkTTSConfigSchema.parse({})

/** Tolerant parser for persisted data; never throws. */
export const parseNetworkTTSConfig = (raw: unknown): NetworkTTSConfig => {
    const parsed = networkTTSConfigSchema.safeParse(raw)
    return parsed.success ? parsed.data : { ...defaultNetworkTTSConfig }
}

/** `Name: value` -> headers object. Invalid lines are ignored. */
export const parseHeaderLines = (lines: string[]): Record<string, string> => {
    const headers: Record<string, string> = {}
    for (const line of lines) {
        const index = line.indexOf(':')
        if (index <= 0) continue
        const key = line.slice(0, index).trim()
        const value = line.slice(index + 1).trim()
        if (key) headers[key] = value
    }
    return headers
}

/** `key=value` -> params map. Invalid lines are ignored. */
export const parseParamLines = (lines: string[]): Record<string, string> => {
    const params: Record<string, string> = {}
    for (const line of lines) {
        const index = line.indexOf('=')
        if (index <= 0) continue
        const key = line.slice(0, index).trim()
        const value = line.slice(index + 1)
        if (key) params[key] = value
    }
    return params
}
