// PATCH: network-tts
import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, Text, View } from 'react-native'

import ThemedButton from '@components/buttons/ThemedButton'
import HorizontalSelector from '@components/input/HorizontalSelector'
import StringArrayEditor from '@components/input/StringArrayEditor'
import ThemedTextInput from '@components/input/ThemedTextInput'
import Accordion from '@components/views/Accordion'
import { createTTSClient, type TTSClient } from '@lib/engine/TTS'
import { buildAudioRequest } from '@lib/engine/TTS/fetchAudio'
import type { NetworkTTSConfig } from '@lib/engine/TTS/NetworkTTSConfig'
import { useNetworkTTSStore } from '@lib/state/NetworkTTS'
import { Theme } from '@lib/theme/ThemeManager'

/**
 * Settings block for the generic HTTP TTS backend.
 *
 * Kept in its own component so TTSManagerScreen only gains one render line.
 * Every field maps 1:1 to NetworkTTSConfig; no request logic lives here.
 */

type NumberFieldProps = {
    label: string
    value: number
    min: number
    max: number
    integer?: boolean
    onChangeValue: (value: number) => void
}

const NumberField: React.FC<NumberFieldProps> = ({
    label,
    value,
    min,
    max,
    integer = false,
    onChangeValue,
}) => {
    const [text, setText] = useState(String(value))
    // While focused the input owns its text: syncing it from `value` on every
    // keystroke is what made "0.5" jump to "0.1" (the store clamps "0").
    const focused = useRef(false)

    useEffect(() => {
        if (!focused.current) setText(String(value))
    }, [value])

    const clamp = (parsed: number) =>
        Math.min(max, Math.max(min, integer ? Math.round(parsed) : parsed))

    const handleChange = (next: string) => {
        setText(next)
        const parsed = Number(next)
        if (!next.trim() || !Number.isFinite(parsed)) return
        onChangeValue(clamp(parsed))
    }

    const commit = () => {
        const parsed = Number(text)
        if (!text.trim() || !Number.isFinite(parsed)) {
            setText(String(value))
            return
        }
        const clamped = clamp(parsed)
        setText(String(clamped))
        onChangeValue(clamped)
    }

    return (
        <ThemedTextInput
            label={label}
            value={text}
            keyboardType={integer ? 'number-pad' : 'decimal-pad'}
            onChangeText={handleChange}
            onFocus={() => {
                focused.current = true
            }}
            onBlur={() => {
                focused.current = false
                commit()
            }}
            onSubmitEditing={() => {
                focused.current = false
                commit()
            }}
        />
    )
}

