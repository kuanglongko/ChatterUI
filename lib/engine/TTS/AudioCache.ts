// PATCH: network-tts
import { Directory, File, Paths } from 'expo-file-system'

import { TTSError } from './TTSClient'

/**
 * Audio cache for network TTS.
 *
 * `file`   – one file per request URL, reused across plays.
 * `memory` – bytes kept in a small in-memory map; a temp file is written per play.
 * `none`   – temp file per play, deleted immediately afterwards.
 *
 * A file is always used for playback because expo-audio takes a URI, not bytes.
 */

export type CacheMode = 'none' | 'memory' | 'file'

const CACHE_DIR = 'network-tts'
const MEMORY_LIMIT = 16

const memoryCache = new Map<string, { data: ArrayBuffer; contentType: string }>()

export const hashKey = (value: string): string => {
    let hash = 0x811c9dc5
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index)
        hash = Math.imul(hash, 0x01000193)
    }
    return (hash >>> 0).toString(16).padStart(8, '0')
}

export const extensionFor = (contentType: string): string => {
    const type = contentType.toLowerCase()
    if (type.includes('wav')) return 'wav'
    if (type.includes('mpeg') || type.includes('mp3')) return 'mp3'
    if (type.includes('ogg') || type.includes('opus')) return 'ogg'
    if (type.includes('aac')) return 'aac'
    if (type.includes('flac')) return 'flac'
    if (type.includes('webm')) return 'webm'
    if (type.includes('mp4') || type.includes('m4a')) return 'm4a'
    return 'bin'
}

const cacheDirectory = (): Directory | null => {
    try {
        const directory = new Directory(Paths.cache, CACHE_DIR)
        if (!directory.exists) {
            directory.create({ intermediates: true, idempotent: true })
        }
        return directory
    } catch {
        return null
    }
}

/** Looks up a previously persisted file by cache key (any extension). */
export const findCachedUri = (key: string): string | null => {
    const directory = cacheDirectory()
    if (!directory) return null
    try {
        for (const entry of directory.list()) {
            if (entry instanceof File && entry.name.startsWith(`${key}.`)) {
                return entry.exists ? entry.uri : null
            }
        }
    } catch {
        return null
    }
    return null
}

const writeFile = (directory: Directory, name: string, data: ArrayBuffer): string => {
    const file = new File(directory, name)
    file.write(new Uint8Array(data))
    return file.uri
}

/**
 * Writes audio for playback. `dispose()` must be called once playback ends
 * (it is a no-op for persistent entries).
 */
export const cacheAudio = (params: {
    key: string
    data: ArrayBuffer
    contentType: string
    mode: CacheMode
}): { uri: string; dispose: () => void } => {
    const { key, data, contentType, mode } = params
    const extension = extensionFor(contentType)
    const directory = cacheDirectory()

    if (!directory) {
        throw new TTSError('DECODE', 'Unable to create the TTS cache directory')
    }

    if (mode === 'file') {
        const existing = findCachedUri(key)
        if (existing) return { uri: existing, dispose: () => {} }
        const uri = writeFile(directory, `${key}.${extension}`, data)
        return { uri, dispose: () => {} }
    }

    if (mode === 'memory') {
        memoryCache.delete(key)
        memoryCache.set(key, { data, contentType })
        while (memoryCache.size > MEMORY_LIMIT) {
            const oldest = memoryCache.keys().next().value
            if (oldest === undefined) break
            memoryCache.delete(oldest)
        }
    }

    const uri = writeFile(directory, `tmp-${key}-${Date.now()}.${extension}`, data)
    return {
        uri,
        dispose: () => {
            try {
                new File(uri).delete()
            } catch {
                // Temp cleanup is best-effort.
            }
        },
    }
}

export const getMemoryCached = (key: string): { data: ArrayBuffer; contentType: string } | null =>
    memoryCache.get(key) ?? null

/** Deletes cache files older than `keepDays`; best-effort. */
export const purgeOldCache = (keepDays: number): void => {
    const directory = cacheDirectory()
    if (!directory) return
    const maxAgeMs = Math.max(0, keepDays) * 24 * 60 * 60 * 1000
    const now = Date.now()
    try {
        for (const entry of directory.list()) {
            if (!(entry instanceof File)) continue
            const modified = entry.lastModified ?? 0
            const isTemp = entry.name.startsWith('tmp-')
            const expired = isTemp
                ? now - modified > 60 * 60 * 1000
                : maxAgeMs === 0 || now - modified > maxAgeMs
            if (expired) {
                try {
                    entry.delete()
                } catch {
                    // Keep going: one locked file must not block cleanup.
                }
            }
        }
    } catch {
        // Cleanup is best-effort.
    }
}
