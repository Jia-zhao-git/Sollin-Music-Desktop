/**
 * Ambient type declaration for pako (ships without TypeScript types).
 */

declare module 'pako' {
  export function inflate(data: Uint8Array | ArrayBuffer | string): Uint8Array
  export function deflate(data: Uint8Array | ArrayBuffer | string, options?: unknown): Uint8Array
  const pako: {
    inflate: typeof inflate
    deflate: typeof deflate
  }
  export default pako
}
