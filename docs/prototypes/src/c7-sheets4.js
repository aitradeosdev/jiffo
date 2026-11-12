/* ================= Sheets, overlays, root, panel ================= */
function BottomSheet({ label, onClose, children }) {
  const [dy, setDy] = useState(0), st = useRef(null);
  const down = e => { st.current = { y:e.clientY }; e.currentTarget.setPointerCapture(e.pointerId); };
  const move = e => { if (st.current) setDy(Math.max(0, e.clientY - st.current.y)); };
  const up = () => { if (!st.current) return; st.current = null; if (dy > 90) onClose(); else setDy(0); };
  return html`<button className="scrim" onClick=${onClose} aria-label="Close"></button>
    <section className="bsheet" role="dialog" aria-label=${label} style=${{ transform:`translateY(${dy}px)`, transition:st.current ? 'none' : 'transform .28s var(--ease)' }}>
      <div className="grabzone" onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up}><span className="handle"></span></div>
      ${children}
    </section>`;
}
function CopyBtn({ text }) {
  const [ok, setOk] = useState(false);
  const run = e => {
    const b = e.currentTarget, done = () => { setOk(true); setTimeout(() => setOk(false), 1500); };
    const pick = () => { const r = document.createRange(); r.selectNodeContents(b.previousSibling); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done).catch(pick); else pick();
  };
  return html`<button className="btn line sm" onClick=${run}><${Ic} n=${ok ? 'check' : 'copy'} s=${15}/>${ok ? 'Copied' : 'Copy'}</button>`;
}
function Sheet({ s }) {
  const t = s.sheet.type, a = agent(), close = ACT.closeSheet;
  const [code, setCode] = useState('LEKKI300');
  let body = null, label = '';
  if (t === 'stop') {
    const w = s.sheet.which, opts = w === 'pick' ? ['shoprite', 'circle', 'medplus', 'gig', 'home'] : ['home', 'work', 'medplus', 'circle'], cur = w === 'pick' ? s.pick : s.drop;
    label = w === 'pick' ? 'Choose pickup' : 'Choose drop-off';
    body = html`<h2 className="h2">${label}</h2>
      <label className="field"><${Ic} n="search" s=${20}/><span className="sr">Search a place</span><input placeholder="Search a place or address"/></label>
      <div className="sec">${w === 'pick' ? 'Nearby' : 'Saved and recent'}</div>
      <div className="list">${opts.map(k => html`<button key=${k} className="li" onClick=${() => ACT.chooseStop(k)}><span className=${'tile' + (cur === k ? ' g' : '')}><${Ic} n=${cur === k ? 'check' : PL(k).icon} s=${19}/></span><span className="tx">${PL(k).name}<small>${PL(k).addr}</small></span>${PL(k).km ? html`<span className="km note num">${PL(k).km}</span>` : null}</button>`)}</div>
      <button className="btn line block"><${Ic} n="map" s=${18}/>Set on the map</button>`;
  }
  if (t === 'cats') {
    label = 'Choose a category';
    body = html`<div><h2 className="h2">Choose a category</h2><p className="sub">Only agents who take this category get your request.</p></div>
      <div className="list">${CATS.map(c => html`<button key=${c.k} className="li" onClick=${() => ACT.pickCat(c.k)}><span className=${'ico' + (s.cat === c.k ? ' k' : '')}><${Ic} n=${s.cat === c.k ? 'check' : c.ic} s=${19}/></span><span className="tx"><b>${c.name}</b><small>${c.eg}</small></span>${c.buy ? html`<span className="badge">Buys items</span>` : null}</button>`)}</div>`;
  }
  if (t === 'promo') { label = 'Promo code'; body = html`<h2 className="h2">Add a promo code</h2><p className="sub">One code per errand. We fund the discount, so your agent is paid in full.</p>
    <label className="field"><${Ic} n="gift" s=${20}/><span className="sr">Promo code</span><input value=${code} onChange=${e => setCode(e.target.value.toUpperCase())}/></label>
    <button className="btn pri block" disabled=${code !== 'LEKKI300'} onClick=${ACT.applyPromo}>Apply</button><p className="note">Try LEKKI300 in this prototype.</p>`; }
  if (t === 'when') { label = 'When'; body = html`<h2 className="h2">When do you need it?</h2>
    <div className="list"><button className="li" onClick=${() => { ACT.setWhen('now'); close(); }}><span className=${'tile' + (s.when === 'now' ? ' g' : '')}><${Ic} n="zap" s=${19}/></span><span className="tx">Now<small>Matched with an agent right away</small></span></button>
    <button className="li" onClick=${() => { ACT.setWhen('later'); close(); }}><span className=${'tile' + (s.when === 'later' ? ' g' : '')}><${Ic} n="cal" s=${19}/></span><span className="tx">Sat, 14 Nov · 10:00 AM<small>Goes on the board ahead of time</small></span></button></div>`; }
  if (t === 'topup' && s.idState === 'pending') { label = 'Add money'; body = html`<h2 className="h2">Your account number is on its way</h2><p className="sub">It's issued once our team approves your ID, usually within ${CONFIG.reviewHours} hours. We'll text you.</p><button className="btn pri block" onClick=${close}>OK</button>`; }
  else if (t === 'topup') { label = 'Add money'; body = html`<div><h2 className="h2">${s.sheet.shortBy ? `Add ${fmt(s.sheet.shortBy)} to continue` : 'Add money'}</h2><p className="sub">Transfer from any bank app to your own account number. It's yours alone, so we know the money is from you.</p></div>
    <div className="acctbig"><span><small>Wema Bank · account number</small><b>781 024 5913</b><small>Jiffo – Tolu Adebayo</small></span><${CopyBtn} text="7810245913"/></div>
    <button className="btn soft block" onClick=${() => toast('Account details ready to share', 'Bank, account number and name')}><${Ic} n="share" s=${18}/>Share account details</button>
    <ol className="nsteps"><li>Open your bank app and send money to the account above.</li><li>It usually shows here within a minute. We'll notify you.</li><li>Cards aren't accepted. Transfers of ₦10,000 or more carry ₦50 stamp duty from your bank.</li></ol>
    <button className="btn pri block" onClick=${ACT.sentMoney}>I've sent the money</button>`; }
  if (t === 'txn') {
    const x = s.tx[s.sheet.k] || {}, isIn = x.a > 0; label = x.n || 'Transaction';
    body = html`<div className="txhead"><span className=${'tile' + (isIn ? ' g' : '')} style=${{ width:'56px', height:'56px', borderRadius:'16px' }}><${Ic} n=${x.i} s=${26}/></span><div className="amt">${isIn ? '+' : '−'}${fmt(Math.abs(x.a || 0))}</div><b>${x.n}</b><small>${x.day || 'Today'} · ${x.d}</small><span className="badge g"><${Ic} n="check" s=${12} w=${2.6}/>Completed</span></div>
      <div className="kv"><div><span>Type</span><b>${TXTYPE[x.i] || 'Wallet'}</b></div>${x.i === 'bank' ? html`<div><span>From</span><b>GTBank •••• 0193</b></div>` : null}<div><span>Reference</span><b>ERD-${String(83021 + (s.sheet.k || 0) * 17).padStart(6, '0')}</b></div>
        ${x.i === 'lock' ? html`<div><span>Released</span><b>At hand-off, by PIN or photo</b></div>` : null}</div>
      <button className="btn soft block" onClick=${() => toast('Support chat', 'Not part of this prototype')}><${Ic} n="help" s=${18}/>Get help with this</button>`;
  }
  if (t === 'howbal') { label = 'How your balance works'; body = html`<h2 className="h2">How your balance works</h2>
    <div className="list">
      <div className="li"><span className="ico"><${Ic} n="bank" s=${19}/></span><span className="tx"><b>Add money by bank transfer</b><small style=${{ whiteSpace:'normal' }}>To your own account number, from any bank app</small></span></div>
      <div className="li"><span className="ico"><${Ic} n="lock" s=${19}/></span><span className="tx"><b>Held while your errand runs</b><small style=${{ whiteSpace:'normal' }}>The fee is held when an agent accepts; item money when you lock the amount</small></span></div>
      <div className="li"><span className="ico g"><${Ic} n="check" s=${19}/></span><span className="tx"><b>Paid only at hand-off</b><small style=${{ whiteSpace:'normal' }}>Your PIN, or your approval of a drop-off photo, releases it to the agent</small></span></div>
      <div className="li"><span className="ico"><${Ic} n="receipt" s=${19}/></span><span className="tx"><b>Leftovers come straight back</b><small style=${{ whiteSpace:'normal' }}>If the receipt is under the locked amount, or an errand is cancelled</small></span></div>
    </div><p className="note">Your balance can't be withdrawn. If you close your account, support refunds what's left.</p>`; }
  if (t === 'attach') { label = 'Add a photo'; body = html`<h2 className="h2">Add a photo</h2><div className="list">
    <button className="li" onClick=${() => { ACT.addPhoto(); toast('Photo added', 'Agents see it with your errand'); }}><span className="tile"><${Ic} n="camera" s=${19}/></span><span className="tx">Take a photo<small>The item, a receipt or a waybill</small></span></button>
    <button className="li" onClick=${() => { ACT.addPhoto(); toast('Photo added', 'Agents see it with your errand'); }}><span className="tile"><${Ic} n="image" s=${19}/></span><span className="tx">Choose from your photos</span></button></div>`; }
  if (t === 'profile') {
    const ag = AGENTS[s.sheet.who || s.agentId], p = agentPub(ag); label = `${p.name}, agent profile`;
    body = html`<${PublicProfile} p=${p} actions=${html`<div className="list"><${Row} ic="flag" t="Report a problem" sub="Reviewed with the chat and GPS trail" on=${close}/><${Row} ic="ban" t=${`Don't match me with ${ag.first} again`} cls="dang" on=${close}/></div>`}/>`;
  }
  if (t === 'me') { label = 'How agents see you'; body = html`<${PublicProfile} p=${ME_PUB} mine="This is what agents see before they accept your errand. Your full name, phone number and address stay hidden until an agent accepts."/>`; }
  if (t === 'counter') {
    const c = s.items.find(i => i.id === s.sheet.id);
    if (c) { const f = svc(c.amt), hold = c.amt + f - (s.promo ? PROMO : 0), diff = hold - s.heldFee; label = 'New price';
      body = html`<div className="offerhead"><${Face} who=${a.face} cls="lg"/><div className="tx"><small>${a.first} sent a new price</small><h2 className="h2">Can we do ${fmt(c.amt)}?</h2></div></div>
        <div className="offer"><div><small>Was</small><s>${fmt(c.was)}</s></div><${Ic} n="right" s=${22}/><div><small>New errand fee</small><b>${fmt(c.amt)}</b></div></div>
        <ul className="lines"><li><span>Service fee</span><span>${fmt(f)}</span></li><li className="tot"><span>Held until hand-off</span><span>${fmt(hold)}</span></li></ul>
        <p className="note">${diff > 0 ? `${fmt(diff)} more is held from your wallet. ` : ''}New prices stop once ${a.first} taps Start service. Declining lets you keep ${a.first} at ${fmt(c.was)} or find someone else.</p>
        <div className="row2"><button className="btn soft" onClick=${() => ACT.declineCounter(c.id)}>Decline</button><button className="btn pri" onClick=${() => ACT.acceptCounter(c.id)}>Accept ${fmt(c.amt)}</button></div>`; }
  }
  if (t === 'choice') { label = 'Keep or replace your agent';
    body = html`<h2 className="h2">Keep ${a.first} at ${fmt(s.agreed)}?</h2><p className="sub">You declined ${fmt(s.sheet.amt)}. You can carry on with ${a.first} at the agreed price, or send your errand back to matching.</p>
      <button className="btn pri block" onClick=${ACT.keepAgent}>Continue with ${a.first}</button>
      <button className="btn soft block" onClick=${ACT.newAgent}>Get new agent</button>
      <p className="note" style=${{ textAlign:'center' }}>A new agent ends this chat. There's no fee for you.</p>`; }
  if (t === 'pin') { label = 'Your hand-off PIN'; const items = s.receiptTotal || s.heldItems;
    body = html`<div className="offerhead"><span className="ico k" style=${{ width:'52px', height:'52px' }}><${Ic} n="lock" s=${24}/></span><div className="tx"><small>${a.first} marked it delivered</small><h2 className="h2">Your hand-off PIN</h2></div></div>
      <div className="pin big">${'4827'.split('').map((d, k) => html`<span key=${k}>${d}</span>`)}</div>
      <p className="sub">Give it to ${a.first} only when you have everything. Entering it pays ${fmt(s.agreed)} for the errand${items ? ` and ${fmt(items)} for the items` : ''}.</p>
      <button className="btn pri block" onClick=${close}>Done</button>
      <button className="btn text block" onClick=${() => { close(); ACT.openChat(); }}>Something's wrong? Message ${a.first}</button>`; }
  if (t === 'sos') { label = 'Emergency'; body = html`<h2 className="h2">Emergency</h2><p className="sub">Calling also shares your live location with our safety team.</p>
    <div className="kv"><div><span>National emergency</span><b style=${{ fontSize:'20px' }}>112</b></div><div><span>Lagos State emergency</span><b style=${{ fontSize:'20px' }}>767</b></div></div>
    <button className="btn dang block"><${Ic} n="phone" s=${20}/>Call 112</button>
    <button className=${'btn block ' + (s.sos ? 'soft' : 'line')} disabled=${s.sos} onClick=${ACT.sosAlert}>${s.sos ? html`<${Ic} n="check" s=${18}/>Safety team alerted with your live location` : html`<${Ic} n="shield" s=${20}/>Alert our safety team`}</button>`; }
  if (t === 'share') { label = 'Share live errand'; body = html`<h2 className="h2">Share live errand</h2><p className="sub">Contacts get a link that shows the agent on the map until hand-off.</p>
    <div className="list">${[['femi', 'Femi', '0816 ••• 0927', true], ['kemi', 'Mum', '0803 ••• 4412', true], ['ibrahim', 'Sade', '0905 ••• 7781', false]].map(([f, n, p, on]) => html`<label key=${n} className="li"><${Face} who=${f}/><span className="tx">${n}<small>${p}</small></span><input type="checkbox" defaultChecked=${on} style=${{ width:'22px', height:'22px', accentColor:'var(--brand)' }}/></label>`)}</div>
    <button className="btn pri block" onClick=${ACT.shareLive}>${s.shared ? 'Update sharing' : 'Share with 2 contacts'}</button>`; }
  if (t === 'receipt') { const h = s.history[s.sheet.k] || s.history[0]; label = 'Receipt'; body = html`<div className="chead"><${Raw} cls="art" style=${{ width:'48px', height:'48px', display:'block' }} svg=${ART[h.art]}/><span className="tx"><b style=${{ fontSize:'18px' }}>${h.t}</b><small>${h.d}</small></span></div>
    <div className="agent"><${Face} who=${h.who}/><span className="tx"><small>${h.s}</small></span></div>
    <ul className="lines"><li><span>Errand fee and service fee</span><span>${fmt(Math.round(h.a * .9))}</span></li><li><span>Other</span><span>${fmt(h.a - Math.round(h.a * .9))}</span></li><li className="tot"><span>Total paid</span><span>${fmt(h.a)}</span></li></ul>
    <div className="row2"><button className="btn soft" onClick=${close}>Repeat errand</button><button className="btn line" onClick=${close}>Get help</button></div>`; }
  return html`<${BottomSheet} label=${label} onClose=${close}>${body}<//>`;
}
function Call() {
  const a = agent();
  return html`<section className="call" role="dialog" aria-label="In-app call">
    <div style=${{ display:'flex', flexDirection:'column', alignItems:'center', gap:'14px' }}><span className="ring"><${Face} who=${a.face} cls="xl"/></span><h2 className="h2" style=${{ color:'inherit' }}>${a.full}</h2><p>Calling in the app… Your number stays hidden.</p></div>
    <div className="btns"><button aria-label="Mute"><${Ic} n="micoff" s=${26}/></button><button className="end" onClick=${() => ACT.call(false)} aria-label="End call"><${Ic} n="phone" s=${26}/></button><button aria-label="Speaker"><${Ic} n="speaker" s=${26}/></button></div>
  </section>`;
}
function Toast({ t, s }) {
  const withAgent = (t.go === 'chat' || t.go === 'trip') && s.phase !== 'none';
  return html`<button className="toast" key=${t.k} onClick=${ACT.toastGo}>${withAgent ? html`<${Face} who=${agent().face}/>` : html`<${Glyph}/>`}<span className="tx"><b>${t.text}</b>${t.sub ? html`<small>${t.sub}</small>` : null}</span></button>`;
}
function App() {
  const s = useS();
  const Scr = { plan:Plan, review:Review, matching:Matching, trip:Trip, chat:Chat, rate:Rate }[s.screen];
  const Tab = { home:Home, errands:ErrandsTab, wallet:WalletTab, account:AccountTab }[s.tab] || Home;
  return html`<div className="shell">
    ${s.ob ? html`<${Onboard} s=${s}/>` : Scr ? html`<${Scr} s=${s}/>` : html`<${Tab} s=${s}/><${TabBar} s=${s}/>`}
    ${s.sheet ? html`<${Sheet} key=${s.sheet.type + (s.sheet.which || '')} s=${s}/>` : null}
    ${s.call ? html`<${Call}/>` : null}
    ${s.toast ? html`<${Toast} t=${s.toast} s=${s}/>` : null}
  </div>`;
}
function Panel() {
  const s = useS(), k = nextStep();
  let status = '';
  if (s.phase === 'none') status = s.screen ? 'Fill in the errand, then slide to request.' : 'Type an errand on Home or tap a shortcut.';
  else if (s.waiting === 'counter') status = 'Waiting for you to answer the new price in the chat.';
  else if (s.waiting === 'item') status = 'Waiting for you to lock the item amount in the chat.';
  else if (s.phase === 'photo') status = 'Approve or dispute the drop-off photo in the chat.';
  else if (s.phase === 'dispute') status = 'Dispute open. Reset to run it again.';
  else if (s.phase === 'done') status = 'Rate and tip to finish.';
  else if (k) status = `Next: ${LABEL[k]}${s.auto ? ', in a few seconds' : ''}.`;
  return html`<div className="pcard" aria-live="polite">
    <div className="prow"><h3 id="autoL">Play the agent's side automatically</h3><button className="switch g" role="switch" aria-checked=${s.auto} aria-labelledby="autoL" onClick=${ACT.autoplay}></button></div>
    <p className="note">${status}</p>
    ${k ? html`<button className="btn pri" onClick=${ACT.next}>${LABEL[k]}</button>` : null}
    ${k === 'arrive' ? html`<button className="btn line" onClick=${ACT.photoPath}><${Ic} n="camera" s=${18}/>No-contact drop-off instead</button>` : null}
    <button className="btn soft" onClick=${ACT.reset}>Reset the prototype</button>
  </div>
  <${KycCard} kyc=${s.kyc} pending=${s.idState === 'pending'} approve=${ACT.approveId} setKyc=${ACT.setKyc} who="customer"/>`;
}
class Boundary extends React.Component {
  constructor(p) { super(p); this.state = { err:null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err) { console.error(err); }
  render() {
    if (!this.state.err) return this.props.children;
    const msg = String((this.state.err && this.state.err.message) || this.state.err);
    return html`<div className="screen" role="alert" style=${{ justifyContent:'center', padding:'28px', gap:'12px' }}><b className="t2">This screen hit an error</b><p className="note">${msg}</p><button className="btn pri" onClick=${() => { ACT.reset(); this.setState({ err:null }); }}>Reset the prototype</button></div>`;
  }
}
ReactDOM.createRoot(document.getElementById('app')).render(html`<${Boundary}><${App}/><//>`);
ReactDOM.createRoot(document.getElementById('panel-root')).render(html`<${Panel}/>`);
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return; const s = S();
  if (s.call) ACT.call(false); else if (s.sheet) ACT.closeSheet(); else if (s.screen === 'chat') ACT.closeChat(); else if (s.screen) ACT.close();
});
addEventListener('hashchange', () => jump(location.hash.slice(1)));
if (location.hash && JUMP[location.hash.slice(1)]) jump(location.hash.slice(1));
