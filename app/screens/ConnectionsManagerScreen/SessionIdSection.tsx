import { randomUUID } from 'expo-crypto'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, Text, View } from 'react-native'

import ThemedButton from '@components/buttons/ThemedButton'
import HorizontalSelector from '@components/input/HorizontalSelector'
import ThemedSwitch from '@components/input/ThemedSwitch'
import ThemedTextInput from '@components/input/ThemedTextInput'
import Accordion from '@components/views/Accordion'
import { APIValues } from '@lib/engine/API/APIBuilder.types'
import { APIManagerValue } from '@lib/engine/API/APIManagerState'
import {
    getOrCreateSessionId,
    getSessionIdSettings,
    setChatSessionId,
    setSharedSessionId,
    SessionIdMode,
} from '@lib/engine/API/SessionId'
import { Chats } from '@lib/state/Chat'
import { Theme } from '@lib/theme/ThemeManager'

// PATCH: session-id
/**
 * Collapsible Session ID section for the connection editor.
 *
 * Kept in its own file on purpose: ConnectionEditor.tsx only gains one
 * <SessionIdSection /> line, which keeps upstream rebases trivial.
 */

type SessionIdSectionProps = {
    values: APIManagerValue
    onChange: (patch: Partial<APIValues>) => void
}

const SessionIdSection: React.FC<SessionIdSectionProps> = ({ values, onChange }) => {
    const { t } = useTranslation()
    const { color, spacing, fontSize } = Theme.useTheme()
    const chatId = Chats.useChatState((state) => state.id)

    const settings = getSessionIdSettings(values)
    const mode = settings.mode
    const [current, setCurrent] = useState('')

    useEffect(() => {
        setCurrent(getOrCreateSessionId(values, chatId))
    }, [values, chatId])

    const changeMode = (next: SessionIdMode) => {
        if (next === 'auto') {
            onChange({ sessionId: '', autoGenerateSessionId: true })
            return
        }
        if (next === 'manual') {
            const id = current || randomUUID()
            setCurrent(id)
            onChange({ sessionId: id, autoGenerateSessionId: false })
            return
        }
        onChange({ sessionId: '', autoGenerateSessionId: false })
    }

    const regenerate = () => {
        const id = randomUUID()
        if (mode === 'auto' && settings.sessionIdPerChat && chatId !== undefined) {
            setCurrent(setChatSessionId(chatId, id))
            return
        }
        if (mode === 'auto') {
            setCurrent(setSharedSessionId(values, id))
            return
        }
        setCurrent(id)
        onChange({ sessionId: id })
    }

    const regenerateDisabled = mode === 'auto' && settings.sessionIdPerChat && chatId === undefined

    const modeOptions: { label: string; value: SessionIdMode }[] = [
        { label: t('connections.sessionId.modes.auto'), value: 'auto' },
        { label: t('connections.sessionId.modes.manual'), value: 'manual' },
        { label: t('connections.sessionId.modes.off'), value: 'off' },
    ]

    return (
        <Accordion label={t('connections.sessionId.title')}>
            <View style={{ rowGap: spacing.l }}>
                <HorizontalSelector
                    label={t('connections.sessionId.mode')}
                    values={modeOptions}
                    selected={mode}
                    onPress={changeMode}
                />

                {mode === 'auto' && (
                    <ThemedSwitch
                        label={t('connections.sessionId.perChat')}
                        description={t('connections.sessionId.perChatDescription')}
                        value={settings.sessionIdPerChat}
                        onChangeValue={(value) => onChange({ sessionIdPerChat: value })}
                    />
                )}

                {mode === 'manual' && (
                    <ThemedTextInput
                        label={t('connections.sessionId.manualLabel')}
                        placeholder={t('connections.sessionId.manualPlaceholder')}
                        value={values.sessionId ?? ''}
                        onChangeText={(value) => {
                            setCurrent(value.trim())
                            onChange({ sessionId: value, autoGenerateSessionId: false })
                        }}
                    />
                )}

                {mode === 'off' ? (
                    <Text style={[styles.hint, { color: color.text._400, fontSize: fontSize.m }]}>
                        {t('connections.sessionId.offDescription')}
                    </Text>
                ) : (
                    <View>
                        <Text style={{ color: color.text._100 }}>
                            {t('connections.sessionId.current')}
                        </Text>
                        <View style={styles.currentRow}>
                            <Text
                                selectable
                                numberOfLines={1}
                                style={{
                                    flex: 1,
                                    color: color.text._300,
                                    fontSize: fontSize.s,
                                }}>
                                {current || t('connections.sessionId.none')}
                            </Text>
                            <ThemedButton
                                variant="tertiary"
                                iconName="reload"
                                label={t('connections.sessionId.regenerate')}
                                disabled={regenerateDisabled}
                                onPress={regenerate}
                            />
                        </View>
                    </View>
                )}

                <Text style={[styles.hint, { color: color.text._400, fontSize: fontSize.m }]}>
                    {t('connections.sessionId.hint')}
                </Text>
            </View>
        </Accordion>
    )
}

export default SessionIdSection

const styles = StyleSheet.create({
    hint: {
        paddingTop: 4,
    },
    currentRow: {
        flexDirection: 'row',
        alignItems: 'center',
        columnGap: 8,
    },
})
