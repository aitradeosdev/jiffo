/* ================= UI parts: helpers, map, slider, chat and cards ================= */
const { useState, useEffect, useRef, useLayoutEffect, useSyncExternalStore } = React;
const html = htm.bind(React.createElement);
const useS = () => useSyncExternalStore(store.sub, store.get);
const Ic = ({ n, s = 22, w = 1.85 }) => html`<svg width=${s} height=${s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth=${w} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML=${{ __html:ICONS[n] }}></svg>`;
const Raw = ({ svg, cls, style }) => html`<span className=${cls} style=${style} aria-hidden="true" dangerouslySetInnerHTML=${{ __html:svg }}></span>`;
const Face = ({ who, cls = '' }) => html`<span className=${'av ' + cls} aria-hidden="true" dangerouslySetInnerHTML=${{ __html:face(who) }}></span>`;
const Glyph = () => html`<span className="glyph" aria-hidden="true" dangerouslySetInnerHTML=${{ __html:GLYPH }}></span>`;
const Segs = ({ i }) => html`<div className="segs" role="img" aria-label=${`Step ${Math.max(0, i) + 1} of 5: ${STEPS[Math.max(0, i)]}`}>${STEPS.map((_, k) => html`<i key=${k} className=${k < i ? 'done' : k === i ? 'now' : ''}></i>`)}</div>`;
const Verified = ({ s = 16 }) => html`<span className="vf" title="ID and selfie verified"><${Ic} n="verified" s=${s} w=${1.8}/></span>`;
function useTween(v, ms = 320) {
  const [x, setX] = useState(v), from = useRef(v);
  useEffect(() => {
    if (RM) { setX(v); from.current = v; return; }
    const a = from.current, t0 = performance.now(); let raf;
    const step = t => { const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3); setX(a + (v - a) * e); if (k < 1) raf = requestAnimationFrame(step); else from.current = v; };
    raf = requestAnimationFrame(step); return () => cancelAnimationFrame(raf);
  }, [v]);
  return x;
}

/* map scenes */
function sceneFor(kind, s) {
  const a = AGENTS[s.agentId]; MAP.avatar(a.face, face(a.face));
  const { P, D, ROUTE, APPROACH, HOME_AGENT } = MAP, img = a.face;
  if (kind === 'home') return { key:'home', focus:[[D[0] - 420, D[1] - 260], [D[0] + 360, D[1] + 520]], me:D, nearby:true, maxZ:.9 };
  if (kind === 'review') return { key:'review', focus:ROUTE, route:true, pick:true, drop:true, pickLabel:PL(s.pick).name || 'Pickup', dropLabel:PL(s.drop).name || 'Drop-off', pad:40 };
  if (kind === 'matching') return { key:'match', focus:[[P[0] - 320, P[1] - 300], [P[0] + 320, P[1] + 200]], pulse:P, nearby:true, pick:true, maxZ:1 };
  const items = s.heldItems > 0 || s.waiting === 'item';
  switch (s.phase) {
    case 'accepted': return { key:'l-acc' + img, focus:[HOME_AGENT, P, D], approach:true, route:true, pick:true, drop:true, dropLabel:'Home', agent:{ at:HOME_AGENT, img } };
    case 'started': return items
      ? { key:'l-shop' + img, focus:[P, D], route:true, pick:true, pickLabel:'Buying here', drop:true, dropLabel:'Home', agent:{ at:P, img } }
      : { key:'l-go' + img, focus:[HOME_AGENT, P, D], approach:true, route:true, pick:true, drop:true, dropLabel:'Home', agent:{ path:APPROACH, u0:0, u1:.94, dur:30, img } };
    case 'bought': return { key:'l-way' + img, focus:ROUTE, route:true, pick:true, drop:true, dropLabel:'Home', agent:{ path:ROUTE, u0:0, u1:.93, dur:40, img } };
    default: return { key:'l-drop' + img, focus:[[D[0] - 130, D[1] - 120], [D[0] + 130, D[1] + 110]], drop:true, dropLabel:'Home', agent:{ at:[D[0] - 6, D[1] + 30], img }, maxZ:1.7 };
  }
}
function MapCanvas({ scene, insets, interactive, onUser, apiRef }) {
  const ref = useRef(), m = useRef();
  useEffect(() => { m.current = MAP.create(ref.current, { interactive, onUser }); if (apiRef) apiRef.current = m.current; return () => m.current.destroy(); }, []);
  const ik = JSON.stringify(insets || {});
  useEffect(() => { if (m.current) m.current.scene(scene, insets); }, [scene.key, scene.pickLabel, scene.dropLabel, ik]);
  return html`<canvas ref=${ref} aria-hidden="true"></canvas>`;
}

