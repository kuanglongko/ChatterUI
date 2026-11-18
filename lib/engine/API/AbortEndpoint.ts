import { CLAUDE_VERSION } from '@lib/constants/GlobalValues'
import { mmkv } from '@lib/storage/MMKV'

import { APIConfiguration, APIValues } from './APIBuilder.types'

// PATCH: abort-support
/**
 * Optional POST <base>/v1/abort on "stop generating".
 *
 * This module is deliberately self-contained and does **not** import the
 * session-id patch: it reads the same MMKV keys by convention instead, so
 * either patch can be applied alone. If the session-id patch is absent the
 * keys simply do not exist and no X-Session-Id header is added.
 *
 * The request is fire-and-forget:
 * - it never delays the local abort,
 * - 404 / 401 / network errors are swallowed,
 * - it is bounded by a short timeout so a dead server cannot keep a socket
 *   (or the JS timer) alive.
 */

const ABORT_PATH = '/v1/abort'
const ABORT_TIMEOUT_MS = 1500
const ABORT_THROTTLE_MS = 1000

// Session-id patch storage convention (see lib/engine/API/SessionId.ts).
const SESSION_CHAT_KEY_PREFIX = 'session-id:chat:'
const SESSION_SHARED_KEY_PREFIX = 'session-id:shared:'

type APIValuesWithName = APIValues & { friendlyName?: string }

let inFlight = false
let lastAbortAt = 0

/**
 * Derive `<baseURL>/v1/abort` from a completion endpoint such as
 * `http://host:8080/v1/chat/completions`.
 *
 * Falls back to the URL origin when no `/v1/` segment exists. Returns '' when
 * the endpoint is not an absolute URL, in which case no request is sent.
 */
export const abortUrlOf = (endpoint: string): string => {
    const value = (endpoint ?? '').trim()
    if (!value) return ''

    const marker = value.indexOf('/v1/')
    if (marker >= 0) return value.slice(0, marker) + ABORT_PATH

    const withoutQuery = value.split(/[?#]/)[0]
    const origin = withoutQuery.match(/^([a-z][a-z0-9+.-]*:\/\/[^/]+)/i)
    return origin ? origin[1] + ABORT_PATH : ''
}

const sessionIdOf = (values: APIValuesWithName, chatId?: number): string => {
    const manual = (values.sessionId ?? '').trim()
    if (manual) return manual

    if (chatId !== undefined) {
        const perChat = mmkv.getString(SESSION_CHAT_KEY_PREFIX + chatId)
        if (perChat) return perChat
    }

    return (
        mmkv.getString(
            `${SESSION_SHARED_KEY_PREFIX}${values.configName}:${values.friendlyName ?? ''}`
        ) ?? ''
    )
}

const abortHeadersOf = (
    apiConfig: APIConfiguration,
    values: APIValuesWithName,
    chatId?: number
): Record<string, string> => {
    const headers: Record<string, string> = {}

    if (apiConfig.features.useKey) {
        headers[apiConfig.request.authHeader] = apiConfig.request.authPrefix + values.key
        if (apiConfig.name === 'Claude') headers['anthropic-version'] = CLAUDE_VERSION
    }

    const sessionId = sessionIdOf(values, chatId)
    if (sessionId) headers['X-Session-Id'] = sessionId

    return headers
}

export type AbortRequestParams = {
    apiConfig: APIConfiguration
    apiValues: APIValuesWithName
    chatId?: number
}

/**
 * Send POST /v1/abort when the connection opted in. Always returns
 * immediately; failures are intentionally silent (see file header).
 */
export const sendAbortRequest = ({ apiConfig, apiValues, chatId }: AbortRequestParams): void => {
    if (!apiValues.useAbortEndpoint) return

    const url = abortUrlOf(apiValues.endpoint)
    if (!url) return

    // A single click must not fan out into multiple abort requests (rapid
    // double taps, abort followed by a queued onEnd path, etc.).
    const now = Date.now()
    if (inFlight || now - lastAbortAt < ABORT_THROTTLE_MS) return
    inFlight = true
    lastAbortAt = now

    const controller = new AbortController()
    const timer = setTimeout(() => {
        try {
            controller.abort()
        } catch {}
    }, ABORT_TIMEOUT_MS)

    try {
        fetch(url, {
            method: 'POST',
            headers: abortHeadersOf(apiConfig, apiValues, chatId),
            signal: controller.signal,
        })
            .catch(() => {})
            .finally(() => {
                clearTimeout(timer)
                inFlight = false
            })
    } catch {
        clearTimeout(timer)
        inFlight = false
    }
}
