import { randomUUID } from 'expo-crypto'

import { mmkv } from '@lib/storage/MMKV'

import { APIValues } from './APIBuilder.types'

// PATCH: session-id
/**
 * X-Session-Id support, self-contained.
 *
 * Scope: this file is the **only** place that knows how a session id is
 * stored, generated and turned into a request header. The rest of the app
 * only touches three optional fields on APIValues (see APIBuilder.types.ts)
 * and one call in APIBuilder.ts.
 *
 * Semantics
 * - `sessionId` non-empty       -> manual mode, that exact value is sent.
 * - `sessionId` empty + auto on -> a UUID v4 is generated once and reused.
 *       `sessionIdPerChat` true  -> one id per chat (stored by chat id).
 *       `sessionIdPerChat` false -> one id per connection (shared by chats).
 * - `sessionId` empty + auto off -> no header is sent at all.
 *
 * A manual value always wins (it is a deliberate override); per-chat only
 * applies to generated ids.
 *
 * Nothing here is sent in the request body, and nothing survives beyond the
 * local MMKV store. Deleting a chat may leave an orphaned per-chat key; it is
 * tiny and harmless, and explicitly ignored (no cleanup hooks in upstream
 * code paths).
 */

export type SessionIdMode = 'auto' | 'manual' | 'off'

export type SessionIdSettings = {
    sessionId: string
    autoGenerateSessionId: boolean
    sessionIdPerChat: boolean
    mode: SessionIdMode
}

/** Kept in sync with the optional fields on APIValues. */
export const SESSION_ID_DEFAULTS = {
    sessionId: '',
    autoGenerateSessionId: true,
    sessionIdPerChat: true,
} as const

export const SESSION_ID_HEADER = 'X-Session-Id'

const CHAT_KEY_PREFIX = 'session-id:chat:'
const SHARED_KEY_PREFIX = 'session-id:shared:'

/** APIManagerValue adds friendlyName; keep this module usable with plain APIValues too. */
export type SessionIdValues = APIValues & { friendlyName?: string }

export const getSessionIdSettings = (values: APIValues): SessionIdSettings => {
    const sessionId = (values.sessionId ?? '').trim()
    const autoGenerateSessionId =
        values.autoGenerateSessionId ?? SESSION_ID_DEFAULTS.autoGenerateSessionId
    const sessionIdPerChat = values.sessionIdPerChat ?? SESSION_ID_DEFAULTS.sessionIdPerChat

    return {
        sessionId,
        autoGenerateSessionId,
        sessionIdPerChat,
        mode: sessionId ? 'manual' : autoGenerateSessionId ? 'auto' : 'off',
    }
}

const sharedKeyOf = (values: SessionIdValues) =>
    `${SHARED_KEY_PREFIX}${values.configName}:${values.friendlyName ?? ''}`

export const getChatSessionId = (chatId: number): string =>
    mmkv.getString(CHAT_KEY_PREFIX + chatId) ?? ''

export const setChatSessionId = (chatId: number, sessionId: string): string => {
    mmkv.set(CHAT_KEY_PREFIX + chatId, sessionId)
    return sessionId
}

export const getSharedSessionId = (values: SessionIdValues): string =>
    mmkv.getString(sharedKeyOf(values)) ?? ''

export const setSharedSessionId = (values: SessionIdValues, sessionId: string): string => {
    mmkv.set(sharedKeyOf(values), sessionId)
    return sessionId
}

/**
 * Resolve the id that should be sent for this request, generating and
 * persisting one when auto mode allows it. Returns '' when nothing should be
 * sent (mode = off, or per-chat mode without an active chat).
 */
export const getOrCreateSessionId = (values: SessionIdValues, chatId?: number): string => {
    const { sessionId, autoGenerateSessionId, sessionIdPerChat } = getSessionIdSettings(values)

    if (sessionId) return sessionId
    if (!autoGenerateSessionId) return ''

    if (sessionIdPerChat) {
        if (chatId === undefined) return ''
        const stored = getChatSessionId(chatId)
        return stored || setChatSessionId(chatId, randomUUID())
    }

    const stored = getSharedSessionId(values)
    return stored || setSharedSessionId(values, randomUUID())
}

/** Header object for the request builders; empty object = send no header. */
export const getSessionIdHeader = (
    values: SessionIdValues,
    chatId?: number
): Record<string, string> => {
    const sessionId = getOrCreateSessionId(values, chatId)
    return sessionId ? { [SESSION_ID_HEADER]: sessionId } : {}
}