/* slide to confirm */
function Slide({ label, onDone }) {
  const ref = useRef(), drag = useRef(null);
  const [x, setX] = useState(0), [done, setDone] = useState(false);
  const max = () => (ref.current ? ref.current.clientWidth - 60 : 240);
  const finish = () => { setX(max()); setDone(true); setTimeout(() => { if (onDone() === false) { setDone(false); setX(0); } }, 280); };
  const down = e => { if (done) return; drag.current = { sx:e.clientX, x0:x }; e.currentTarget.setPointerCapture(e.pointerId); };
  const move = e => { if (!drag.current) return; setX(Math.max(0, Math.min(max(), drag.current.x0 + e.clientX - drag.current.sx))); };
  const up = () => { if (!drag.current) return; drag.current = null; if (x > max() * .8) finish(); else setX(0); };
  const tr = drag.current ? 'none' : 'transform .35s var(--ease), width .35s var(--ease)';
  return html`<div ref=${ref} className=${'slider' + (done ? ' done' : '')}>
    <div className="fillbar" style=${{ width:(x + 58) + 'px', transition:tr }}></div>
    <div className="lbl"><span>${done ? 'Requesting…' : label}</span></div>
    <button className="knob" style=${{ transform:`translateX(${x}px)`, transition:tr }} onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up}
      onKeyDown=${e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); finish(); } }} aria-label=${label + '. Slide right or press Enter.'}>
      <${Ic} n=${done ? 'check' : 'right'} s=${22} w=${2.2}/></button>
  </div>`;
}

