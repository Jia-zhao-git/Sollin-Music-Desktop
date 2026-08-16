/*
 * Mineradio 播放界面运行时验证脚本（CDP 驱动 Electron dev 实例）
 * 用法：node scripts/mineradio-harness.mjs
 * 前置：vite dev + electron --remote-debugging-port=9222 已启动
 */
import { WebSocket } from 'ws'
import { writeFileSync, mkdirSync } from 'node:fs'

const CDP_PORT = 9222
const OUT_DIR = '/tmp/mineradio-harness'
mkdirSync(OUT_DIR, { recursive: true })

const consoleLogs = []
let msgId = 0
const pending = new Map()

const targets = await fetch(`http://127.0.0.1:${CDP_PORT}/json`).then((r) => r.json())
const page = targets.find((t) => t.type === 'page' && !/devtools/i.test(t.url))
if (!page) {
  console.error('NO PAGE TARGET', targets.map((t) => `${t.type}:${t.url}`))
  process.exit(1)
}
console.log('TARGET:', page.url)

const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 512 * 1024 * 1024 })
await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej) })

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString())
  if (msg.id && pending.has(msg.id)) {
    const { resolve } = pending.get(msg.id)
    pending.delete(msg.id)
    resolve(msg)
  } else if (msg.method === 'Runtime.consoleAPICalled') {
    const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ')
    consoleLogs.push(`[${msg.params.type}] ${text}`)
  } else if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails
    consoleLogs.push(`[EXCEPTION] ${d.text} ${d.exception?.description || ''}`)
  }
})

function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = ++msgId
    pending.set(id, { resolve })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression, awaitPromise = false) {
  const res = await send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
  })
  if (res.result?.exceptionDetails) {
    return { error: res.result.exceptionDetails.exception?.description || res.result.exceptionDetails.text }
  }
  return { value: res.result?.result?.value }
}

