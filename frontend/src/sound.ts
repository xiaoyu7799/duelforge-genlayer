// DuelForge sound: synthesized in-browser, never autoplayed on load.
// Auto-enable on the user's first click (button state synced); a manual
// close is never overridden by a later auto-enable.
let ctx: AudioContext | null = null
let ambientNodes: { osc: OscillatorNode[]; gain: GainNode } | null = null
let manualOff = false

function ensureCtx(): AudioContext | null {
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch { return null }
}

export function isManualOff() { return manualOff }
export function setManualOff(v: boolean) { manualOff = v }

export function startAmbient() {
  const ac = ensureCtx()
  if (!ac || ambientNodes) return
  const gain = ac.createGain()
  gain.gain.value = 0.0
  const filter = ac.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 320
  const oscs = [55, 55.7, 110.3].map((f) => {
    const o = ac.createOscillator()
    o.type = 'sine'
    o.frequency.value = f
    o.connect(filter)
    o.start()
    return o
  })
  filter.connect(gain)
  gain.connect(ac.destination)
  gain.gain.linearRampToValueAtTime(0.035, ac.currentTime + 1.2)
  ambientNodes = { osc: oscs, gain }
}

export function stopAmbient() {
  if (!ctx || !ambientNodes) return
  const { osc, gain } = ambientNodes
  try { gain.gain.linearRampToValueAtTime(0.0, ctx.currentTime + 0.4) } catch { /* noop */ }
  const stopAt = ctx.currentTime + 0.5
  osc.forEach((o) => { try { o.stop(stopAt) } catch { /* noop */ } })
  ambientNodes = null
}

export function playFinalizedCue() {
  const ac = ensureCtx()
  if (!ac) return
  ;[523.25, 783.99].forEach((f, i) => {
    const o = ac.createOscillator()
    const g = ac.createGain()
    o.type = 'triangle'
    o.frequency.value = f
    const t = ac.currentTime + i * 0.16
    g.gain.setValueAtTime(0.0, t)
    g.gain.linearRampToValueAtTime(0.12, t + 0.02)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5)
    o.connect(g)
    g.connect(ac.destination)
    o.start(t)
    o.stop(t + 0.55)
  })
}
