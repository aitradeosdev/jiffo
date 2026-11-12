/* ================= Agent UI: tabs, sheets, root, panel ================= */
function TabBar({ s }) {
  const tabs = [['home', 'Home', 'home'], ['earnings', 'Earnings', 'chart'], ['errands', 'Errands', 'history'], ['account', 'Account', 'user']];
  return html`<nav className="tabbar" aria-label="Main">${tabs.map(([k, l, i]) => html`<button key=${k} className="tab" aria-current=${s.tab === k ? 'page' : undefined} onClick=${() => ACT.tab(k)}><${Ic} n=${i} s=${24} w=${s.tab === k ? 2.3 : 1.8}/>${l}</button>`)}</nav>`;
}
function Earnings({ s }) {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], max = Math.max(...s.week, 1), wk = s.week.reduce((a, b) => a + b, 0);
  return html`<div className="tabpage">
    <header className="phead big"><h1>Earnings</h1></header>
    <div className="pbody">
      <div className="chips"><button className="chip" aria-pressed=${s.range === 'today'} onClick=${() => ACT.range('today')}>Today</button><button className="chip" aria-pressed=${s.range === 'week'} onClick=${() => ACT.range('week')}>This week</button></div>
      <div><p className="sub">${s.range === 'today' ? `Today · ${s.todayN} errands` : 'Mon 9 to Sun 15 Nov'}</p><p className="amt" style=${{ margin:'2px 0 0', fontSize:'40px' }}>${fmt(s.range === 'today' ? s.today : wk)}</p><p className="note">After commission, tips included. Item money is shown separately.</p></div>
      ${s.range === 'week' ? html`<div className="chart" role="img" aria-label="Earnings by day this week">${s.week.map((v, k) => html`<div key=${k} className="col"><span className="val">${v ? fmt(v) : ''}</span><span className=${'cbar ' + (k === 3 ? 'today' : v ? '' : 'future')} style=${{ height:Math.max(4, Math.round(v / max * 112)) + 'px' }}></span><span className=${'day' + (k === 3 ? ' today' : '')}>${days[k]}</span></div>`)}</div>` : null}
      <section className="earnbox"><small>Available to withdraw</small><div className="bal">${fmt(s.avail)}</div>
        <button className="btn" disabled=${s.avail <= 0} onClick=${() => ACT.sheet('withdraw')}><${Ic} n="bank" s=${18}/>Withdraw</button>
        <div className="pend"><span>Clears in 24 hours (${ME.tier})</span><b>${fmt(s.pend)}</b></div></section>
      <div className="block"><h2 className="sec">Your tier</h2>
        <div className="tierrow" style=${{ cursor:'default' }}><span className="medal">B</span><span className="tx"><b>Bronze</b><small className="note">Silver means lower commission and instant earnings</small></span></div>
        <div className="meter"><div className="mh"><span>Errands, last 30 days</span><b>18 of 25</b></div><div className="bar1"><span style=${{ width:'72%' }}></span></div></div>
        <div className="meter"><div className="mh"><span>Rating</span><b>4.9 of 4.7 needed</b></div><div className="bar1"><span style=${{ width:'100%' }}></span></div></div>
        <div className="meter"><div className="mh"><span>Completion rate</span><b>96% of 95% needed</b></div><div className="bar1"><span style=${{ width:'100%' }}></span></div></div>
        <p className="note">No strikes in the last 30 days.</p></div>
    </div>
  </div>`;
}
function Errands({ s }) {
  return html`<div className="tabpage">
    <header className="phead big"><h1>Errands</h1></header>
    <div className="pbody">
      <div className="block"><h2 className="sec">Upcoming</h2>
        <div className="job" style=${{ cursor:'default' }}><span className="thumb"><${Raw} svg=${ART.queue}/></span><span className="tx"><b>Passport collection queue</b><small>Sat, 14 Nov · 8:00 AM · Ikoyi</small><span className="tags"><span className="badge">Reminder set</span></span></span><span className="fee">${fmt(6000)}</span></div></div>
      <div className="block"><h2 className="sec">Today</h2>
        <div className="list">${s.history.map((h, k) => html`<div key=${k} className="job"><span className="thumb"><${Raw} svg=${ART[h.art]}/></span><span className="tx"><b>${h.t}</b><small>${h.s}</small><small>Fee ${fmt(h.fee)} · commission −${fmt(h.fee - net(h.fee))}${h.tip ? ` · tip ${fmt(h.tip)}` : ''}${h.items ? ` · items ${fmt(h.items)}` : ''}</small></span><span className="fee">${fmt(net(h.fee) + h.tip)}</span></div>`)}</div></div>
    </div>
  </div>`;
}
function Account() {
  const s = useS(), soon = t => () => toast(t, 'Not part of this prototype');
  return html`<div className="tabpage">
    <div className="pbody acct">
      <${AccHead} face="chinedu" name=${ME.full} sub=${html`<${Verified} s=${15}/>Verified agent · See your profile`} on=${() => ACT.sheet('me')}/>
      <${AccStats} items=${[[html`${ME.rating}<span style=${{ fontSize:'15px' }}> ★</span>`, 'Rating'], ['98%', 'Completed'], ['0', 'Strikes']]}/>
      <button className="tierrow" onClick=${() => ACT.tab('earnings')}><span className="medal">B</span><span className="tx"><b>Bronze · 18 of 25 errands to Silver</b><span className="bar1"><span style=${{ width:'72%' }}></span></span></span><${Ic} n="chev" s=${18}/></button>
      <nav className="menu" aria-label="Account">
        <${MRow} ic="tune" t="Errand preferences" right=${html`<small>${CATS.filter(c => s.prefs.cats[c.k]).length} of ${CATS.length}</small>`} on=${ACT.prefs}/>
        <${MRow} ic="chart" t="Earnings" on=${() => ACT.tab('earnings')}/>
        <${MRow} ic="bank" t="Payout account" right=${html`<small>GTBank •••• 4821</small>`} on=${soon('Payout account')}/>
        <${MRow} ic="shield" t="Documents and verification" right=${html`<span className="badge g">Verified</span>`} on=${soon('Documents and verification')}/>
        <${MRow} ic="pin" t="Work radius" right=${html`<small>5 km</small>`} on=${soon('Work radius')}/>
        <${MRow} ic="help" t="Help" on=${soon('Help')}/>
      </nav>
      <${Minor} items=${[['Invite agents', soon('Invite agents'), '', 'Bonus after their first errands'], ['Language', soon('Language'), '', 'English'], ['Terms and privacy', soon('Terms and privacy')], ['Log out', soon('Log out')]]}/>
      <p className="ver">Jiffo Agent 1.0 · prototype</p>
    </div>
  </div>`;
}

