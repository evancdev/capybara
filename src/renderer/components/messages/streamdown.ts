import {
  defaultRehypePlugins,
  type UrlTransform,
  type StreamdownProps
} from 'streamdown'
import { createCodePlugin } from '@streamdown/code'

// ---------------------------------------------------------------------------
// Syntax highlighting plugin — one-dark-pro suits the terminal aesthetic
// ---------------------------------------------------------------------------

export const codePlugin = createCodePlugin({
  themes: ['github-light', 'one-dark-pro']
})

// ---------------------------------------------------------------------------
// Security: Hardened Streamdown configuration
//
// Streamdown's default rehype-harden config uses wildcards ("*") for
// allowedProtocols, allowedLinkPrefixes, allowedImagePrefixes, and enables
// allowDataImages. This is dangerously permissive in Electron where
// javascript:, data:, and file:// URIs can escape the renderer sandbox.
//
// We override the harden plugin with a restrictive allowlist and add a
// urlTransform as defense-in-depth at the react-markdown layer.
// ---------------------------------------------------------------------------

/**
 * Allowlist-based URL transform. Blocks all protocols except http(s) and
 * fragment-only anchors. Applied by react-markdown before rendering any
 * href or src attribute.
 */
const hardenedUrlTransform: UrlTransform = (
  url: string,
  _key,
  _node
): string | undefined => {
  // Allow fragment-only links (e.g. #heading) for in-page navigation
  if (url.startsWith('#')) return url

  // Only allow absolute http(s) URLs. This blocks:
  //   - javascript:, data:, file://, vbscript:, blob: protocols
  //   - Protocol-relative URLs (//example.com) which inherit the page protocol
  //   - Relative paths that would resolve to file:// in Electron
  if (url.startsWith('https://') || url.startsWith('http://')) {
    return url
  }

  // Block everything else
  return undefined
}

/**
 * Build a hardened rehype plugin pipeline from streamdown's defaults.
 *
 * We keep the `raw` and `sanitize` plugins from defaultRehypePlugins as-is,
 * but replace the `harden` plugin options to use a strict allowlist instead
 * of the default wildcards.
 *
 * The harden function reference is extracted from the default tuple so we
 * do not need to import rehype-harden as a direct dependency.
 */
type RehypePlugins = NonNullable<StreamdownProps['rehypePlugins']>

function buildHardenedRehypePlugins(): RehypePlugins {
  const plugins: RehypePlugins = []

  // Keep raw and sanitize as-is from defaults
  plugins.push(defaultRehypePlugins.raw)
  plugins.push(defaultRehypePlugins.sanitize)

  // Replace harden with restrictive options
  // defaultRehypePlugins.harden is [hardenFn, { ...permissive opts }]
  const hardenTuple = defaultRehypePlugins.harden
  const hardenFn = Array.isArray(hardenTuple) ? hardenTuple[0] : hardenTuple
  plugins.push([
    hardenFn,
    {
      // Only allow http and https protocols — blocks javascript:, data:,
      // file://, vbscript:, blob:, and everything else
      allowedProtocols: ['http', 'https'],
      // No wildcard link prefixes — only http(s) links are allowed
      allowedLinkPrefixes: ['https://', 'http://'],
      // No wildcard image prefixes — only http(s) images
      allowedImagePrefixes: ['https://', 'http://'],
      // Block data: URIs in images (base64 exfiltration, XSS vector)
      allowDataImages: false,
      // No default origin — relative URLs should not resolve to file://
      defaultOrigin: undefined,
      // When a link is blocked, show text only (no clickable element)
      linkBlockPolicy: 'text-only',
      // When an image is blocked, remove it entirely
      imageBlockPolicy: 'remove'
    }
  ] as RehypePlugins[number])

  return plugins
}

const hardenedRehypePlugins = buildHardenedRehypePlugins()

/**
 * Shared security props applied to every Streamdown instance.
 * Centralised here so no rendering site can accidentally omit them.
 */
export const STREAMDOWN_SECURITY_PROPS: {
  rehypePlugins: RehypePlugins
  urlTransform: UrlTransform
} = {
  rehypePlugins: hardenedRehypePlugins,
  urlTransform: hardenedUrlTransform
}
