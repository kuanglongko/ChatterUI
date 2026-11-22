// PATCH: network-tts
import { TTSError } from './TTSClient'

/**
 * `{{name}}` template resolution.
 *
 * Rules:
 * - `{{text}}` is the only value that is *always* URI encoded when it lands in
 *   a URL. Encoding it twice (query params appended later) would turn spaces
 *   into `%2520`, so callers choose between `encode = true` (URL) and
 *   `encode = false` (form/JSON body).
 * - `{{speed}}` / `{{speakSpeed}}` are pre-formatted strings and never
 *   encoded (a percent-formatted `100%` must stay `100%`).
 * - Any other name comes from the user's `params` list.
 * - Unknown names throw a CONFIG error instead of silently expanding to "".
 */

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g

export type TemplateContext = {
    text: string
    /** Already formatted with `formatSpeed`; never encoded. */
    speed: string
    params: Record<string, string>
}

export const formatSpeed = (speed: number, format: 'raw' | 'percent' | 'int'): string => {
    if (format === 'percent') return `${Math.round(speed * 100)}%`
    if (format === 'int') return String(Math.round(speed))
    return String(Number(speed.toFixed(2)))
}

/** Speed actually sent to the server: app rate * user scale, formatted. */
export const resolveSpeed = (
    rate: number | undefined,
    scale: number,
    format: 'raw' | 'percent' | 'int'
): string => formatSpeed(Math.min(5, Math.max(0.1, (rate ?? 1) * scale)), format)

const substitute = (
    template: string,
    context: TemplateContext,
    encode: boolean,
    depth: number
): string =>
    template.replace(PLACEHOLDER, (_, name: string) => {
        if (name === 'speed' || name === 'speakSpeed') return context.speed

        let value: string
        if (name === 'text') {
            value = context.text
        } else {
            const param = context.params[name]
            if (param === undefined) {
                throw new TTSError('CONFIG', `Unknown template variable: {{${name}}}`)
            }
            if (depth >= 2) {
                throw new TTSError('CONFIG', 'Template variables are nested too deeply')
            }
            // Params may themselves contain {{text}} / {{speed}}.
            value = substitute(param, context, false, depth + 1)
        }
        return encode ? encodeURIComponent(value) : value
    })

export const substituteTemplate = (
    template: string,
    context: TemplateContext,
    encode: boolean
): string => substitute(template, context, encode, 0)

/** Names used by a template, e.g. to avoid appending duplicate query params. */
export const templateNames = (template: string): Set<string> => {
    const names = new Set<string>()
    for (const match of template.matchAll(PLACEHOLDER)) names.add(match[1])
    return names
}
