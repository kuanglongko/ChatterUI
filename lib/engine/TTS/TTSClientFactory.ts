// PATCH: network-tts
import { useNetworkTTSStore } from '@lib/state/NetworkTTS'

import type { NetworkTTSConfig } from './NetworkTTSConfig'
import { NetworkTTSClient } from './NetworkTTSClient'
import { SystemTTSClient } from './SystemTTSClient'
import type { TTSClient } from './TTSClient'

/**
 * Runtime backend selection.
 *
 * `getTTSClient()` is the single entry point used by the app. Adding another
 * backend later means: implement TTSClient, call registerTTSProvider(), and
 * expose it in the provider selector — no call-site changes.
 */

export type TTSProviderId = 'system' | 'network'

type TTSClientFactory = (config: NetworkTTSConfig) => TTSClient

const systemClient = new SystemTTSClient()

const providers: Record<string, TTSClientFactory> = {
    system: () => systemClient,
    network: (config) => new NetworkTTSClient(config),
}

export const registerTTSProvider = (id: string, factory: TTSClientFactory) => {
    providers[id] = factory
}

let networkCache: { key: string; client: TTSClient } | null = null

/** Builds a client without touching the persisted selection (used for previews). */
export const createTTSClient = (config: NetworkTTSConfig): TTSClient => new NetworkTTSClient(config)

export const getTTSClient = (): TTSClient => {
    const { provider, config } = useNetworkTTSStore.getState()
    const factory = providers[provider]
    if (!factory) return systemClient

    if (provider === 'network') {
        const key = JSON.stringify(config)
        if (!networkCache || networkCache.key !== key) {
            networkCache = { key, client: factory(config) }
        }
        return networkCache.client
    }

    return factory(config)
}
