import { WebSocket } from 'ws'
const targets = await fetch('http://127.0.0.1:9222/json').then(r => r.json())
const page = targets.find(t => t.type === 'page' && !/devtools/i.test(t.url))
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 512*1024*1024 })
await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej) })
let msgId = 0; const pending = new Map()
ws.on('message', raw => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
const send = (method, params={}) => new Promise(r => { const id = ++msgId; pending.set(id, r); ws.send(JSON.stringify({id, method, params})) })
const evaluate = async (expression, awaitPromise=false) => {
  const res = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true })
  return res.result?.exceptionDetails ? { error: res.result.exceptionDetails.exception?.description } : { value: res.result?.result?.value }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const arg = process.argv[2] || ''
if (arg === 'reload') { await send('Page.reload'); console.log('reloaded'); process.exit(0) }
const expr = arg || `JSON.stringify(window.__mineradioDebug ? window.__mineradioDebug() : 'NO DEBUG HOOK')`
const out = await evaluate(expr, arg.startsWith('(async'))
console.log(out.value ?? JSON.stringify(out))
process.exit(0)