/* ---------- Sheets ---------- */
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
function JobBody({ j, urgent, left }) {
  const R = 24, C = 2 * Math.PI * R;
  return html`<div className="reqhead">${urgent ? html`<span className="badge o" style=${{ height:'30px', fontSize:'13px' }}><${Ic} n="zap" s=${14}/>Urgent request</span>` : html`<span className="badge">${j.sched ? j.when : 'Now'}</span>`}
      ${urgent ? html`<div className="countdown" role="timer" aria-label=${`${left} seconds to accept`}><svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true"><circle cx="28" cy="28" r=${R} fill="none" stroke="var(--surface-3)" strokeWidth="5"/><circle cx="28" cy="28" r=${R} fill="none" stroke="var(--ink)" strokeWidth="5" strokeLinecap="round" strokeDasharray=${C} strokeDashoffset=${C * (1 - left / 20)} style=${{ transition:'stroke-dashoffset 1s linear' }}/></svg><b>${left}</b></div>` : null}</div>
    <div><div className="bigfee">${fmt(j.fee)}</div><p className="sub">You earn ${fmt(net(j.fee))} after commission</p></div>
    <div style=${{ display:'flex', gap:'6px', flexWrap:'wrap' }}><span className="badge"><${Ic} n=${CAT(j.cat).ic} s=${12}/>${CAT(j.cat).name}</span>${j.buy ? html`<span className="badge g"><${Ic} n="bag" s=${12}/>You buy items first</span>` : html`<span className="badge">No purchase</span>`}</div>
    <div className="stoplist"><span className="mk pick"></span><span><b>${j.from}</b><small>Pickup</small></span><span className="km">${j.to} km away</span><span className="rail"></span><span></span><span></span><span className="mk drop"></span><span><b>${j.dest}</b><small>Drop-off</small></span><span className="km">${j.km} km errand</span></div>
    <div className="agentrow">${CONFIG.custPhotoBeforeAccept ? html`<${Face} who=${j.who}/>` : html`<span className="av initials" aria-hidden="true">${j.name.split(' ').map(w => w[0]).join('').replace('.', '')}</span>`}<span className="tx"><b>${j.name}<${Verified} s=${16}/></b><small>${j.rating} ★ · verified customer${CONFIG.custPhotoBeforeAccept ? '' : ' · photo shown after you accept'}</small></span></div>
    ${j.id === 0 ? html`<p style=${{ margin:0, fontSize:'15px', lineHeight:1.45 }}>${DESC}</p>` : null}`;
}
function PrefsBody({ p }) {
  const on = CATS.filter(c => p.cats[c.k]).length;
  return html`<div className="prefrow"><span className=${'ico' + (p.buy ? ' g' : '')}><${Ic} n="bag" s=${19}/></span><span className="tx"><b id="pbuy">Purchase errands</b><small>You pay for items first; the item money is paid to you at hand-off</small></span><button className="switch g" role="switch" aria-checked=${p.buy} aria-labelledby="pbuy" onClick=${ACT.prefBuy}></button></div>
    <div className="prow"><h3 className="sec" style=${{ margin:0 }}>Categories</h3><button className="btn sm soft" onClick=${() => ACT.prefAll(on < CATS.length)}>${on < CATS.length ? 'Turn all on' : 'Turn all off'}</button></div>
    <div className="list">${CATS.map(c => html`<div key=${c.k} className="prefrow plain"><span className="ico"><${Ic} n=${c.ic} s=${19}/></span><span className="tx"><b id=${'pc-' + c.k}>${c.name}</b><small>${c.eg}</small></span><button className="switch g" role="switch" aria-checked=${!!p.cats[c.k]} aria-labelledby=${'pc-' + c.k} onClick=${() => ACT.prefCat(c.k)}></button></div>`)}</div>
    ${on ? null : html`<p className="note" style=${{ color:'var(--danger)' }}>With every category off you won't get any errands.</p>`}`;
}
function Sheet({ s }) {
  const t = s.sheet.type, close = ACT.closeSheet;
  let body = null, label = '';
  if (t === 'prefs') {
    label = 'Errand preferences';
    body = html`<div><h2 className="h2">Errand preferences</h2><p className="sub">Urgent requests and the board only show errands that match. Changes apply to new requests, not errands you've accepted.</p></div>
      <${PrefsBody} p=${s.prefs}/>
      <button className="btn pri block" onClick=${close}>Done</button>`;
  }
  if (t === 'states') {
    label = 'Where will you work?';
    body = html`<div><h2 className="h2">Where will you work?</h2><p className="sub">States where Jiffo is live. Some have a waitlist for new agents.</p></div>
      <div className="list">${STATES.map(([n, open]) => html`<button key=${n} className="li" onClick=${() => ACT.obState(n)}><span className=${'ico' + (s.ob && s.ob.state === n ? ' k' : '')}><${Ic} n=${s.ob && s.ob.state === n ? 'check' : 'pin'} s=${19}/></span><span className="tx"><b>${n}</b><small>${open ? 'Taking new agents' : 'Waitlist for new agents'}</small></span>${open ? null : html`<span className="badge o">Waitlist</span>`}</button>`)}</div>`;
  }
  if (t === 'banks') {
    label = 'Choose your bank';
    body = html`<h2 className="h2">Choose your bank</h2>
      <label className="field"><${Ic} n="search" s=${20}/><span className="sr">Search banks</span><input placeholder="Search banks"/></label>
      <div className="list">${BANKS.map(n => html`<button key=${n} className="li" onClick=${() => ACT.obBank(n)}><span className=${'ico' + (s.ob && s.ob.bank === n ? ' k' : '')}><${Ic} n=${s.ob && s.ob.bank === n ? 'check' : 'bank'} s=${19}/></span><span className="tx"><b>${n}</b></span></button>`)}</div>`;
  }
  if (t === 'request') { label = 'Urgent errand request'; body = html`<${JobBody} j=${BOARD[0]} urgent=${true} left=${s.reqLeft}/>
    <button className="btn pri block" onClick=${ACT.accept}>Accept errand</button><button className="btn text block" onClick=${ACT.decline}>Decline</button>`; }
  if (t === 'job') { const j = BOARD[s.sheet.id]; label = 'Errand details'; body = html`<${JobBody} j=${j}/>
    ${j.buy ? html`<p className="note">You buy with your own money, then send the receipt and a photo of the items. You're paid it back at hand-off.</p>` : null}
    <button className="btn pri block" onClick=${() => ACT.acceptJob(j.id)}>Accept errand</button>`; }
  if (t === 'counter') { const n = net(s.cAmt); label = 'Send a new price'; body = html`<h2 className="h2">Send a new price</h2><p className="sub">Agreed now: ${fmt(s.agreed)}. Tolu sees it as a popup and accepts or declines. You can send new prices until you tap Start service.</p>
    <div className="stepper"><button onClick=${() => ACT.cStep(-100)} aria-label="Lower by ₦100"><${Ic} n="minus"/></button><span className="amt">${fmt(s.cAmt)}</span><button onClick=${() => ACT.cStep(100)} aria-label="Raise by ₦100"><${Ic} n="plus"/></button></div>
    <p className="feehint">You'd earn ${fmt(n)} after commission</p>
    <button className="btn pri block" disabled=${s.cAmt === s.agreed} onClick=${ACT.sendCounter}>Send ${fmt(s.cAmt)}</button>`; }
  if (t === 'start') { label = 'Start the service'; body = html`<h2 className="h2">Start the service?</h2><p className="sub">The price is fixed at ${fmt(s.agreed)} once you start, and you can't send new prices after this. Tolu's tracker moves to Service started.</p>
    <button className="btn pri block" onClick=${ACT.start}><${Ic} n="play" s=${19}/>Start service</button><button className="btn text block" onClick=${close}>Not yet</button>`; }
  if (t === 'delivered') { label = 'Mark delivered'; body = html`<h2 className="h2">Mark the errand delivered?</h2><p className="sub">Do this when you're with Tolu at 12 Admiralty Way. Their hand-off PIN appears in their app, and you enter it to get paid.</p>
    <button className="btn pri block" onClick=${ACT.delivered}><${Ic} n="check" s=${19}/>Mark delivered</button><button className="btn text block" onClick=${close}>Not yet</button>`; }
  if (t === 'plus') { label = 'More actions'; body = html`<div className="list">
    <${Row} ic="edit" t="New price" sub=${s.phase === 'accepted' ? 'Until you tap Start service' : 'Fixed after Start service'} on=${s.phase === 'accepted' && !s.pending ? ACT.counterSheet : close}/>
    <${Row} ic="bag" t="Item amount" sub=${s.phase === 'started' ? 'With the receipt and items photo' : 'After Start service, once you have bought'} on=${s.phase === 'started' ? () => { set({ sheet:null }); ACT.openItem(); } : close}/>
    <${Row} ic="camera" t="Photo" sub="Taken in the app" on=${close}/></div>`; }
  if (t === 'withdraw') { const w = s.wd; label = 'Withdraw';
    body = w.done ? html`<div className="hero"><span className="tick"><${Ic} n="check" s=${32} w=${2.8}/></span><h2 className="h2">${fmt(w.amt)} on its way</h2><p className="sub">To GTBank •••• 4821, ${w.when}.</p></div><button className="btn pri block" onClick=${ACT.closeWd}>Done</button>`
      : html`<h2 className="h2">Withdraw ${fmt(s.avail)}</h2>
        <div className="list" role="radiogroup" aria-label="Withdrawal speed" style=${{ gap:'8px' }}>
          <button className="opt" role="radio" aria-checked=${w.mode === 'sched'} onClick=${() => ACT.wdMode('sched')}><span className="radio"></span><span className="tx"><b>Scheduled · free</b><small>Today at 6:00 PM. One free withdrawal a day.</small></span></button>
          <button className="opt" role="radio" aria-checked=${w.mode === 'instant'} onClick=${() => ACT.wdMode('instant')}><span className="radio"></span><span className="tx"><b>Instant · ${fmt(INSTANT_FEE)} fee</b><small>Arrives in a few minutes</small></span></button></div>
        <div className="kv"><div><span>To</span><b>GTBank •••• 4821</b></div><div><span>Account name</span><b>CHINEDU OKAFOR</b></div></div>
        <p className="note">Payouts go only to this account. Its name matches your NIN.</p>
        <button className="btn pri block" onClick=${ACT.confirmWd}><${Ic} n="finger" s=${20}/>Confirm with fingerprint</button>`; }
  if (t === 'cust') { label = 'Customer profile'; body = html`<${PublicProfile} p=${CUST_PUB} actions=${html`<div className="list"><${Row} ic="flag" t="Report a problem" sub="Reviewed with the chat and GPS trail" on=${close}/><${Row} ic="ban" t="Don't match me with Tolu again" cls="dang" on=${close}/></div>`}/>`; }
  if (t === 'me') { label = 'Your profile'; body = html`<${PublicProfile} p=${ME_PUB} mine="This is what customers see once you accept their errand. Your phone number stays hidden; calls go through the app."/>`; }
  if (t === 'sos') { label = 'Emergency'; body = html`<h2 className="h2">Emergency</h2><p className="sub">Calling also shares your live location with our safety team.</p>
    <div className="kv"><div><span>National emergency</span><b style=${{ fontSize:'20px' }}>112</b></div><div><span>Lagos State emergency</span><b style=${{ fontSize:'20px' }}>767</b></div></div>
    <button className="btn dang block"><${Ic} n="phone" s=${20}/>Call 112</button><button className="btn soft block" onClick=${() => { close(); toast('Safety team alerted', 'They can see your live location'); }}><${Ic} n="shield" s=${20}/>Alert our safety team</button>`; }
  return html`<${BottomSheet} label=${label} onClose=${close}>${body}<//>`;
}
function Call() {
  return html`<section className="call" role="dialog" aria-label="In-app call">
    <div style=${{ display:'flex', flexDirection:'column', alignItems:'center', gap:'14px' }}><span className="ring"><${Face} who="tolu" cls="xl"/></span><h2 className="h2" style=${{ color:'inherit' }}>Tolu A.</h2><p>Calling in the app… Your number stays hidden.</p></div>
    <div className="btns"><button aria-label="Mute"><${Ic} n="micoff" s=${26}/></button><button className="end" onClick=${() => ACT.call(false)} aria-label="End call"><${Ic} n="phone" s=${26}/></button><button aria-label="Speaker"><${Ic} n="speaker" s=${26}/></button></div>
  </section>`;
}
function Toast({ t }) {
  return html`<button className="toast" key=${t.k} onClick=${ACT.toastGo}>${t.go ? html`<${Face} who="tolu"/>` : html`<${Glyph}/>`}<span className="tx"><b>${t.text}</b>${t.sub ? html`<small>${t.sub}</small>` : null}</span></button>`;
}
function App() {
  const s = useS();
  const Scr = { selfie:Selfie, trip:Trip, chat:Chat, item:ItemScreen, camera:Camera, pin:Pin, wait:Wait, done:Done }[s.screen];
  const Tab = { home:Home, earnings:Earnings, errands:Errands, account:Account }[s.tab] || Home;
  return html`<div className="shell">
    ${s.ob ? html`<${Onboard} s=${s}/>` : Scr ? html`<${Scr} s=${s}/>` : html`<${Tab} s=${s}/><${TabBar} s=${s}/>`}
    ${s.sheet ? html`<${Sheet} key=${s.sheet.type} s=${s}/>` : null}
    ${s.call ? html`<${Call}/>` : null}
    ${s.toast ? html`<${Toast} t=${s.toast}/>` : null}
  </div>`;
}
function Panel() {
  const s = useS(), k = nextCustomer();
  let status = 'Tap GO to go online. An urgent request arrives a few seconds later.';
  if (s.online && s.phase === 'idle') status = s.auto ? 'Online. An urgent request arrives in a few seconds.' : 'Online. Send yourself an urgent request.';
  if (s.phase === 'request') status = 'Accept or decline the urgent request.';
  if (s.phase === 'accepted' && !k) status = 'Send a new price or tap Start service.';
  if (s.phase === 'started') status = 'Tap Send item amount and take both photos.';
  if (s.phase === 'bought') status = 'Tap Mark delivered.';
  if (s.phase === 'delivered') status = `Enter the customer's PIN: ${CUSTOMER_PIN}. Or try the drop-off photo or Not answering.`;
  if (s.phase === 'unreachable') status = 'Marked unreachable. The customer has 24 hours.';
  if (s.phase === 'done') status = 'Errand complete. Check Earnings or go back to the board.';
  if (k) status = `Next: ${CLABEL[k]}${s.auto ? ', in a few seconds' : ''}.`;
  return html`<div className="pcard" aria-live="polite">
    <div className="prow"><h3 id="autoL">Play the customer's side automatically</h3><button className="switch g" role="switch" aria-checked=${s.auto} aria-labelledby="autoL" onClick=${ACT.autoplay}></button></div>
    <p className="note">${status}</p>
    ${k ? html`<button className="btn pri" onClick=${ACT.custNext}>${CLABEL[k]}</button>` : null}
    ${k === 'counter' ? html`<button className="btn soft" onClick=${ACT.custDecline}>Customer declines, keeps you</button>` : null}
    ${s.screen === 'wait' && s.phase !== 'unreachable' && s.wait > 0 ? html`<button className="btn soft" onClick=${ACT.skipWait}>Skip the 10-minute wait</button>` : null}
    ${s.phase === 'idle' ? html`<button className="btn soft" onClick=${ACT.sendPing}><${Ic} n="zap" s=${18}/>Send an urgent request now</button>` : null}
    <button className="btn soft" onClick=${ACT.reset}>Reset the prototype</button>
  </div>
  <${KycCard} kyc=${s.kyc} pending=${!!(s.ob && s.ob.step === 'submitted')} approve=${ACT.approveApp} setKyc=${ACT.setKyc} who="agent"/>
  <div className="pcard"><div className="prow"><h3 id="photoL">Admin: show the customer's photo before accepting</h3><button className="switch" role="switch" aria-checked=${!!s.custPhoto} aria-labelledby="photoL" onClick=${ACT.togglePhoto}></button></div>
    <p className="note">${s.custPhoto ? 'On: agents see the photo on requests and the board.' : 'Off: agents see initials until they accept, then the full profile.'} Try the urgent request after switching.</p></div>`;
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
  const s = S(), tag = e.target && e.target.tagName;
  if (e.key === 'Escape') { if (s.call) ACT.call(false); else if (s.sheet) ACT.closeSheet(); else if (s.screen === 'chat') ACT.closeChat(); else if (s.screen && s.screen !== 'trip') set({ screen:s.phase === 'idle' ? null : 'trip' }); else if (s.screen) ACT.close(); }
  if (s.screen === 'pin' && !s.sheet && !/INPUT|TEXTAREA/.test(tag || '')) { if (/^[0-9]$/.test(e.key)) ACT.key(e.key); if (e.key === 'Backspace') ACT.del(); }
});
addEventListener('hashchange', () => jump(location.hash.slice(1)));
if (location.hash && JUMP[location.hash.slice(1)]) jump(location.hash.slice(1));
