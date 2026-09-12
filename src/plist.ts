export type PlistValue =
    | string
    | boolean
    | number
    | Uint8Array
    | PlistValue[]
    | { [key: string]: PlistValue }

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

function escapeXml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
}

function encodeValue(value: PlistValue): string {
    if (typeof value === 'string') return `<string>${escapeXml(value)}</string>`
    if (typeof value === 'boolean') return value ? '<true/>' : '<false/>'
    if (typeof value === 'number') return `<integer>${value}</integer>`
    if (value instanceof Uint8Array) {
        let binary = ''
        for (const byte of value) binary += String.fromCharCode(byte)
        return `<data>${btoa(binary)}</data>`
    }
    if (Array.isArray(value)) return `<array>${value.map(encodeValue).join('')}</array>`
    return `<dict>${Object.entries(value)
        .map(([key, child]) => `<key>${escapeXml(key)}</key>${encodeValue(child)}`)
        .join('')}</dict>`
}

export function encodePlist(value: { [key: string]: PlistValue }): Uint8Array {
    const xml = '<?xml version="1.0" encoding="UTF-8"?>' +
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" ' +
        '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">' +
        `<plist version="1.0">${encodeValue(value)}</plist>`
    return textEncoder.encode(xml)
}

function elementChildren(element: Element): Element[] {
    return Array.from(element.children)
}

function parseData(value: string): Uint8Array {
    const binary = atob(value.replace(/\s/g, ''))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
}

function parseElement(element: Element): PlistValue {
    switch (element.tagName) {
        case 'string':
        case 'key':
        case 'date':
            return element.textContent || ''
        case 'integer':
        case 'real':
            return Number(element.textContent || '0')
        case 'true':
            return true
        case 'false':
            return false
        case 'data':
            return parseData(element.textContent || '')
        case 'array':
            return elementChildren(element).map(parseElement)
        case 'dict': {
            const children = elementChildren(element)
            const result: { [key: string]: PlistValue } = {}
            for (let i = 0; i + 1 < children.length; i += 2) {
                if (children[i].tagName !== 'key') throw new Error('Invalid plist dictionary key')
                result[children[i].textContent || ''] = parseElement(children[i + 1])
            }
            return result
        }
        default:
            throw new Error(`Unsupported plist element: ${element.tagName}`)
    }
}

export function decodePlist(data: Uint8Array): { [key: string]: PlistValue } {
    const document = new DOMParser().parseFromString(textDecoder.decode(data), 'application/xml')
    const parserError = document.querySelector('parsererror')
    if (parserError) throw new Error(`Invalid plist XML: ${parserError.textContent || 'parse error'}`)
    const root = document.documentElement.firstElementChild
    if (!root) throw new Error('Invalid plist XML: missing root value')
    const value = parseElement(root)
    if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Uint8Array) {
        throw new Error('Expected plist dictionary')
    }
    return value
}

export function buildPlistFrame(value: { [key: string]: PlistValue }): Uint8Array {
    const body = encodePlist(value)
    const frame = new Uint8Array(4 + body.length)
    new DataView(frame.buffer).setUint32(0, body.length, false)
    frame.set(body, 4)
    return frame
}
