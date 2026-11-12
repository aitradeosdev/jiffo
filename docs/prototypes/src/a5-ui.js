/* ================= Agent UI: helpers and main screens ================= */
const { useState, useEffect, useRef, useLayoutEffect, useSyncExternalStore } = React;
const html = htm.bind(React.createElement);
const useS = () => useSyncExternalStore(store.sub, store.get);
const Ic = ({ n, s = 22, w = 1.85 }) => html`<svg width=${s} height=${s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth=${w} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML=${{ __html:ICONS[n] }}></svg>`;
const Raw = ({ svg, cls, style }) => html`<span className=${cls} style=${style} aria-hidden="true" dangerouslySetInnerHTML=${{ __html:svg }}></span>`;
const Face = ({ who, cls = '' }) => html`<span className=${'av ' + cls} aria-hidden="true" dangerouslySetInnerHTML=${{ __html:face(who) }}></span>`;
const Glyph = () => html`<span className="glyph" aria-hidden="true" dangerouslySetInnerHTML=${{ __html:GLYPH }}></span>`;
const Segs = ({ i }) => html`<div className="segs" role="img" aria-label=${`Step ${Math.max(0, i) + 1} of 5: ${STEPS[Math.max(0, i)]}`}>${STEPS.map((_, k) => html`<i key=${k} className=${k < i ? 'done' : k === i ? 'now' : ''}></i>`)}</div>`;
const Verified = ({ s = 16 }) => html`<span className="vf"><${Ic} n="verified" s=${s} w=${1.8}/></span>`;
const EtaBox = ({ st }) => st.eta ? html`<span className="eta-box">${st.eta}<small>min</small></span>` : null;
const Row = ({ ic, t, sub, on, cls = '', icls = '', right }) => html`<button className=${'li ' + cls} onClick=${on}><span className=${'ico ' + icls}><${Ic} n=${ic} s=${19}/></span><span className="tx"><span className="t">${t}</span>${sub ? html`<small>${sub}</small>` : null}</span>${right !== undefined ? right : (cls === 'dang' ? null : html`<${Ic} n="chev" s=${18}/>`)}</button>`;
function useHeight() { const ref = useRef(), [h, setH] = useState(320); useLayoutEffect(() => { if (ref.current && Math.abs(ref.current.offsetHeight - h) > 4) setH(ref.current.offsetHeight); }); return [ref, h]; }
const mmss = v => `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;

/* map */
function scene(kind, s) {
  MAP.avatar('chinedu', face('chinedu'));
  const { P, D, ROUTE, APPROACH, HOME_AGENT:HA, POIS } = MAP, img = 'chinedu';
  if (kind === 'off') return { key:'off', focus:[[HA[0] - 320, HA[1] - 320], [HA[0] + 320, HA[1] + 260]], agent:{ at:HA, img }, maxZ:.95 };
  if (kind === 'board') {
    const spots = [[0, P, true], [1, POIS[2].p], [2, POIS[1].p], [3, POIS[3].p]].filter(([id]) => matches(BOARD[id], s.prefs));
    return { key:'board' + spots.map(x => x[0]).join(''), focus:[HA, P, POIS[1].p, POIS[2].p, POIS[3].p], pad:90, agent:{ at:HA, img },
      tags:spots.map(([id, p, hot]) => ({ p, text:fmt(BOARD[id].fee), hot:!!hot })) };
  }
  if (kind === 'request') return { key:'req', focus:[HA, P, D], approach:true, route:true, pick:true, drop:true, pickLabel:'Pickup', dropLabel:'Drop-off', agent:{ at:HA, img } };
  const base = { route:true, pick:true, drop:true, pickLabel:'Shoprite', dropLabel:'Tolu' };
  switch (s.phase) {
    case 'accepted': return { ...base, key:'t-acc', focus:[HA, P, D], approach:true, agent:{ at:HA, img } };
    case 'started': return { ...base, key:'t-go', focus:[HA, P, D], approach:true, agent:{ path:APPROACH, u0:0, u1:1, dur:24, img } };
    case 'itemsent': return { ...base, key:'t-shop', focus:[P, D], agent:{ at:P, img } };
    case 'bought': return { ...base, key:'t-way', focus:ROUTE, agent:{ path:ROUTE, u0:0, u1:.97, dur:36, img } };
    default: return { ...base, key:'t-drop', focus:[[D[0] - 130, D[1] - 120], [D[0] + 130, D[1] + 110]], agent:{ at:[D[0] - 6, D[1] + 28], img }, maxZ:1.7 };
  }
}
function MapCanvas({ sc, insets, interactive, apiRef }) {
  const ref = useRef(), m = useRef();
  useEffect(() => { m.current = MAP.create(ref.current, { interactive }); if (apiRef) apiRef.current = m.current; return () => m.current.destroy(); }, []);
  const ik = JSON.stringify(insets || {});
  useEffect(() => { if (m.current) m.current.scene(sc, insets); }, [sc.key, ik]);
  return html`<canvas ref=${ref} aria-hidden="true"></canvas>`;
}

/* ---------- Home ---------- */
function JobRow({ j }) {
  const c = CAT(j.cat);
  return html`<button className="job" onClick=${() => ACT.openJob(j.id)}><span className="thumb">${j.art ? html`<${Raw} svg=${ART[j.art]}/>` : html`<${Ic} n=${c.ic} s=${24}/>`}</span>
    <span className="tx"><b>${j.title}</b><small>${c.short} · ${j.km} km errand · ${j.to} km away${j.sched ? ' · ' + j.when : ''}</small>
      <span className="tags">${j.urgent ? html`<span className="badge o"><${Ic} n="zap" s=${11}/>Urgent</span>` : null}${j.buy ? html`<span className="badge g"><${Ic} n="bag" s=${11}/>Buying items</span>` : null}<span className="badge">${j.rating} ★ ${j.name}</span></span></span>
    <span className="fee">${fmt(j.fee)}</span></button>`;
}
function Home({ s }) {
  const [ref, h] = useHeight();
  const mine = BOARD.filter(j => matches(j, s.prefs)), hidden = BOARD.length - mine.length;
  let list = mine.slice();
  if (s.filter === 'near') list.sort((a, b) => a.to - b.to);
  if (s.filter === 'fee') list.sort((a, b) => b.fee - a.fee);
  if (s.filter === 'buy') list = list.filter(j => j.buy);
  if (s.filter === 'sched') list = list.filter(j => j.sched);
  const live = !['idle', 'request', 'done'].includes(s.phase), st = stageInfo(s);
  const sc = s.sheet && (s.sheet.type === 'request' || (s.sheet.type === 'job' && s.sheet.id === 0)) ? scene('request', s) : scene(s.online ? 'board' : 'off', s);
  return html`<div className="fill">
    <${MapCanvas} interactive=${true} sc=${sc} insets=${{ t:70, b:h + 72, l:24, r:24 }}/>
    <button className="avbtn" onClick=${() => ACT.tab('account')} aria-label="Account"><${Face} who="chinedu"/></button>
    <button className="toppill" onClick=${() => ACT.tab('earnings')} aria-label=${`Today's earnings, ${fmt(s.today)}`}>${fmt(s.today)}<small>today</small></button>
    ${!s.online ? html`<button className="gobtn" style=${{ bottom:(h + 90) + 'px' }} onClick=${ACT.goOnline} aria-label="Go online">GO</button>` : null}
    <section className="sheet" ref=${ref} style=${{ bottom:'var(--tabh)', maxHeight:s.online ? '58%' : 'none' }}>
      <span className="handle"></span>
      ${live ? html`<button className="livecard" onClick=${ACT.openTrip}><${Face} who="tolu" cls="lg"/><span className="tx"><b>${st.title}</b><${Segs} i=${st.i}/></span><${Ic} n="chev" s=${20}/></button>` : null}
      ${s.online ? html`
        <div className="statline"><span className="dotst on"></span><span className="tx"><h1 className="t2">You're online</h1><span className="sub">Errands within 5 km of you</span></span><button className="chip" onClick=${ACT.goOffline}><${Ic} n="power" s=${16}/>Go offline</button></div>
        <div className="chips"><button className="chip" onClick=${ACT.prefs} aria-label="Errand preferences"><${Ic} n="tune" s=${16}/>Preferences</button>${FILTERS.map(([k, l]) => html`<button key=${k} className="chip" aria-pressed=${s.filter === k} onClick=${() => ACT.filter(k)}>${l}</button>`)}</div>
        ${hidden ? html`<button className="hiddenrow" onClick=${ACT.prefs}><${Ic} n="eyeoff" s=${17}/><span className="tx">${hidden} errand${hidden > 1 ? 's' : ''} nearby left out by your preferences<small>${prefLine(s.prefs)}</small></span><${Ic} n="chev" s=${18}/></button>` : null}
        <div className="list">${list.length ? list.map(j => html`<${JobRow} key=${j.id} j=${j}/>`) : html`<p className="sub" style=${{ textAlign:'center', padding:'16px 0' }}>No errands match this filter right now.</p>`}</div>` : html`
        <div className="statline"><span className="dotst"></span><span className="tx"><h1 className="t2">You're offline</h1><span className="sub">Go online to see errands near you. Your location is shared only while online or on an errand.</span></span></div>
        <button className="tierrow" onClick=${() => ACT.tab('earnings')}><span className="medal">B</span><span className="tx"><b>Bronze · 18 of 25 errands to Silver</b><span className="bar1"><span style=${{ width:'72%' }}></span></span></span><${Ic} n="chev" s=${18}/></button>
        <p className="note" style=${{ display:'flex', gap:'8px' }}><${Ic} n="face" s=${17}/><span>Your first time online today starts a quick selfie check, matched to your ID.</span></p>`}
    </section>
  </div>`;
}
function Selfie({ s }) {
  const st = s.selfie;
  return html`<section className="selfie" role="dialog" aria-label="Selfie check">
    <button className="ib" onClick=${ACT.close} aria-label="Close"><${Ic} n="x"/></button>
    <div style=${{ display:'flex', flexDirection:'column', alignItems:'center', gap:'20px' }}>
      <div><h1 className="t1" style=${{ color:'inherit' }}>Daily selfie check</h1><p>We match it to your ID photo before you go online.</p></div>
      <div className=${'oval' + (st === 'ok' ? ' ok' : '')} aria-hidden="true">${st === 'ok' ? html`<${Ic} n="check" s=${64} w=${2.2}/>` : html`<${Ic} n="face" s=${96} w=${1.2}/>`}</div>
      <p aria-live="polite" style=${{ minHeight:'20px' }}>${st === 'checking' ? 'Checking your selfie…' : st === 'ok' ? 'Matched to your ID. Going online.' : 'Good light, face the camera, no cap or sunglasses.'}</p>
    </div>
    <button className="btn block" style=${{ background:'#FFFFFF', color:'#000000', maxWidth:'340px' }} disabled=${st !== 'idle'} onClick=${ACT.takeSelfie}>${st === 'idle' ? 'Take selfie' : st === 'checking' ? 'Checking…' : 'Matched'}</button>
  </section>`;
}

/* ---------- Trip (errand tracker) ---------- */
function Primary({ s }) {
  const p = s.phase;
  if (p === 'accepted') return html`<div className="block">${s.pending ? html`<div className="waiting"><span className="spinner"></span><span className="tx"><b>Waiting for Tolu to answer ${fmt(s.pending)}</b><small>They see it as a popup</small></span></div>` : null}
    <div className="row2"><button className="btn soft" disabled=${!!s.pending} onClick=${ACT.counterSheet}><${Ic} n="edit" s=${18}/>New price</button><button className="btn pri" disabled=${!!s.pending} onClick=${ACT.askStart}><${Ic} n="play" s=${18}/>Start service</button></div></div>`;
  if (p === 'started') return html`<div className="block"><button className="btn pri block" onClick=${ACT.openItem}><${Ic} n="camera" s=${19}/>Send item amount</button><p className="note" style=${{ textAlign:'center' }}>After paying, add the receipt and a photo of the items.</p></div>`;
  if (p === 'itemsent') return html`<div className="waiting"><span className="spinner"></span><span className="tx"><b>Waiting for Tolu to lock ${fmt(s.itemAmt)}</b><small>If they don't within 30 minutes, our team steps in</small></span></div>`;
  if (p === 'bought') return html`<button className="btn pri block" onClick=${ACT.askDelivered}><${Ic} n="check" s=${19}/>Mark delivered</button>`;
  if (p === 'delivered') return html`<div className="block"><button className="btn pri block" onClick=${ACT.openPin}><${Ic} n="lock" s=${19}/>Enter Tolu's PIN</button>
    <div className="row2"><button className="btn soft" onClick=${() => ACT.camera('drop')}><${Ic} n="camera" s=${18}/>Drop-off photo</button><button className="btn soft" onClick=${ACT.notAnswering}><${Ic} n="clock" s=${18}/>Not answering</button></div></div>`;
  if (p === 'photo') return html`<div className="waiting"><span className="spinner"></span><span className="tx"><b>Waiting for Tolu to approve your photo</b><small>It approves itself after 24 hours</small></span></div>`;
  if (p === 'unreachable') return html`<button className="btn soft block" onClick=${() => set({ screen:'wait' })}>See what happens next</button>`;
  return null;
}
function Trip({ s }) {
  const st = stageInfo(s), box = useRef(), drag = useRef(null), top = useRef(), chips = useRef(), n = net(s.agreed), c = CAT(BOARD[0].cat);
  const [H, setH] = useState(844), [topH, setTopH] = useState(260), [peek, setPeek] = useState(260);
  useLayoutEffect(() => {
    if (box.current) setH(box.current.clientHeight);
    if (top.current && top.current.offsetHeight !== topH) setTopH(top.current.offsetHeight);
    if (chips.current) { const p = chips.current.offsetTop + chips.current.offsetHeight + 20; if (Math.abs(p - peek) > 1) setPeek(p); }
  });
  const sheetH = s.expanded ? H - topH - 24 : peek;
  const down = e => { drag.current = { y:e.clientY, d:0 }; e.currentTarget.setPointerCapture(e.pointerId); };
  const move = e => { if (drag.current) drag.current.d = e.clientY - drag.current.y; };
  const up = () => { if (!drag.current) return; const d = drag.current.d; drag.current = null; if (Math.abs(d) < 6) ACT.expand(); else ACT.expand(d < 0); };
  return html`<div className="mapscreen" ref=${box}>
    <${MapCanvas} interactive=${true} sc=${scene('trip', s)} insets=${{ t:topH + 30, b:peek + 16, l:36, r:36 }}/>
    <section className="tcard" ref=${top} aria-live="polite" aria-label="Errand status">
      <div className="tcrow">
        <button className="ib" onClick=${ACT.close} aria-label="Back to home"><${Ic} n="down" s=${24}/></button><span className="grow"></span>
        <span className="pillbtn earn" title="You earn on this errand"><${Ic} n="wallet" s=${16}/>${fmt(n)}</span>
        <button className="pillbtn sos" onClick=${() => ACT.sheet('sos')}><${Ic} n="shield" s=${16}/>Safety</button>
      </div>
      <span className=${'tchip ' + (st.chip ? st.chip[1] : 'k')}>${st.chip && st.chip[1] === 'g' && s.phase !== 'done' ? html`<span className="dot"></span>` : null}${st.chip ? st.chip[0] : ''}</span>
      <h1 className="tbig">${st.big || st.title}</h1>
      <p className="tsub">${st.tsub || st.sub}</p>
      <${TBar} i=${st.i}/>
      <div className="tagent">
        <button className="who" onClick=${() => ACT.sheet('cust')} aria-label="Tolu A., see profile"><${Face} who="tolu"/><span className="tx"><b>${CUST.short}<${Verified} s=${15}/><span className="rt"><${StarF} s=${12}/>${CUST.rating}</span></b><small>${st.doing || ''}</small></span></button>
        <button className="cbtn" onClick=${ACT.openChat} aria-label=${`Chat with Tolu${s.unread ? `, ${s.unread} unread` : ''}`}><${Ic} n="chat" s=${20}/>${s.unread ? html`<span className="n">${s.unread}</span>` : null}</button>
        <button className="cbtn" onClick=${() => ACT.call(true)} aria-label="Call Tolu"><${Ic} n="phone" s=${20}/></button>
      </div>
    </section>
    <section className="trip" style=${{ height:sheetH + 'px' }} aria-label="Errand details">
      <div className="grabzone" onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up} role="button" tabIndex="0" aria-label=${s.expanded ? 'Show more map' : 'Show more details'} onKeyDown=${e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ACT.expand(); } }}><span className="handle"></span></div>
      <div className="body">
        <${Primary} s=${s}/>
        <button className="errcard" onClick=${() => ACT.expand(true)} aria-label="Errand details">
          <span className="tile"><${Ic} n=${c.ic} s=${20}/></span>
          <span className="tx"><b>Shoprite to Admiralty Way</b><small>${c.short} · you buy items · 4.2 km</small></span>
          <span className="held"><b>${fmt(n)}</b><small>you earn</small></span>
        </button>
        <div className="qchips" ref=${chips}>
          ${st.next ? html`<button className="chip" onClick=${() => ACT.directions(st.next)}><${Ic} n="nav" s=${16}/>Directions</button>` : null}
          <button className="chip" onClick=${() => ACT.expand(true)}><${Ic} n="doc" s=${16}/>Details</button>
          <button className="chip" onClick=${() => toast('Report started', 'Our team reviews the chat and GPS trail')}><${Ic} n="flag" s=${16}/>Report</button>
        </div>
        <div className="divider"></div>
        <div className="block"><h2 className="sec">Stops</h2>
          <div className="stoplist"><span className="mk pick"></span><span><b>Shoprite</b><small>Lekki–Epe Expressway, Lekki</small></span><button className="btn sm soft" onClick=${() => ACT.directions('Shoprite, Lekki')}><${Ic} n="nav" s=${15}/>Go</button>
            <span className="rail"></span><span></span><span></span>
            <span className="mk drop"></span><span><b>12 Admiralty Way</b><small>Lekki Phase 1</small></span><button className="btn sm soft" onClick=${() => ACT.directions('12 Admiralty Way')}><${Ic} n="nav" s=${15}/>Go</button></div></div>
        <div className="block"><h2 className="sec">Errand</h2><p style=${{ margin:0 }}>${DESC}</p></div>
        <div className="block"><h2 className="sec">Your earnings</h2>
          <ul className="lines"><li><span>Errand fee</span><span>${fmt(s.agreed)}</span></li><li><span>Commission (${ME.tier}, ${Math.round(COMMISSION * 100)}%)</span><span>−${fmt(s.agreed - n)}</span></li>${s.itemAmt ? html`<li><span>Items, paid back at hand-off</span><span>${fmt(s.itemAmt)}</span></li>` : null}<li className="tot"><span>You earn</span><span>${fmt(n)}</span></li></ul></div>
        <div className="list"><${Row} ic="x" t="Cancel errand" sub=${s.phase === 'accepted' ? 'Sends a cancellation request to Tolu' : 'Items are bought: open a dispute instead'} on=${() => toast('Cancellation request sent', 'Tolu accepts or rejects it')}/></div>
      </div>
    </section>
  </div>`;
}