/* ---------- Chat ---------- */
function ChatThread({ s }) {
  const ref = useRef();
  useLayoutEffect(() => { const el = ref.current; if (el) el.scrollTo({ top:el.scrollHeight, behavior:RM ? 'auto' : 'smooth' }); }, [s.items.length, s.typing, s.etab]);
  const typer = s.typing === 'app' ? html`<${Glyph}/>` : s.typing ? html`<${Face} who=${agent().face}/>` : null;
  return html`<div className="ebody" ref=${ref} aria-live="polite">
    <div className="sysline" style=${{ background:'transparent' }}><${Ic} n="lock" s=${14} w=${2}/><span>Messages and cards here are kept as evidence if there's ever a dispute.</span></div>
    ${s.items.map((it, k) => html`<${Msg} key=${it.id} it=${it} s=${s} first=${!s.items[k - 1] || s.items[k - 1].kind !== it.kind || s.items[k - 1].who !== it.who}/>`)}
    ${s.typing ? html`<div className=${'m ' + s.typing}>${typer}<div className="typing" role="status" aria-label="Typing"><i></i><i></i><i></i></div></div>` : null}
  </div>`;
}
function Msg({ it, s, first }) {
  if (it.kind === 'sys') return html`<div className="sysline"><${Ic} n=${it.icon || 'info'} s=${15} w=${2}/><span>${it.text}</span></div>`;
  if (it.kind === 'user') return html`<div className="m user"><div className="col" style=${{ alignItems:'flex-end' }}>
    ${it.photos ? html`<div className="thumbs">${Array.from({ length:it.photos }, (_, k) => html`<${Raw} key=${k} cls="ph" svg=${PHOTO.receipt}/>`)}</div>` : null}
    <div className="bubble">${it.text}</div></div></div>`;
  const card = it.card ? html`<${Card} it=${it} s=${s}/>` : null;
  if (it.kind === 'app') return html`<div className="m app"><${Glyph}/><div className="col">${it.text ? html`<div className="say" style=${{ fontSize:'14.5px' }}>${it.text}</div>` : null}${card}</div></div>`;
  const a = AGENTS[it.who || s.agentId];
  return html`<div className="m agent">${first ? html`<${Face} who=${a.face}/>` : html`<span className="av" style=${{ visibility:'hidden' }}></span>`}
    <div className="col">${first ? html`<span className="who">${a.first}<${Verified} s=${14}/></span>` : null}${it.text ? html`<div className="bubble">${it.text}</div>` : null}${card}</div></div>`;
}
function Card({ it, s }) {
  const C = { counter:CounterCard, choice:ChoiceCard, item:ItemCard, receipt:ReceiptCard, pin:PinCard, photo:PhotoCard }[it.card];
  return C ? html`<${C} it=${it} s=${s}/>` : null;
}
function CounterCard({ it, s }) {
  const pend = it.st === 'pending', f = svc(it.amt), hold = it.amt + f - (s.promo ? PROMO : 0);
  return html`<div className="card"><div className="cpad">
    <div className="chead"><span className="tile o"><${Ic} n="edit" s=${18}/></span><span className="tx"><b>New price</b><small>Errand fee · allowed until Start service</small></span>
      <span className=${'badge ' + (pend ? 'o' : it.st === 'accepted' ? 'g' : '')}>${pend ? 'Pending' : it.st === 'accepted' ? 'Accepted' : 'Declined'}</span></div>
    <div className="amt-row"><span className="amt">${fmt(it.amt)}</span><s>${fmt(it.was)}</s></div>
    ${pend ? html`<p className="note">The service fee becomes ${fmt(f)}, so ${fmt(hold)} would be held.</p>
      <div className="row2"><button className="btn line" onClick=${() => ACT.declineCounter(it.id)}>Decline</button><button className="btn pri" onClick=${() => ACT.acceptCounter(it.id)}>Accept ${fmt(it.amt)}</button></div>` : null}
  </div></div>`;
}
function ChoiceCard({ it }) {
  const a = AGENTS[it.who || 'a1'];
  if (it.chosen) return html`<div className="card flat"><div className="collapsed"><${Ic} n="check" s=${18} w=${2.2}/><span className="tx">${it.chosen === 'keep' ? `You kept ${a.first} at the old price` : 'You asked for a new agent'}</span></div></div>`;
  return html`<div className="card"><div className="cpad">
    <button className="btn pri block" onClick=${() => ACT.keepAgent(it.id)}>Continue with ${a.first}</button>
    <button className="btn line block" onClick=${() => ACT.newAgent(it.id)}>Get new agent</button>
    <p className="note">A new agent ends this chat and sends your errand back to matching. No fee for you.</p>
  </div></div>`;
}
function ItemCard({ it }) {
  const pend = it.st === 'pending';
  return html`<div className="card"><div className="cpad">
    <div className="chead"><span className="tile g"><${Ic} n="bag" s=${18}/></span><span className="tx"><b>Item amount</b><small>Receipt and photo attached · paid at hand-off</small></span><span className=${'badge ' + (pend ? 'o' : 'g')}>${pend ? 'Pending' : 'Locked'}</span></div>
    ${it.photos ? html`<div className="pics"><div className="ph" style=${{ position:'relative' }}><${Raw} svg=${PHOTO.receipt} style=${{ display:'block', width:'100%', height:'100%' }}/><span className="stamp"><${Ic} n="receipt" s=${12}/>Receipt · 2:31 PM</span></div><div className="ph" style=${{ position:'relative' }}><${Raw} svg=${PHOTO.items} style=${{ display:'block', width:'100%', height:'100%' }}/><span className="stamp"><${Ic} n="camera" s=${12}/>Items · Shoprite</span></div></div>` : null}
    <ul className="lines">${it.lines.map(l => html`<li key=${l[0]}><span>${l[0]}</span><span>${fmt(l[1])}</span></li>`)}<li className="tot"><span>Receipt total</span><span>${fmt(it.amt)}</span></li></ul>
    ${pend ? html`<p className="note">Check the photos match your list. Locking holds this amount until hand-off; nothing is paid to the agent before then.</p>
      <div className="row2"><button className="btn soft" onClick=${ACT.askItem}>Ask in chat</button><button className="btn brand" onClick=${() => ACT.acceptItem(it.id)}><${Ic} n="lock" s=${17}/>Lock ${fmt(it.amt)}</button></div>` : null}
  </div></div>`;
}
function ReceiptCard({ it }) {
  return html`<div className="card"><div className="cpad">
    <div className="chead"><span className="tile"><${Ic} n="receipt" s=${18}/></span><span className="tx"><b>Receipt uploaded</b><small>Shoprite, Lekki · 2:31 PM</small></span></div>
    <div className="pics"><${Raw} cls="ph" svg=${PHOTO.receipt}/><${Raw} cls="ph" svg=${PHOTO.items}/></div>
    <ul className="lines"><li><span>Receipt total</span><span>${fmt(it.total)}</span></li><li><span>Locked</span><span>${fmt(it.locked)}</span></li>${it.back > 0 ? html`<li className="tot"><span>Back to your wallet</span><span style=${{ color:'var(--brand-ink)' }}>+${fmt(it.back)}</span></li>` : null}</ul>
  </div></div>`;
}
function PinCard({ s }) {
  const used = s.phase === 'done', show = s.pinShown || used;
  return html`<div className="card"><div className="cpad">
    <div className="chead"><span className="tile g"><${Ic} n="lock" s=${18}/></span><span className="tx"><b>Your hand-off PIN</b><small>${used ? 'Used at 2:46 PM' : 'Pays your agent the fee and the item money'}</small></span>
      ${used ? null : html`<button className="btn soft sm" onClick=${ACT.togglePin} aria-pressed=${s.pinShown}><${Ic} n=${s.pinShown ? 'eyeoff' : 'eye'} s=${16}/>${s.pinShown ? 'Hide' : 'Show'}</button>`}</div>
    <div className=${'pin' + (show ? '' : ' hidden')} aria-label=${show ? 'PIN 4 8 2 7' : 'PIN hidden'}>${'4827'.split('').map((d, k) => html`<span key=${k}>${show ? d : '•'}</span>`)}</div>
    ${used ? null : html`<p className="note">Share it only when you have everything. Not home? Ask for a no-contact drop-off here in the chat.</p>`}
  </div></div>`;
}
function PhotoCard({ it }) {
  const pend = it.st === 'pending';
  return html`<div className="card">
    <div className="mapbox" style=${{ height:'180px' }}><${Raw} cls="ph" style=${{ position:'absolute', inset:0, borderRadius:0, aspectRatio:'auto' }} svg=${PHOTO.gate}/><span className="stamp"><${Ic} n="pin" s=${13}/>12 Admiralty Way · 2:41 PM · GPS checked</span></div>
    <div className="cpad">
      <div className="chead"><span className="tx"><b>No-contact drop-off</b><small>Taken in the app at your drop-off</small></span><span className=${'badge ' + (pend ? 'o' : it.st === 'approved' ? 'g' : 'r')}>${pend ? 'Pending' : it.st === 'approved' ? 'Approved' : 'Disputed'}</span></div>
      ${pend ? html`<p className="note">Nothing is paid until you approve. If you don't respond, it approves itself in 24 hours.</p>
        <div className="row2"><button className="btn line" onClick=${() => ACT.disputePhoto(it.id)}>Dispute</button><button className="btn pri" onClick=${() => ACT.approvePhoto(it.id)}>Approve</button></div>` : null}
    </div></div>`;
}