async function screenshot(name) {
  const res = await send('Page.captureScreenshot', { format: 'png' })
  if (res.result?.data) {
    const path = `${OUT_DIR}/${name}.png`
    writeFileSync(path, Buffer.from(res.result.data, 'base64'))
    console.log('SHOT:', path)
  } else {
    console.log('SHOT-FAIL:', name, JSON.stringify(res).slice(0, 200))
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await send('Runtime.enable')
await send('Page.enable')

// 1. 等 app + store 就绪
for (let i = 0; i < 40; i++) {
  const { value } = await evaluate('!!(window.__sollinStores && window.__sollinStores.usePlayerStore.getState().audioRef)')
  if (value) break
  await sleep(500)
}
console.log('STORES READY')

// 2. 注入合成歌曲：4 拍/秒 kick + 和弦垫的 WAV + 渐变封面 PNG + LRC 歌词
const setup = await evaluate(`(async () => {
  const stores = window.__sollinStores
  // --- 合成 30s WAV (44100Hz 单声道)：120BPM kick + 220/277/330Hz 和弦 ---
  const sr = 22050, dur = 30, n = sr * dur
  const data = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / sr
    const beatT = t % 0.5
    const kick = Math.exp(-beatT * 18) * Math.sin(2 * Math.PI * (52 + 60 * Math.exp(-beatT * 30)) * beatT) * 0.9
    const pad = (Math.sin(2*Math.PI*220*t) + Math.sin(2*Math.PI*277*t) + Math.sin(2*Math.PI*330*t)) / 3 * 0.22 * (0.6 + 0.4 * Math.sin(2*Math.PI*t/4))
    const hat = (t % 0.25 < 0.03) ? (Math.random()*2-1) * Math.exp(-(t%0.25)*90) * 0.3 : 0
    data[i] = Math.max(-1, Math.min(1, kick + pad + hat))
  }
  const buf = new ArrayBuffer(44 + n * 2)
  const v = new DataView(buf)
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  ws(0,'RIFF'); v.setUint32(4, 36 + n*2, true); ws(8,'WAVE'); ws(12,'fmt ')
  v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true)
  v.setUint32(24,sr,true); v.setUint32(28,sr*2,true); v.setUint16(32,2,true); v.setUint16(34,16,true)
  ws(36,'data'); v.setUint32(40,n*2,true)
  for (let i = 0; i < n; i++) v.setInt16(44 + i*2, data[i] * 32767, true)
  const wavUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }))

  // --- 封面：渐变 + 圆形图案 ---
  const cv = document.createElement('canvas'); cv.width = cv.height = 360
  const cx = cv.getContext('2d')
  const g = cx.createLinearGradient(0,0,360,360)
  g.addColorStop(0,'#ff5f6d'); g.addColorStop(0.5,'#845ec2'); g.addColorStop(1,'#00c9a7')
  cx.fillStyle = g; cx.fillRect(0,0,360,360)
  for (let i = 0; i < 24; i++) {
    cx.beginPath()
    cx.arc(60 + (i%6)*48, 60 + Math.floor(i/6)*72, 16 + (i%4)*7, 0, Math.PI*2)
    cx.fillStyle = 'rgba(255,255,255,' + (0.10 + (i%5)*0.09) + ')'
    cx.fill()
  }
  cx.fillStyle = '#fff'; cx.font = 'bold 44px sans-serif'; cx.fillText('TEST', 120, 190)
  const coverUrl = cv.toDataURL('image/png')

  // --- LRC ---
  const lrc = Array.from({length: 14}, (_, i) =>
    '[00:' + String(i*2).padStart(2,'0') + '.00] 测试歌词第' + (i+1) + '行 Stage Lyrics ' + (i+1)
  ).join('\\n')

  const song = { id: 'harness-1', name: '粒子测试音', artist: 'CDP Harness', album: 'Verification', duration: 30, cover: coverUrl, url: wavUrl, platform: 'local' }
  const ps = stores.usePlayerStore
  ps.setState({ currentSong: song, playlist: [song], isPlaying: true, isLoading: false, playbackSessionKey: 'harness-' + Date.now(), lyricData: { lyric: lrc }, lyrics: lrc })
  const audio = ps.getState().audioRef
  audio.src = wavUrl
  audio.loop = true
  await audio.play()
  stores.useUIStore.getState().setLyricsPlayerMode('mineradio')
  stores.useUIStore.getState().setShowLyricsPanel(true)
  return 'ok audio.paused=' + audio.paused
})()`, true)
console.log('SETUP:', JSON.stringify(setup))

await sleep(5000)

// 3. 检查引擎与渲染统计
const probe = await evaluate(`(() => {
  const overlay = document.querySelector('.mineradio-player')
  const canvas = overlay && overlay.querySelector('#canvas-container canvas')
  const snap = window.__mineradioPerfSnapshot ? window.__mineradioPerfSnapshot() : null
  return JSON.stringify({
    overlay: !!overlay,
    canvas: !!canvas,
    canvasSize: canvas ? canvas.width + 'x' + canvas.height : '',
    albumBgVisible: overlay ? overlay.querySelector('#album-bg').className : '',
    render: snap && snap.render, renderer: snap && snap.renderer,
  })
})()`)
console.log('PROBE:', probe.value || JSON.stringify(probe))

await screenshot('01-initial-preset')

// 4. 逐预设截图（DOM 点击 preset-card；卡片 data-preset 属性即预设号）
const presetOrder = [0, 1, 2, 4, 5, 6]
for (const p of presetOrder) {
  const r = await evaluate(`(() => {
    const card = document.querySelector('.mineradio-player .preset-card[data-preset="${p}"]')
    if (!card) return 'no-card'
    card.click()
    return 'clicked'
  })()`)
  await sleep(2600)
  const stats = await evaluate(`JSON.stringify((window.__mineradioPerfSnapshot && window.__mineradioPerfSnapshot().renderer) || {})`)
  console.log(`PRESET ${p}: ${r.value} renderer=${stats.value}`)
  await screenshot(`02-preset-${p}`)
}

// 5. 沉浸模式 + 歌词进度截图
await evaluate(`document.querySelector('.mineradio-player #immersive-btn')?.click()`)
await sleep(1800)
await screenshot('03-immersive')
await evaluate(`(() => {
  const s = window.__sollinStores.usePlayerStore.getState()
  s.audioRef.currentTime = 9.2
  return 'seeked'
})()`)
await sleep(2200)
await screenshot('04-lyrics-mid')

console.log('CONSOLE LOG DUMP (last 80):')
consoleLogs.slice(-80).forEach((l) => console.log('  ', l.slice(0, 300)))
writeFileSync(`${OUT_DIR}/console.log`, consoleLogs.join('\n'))
ws.close()
process.exit(0)
