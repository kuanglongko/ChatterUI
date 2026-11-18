import { useTranslation } from 'react-i18next'
import { Text } from 'react-native'

import ThemedSwitch from '@components/input/ThemedSwitch'
import Accordion from '@components/views/Accordion'
import { abortUrlOf } from '@lib/engine/API/AbortEndpoint'
import { APIValues } from '@lib/engine/API/APIBuilder.types'
import { Theme } from '@lib/theme/ThemeManager'

// PATCH: abort-support
/**
 * Collapsible "stop via /v1/abort" section for the connection editor.
 *
 * Separate file so ConnectionEditor.tsx only gains one <AbortEndpointSection />
 * line, keeping upstream rebases trivial.
 */

type AbortEndpointSectionProps = {
    values: APIValues
    onChange: (patch: Partial<APIValues>) => void
}

const AbortEndpointSection: React.FC<AbortEndpointSectionProps> = ({ values, onChange }) => {
    const { t } = useTranslation()
    const { color, spacing } = Theme.useTheme()
    const enabled = values.useAbortEndpoint ?? false
    const abortUrl = abortUrlOf(values.endpoint)

    return (
        <Accordion label={t('connections.abortEndpoint.title')}>
            <ThemedSwitch
                label={t('connections.abortEndpoint.label')}
                description={t('connections.abortEndpoint.description')}
                value={enabled}
                onChangeValue={(value) => onChange({ useAbortEndpoint: value })}
            />
            {enabled && (
                <Text style={{ color: color.text._400, paddingBottom: spacing.m }}>
                    {abortUrl
                        ? t('connections.abortEndpoint.urlHint', { url: abortUrl })
                        : t('connections.abortEndpoint.urlInvalid')}
                </Text>
            )}
        </Accordion>
    )
}

export default AbortEndpointSection
