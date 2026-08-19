/// <reference lib="webworker" />
/**
 * LX source sandbox Web Worker.
 *
 * Receives scripts from the main thread via postMessage, runs them inside the
 * worker global scope with the `lx` shim from sandboxEnv, and bridges HTTP
 * requests back to the host (which uses CapacitorHttp on native platforms to
 * bypass CORS).
 */

import { LxScriptSandbox, type LxSandboxScriptInfo } from './sandboxEnv'

const scope = self as unknown as DedicatedWorkerGlobalScope

let sandbox: LxScriptSandbox | null = null

const getErrorMessage = (error: unknown) => {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  return String(error)
}

scope.addEventListener('message', (event: MessageEvent) => {
  const message = event.data as Record<string, any>
  if (!message || typeof message.type !== 'string') return

  switch (message.type) {
    case 'init': {
      const initId = message.initId as number
      const script = message.script as string
      const scriptInfo = message.scriptInfo as LxSandboxScriptInfo

      const next = new LxScriptSandbox({
        postMessage: (outbound) => {
          scope.postMessage(outbound)
        },
      })
      if (sandbox) sandbox = null
      sandbox = next

      next.start(script, scriptInfo).then(
        (sources) => {
          scope.postMessage({ type: 'inited', initId, ok: true, sources })
        },
        (error) => {
          scope.postMessage({ type: 'inited', initId, ok: false, error: getErrorMessage(error) })
        },
      )
      break
    }
    case 'request': {
      const requestId = message.requestId as string
      if (!sandbox) {
        scope.postMessage({ type: 'requestResult', requestId, ok: false, error: 'Sandbox is not ready' })
        break
      }
      sandbox.handleRequest(message.data).then(
        (result) => {
          scope.postMessage({ type: 'requestResult', requestId, ok: true, result })
        },
        (error) => {
          scope.postMessage({ type: 'requestResult', requestId, ok: false, error: getErrorMessage(error) })
        },
      )
      break
    }
    case 'httpResult': {
      sandbox?.handleHttpResult(message as never)
      break
    }
  }
})

scope.addEventListener('error', (event) => {
  sandbox?.reportUncaughtError(String(event.message || 'Script error'))
})

scope.addEventListener('unhandledrejection', (event) => {
  const reason = (event as unknown as { reason?: unknown }).reason
  const message = typeof reason === 'string' ? reason : reason instanceof Error ? reason.message : String(reason)
  sandbox?.reportUncaughtError(message)
})
