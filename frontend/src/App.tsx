import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CHAIN_ID, CONTRACT_ADDRESS, EXPLORER,
  explorerAddress, explorerTx, short,
  readDuels, readDuelCount, readLeaderboard, readPlayer, readDuel,
  waitFinal, injectedProvider, connectWalletAddress, ensureStudionet,
  snapClient, ephemeralClient, ephemeralAddress, errorCode,
} from './genlayer'
import { locales, type Locale } from './i18n'
import { startAmbient, stopAmbient, playFinalizedCue, isManualOff, setManualOff } from './sound'

const PRICE_SOURCES = [
  { url: 'https://api.coindesk.com/v1/bpi/currentprice/USD.json', label: 'CoinDesk', parse: (d: any) => d?.bpi?.USD?.rate_float ?? d?.bpi?.USD?.rate },
  { url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd', label: 'CoinGecko', parse: (d: any) => d?.bitcoin?.usd },
]
const COINDESK_URL = 'https://api.coindesk.com/v1/bpi/currentprice/USD.json'
const COINGECKO_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd'

type TxState = { kind: string; hash: string; stage: 'submitted' | 'waiting' | 'finalized' | 'error'; detail?: string } | null

function Reveal({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setInView(true); return }
    const obs = new IntersectionObserver((es) => { if (es[0].isIntersecting) { setInView(true); obs.disconnect() } }, { threshold: 0.12 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  return <div ref={ref} className={`reveal${inView ? ' in' : ''}`}>{children}</div>
}

function useTilt() {
  const fine = useMemo(() => typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches && !window.matchMedia('(prefers-reduced-motion: reduce)').matches, [])
  return (e: React.MouseEvent<HTMLElement>) => {
    if (!fine) return
    const el = e.currentTarget
    const r = el.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width - 0.5
    const y = (e.clientY - r.top) / r.height - 0.5
    el.style.transform = `perspective(900px) rotateX(${(-y * 4).toFixed(2)}deg) rotateY(${(x * 5).toFixed(2)}deg) translateY(-2px)`
  }
}
function untilt(e: React.MouseEvent<HTMLElement>) { e.currentTarget.style.transform = '' }

export default function App() {
  const [lang, setLang] = useState<Locale>(() => (navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en')
  const t = locales[lang]
  const [splash, setSplash] = useState(() => {
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('df-splash-seen')) return false
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
    return true
  })
  const [soundOn, setSoundOn] = useState(false)
  const [duels, setDuels] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [board, setBoard] = useState<any[]>([])
  const [nextId, setNextId] = useState<number | null>(null)
  const [price, setPrice] = useState<{ value: number; source: string; at: string } | null>(null)
  const [priceErr, setPriceErr] = useState(false)

  const [wallet, setWallet] = useState<string | null>(null)
  const [mode, setMode] = useState<'snap' | 'ephemeral' | null>(null)
  const [ephAddr, setEphAddr] = useState<string | null>(null)
  const [snapFailed, setSnapFailed] = useState(false)
  const [chainOk, setChainOk] = useState<boolean | null>(null)
  const [myPlayer, setMyPlayer] = useState<any>(null)

  const [threshold, setThreshold] = useState(80000)
  const [thresholdCustom, setThresholdCustom] = useState(false)
  const [side, setSide] = useState<'YES' | 'NO'>('YES')
  const [stake, setStake] = useState(100)
  const [createId, setCreateId] = useState('')

  const snapRef = useRef<any>(null)
  const [tx, setTx] = useState<TxState>(null)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [reveal, setReveal] = useState<any>(null)
  const [status, setStatus] = useState('')

  const tilt = useTilt()
  const glowRef = useRef<HTMLDivElement>(null)

  const dismissSplash = useCallback(() => {
    setSplash(false)
    try { sessionStorage.setItem('df-splash-seen', '1') } catch { /* noop */ }
  }, [])
  useEffect(() => {
    if (!splash) return
    const timer = setTimeout(dismissSplash, 6000)
    return () => clearTimeout(timer)
  }, [splash, dismissSplash])

  // Sound: auto-enable on first click anywhere except the sound button.
  // Never auto-re-enables after a manual close.
  useEffect(() => {
    const onFirstClick = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('[data-sound-btn]')) return
      if (isManualOff()) return
      startAmbient()
      setSoundOn(true)
    }
    document.addEventListener('click', onFirstClick, { capture: true, once: true })
    return () => document.removeEventListener('click', onFirstClick, { capture: true })
  }, [])
  const toggleSound = () => {
    if (soundOn) { stopAmbient(); setManualOff(true); setSoundOn(false) }
    else { setManualOff(false); startAmbient(); setSoundOn(true) }
  }

  // Cursor glow — fine pointers only.
  useEffect(() => {
    if (!window.matchMedia('(pointer: fine)').matches) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const move = (e: MouseEvent) => {
      if (glowRef.current) glowRef.current.style.transform = `translate(${e.clientX - 180}px, ${e.clientY - 180}px)`
    }
    window.addEventListener('mousemove', move)
    return () => window.removeEventListener('mousemove', move)
  }, [])

  const loadAll = useCallback(async () => {
    setLoading(true); setLoadError('')
    try {
      const [d, b, c] = await Promise.all([readDuels(), readLeaderboard(), readDuelCount()])
      setDuels([...d].reverse())
      setBoard(b)
      setNextId(c)
      if (!createId) setCreateId(String(c))
    } catch (e: any) {
      setLoadError(t.err_generic)
    } finally { setLoading(false) }
  }, [createId, t.err_generic])
  useEffect(() => { loadAll() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const loadPrice = useCallback(async () => {
    for (const src of PRICE_SOURCES) {
      try {
        const res = await fetch(src.url)
        if (!res.ok) continue
        const data = await res.json()
        const raw = src.parse(data)
        const value = typeof raw === 'string' ? parseFloat(raw.replace(/,/g, '')) : Number(raw)
        if (Number.isFinite(value) && value > 0) {
          setPrice({ value: Math.floor(value), source: src.label, at: new Date().toLocaleTimeString() })
          setPriceErr(false)
          return
        }
      } catch { /* try next source */ }
    }
    setPriceErr(true)
  }, [])
  useEffect(() => { loadPrice(); const id = setInterval(loadPrice, 60000); return () => clearInterval(id) }, [loadPrice])

  const refreshMine = useCallback(async (addr: string | null) => {
    if (!addr) { setMyPlayer(null); return }
    try { setMyPlayer(await readPlayer(addr)) } catch { setMyPlayer(null) }
  }, [])

  async function doConnect() {
    setError(''); setSnapFailed(false)
    try {
      const address = await connectWalletAddress()
      setWallet(address); setChainOk(true)
      try {
        snapRef.current = await snapClient(address)
        setMode('snap')
        setStatus(t.walletConnected)
        refreshMine(address)
      } catch (snapErr: any) {
        setSnapFailed(true)
        setError(t.snapFailed)
      }
    } catch (e: any) {
      const code = errorCode(e)
      setError((t as any)[`err_${code}`] || t.err_generic)
    }
  }

  function doTestAccount() {
    const { address } = ephemeralClient()
    setEphAddr(address); setMode('ephemeral'); setSnapFailed(false); setError('')
    setStatus(`${t.writingAsTest} ${short(address)}`)
    refreshMine(address)
  }

  async function doSwitchNetwork() {
    try { await ensureStudionet(injectedProvider()); setChainOk(true); setError('') }
    catch (e: any) { setError((t as any)[`err_${errorCode(e)}`] || t.err_generic) }
  }

  async function runWrite(kind: string, fn: (client: any) => Promise<string>, after: () => Promise<void>) {
    setError(''); setTx(null); setReveal(null); setStatus('')
    let client: any
    if (mode === 'ephemeral') client = ephemeralClient().client
    else if (mode === 'snap' && wallet) {
      // Reuse the Snap session from connect; re-establish only if lost.
      if (!snapRef.current) {
        try { snapRef.current = await snapClient(wallet) } catch (e: any) { setSnapFailed(true); setError(t.snapFailed); return }
      }
      client = snapRef.current
    } else { setError(t.youConnect); return }
    try {
      const hash = await fn(client)
      setTx({ kind, hash, stage: 'submitted' })
      setStatus(t.txRequest)
      await waitFinal(hash, (s) => {
        setTx((prev) => prev ? { ...prev, stage: s === 'finalized' ? 'finalized' : 'waiting' } : prev)
        setStatus(s === 'finalized' ? t.txFinalized : t.txWaiting)
      })
      playFinalizedCue()
      setTx((prev) => prev ? { ...prev, stage: 'finalized' } : prev)
      setStatus(t.txFinalized)
      await after()
      await loadAll()
    } catch (e: any) {
      const code = errorCode(e)
      setError((t as any)[`err_${code}`] || t.err_generic)
      setTx((prev) => prev ? { ...prev, stage: 'error' } : prev)
      setStatus('')
    }
  }

  async function doCreate() {
    if (!/^\d+$/.test(createId.trim())) { setError(t.err_id_number); return }
    if (threshold <= 0) { setError(t.err_threshold_positive); return }
    if (stake <= 0) { setError(t.err_stake_positive); return }
    const id = Number(createId)
    setBusyId('create')
    await runWrite(`Create #${id}`, async (client) =>
      client.writeContract({ address: CONTRACT_ADDRESS, functionName: 'create_duel', args: [BigInt(id), BigInt(threshold), side, BigInt(stake)], value: 0n, leaderOnly: false }),
      async () => { refreshMine(mode === 'ephemeral' ? ephemeralAddress() : wallet) })
    setBusyId(null)
  }

  async function doJoin(duel: any) {
    const opposite = duel.creator_side === 'YES' ? 'NO' : 'YES'
    setBusyId(`join-${duel.id}`)
    await runWrite(`Join #${duel.id}`, async (client) =>
      client.writeContract({ address: CONTRACT_ADDRESS, functionName: 'join_duel', args: [BigInt(duel.id), opposite], value: 0n, leaderOnly: false }),
      async () => { refreshMine(mode === 'ephemeral' ? ephemeralAddress() : wallet) })
    setBusyId(null)
  }

  async function doSettle(duel: any) {
    setBusyId(`settle-${duel.id}`)
    await runWrite(`Settle #${duel.id}`, async (client) =>
      client.writeContract({ address: CONTRACT_ADDRESS, functionName: 'settle_duel', args: [BigInt(duel.id)], value: 0n, leaderOnly: false }),
      async () => {
        const fresh = await readDuel(Number(duel.id))
        setReveal(fresh)
        refreshMine(mode === 'ephemeral' ? ephemeralAddress() : wallet)
      })
    setBusyId(null)
  }

  const actingAddress = mode === 'ephemeral' ? ephAddr : wallet
  const canWrite = mode !== null

  return (
    <div className="app">
      <div ref={glowRef} className="glow" aria-hidden="true" />
      {splash && (
        <div className="splash" role="dialog" aria-label="DuelForge">
          <div className="splash-mark">⚒</div>
          <h1>{t.splashTitle}</h1>
          <p>{t.splashSub}</p>
          <button className="btn ember big" onClick={dismissSplash}>{t.splashEnter}</button>
          <button className="linklike" onClick={dismissSplash}>{t.splashSkip}</button>
        </div>
      )}

      <header className="topbar">
        <a className="brand" href="#top">⚒ DUEL<span>FORGE</span></a>
        <div className="top-actions">
          <span className="net-badge">{t.networkBadge}</span>
          <button className="chip" data-sound-btn onClick={toggleSound} aria-pressed={soundOn} title={soundOn ? t.soundOn : t.soundOff}>
            {soundOn ? '🔊' : '🔇'} <span className="hide-sm">{soundOn ? t.soundOn : t.soundOff}</span>
          </button>
          <div className="lang" role="group" aria-label="Language">
            <button className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')}>{t.langEn}</button>
            <button className={lang === 'zh' ? 'active' : ''} onClick={() => setLang('zh')}>{t.langZh}</button>
          </div>
          {wallet || mode === 'ephemeral' ? (
            <span className="wallet-chip" title={actingAddress || ''}>
              {mode === 'ephemeral' ? `🧪 ${short(ephAddr || '')}` : `⬡ ${short(wallet || '')}`}
            </span>
          ) : (
            <button className="btn ember" onClick={doConnect}>{t.walletConnect}</button>
          )}
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <p className="kicker">{t.tagline}</p>
          <h1>{t.heroTitle}</h1>
          <p className="hero-sub">{t.heroSub}</p>
          <div className="hero-actions">
            <a className="btn ember big magnetic" href="#arena">{t.heroCta}</a>
            <a className="btn ghost big" href="#forge">{t.forgeTitle} →</a>
          </div>
          <div className="vs-strip" aria-hidden="true">
            <div className="vs-side yes"><span>YES</span><small>BTC ↑</small></div>
            <div className="vs-mid">VS</div>
            <div className="vs-side no"><span>NO</span><small>BTC ↓</small></div>
          </div>
          <div className="price-ticker">
            <span className="price-label">{t.priceLabel}</span>
            {price ? (
              <span className="price-value">${price.value.toLocaleString()} <small>USD</small></span>
            ) : (
              <span className="price-value dim">{priceErr ? t.priceUnavailable : '…'}</span>
            )}
            {price && <span className="price-meta">{t.priceSource}: {price.source} · {t.priceUpdated} {price.at}</span>}
            <p className="price-note">{t.priceNote}</p>
          </div>
        </section>

        {(tx || error || status) && (
          <section className="tx-panel" aria-live="polite">
            <div className="tx-steps">
              <span className={tx ? 'on' : ''}>① {t.txRequest}</span>
              <span className={tx && (tx.stage === 'waiting' || tx.stage === 'finalized') ? 'on' : ''}>② {t.txWaiting}</span>
              <span className={tx && tx.stage === 'finalized' ? 'done' : ''}>③ {t.txFinalized}</span>
            </div>
            {tx && <p>{tx.kind} · <a href={explorerTx(tx.hash)} target="_blank" rel="noreferrer">{t.txView}: {short(tx.hash)}</a></p>}
            {status && <p className="status-line">{status}</p>}
            {error && <p className="error" role="alert">{error}</p>}
          </section>
        )}

        {reveal && (
          <section className="reveal-panel">
            <h2>🏆 {t.revealTitle} — #{reveal.id}</h2>
            <p className="reveal-big">{t.revealWinner} <strong>{reveal.winner_side}</strong> {t.revealSide}</p>
            <p>{t.winner}: {short(reveal.winner || '')} · {t.pool}: {reveal.pool} TEST · {t.threshold}: ${Number(reveal.threshold).toLocaleString()}</p>
            <p className="muted">{t.revealReadback}</p>
          </section>
        )}

        <Reveal>
          <section id="arena" className="section">
            <div className="section-head">
              <div><h2>{t.arenaTitle}</h2><p className="muted">{t.arenaSub}</p></div>
              <button className="btn ghost" onClick={loadAll} disabled={loading}>{t.refresh}</button>
            </div>
            <p className="muted small">{t.demoNote}</p>
            {loading ? (
              <div className="grid" aria-busy="true">
                {[0, 1].map((i) => <div key={i} className="card skeleton"><div className="sk-line big" /><div className="sk-line" /><div className="sk-line" /></div>)}
              </div>
            ) : loadError ? (
              <p className="error" role="alert">{loadError}</p>
            ) : duels.length === 0 ? (
              <div className="empty"><p>⚒</p><p>{t.noDuels}</p></div>
            ) : (
              <div className="grid">
                {duels.map((d) => (
                  <article key={d.id} className={`card status-${d.status}`} onMouseMove={tilt} onMouseLeave={untilt}>
                    <div className="card-top">
                      <span className="duel-id">#{d.id}</span>
                      <span className={`pill ${d.status}`}>{(t as any)[`status${d.status}`] || d.status}</span>
                    </div>
                    <h3>BTC {d.creator_side === 'YES' ? '>' : '≤'} ${Number(d.threshold).toLocaleString()}</h3>
                    <p className="muted">{d.creator_side === 'YES' ? t.sideYES : t.sideNO} · {lang === 'zh' ? '发起方' : 'creator'} {d.creator_side}</p>
                    <dl>
                      <div><dt>{t.threshold}</dt><dd>${Number(d.threshold).toLocaleString()}</dd></div>
                      <div><dt>{t.stake}</dt><dd>{d.stake} TEST</dd></div>
                      <div><dt>{t.pool}</dt><dd>{d.pool || d.stake * 2} TEST</dd></div>
                      <div><dt>{t.creator}</dt><dd>{short(d.creator)}</dd></div>
                      {d.joiner && <div><dt>{t.joiner}</dt><dd>{short(d.joiner)}</dd></div>}
                      {d.status === 'SETTLED' && <div><dt>{t.winnerSide}</dt><dd><strong>{d.winner_side}</strong> · {short(d.winner || '')}</dd></div>}
                    </dl>
                    {d.status === 'OPEN' && (
                      <>
                        <button className="btn ember full" disabled={!canWrite || busyId === `join-${d.id}`} onClick={() => doJoin(d)}>
                          {busyId === `join-${d.id}` ? t.txWaiting : t.join}
                        </button>
                        <p className="muted small">{t.joinHint}</p>
                      </>
                    )}
                    {d.status === 'STAKED' && (
                      <>
                        <button className="btn gold full" disabled={!canWrite || busyId === `settle-${d.id}`} onClick={() => doSettle(d)}>
                          {busyId === `settle-${d.id}` ? t.txWaiting : t.settle}
                        </button>
                        <p className="muted small">{t.settleHint}</p>
                      </>
                    )}
                    {!canWrite && d.status !== 'SETTLED' && <p className="muted small">{t.youConnect}</p>}
                  </article>
                ))}
              </div>
            )}
          </section>
        </Reveal>

        <Reveal>
          <section id="forge" className="section forge">
            <h2>{t.forgeTitle}</h2>
            <p className="muted">{t.forgeSub}</p>
            <div className="forge-grid">
              <label>{t.duelId}
                <input inputMode="numeric" value={createId} onChange={(e) => setCreateId(e.target.value)} placeholder={nextId !== null ? String(nextId) : ''} />
                <small>{t.duelIdHint}</small>
              </label>
              <div className="field">{t.threshold}
                <div className="presets">
                  {[50000, 80000, 100000].map((v) => (
                    <button key={v} className={!thresholdCustom && threshold === v ? 'active' : ''} onClick={() => { setThreshold(v); setThresholdCustom(false) }}>${v.toLocaleString()}</button>
                  ))}
                  <button className={thresholdCustom ? 'active' : ''} onClick={() => setThresholdCustom(true)}>{lang === 'zh' ? '自定义' : 'Custom'}</button>
                </div>
                {thresholdCustom && <input type="number" min={1} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />}
                {!thresholdCustom && <p className="big-num">${threshold.toLocaleString()}</p>}
              </div>
              <div className="field">{t.yourSide}
                <div className="side-toggle">
                  <button className={side === 'YES' ? 'yes active' : 'yes'} onClick={() => setSide('YES')}>YES</button>
                  <button className={side === 'NO' ? 'no active' : 'no'} onClick={() => setSide('NO')}>NO</button>
                </div>
                <small>{side === 'YES' ? t.sideYES : t.sideNO}</small>
              </div>
              <label>{t.stakeSlider}
                <input type="range" min={10} max={500} step={10} value={stake} onChange={(e) => setStake(Number(e.target.value))} />
                <span className="big-num">{stake} TEST</span>
                <small>{t.poolPreview} {stake * 2} TEST</small>
              </label>
            </div>
            <button className="btn ember big" disabled={!canWrite || busyId === 'create'} onClick={doCreate}>
              {busyId === 'create' ? t.txWaiting : t.create}
            </button>
            <p className="muted small">{t.createHint}</p>
            {!canWrite && <p className="muted">{t.youConnect}</p>}
          </section>
        </Reveal>

        <Reveal>
          <section className="section wallet-panel">
            <h2>{wallet ? t.walletConnected : t.walletConnect}</h2>
            {wallet && <p>{short(wallet)} · <a href={explorerAddress(wallet)} target="_blank" rel="noreferrer">{t.txContract}</a></p>}
            {chainOk === false && <p className="error">{t.networkWrong} <button className="btn ghost" onClick={doSwitchNetwork}>{t.switchNetwork}</button></p>}
            {!wallet && <button className="btn ember" onClick={doConnect}>{t.walletConnect}</button>}
            {snapFailed && <p className="error" role="alert">{t.snapFailed}</p>}
            {(snapFailed || !wallet) && (
              <div className="test-box">
                <p><strong>🧪 {t.testAccount}</strong></p>
                <p className="muted small">{t.testAccountBlurb}</p>
                <button className="btn gold" onClick={doTestAccount}>{t.testAccount}</button>
              </div>
            )}
            {mode === 'ephemeral' && ephAddr && (
              <p className="test-banner" role="note">🧪 {t.writingAsTest} <a href={explorerAddress(ephAddr)} target="_blank" rel="noreferrer">{short(ephAddr)}</a> {t.writingAsNote}</p>
            )}
            {mode === 'snap' && wallet && <p className="muted small">⬡ {t.writingAsWallet} {short(wallet)}</p>}
            <div className="you-box">
              <h3>{t.youTitle}</h3>
              {!actingAddress ? <p className="muted">{t.youConnect}</p>
                : myPlayer ? (myPlayer.exists
                  ? <p>{short(myPlayer.address)} · {t.balance}: <strong>{myPlayer.balance} TEST</strong> · {t.wins} {myPlayer.wins} · {t.losses} {myPlayer.losses}</p>
                  : <p className="muted">{t.youNew}</p>)
                : <p className="muted">…</p>}
            </div>
          </section>
        </Reveal>

        <Reveal>
          <section className="section">
            <h2>{t.boardTitle}</h2>
            <p className="muted">{t.boardSub}</p>
            {board.length === 0 ? <div className="empty"><p>{t.noPlayers}</p></div> : (
              <div className="board" role="table">
                <div className="board-row head" role="row"><span>{t.rank}</span><span>{t.player}</span><span>{t.balance}</span><span>{t.wins}</span><span>{t.losses}</span></div>
                {board.map((p, i) => (
                  <div key={p.address} className={`board-row${actingAddress && p.address.toLowerCase() === actingAddress.toLowerCase() ? ' me' : ''}`} role="row">
                    <span>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}</span>
                    <span><a href={explorerAddress(p.address)} target="_blank" rel="noreferrer">{short(p.address)}</a></span>
                    <span>{p.balance} TEST</span><span>{p.wins}</span><span>{p.losses}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </Reveal>

        <Reveal>
          <section className="section trust">
            <h2>{t.honestTitle}</h2>
            <ul>
              <li>{t.honestWallet}</li>
              <li>{t.honestMobile}</li>
              <li>{t.honestTest}</li>
            </ul>
            <h2>{t.sourcesTitle}</h2>
            <ul>
              <li>{t.sourcesPrice}: <a href={COINDESK_URL} target="_blank" rel="noreferrer">CoinDesk BTC/USD</a> · <a href={COINGECKO_URL} target="_blank" rel="noreferrer">CoinGecko simple price</a></li>
              <li>{t.sourcesContract}: <a href={explorerAddress(CONTRACT_ADDRESS)} target="_blank" rel="noreferrer">{t.txContract}: {short(CONTRACT_ADDRESS)}</a> · <a href={EXPLORER} target="_blank" rel="noreferrer">explorer-studio.genlayer.com</a></li>
            </ul>
            <p className="muted small">{t.footerNote}</p>
          </section>
        </Reveal>
      </main>

      <footer className="foot">
        <span>⚒ DUELFORGE</span>
        <a href={explorerAddress(CONTRACT_ADDRESS)} target="_blank" rel="noreferrer">{t.txContract}</a>
        <span className="muted small">{t.footerNote}</span>
      </footer>
    </div>
  )
}