const NetworkTTSSection = () => {
    const { t } = useTranslation()
    const { color, fontSize } = Theme.useTheme()
    const { provider, config, setProvider, setConfig, resetConfig } = useNetworkTTSStore()
    const [testText, setTestText] = useState(t('tts.test'))
    const [preview, setPreview] = useState<TTSClient | null>(null)

    const update = (patch: Partial<NetworkTTSConfig>) => setConfig(patch)

    // Readable preview: placeholders are replaced but nothing is percent-encoded,
    // so it is obvious which values actually made it into the request.
    let resolvedRequest = ''
    let resolvedUrlError = ''
    try {
        const request = buildAudioRequest(config, testText.trim() || 'test', 1, {
            encodeUrl: false,
        })
        resolvedRequest = request.body
            ? `${request.method} ${request.url}\n${request.body}`
            : `${request.method} ${request.url}`
    } catch (error) {
        resolvedUrlError = error instanceof Error ? error.message : String(error)
    }

    const stopPreview = () => {
        void preview?.stop()
        setPreview(null)
    }

    const runPreview = () => {
        void preview?.stop()
        const client = createTTSClient(config)
        setPreview(client)
        client.speak(
            testText,
            { rate: 1 },
            { onDone: () => setPreview(null), onStopped: () => setPreview(null) }
        )
    }

    return (
        <Accordion label={t('tts.network.title')}>
            <View style={{ rowGap: 8 }}>
                <HorizontalSelector
                    label={t('tts.network.backend')}
                    values={[
                        { label: t('tts.network.system'), value: 'system' as const },
                        { label: t('tts.network.network'), value: 'network' as const },
                    ]}
                    selected={provider}
                    onPress={setProvider}
                />

                {provider === 'network' && (
                    <>
                        <ThemedTextInput
                            label={t('tts.network.urlTemplate')}
                            value={config.urlTemplate}
                            numberOfLines={3}
                            autoCapitalize="none"
                            autoCorrect={false}
                            onChangeText={(urlTemplate) => update({ urlTemplate })}
                        />
                        <Text
                            style={{
                                color: color.text._400,
                                fontSize: fontSize.s,
                                paddingBottom: 4,
                            }}>
                            {t('tts.network.urlHint')}
                        </Text>

                        <HorizontalSelector
                            label={t('tts.network.method')}
                            values={[
                                { label: 'GET', value: 'GET' as const },
                                { label: 'POST', value: 'POST' as const },
                            ]}
                            selected={config.method}
                            onPress={(method) => update({ method })}
                        />

                        {config.method === 'POST' && (
                            <HorizontalSelector
                                label={t('tts.network.paramLocation')}
                                values={[
                                    { label: t('tts.network.query'), value: 'query' as const },
                                    { label: t('tts.network.form'), value: 'form' as const },
                                    { label: t('tts.network.json'), value: 'json' as const },
                                ]}
                                selected={config.paramLocation}
                                onPress={(paramLocation) => update({ paramLocation })}
                            />
                        )}

                        <ThemedTextInput
                            label={t('tts.network.audioContentType')}
                            value={config.audioContentType}
                            autoCapitalize="none"
                            autoCorrect={false}
                            onChangeText={(audioContentType) => update({ audioContentType })}
                        />

                        <NumberField
                            label={`${t('tts.network.speedScale')} (0.1–5)`}
                            value={config.speedScale}
                            min={0.1}
                            max={5}
                            onChangeValue={(speedScale) => update({ speedScale })}
                        />

                        <HorizontalSelector
                            label={t('tts.network.speedFormat')}
                            values={[
                                { label: t('tts.network.speedRaw'), value: 'raw' as const },
                                {
                                    label: t('tts.network.speedPercent'),
                                    value: 'percent' as const,
                                },
                                { label: t('tts.network.speedInt'), value: 'int' as const },
                                {
                                    label: t('tts.network.speedCustom'),
                                    value: 'custom' as const,
                                },
                            ]}
                            selected={config.speedFormat}
                            onPress={(speedFormat) => update({ speedFormat })}
                        />

                        {config.speedFormat === 'custom' && (
                            <>
                                <NumberField
                                    label={`${t('tts.network.customSpeedValue')} (0.01–1000)`}
                                    value={config.customSpeedValue ?? 10}
                                    min={0.01}
                                    max={1000}
                                    onChangeValue={(customSpeedValue) =>
                                        update({ customSpeedValue })
                                    }
                                />
                                <Text
                                    style={{
                                        color: color.text._400,
                                        fontSize: fontSize.s,
                                        paddingBottom: 4,
                                    }}>
                                    {t('tts.network.customSpeedHint')}
                                </Text>
                            </>
                        )}

                        <HorizontalSelector
                            label={t('tts.network.responseMode')}
                            values={[
                                {
                                    label: t('tts.network.responseBinary'),
                                    value: 'binary' as const,
                                },
                                { label: t('tts.network.responseUrl'), value: 'url' as const },
                            ]}
                            selected={config.responseMode}
                            onPress={(responseMode) => update({ responseMode })}
                        />

                        {config.responseMode === 'url' && (
                            <ThemedTextInput
                                label={t('tts.network.urlField')}
                                value={config.urlField}
                                autoCapitalize="none"
                                autoCorrect={false}
                                onChangeText={(urlField) => update({ urlField })}
                            />
                        )}

                        <HorizontalSelector
                            label={t('tts.network.cacheMode')}
                            values={[
                                { label: t('tts.network.cacheNone'), value: 'none' as const },
                                {
                                    label: t('tts.network.cacheMemory'),
                                    value: 'memory' as const,
                                },
                                { label: t('tts.network.cacheFile'), value: 'file' as const },
                            ]}
                            selected={config.cacheMode}
                            onPress={(cacheMode) => update({ cacheMode })}
                        />

                        <NumberField
                            label={`${t('tts.network.timeout')} (1000–120000)`}
                            value={config.timeoutMs}
                            min={1000}
                            max={120000}
                            integer
                            onChangeValue={(timeoutMs) => update({ timeoutMs })}
                        />
                        <NumberField
                            label={`${t('tts.network.maxChars')} (50–4000)`}
                            value={config.maxCharsPerRequest}
                            min={50}
                            max={4000}
                            integer
                            onChangeValue={(maxCharsPerRequest) => update({ maxCharsPerRequest })}
                        />
                        <NumberField
                            label={`${t('tts.network.keepCacheDays')} (0–365)`}
                            value={config.keepCacheDays}
                            min={0}
                            max={365}
                            integer
                            onChangeValue={(keepCacheDays) => update({ keepCacheDays })}
                        />

                        <StringArrayEditor
                            label={t('tts.network.headers')}
                            value={config.headers}
                            placeholder="Authorization: Bearer ..."
                            setValue={(headers) => update({ headers })}
                        />
                        <Text
                            style={{
                                color: color.text._400,
                                fontSize: fontSize.s,
                                paddingBottom: 4,
                            }}>
                            {t('tts.network.headersHint')}
                        </Text>

                        <StringArrayEditor
                            label={t('tts.network.params')}
                            value={config.params}
                            placeholder="voice=alloy"
                            setValue={(params) => update({ params })}
                        />
                        <Text
                            style={{
                                color: color.text._400,
                                fontSize: fontSize.s,
                                paddingBottom: 4,
                            }}>
                            {t('tts.network.paramsHint')}
                        </Text>

                        <ThemedTextInput
                            label={t('tts.network.test')}
                            value={testText}
                            onChangeText={setTestText}
                        />
                        <Text
                            selectable
                            style={{
                                color: resolvedUrlError ? color.text._400 : color.text._300,
                                fontSize: fontSize.s,
                            }}>
                            {t('tts.network.requestPreview')}
                            {'\n'}
                            {resolvedUrlError || resolvedRequest}
                        </Text>
                        <Text
                            style={{
                                color: color.text._400,
                                fontSize: fontSize.s,
                                paddingBottom: 4,
                            }}>
                            {t('tts.network.requestPreviewHint')}
                        </Text>
                        <View style={styles.row}>
                            <ThemedButton
                                label={t('tts.network.test')}
                                variant="secondary"
                                onPress={runPreview}
                            />
                            <ThemedButton
                                label={t('tts.network.stop')}
                                variant="tertiary"
                                onPress={stopPreview}
                            />
                            <ThemedButton
                                label={t('tts.network.reset')}
                                variant="tertiary"
                                onPress={resetConfig}
                            />
                        </View>
                    </>
                )}
            </View>
        </Accordion>
    )
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        columnGap: 8,
        flexWrap: 'wrap',
    },
})

export default NetworkTTSSection