/* ---------- Chat ---------- */
function Msg({ it }) {
  if (it.kind === 'sys') return html`<div className="sysline"><${Ic} n=${it.icon || 'info'} s=${14} w=${2}/><span>${it.text}</span></div>`;
  if (it.kind === 'them') return html`<div className="m agent"><${Face} who="tolu" cls="sm"/><div className="col"><div className="bubble">${it.text}</div></div></div>`;
  if (!it.card) return html`<div className="m user"><div className="col"><div className="bubble">${it.text}</div></div></div>`;
  const badge = st => html`<span className=${'badge ' + (st === 'pending' ? 'o' : st === 'declined' ? '' : 'g')}>${st === 'pending' ? 'Pending' : st === 'declined' ? 'Declined' : st === 'approved' ? 'Approved' : it.card === 'item' ? 'Locked' : 'Accepted'}</span>`;
  let body = null;
  if (it.card === 'counter') body = html`<div className="cpad"><div className="chead"><span className="tile o"><${Ic} n="edit" s=${18}/></span><span className="tx"><b>You sent a new price</b><small>Errand fee</small></span>${badge(it.st)}</div><div className="amt-row"><span className="amt">${fmt(it.amt)}</span><s>${fmt(it.was)}</s></div></div>`;
  if (it.card === 'item') body = html`<div className="cpad"><div className="chead"><span className="tile g"><${Ic} n="bag" s=${18}/></span><span className="tx"><b>Item amount</b><small>${it.noReceipt ? 'Price tags' : 'Receipt'} and items photo attached</small></span>${badge(it.st)}</div>
    <div className="pics"><${Raw} cls="ph" svg=${PHOTO.receipt}/><${Raw} cls="ph" svg=${PHOTO.items}/></div>
    <ul className="lines">${it.lines.map(l => html`<li key=${l[0]}><span>${l[0]}</span><span>${fmt(l[1])}</span></li>`)}<li className="tot"><span>Total</span><span>${fmt(it.amt)}</span></li></ul></div>`;
  if (it.card === 'photo') body = html`<div><div className="mapbox" style=${{ height:'160px' }}><${Raw} cls="ph" style=${{ position:'absolute', inset:0, borderRadius:0, aspectRatio:'auto' }} svg=${PHOTO.gate}/><span className="stamp"><${Ic} n="pin" s=${12}/>12 Admiralty Way · GPS checked</span></div><div className="cpad"><div className="chead"><span className="tx"><b>Drop-off photo</b><small>Tolu approves it before you're paid</small></span>${badge(it.st)}</div></div></div>`;
  return html`<div className="m user"><div className="col" style=${{ width:'86%' }}><div className="card">${body}</div></div></div>`;
}
function Chat({ s }) {
  const st = stageInfo(s), ref = useRef(), ta = useRef();
  useLayoutEffect(() => { const el = ref.current; if (el) el.scrollTo({ top:el.scrollHeight, behavior:RM ? 'auto' : 'smooth' }); }, [s.items.length, s.typing]);
  useLayoutEffect(() => { const el = ta.current; if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px'; } }, [s.chat]);
  return html`<div className="chat">
    <header className="chathead"><button className="ib" onClick=${ACT.closeChat} aria-label="Back"><${Ic} n="back" s=${24}/></button>
      <button className="chatwho" onClick=${() => ACT.sheet('cust')} aria-label="Tolu A., see profile"><${Face} who="tolu"/><span className="tx"><b>${CUST.short}<${Verified} s=${16}/></b><small>${CUST.rating} ★ · ${st.title}</small></span></button>
      <button className="ib" onClick=${() => ACT.call(true)} aria-label="Call Tolu in the app"><${Ic} n="phone" s=${21}/></button></header>
    <button className="pinned" style=${{ border:'none', textAlign:'left', width:'100%' }} onClick=${ACT.openTrip}><span className="tx"><b>Shoprite to 12 Admiralty Way</b><${Segs} i=${st.i}/></span><${Ic} n="map" s=${18}/></button>
    <div className="ebody" ref=${ref} aria-live="polite">
      <div className="sysline"><${Ic} n="lock" s=${14} w=${2}/><span>Messages and cards here are kept as evidence if there's ever a dispute.</span></div>
      ${s.items.map(it => html`<${Msg} key=${it.id} it=${it}/>`)}
      ${s.typing ? html`<div className="m agent"><${Face} who="tolu" cls="sm"/><div className="typing" role="status" aria-label="Typing"><i></i><i></i><i></i></div></div>` : null}
    </div>
    <div className="edock">
      <div className="hints">${QUICK.map(q => html`<button key=${q} className="hint-chip" onClick=${() => ACT.sendChat(q)}>${q}</button>`)}</div>
      <div className="composer">
        <button className="cb" aria-label="More actions" onClick=${() => ACT.sheet('plus')}><${Ic} n="plus"/></button>
        <label className="sr" htmlFor="chatbox">Message Tolu</label>
        <textarea id="chatbox" ref=${ta} rows="1" placeholder="Message Tolu" value=${s.chat} onChange=${e => set({ chat:e.target.value })} onKeyDown=${e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ACT.sendChat(); } }}></textarea>
        <button className="cb" aria-label="Record a voice note" onClick=${() => toast('Hold to record a voice note', 'It sends like a message')}><${Ic} n="mic"/></button>
        <button className="cb send" aria-label="Send" disabled=${!s.chat.trim()} onClick=${() => ACT.sendChat()}><${Ic} n="up" s=${20} w=${2.4}/></button>
      </div>
    </div>
  </div>`;
}

/* ---------- Item amount, camera, PIN, wait, done ---------- */
function ItemScreen({ s }) {
  const it = s.item, total = it.lines.reduce((a, l) => a + (Number(l[1]) || 0), 0), ready = it.receipt && it.photo && total > 0;
  const tile = (k, title, sub, svg) => it[k]
    ? html`<div className="capt done"><${Raw} cls="shot" svg=${svg}/><span className="ok"><${Ic} n="check" s=${15} w=${3}/></span><button className="retake" style=${{ border:'none' }} onClick=${() => ACT.camera(k)}><${Ic} n="camera" s=${13}/>Retake</button></div>`
    : html`<button className="capt" onClick=${() => ACT.camera(k)}><span className="ico k" style=${{ width:'48px', height:'48px' }}><${Ic} n="camera" s=${22}/></span>${title}<small>${sub}</small></button>`;
  return html`<div className="screen">
    <header className="phead"><button className="ib" onClick=${() => set({ screen:'trip' })} aria-label="Back"><${Ic} n="back" s=${24}/></button><h1>Item amount</h1><span style=${{ width:'44px' }}></span></header>
    <div className="pbody">
      <p className="sub">Add the photos, check the amounts, then send it. Tolu checks your photos before locking the money.</p>
      <div className="capgrid">
        ${tile('receipt', it.noReceipt ? 'Price tags photo' : 'Receipt photo', it.noReceipt ? 'Items with their prices' : 'The whole receipt in frame', PHOTO.receipt)}
        ${tile('photo', 'Items photo', 'Everything you bought', PHOTO.items)}
      </div>
      <div className="trow" style=${{ display:'flex', alignItems:'center', gap:'12px' }}><span className="tx" style=${{ flex:1 }}><b id="norc">No receipt?</b><small className="note" style=${{ display:'block' }}>Open markets often give none. Use a photo of the price tags or the vendor instead.</small></span><button className="switch" role="switch" aria-checked=${it.noReceipt} aria-labelledby="norc" onClick=${ACT.toggleNoReceipt}></button></div>
      <div className="block"><h2 className="sec">Items</h2>
        ${it.lines.map((l, k) => html`<div key=${k} className="lineedit"><label className="sr" htmlFor=${'n' + k}>Item ${k + 1}</label><input id=${'n' + k} value=${l[0]} onChange=${e => ACT.line(k, 0, e.target.value)}/><label className="sr" htmlFor=${'a' + k}>Amount for item ${k + 1}</label><input id=${'a' + k} className="amtin" inputMode="numeric" value=${l[1]} onChange=${e => ACT.line(k, 1, e.target.value)}/></div>`)}
        <ul className="lines"><li className="tot"><span>${it.noReceipt ? 'Total you paid' : 'Receipt total'}</span><span>${fmt(total)}</span></li></ul></div>
      <p className="note">You've paid with your own money. Tolu has 30 minutes to lock it, or it goes to our team. You're paid this at hand-off, withdrawable at once.</p>
    </div>
    <footer className="sfoot"><button className="btn pri block" disabled=${!ready} onClick=${ACT.sendItem}>${ready ? `Send to Tolu · ${fmt(total)}` : `Add ${!it.receipt && !it.photo ? 'both photos' : !it.receipt ? (it.noReceipt ? 'the price tags photo' : 'the receipt photo') : 'the items photo'} to send`}</button></footer>
  </div>`;
}
function Camera({ s }) {
  const k = s.cameraFor, svg = k === 'drop' ? PHOTO.gate : k === 'photo' ? PHOTO.items : PHOTO.receipt;
  const tip = k === 'drop' ? html`<${Ic} n="pin" s=${14}/>12 Admiralty Way · 14 m from the drop-off pin <${Ic} n="check" s=${14} w=${2.6}/>` : k === 'photo' ? 'Show everything you bought' : s.item.noReceipt ? 'Show the items with their price tags' : 'Fit the whole receipt in the frame';
  return html`<section className="cam" role="dialog" aria-label="Camera">
    <div className="top"><button className="ib" onClick=${() => set({ screen:k === 'drop' ? 'trip' : 'item' })} aria-label="Close"><${Ic} n="x"/></button><span style=${{ fontWeight:700 }}>${k === 'drop' ? 'Drop-off photo' : k === 'photo' ? 'Items photo' : s.item.noReceipt ? 'Price tags photo' : 'Receipt photo'}</span><span style=${{ width:'44px' }}></span></div>
    <div className=${'vf' + (s.shot ? '' : ' live')} role="img" aria-label=${s.shot ? 'Photo taken' : 'Camera view'}><${Raw} cls="shot" svg=${svg}/>${s.shot ? null : html`<span className="guide"></span>`}<span className="chipc">${tip}</span></div>
    <p>${s.shot ? 'Make sure it is sharp and readable.' : 'Photos are taken in the app. Gallery uploads aren’t allowed.'}</p>
    ${s.shot ? html`<div className="row2" style=${{ width:'100%', maxWidth:'340px' }}><button className="btnw" style=${{ flex:1 }} onClick=${ACT.retake}>Retake</button><button className="btnw pri" style=${{ flex:1 }} onClick=${ACT.usePhoto}>${k === 'drop' ? 'Send photo' : 'Use photo'}</button></div>` : html`<button className="shutter" onClick=${ACT.shutter} aria-label="Take photo"><span></span></button>`}
  </section>`;
}
function Pin({ s }) {
  return html`<div className="screen">
    <header className="phead"><button className="ib" onClick=${() => set({ screen:'trip' })} aria-label="Back"><${Ic} n="back" s=${24}/></button><h1>Hand-off PIN</h1><span style=${{ width:'44px' }}></span></header>
    <div className="pbody" style=${{ justifyContent:'center', gap:'22px' }}>
      <div style=${{ textAlign:'center' }}><h2 className="t1">Enter Tolu's PIN</h2><p className="sub">It pays you ${fmt(s.agreed)} for the errand${s.itemAmt ? ` and ${fmt(s.itemAmt)} for the items` : ''}.</p></div>
      <div className=${'pinbox' + (s.pinErr ? ' err' : '')} aria-label=${`${s.pin.length} of 4 digits entered`}>${[0, 1, 2, 3].map(k => html`<span key=${k} className=${k < s.pin.length ? 'on' : ''}>${s.pin[k] ? '•' : ''}</span>`)}</div>
      <p className="errtxt" aria-live="assertive">${s.pinErr ? "That PIN doesn't match. Ask Tolu to check it in their app." : ''}</p>
      <div className="keys">${['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => html`<button key=${d} onClick=${() => ACT.key(d)}>${d}</button>`)}<span></span><button onClick=${() => ACT.key('0')}>0</button><button className="ghost" onClick=${ACT.del} aria-label="Delete"><${Ic} n="backspace" s=${26}/></button></div>
    </div>
  </div>`;
}
function Wait({ s }) {
  const ready = s.wait <= 0 && s.calls > 0;
  if (s.phase === 'unreachable') return html`<div className="screen">
    <header className="phead"><button className="ib" onClick=${() => set({ screen:'trip' })} aria-label="Back"><${Ic} n="back" s=${24}/></button><h1>Customer unreachable</h1><span style=${{ width:'44px' }}></span></header>
    <div className="pbody"><h2 className="t1">Tolu has 24 hours to arrange redelivery or collection</h2>
      <ul className="pnotes" style=${{ fontSize:'15px' }}><li>Keep the items safe until then.</li><li>A redelivery pays the same errand fee you agreed.</li><li>If nothing is arranged, the errand fee and the item money are released to you, and you keep the items.</li><li>Our team sees this case and can step in at any time.</li></ul>
      <div className="waiting"><${Ic} n="clock" s=${20}/><span className="tx"><b>Auto-release in 23 h 59 min</b><small>Unless Tolu disputes or our team steps in</small></span></div></div>
    <footer className="sfoot"><button className="btn pri block" onClick=${ACT.toBoard}>Back to the board</button></footer></div>`;
  const R = 95, C = 2 * Math.PI * R;
  return html`<div className="screen">
    <header className="phead"><button className="ib" onClick=${() => set({ screen:'trip' })} aria-label="Back"><${Ic} n="back" s=${24}/></button><h1>Waiting at the drop-off</h1><span style=${{ width:'44px' }}></span></header>
    <div className="pbody" style=${{ gap:'22px' }}>
      <div className="timer" role="timer" aria-label="Time left to wait"><svg width="210" height="210" viewBox="0 0 210 210" aria-hidden="true"><circle cx="105" cy="105" r=${R} fill="none" stroke="var(--surface-3)" strokeWidth="10"/><circle cx="105" cy="105" r=${R} fill="none" stroke="var(--ink)" strokeWidth="10" strokeLinecap="round" strokeDasharray=${C} strokeDashoffset=${C * (1 - Math.max(0, s.wait) / 600)}/></svg><div className="t"><b>${mmss(Math.max(0, s.wait))}</b><span className="sub">left to wait</span></div></div>
      <p className="sub" style=${{ textAlign:'center' }}>You're at 12 Admiralty Way. Call Tolu at least once. After 10 minutes you can mark them unreachable.</p>
      <div className="row2"><button className="btn soft" onClick=${() => ACT.call(true)}><${Ic} n="phone" s=${18}/>Call Tolu${s.calls ? ` (${s.calls})` : ''}</button><button className="btn soft" onClick=${ACT.openChat}><${Ic} n="chat" s=${18}/>Message</button></div>
    </div>
    <footer className="sfoot"><button className="btn dang block" disabled=${!ready} onClick=${ACT.markUnreachable}>Mark customer unreachable</button></footer></div>`;
}
function Done({ s }) {
  const n = net(s.agreed);
  return html`<div className="screen">
    <div className="pbody" style=${{ paddingTop:'28px', gap:'20px' }}>
      <div className="hero"><span className="tick"><${Ic} n="check" s=${36} w=${2.8}/></span><h1 className="t1 num">${fmt(n + s.tip)} earned</h1><p className="sub">${s.method === 'photo' ? 'Drop-off photo approved by Tolu' : 'Hand-off confirmed with Tolu’s PIN'}</p></div>
      <div className="block"><h2 className="sec">This errand</h2>
        <ul className="lines"><li><span>Errand fee</span><span>${fmt(s.agreed)}</span></li><li><span>Commission (${ME.tier}, ${Math.round(COMMISSION * 100)}%)</span><span>−${fmt(s.agreed - n)}</span></li>${s.tip ? html`<li><span>Tip from Tolu</span><span>${fmt(s.tip)}</span></li>` : null}<li className="tot"><span>Your earnings</span><span>${fmt(n + s.tip)}</span></li></ul>
        <p className="note">Withdrawable tomorrow at 2:46 PM. Silver and above get errand earnings instantly.</p></div>
      ${s.itemAmt ? html`<div className="waiting" style=${{ background:'var(--brand-soft)' }}><${Ic} n="check" s=${20} w=${2.4}/><span className="tx"><b>${fmt(s.itemAmt)} item money paid back</b><small>Withdrawable now. You spent your own money, so it never waits.</small></span></div>` : null}
      <div className="block" style=${{ alignItems:'center', textAlign:'center' }}><${Face} who="tolu" cls="lg"/><h2 className="t2">How was Tolu?</h2>
        <div className="stars" role="group" aria-label="Rating">${[1, 2, 3, 4, 5].map(k => html`<button key=${k} aria-pressed=${k <= s.rating} aria-label=${`${k} star${k > 1 ? 's' : ''}`} onClick=${() => ACT.star(k)}><${Ic} n="star" s=${34} w=${1.6}/></button>`)}</div></div>
    </div>
    <footer className="sfoot"><div className="row2"><button className="btn soft" onClick=${() => { ACT.toBoard(); ACT.tab('earnings'); }}>Earnings</button><button className="btn pri" onClick=${ACT.toBoard}>Back to the board</button></div></footer>
  </div>`;
}
