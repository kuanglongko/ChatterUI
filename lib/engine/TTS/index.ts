// PATCH: network-tts
export type {
    TTSClient,
    TTSErrorCode,
    TTSSpeakCallbacks,
    TTSSpeakOptions,
    TTSVoice,
} from './TTSClient'
export { TTSError } from './TTSClient'
export type { NetworkTTSConfig } from './NetworkTTSConfig'
export {
    defaultNetworkTTSConfig,
    networkTTSConfigSchema,
    parseNetworkTTSConfig,
} from './NetworkTTSConfig'
export { NetworkTTSClient, splitText } from './NetworkTTSClient'
export { SystemTTSClient } from './SystemTTSClient'
export type { TTSProviderId } from './TTSClientFactory'
export { createTTSClient, getTTSClient, registerTTSProvider } from './TTSClientFactory'
