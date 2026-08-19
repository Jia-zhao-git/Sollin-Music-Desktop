/// <reference types="vite/client" />

declare module 'node-forge' {
    interface ByteBuffer {
        length(): number
        getBytes(): string
    }
    namespace pki {
        interface PublicKey {
            n: { bitLength(): number }
            encrypt(data: string | ByteBuffer, scheme: string): string
        }
        function publicKeyFromPem(pem: string): PublicKey
    }
    namespace util {
        function bytesToHex(bytes: string): string
        function createBuffer(data?: Uint8Array | ArrayBuffer | string | number[]): ByteBuffer
    }
}

interface ImportMetaEnv {
  readonly DEV: boolean
  readonly PROD: boolean
  readonly MODE: string
  readonly VITE_APP_VERSION?: string
  readonly VITE_DEV_SERVER_PORT?: string
  readonly VITE_GITHUB_REPO?: string
  readonly VITE_GITHUB_ANNOUNCEMENT_REPO?: string
  readonly VITE_GITHUB_ANNOUNCEMENT_ISSUE_NUMBER?: string
  readonly VITE_GITHUB_ANNOUNCEMENT_AUTHOR?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
