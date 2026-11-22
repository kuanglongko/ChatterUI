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
 * - `{{speed}}` / `{{speakSpeed}}` are pre-formatted strings; they follow the
 *   same encoding rule as every other value (percent format becomes `100%25`
 *   in a URL, which the server decodes back to `100%`).
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

/**
 * Speed actually sent to the server: app rate * user scale, formatted.
 *
 * `custom` exists for servers whose unit is not 1.0 (e.g. 10 = 1x, 20 = 2x):
 * the user enters the value that represents 1x and the product is sent as-is.
 */
export const resolveSpeed = (
    rate: number | undefined,
    scale: number,
    format: 'raw' | 'percent' | 'int' | 'custom',
    customSpeedValue = 10
): string => {
    // Keep a sane floor/ceiling, but do not cap at 5: 10/20 style units are
    // legitimate and must survive.
    const product = Math.min(10000, Math.max(0.01, (rate ?? 1) * scale))
    if (format === 'custom') {
        const unit = Math.min(1000, Math.max(0.01, customSpeedValue || 10))
        return String(Number((product * unit).toFixed(2)))
    }
    return formatSpeed(product, format)
}

const substitute = (
    template: string,
    context: TemplateContext,
    encode: boolean,
    depth: number
): string =>
    template.replace(PLACEHOLDER, (_, name: string) => {
        let value: string
        if (name === 'speed' || name === 'speakSpeed') {
            value = context.speed
        } else if (name === 'text') {
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
