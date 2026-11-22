// PATCH: network-tts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { defaultNetworkTTSConfig, parseNetworkTTSConfig } from '@lib/engine/TTS/NetworkTTSConfig'
import type { NetworkTTSConfig } from '@lib/engine/TTS/NetworkTTSConfig'
import { Storage } from '@lib/enums/Storage'
import { createMMKVStorage } from '@lib/storage/MMKV'

import type { TTSProviderId } from '@lib/engine/TTS/TTSClientFactory'

type NetworkTTSState = {
    provider: TTSProviderId
    config: NetworkTTSConfig
    setProvider: (provider: TTSProviderId) => void
    setConfig: (patch: Partial<NetworkTTSConfig>) => void
    resetConfig: () => void
}

/**
 * Persisted backend selection + HTTP TTS config.
 *
 * Kept separate from useTTSStore on purpose: the existing store's persisted
 * shape stays untouched, so upstream TTS changes never collide with this file.
 */
export const useNetworkTTSStore = create<NetworkTTSState>()(
    persist(
        (set) => ({
            provider: 'system',
            config: { ...defaultNetworkTTSConfig },
            setProvider: (provider) => set({ provider }),
            setConfig: (patch) =>
                set((state) => ({
                    config: { ...state.config, ...patch },
                })),
            resetConfig: () => set({ config: { ...defaultNetworkTTSConfig } }),
        }),
        {
            name: Storage.NetworkTTS,
            storage: createMMKVStorage(),
            version: 1,
            partialize: (state) => ({
                provider: state.provider,
                config: state.config,
            }),
            migrate: (persistedState) => {
                const persisted = persistedState as
                    | { provider?: unknown; config?: unknown }
                    | undefined
                return {
                    provider: persisted?.provider === 'network' ? 'network' : 'system',
                    config: parseNetworkTTSConfig(persisted?.config),
                } as unknown as NetworkTTSState
            },
        }
    )
)
