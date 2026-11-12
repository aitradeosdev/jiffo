/* ================= Screens ================= */
Object.assign(ICONS, {
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  bell:'<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9z"/><path d="M10 19a2 2 0 0 0 4 0"/>',
  globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
  doc:'<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
  out:'<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/>',
  trash:'<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'
});
const Row = ({ ic, t, sub, on, cls = '', icls = '', right }) => html`<button className=${'li ' + cls} onClick=${on}><span className=${'ico ' + icls}><${Ic} n=${ic} s=${19}/></span><span className="tx"><span className="t">${t}</span>${sub ? html`<small>${sub}</small>` : null}</span>${right !== undefined ? right : (cls === 'dang' ? null : html`<${Ic} n="chev" s=${18}/>`)}</button>`;
const EtaBox = ({ st }) => st.eta ? html`<span className="eta-box">${st.eta}<small>min</small></span>` : null;
function useHeight() {
  const ref = useRef(), [h, setH] = useState(420);
  useLayoutEffect(() => { if (ref.current && Math.abs(ref.current.offsetHeight - h) > 4) setH(ref.current.offsetHeight); });
  return [ref, h];
}
const isLive = s => ACTIVE.includes(s.phase) || s.phase === 'matching';

function TabBar({ s }) {
  const tabs = [['home', 'Home', 'home'], ['errands', 'Errands', 'history'], ['wallet', 'Wallet', 'wallet'], ['account', 'Account', 'user']];
  return html`<nav className="tabbar" aria-label="Main">${tabs.map(([k, l, i]) => html`<button key=${k} className="tab" aria-current=${s.tab === k ? 'page' : undefined} onClick=${() => ACT.tab(k)}><${Ic} n=${i} s=${24} w=${s.tab === k ? 2.3 : 1.8}/>${l}${k === 'errands' && isLive(s) ? html`<span className="bdot"></span>` : null}</button>`)}</nav>`;
}
function LiveCard({ s }) {
  const st = stageInfo(s), a = agent();
  return html`<button className="livecard" onClick=${s.phase === 'matching' ? () => set({ screen:'matching' }) : ACT.openErrand}>
    ${s.phase === 'matching' ? html`<span className="ico" style=${{ background:'rgb(255 255 255 / .14)', color:'inherit' }}><${Ic} n="search" s=${19}/></span>` : html`<${Face} who=${a.face} cls="lg"/>`}
    <span className="tx"><b>${st.title}</b>${s.phase === 'matching' ? html`<small style=${{ opacity:.75 }}>Your errand is with nearby agents</small>` : html`<${Segs} i=${st.i}/>`}</span>
    ${st.eta ? html`<span className="eta">${st.eta}<small>min</small></span>` : html`<${Ic} n="chev" s=${20}/>`}
  </button>`;
}
function Home({ s }) {
  const [ref, h] = useHeight(), api = useRef();
  return html`<div className="fill">
    <${MapCanvas} interactive=${true} scene=${sceneFor('home', s)} insets=${{ t:64, b:h + 72 }} apiRef=${api}/>
    <div className="brandmark" aria-label="Jiffo"><${Raw} cls="wm" svg=${WORDMARK}/></div>
    <button className="wpill" style=${{ position:'absolute', top:'14px', right:'var(--gr)' }} onClick=${() => ACT.tab('wallet')} aria-label=${`Wallet, ${fmt(s.balance)}`}><${Ic} n="wallet" s=${17}/><span className="num">${fmt(s.balance)}</span></button>
    <button className="fab" style=${{ right:'var(--gr)', bottom:(h + 84) + 'px' }} onClick=${() => api.current && api.current.recenter()} aria-label="Show my location"><${Ic} n="locate"/></button>
    <section className="sheet" ref=${ref} style=${{ bottom:'var(--tabh)', maxHeight:'calc(100% - var(--tabh) - 200px)' }}>
      <span className="handle"></span>
      ${isLive(s) ? html`<${LiveCard} s=${s}/>` : null}
      ${s.newbie && s.idState === 'pending' ? html`<div className="addcard" style=${{ background:'var(--urgent-soft)' }}><span className="ico o"><${Ic} n="clock" s=${19}/></span><span className="tx"><b>We're checking your ID</b><small>Usually within ${CONFIG.reviewHours} hours. Adding money and requests open once you're approved.</small></span></div>` : null}
      ${s.newbie && s.idState === 'ok' && s.balance === 0 ? html`<button className="addcard" onClick=${() => ACT.sheet('topup')}><span className="ico g"><${Ic} n="bank" s=${19}/></span><span className="tx"><b>Add money to request your first errand</b><small>Transfer to your own account number from any bank app</small></span><${Ic} n="chev" s=${18}/></button>` : null}
      <h1 className="t1">What do you need done?</h1>
      <button className="whereto" onClick=${ACT.ask}><${Ic} n="search" s=${22} w=${2.4}/><span className="grow">Describe your errand</span><span className="when" onClick=${e => { e.stopPropagation(); ACT.sheet('when'); }}><${Ic} n="clock" s=${16}/>${s.when === 'now' ? 'Now' : 'Later'}<${Ic} n="down" s=${15}/></span></button>
      <div className="list">
        <${Row} ic="home" t="Home" sub="12 Admiralty Way, Lekki Phase 1" on=${() => ACT.place('home')} right=${null}/>
        <${Row} ic="history" t="Medplus Pharmacy" sub="Admiralty Way · your last errand" on=${() => ACT.idea(2)} right=${null}/>
      </div>
      <div className="prow" style=${{ display:'flex', alignItems:'center', justifyContent:'space-between' }}><h2 className="sec" style=${{ margin:0 }}>Categories</h2><button className="btn sm soft" onClick=${() => ACT.sheet('cats')}>See all</button></div>
      <div className="sugs">${IDEAS.map((d, i) => html`<button key=${i} className="sug" onClick=${() => ACT.idea(i)}><span className="box"><${Raw} svg=${ART[d.art]}/></span>${d.short}</button>`)}</div>
      <button className="promo-card" onClick=${() => ACT.idea(0)}><span className="tx"><b>Groceries without the traffic</b><small>An agent buys with their own money. You pay for items only when they're in your hands.</small><span className="go">Try a grocery run<${Ic} n="right" s=${14} w=${2.4}/></span></span><${Raw} cls="art" svg=${ART.groceries}/></button>
    </section>
  </div>`;
}
function Plan({ s }) {
  const f = s.focus, ok = s.cat && s.desc.trim() && s.pick && s.drop, c = CAT(s.cat);
  const opts = f === 'drop' ? ['home', 'work', 'medplus', 'circle'] : ['shoprite', 'circle', 'medplus', 'gig', 'home'];
  const field = (kind, k, ph) => html`<button className=${'input' + (f === kind ? ' on' : '')} onClick=${() => ACT.setFocus(kind)}>${k ? html`<span className="val">${PL(k).name}<span style=${{ fontWeight:500, color:'var(--ink-3)' }}> · ${PL(k).addr}</span></span>` : html`<span className="phd">${ph}</span>`}</button>`;
  return html`<div className="screen">
    <header className="phead"><button className="ib" onClick=${ACT.close} aria-label="Back"><${Ic} n="back" s=${24}/></button><h1>Plan your errand</h1><span style=${{ width:'44px' }}></span></header>
    <div className="pbody" style=${{ gap:'14px' }}>
      <button className=${'input catfield' + (c ? '' : ' on')} onClick=${() => ACT.sheet('cats')} aria-label=${c ? `Category: ${c.name}. Change` : 'Choose a category'}>
        <span className=${'ico' + (c ? ' k' : '')}><${Ic} n=${c ? c.ic : 'menu'} s=${18}/></span>
        ${c ? html`<span className="val">${c.name}</span>` : html`<span className="phd">Choose a category</span>`}
        <span className="catlink">${c ? 'Change' : 'Required'}<${Ic} n="chev" s=${16}/></span>
      </button>
      <div className="chips">
        <button className="chip" onClick=${() => ACT.sheet('when')}><${Ic} n="clock" s=${16}/>${s.when === 'now' ? 'Now' : 'Sat, 10:00 AM'}<${Ic} n="down" s=${15}/></button>
        <button className="chip urg" aria-pressed=${s.urgent} onClick=${ACT.toggleUrgent}><${Ic} n="zap" s=${16}/>Urgent</button>
        <button className="chip" onClick=${ACT.addPhoto}><${Ic} n="camera" s=${16}/>${s.photos ? `${s.photos} photo${s.photos > 1 ? 's' : ''}` : 'Add photo'}</button>
      </div>
      <label className="sr" htmlFor="desc">What do you need done?</label>
      <textarea id="desc" className="desc" rows="3" value=${s.desc} onFocus=${() => ACT.setFocus('desc')} onChange=${e => set({ desc:e.target.value })} placeholder="What do you need done? For example: buy 2 loaves of bread at the bakery and bring them home"></textarea>
      <div className="buyrow">
        <span className=${'ico' + (s.buy ? ' g' : '')}><${Ic} n="bag" s=${18}/></span>
        <span className="tx"><b id="buyL">Agent buys items</b><small>${s.buy ? 'You lock the item amount after they send the receipt' : 'They only collect, deliver or do the task'}</small></span>
        <button className="switch g" role="switch" aria-checked=${s.buy} aria-labelledby="buyL" onClick=${ACT.toggleBuy}></button>
      </div>
      ${s.photos ? html`<div className="thumbrow">${Array.from({ length:s.photos }, (_, k) => html`<${Raw} key=${k} cls="ph" svg=${PHOTO.receipt}/>`)}</div>` : null}
      <div className="stops">
        <span className="mk pick"></span>${field('pick', s.pick, 'Pickup location')}
        ${s.mid ? html`<span className="rail"></span><span></span><span className="mk mid"></span><div style=${{ display:'flex', gap:'6px' }}><span className="input"><span className="val">Medplus Pharmacy</span></span><button className="ib" onClick=${ACT.toggleMid} aria-label="Remove stop"><${Ic} n="x" s=${18}/></button></div>` : null}
        <span className="rail"></span><span></span>
        <span className="mk drop"></span>${field('drop', s.drop, 'Drop-off location')}
      </div>
      ${s.mid ? null : html`<button className="link" style=${{ alignSelf:'flex-start', marginLeft:'30px', fontSize:'14px' }} onClick=${ACT.toggleMid}>Add a stop</button>`}
      ${f === 'desc' ? html`<p className="note">${s.buy ? "Say what to buy, where, and anything the agent should know. You agree the item amount with your agent in chat; it's held separately and paid at hand-off." : 'Say what to collect, deliver or do, where, and anything the agent should know.'}</p>` : html`
        <div className="list">
          ${opts.map(k => html`<button key=${k} className="li" onClick=${() => ACT.pickPlace(k)}><span className=${'ico' + ((f === 'drop' ? s.drop : s.pick) === k ? ' k' : '')}><${Ic} n=${(f === 'drop' ? s.drop : s.pick) === k ? 'check' : PL(k).icon === 'bag' ? 'pin' : PL(k).icon} s=${19}/></span><span className="tx"><b>${PL(k).name}</b><small>${PL(k).addr}</small></span>${PL(k).km ? html`<span className="km">${PL(k).km}</span>` : null}</button>`)}
          <${Row} ic="map" t="Set location on map" on=${() => toast('Drag the map to set the spot', 'Not part of this prototype')} right=${null}/>
        </div>`}
    </div>
    <footer className="sfoot"><button className="btn pri block" disabled=${!ok} onClick=${ACT.toReview}>Continue</button></footer>
  </div>`;
}
function Review({ s }) {
  const [ref, h] = useHeight();
  const hold = holdFor(s), covers = s.balance >= hold, d = s.fee - s.suggested, shown = useTween(s.fee);
  const hint = d === 0 ? 'Suggested for this distance' : d > 0 ? `${fmt(d)} above suggested` : `${fmt(-d)} below suggested`;
  return html`<div className="mapscreen">
    <${MapCanvas} interactive=${true} scene=${sceneFor('review', s)} insets=${{ t:70, b:h + 8, l:28, r:28 }}/>
    <button className="fab" style=${{ top:'14px', left:'var(--gl)' }} onClick=${() => ACT.back('plan')} aria-label="Back"><${Ic} n="back" s=${24}/></button>
    <section className="sheet" ref=${ref} style=${{ maxHeight:'66%' }}>
      <span className="handle"></span>
      <div style=${{ display:'flex', flexDirection:'column', gap:'8px' }}><div><h1 className="t2">Confirm your errand</h1><p className="sub">${PL(s.pick).name} to ${PL(s.drop).name} · ${s.km} km · about ${s.mins} min</p></div>
        <div style=${{ display:'flex', gap:'6px', flexWrap:'wrap' }}>${CAT(s.cat) ? html`<span className="badge"><${Ic} n=${CAT(s.cat).ic} s=${12}/>${CAT(s.cat).name}</span>` : null}<span className=${'badge' + (s.buy ? ' g' : '')}><${Ic} n="bag" s=${12}/>${s.buy ? 'Agent buys items' : 'No purchase'}</span></div></div>
      <div className="option"><span className="tile" style=${{ width:'52px', height:'52px' }}>${CAT(s.cat) && CAT(s.cat).art ? html`<${Raw} svg=${ART[CAT(s.cat).art]} style=${{ width:'40px', height:'40px', display:'block' }}/>` : html`<${Ic} n=${CAT(s.cat) ? CAT(s.cat).ic : 'bag'} s=${24}/>`}</span>
        <span className="tx"><b>Errand fee ${s.urgent ? html`<span className="badge o" style=${{ marginLeft:'4px' }}><${Ic} n="zap" s=${11}/>Urgent</span>` : null}</b><small>${hint}</small></span><span className="price">${fmt(shown)}</span></div>
      <div className="stepper"><button onClick=${() => ACT.fee(-100)} aria-label="Lower the fee by ₦100"><${Ic} n="minus"/></button><span className="note" style=${{ flex:1, textAlign:'center' }}>Adjust your offer in ₦100 steps</span><button onClick=${() => ACT.fee(100)} aria-label="Raise the fee by ₦100"><${Ic} n="plus"/></button></div>
      <ul className="lines"><li><span>Service fee</span><span>${fmt(svc(s.fee))}</span></li>${s.promo ? html`<li><span>Promo LEKKI300</span><span style=${{ color:'var(--brand-ink)' }}>−${fmt(PROMO)}</span></li>` : null}<li className="tot"><span>Held when an agent accepts</span><span>${fmt(hold)}</span></li></ul>
      <div className="list">
        <button className=${'li payline' + (covers ? '' : ' short')} onClick=${() => ACT.sheet('topup')}><span className="ico"><${Ic} n="wallet" s=${19}/></span><span className="tx">Wallet · ${fmt(s.balance)}<small>${covers ? 'Covers this errand' : 'Top up to continue'}</small></span><${Ic} n="chev" s=${18}/></button>
        <${Row} ic="gift" icls=${s.promo ? 'g' : ''} t=${s.promo ? 'LEKKI300 applied' : 'Add promo code'} sub=${s.promo ? 'Your agent is still paid in full' : null} on=${() => { if (!s.promo) ACT.sheet('promo'); }}/>
      </div>
      ${s.idState === 'pending' ? html`<button className="btn pri block" disabled>Available once your ID is approved</button>` : html`<button className="btn pri block" onClick=${ACT.request}>Request agent · ${fmt(hold)}</button>`}
    </section>
  </div>`;
}
function Matching({ s }) {
  const [ref, h] = useHeight();
  return html`<div className="mapscreen">
    <${MapCanvas} scene=${sceneFor('matching', s)} insets=${{ t:70, b:h }}/>
    <button className="fab" style=${{ top:'14px', left:'var(--gl)' }} onClick=${ACT.close} aria-label="Back to home"><${Ic} n="back" s=${24}/></button>
    <section className="sheet" ref=${ref}>
      <div className="shimmer" aria-hidden="true"></div>
      <div><h1 className="t2">${s.urgent ? 'Sending to the nearest agents' : 'Finding your agent'}</h1><p className="sub">${s.urgent ? 'The first agent to accept gets it.' : 'Agents near Shoprite can see it and accept.'}</p></div>
      <div style=${{ display:'flex', alignItems:'center', gap:'10px' }}><span className="stack" style=${{ display:'flex' }}>${['chinedu', 'aisha', 'ibrahim', 'kemi', 'femi'].map((w, k) => html`<span key=${w} style=${{ marginLeft:k ? '-10px' : 0, borderRadius:'50%', boxShadow:'0 0 0 2px var(--surface)' }}><${Face} who=${w}/></span>`)}</span><span className="sub">6 agents online within 3 km</span></div>
      <div className="list">
        <div className="li"><span className="ico"><span className="mk pick"></span></span><span className="tx"><b>${PL(s.pick).name}</b><small>${PL(s.pick).addr}</small></span></div>
        <div className="li"><span className="ico"><span className="mk drop"></span></span><span className="tx"><b>${PL(s.drop).name}</b><small>${PL(s.drop).addr}</small></span></div>
        <div className="li"><span className="ico"><${Ic} n="wallet" s=${19}/></span><span className="tx"><b className="num">${fmt(s.fee)} offer</b><small>Nothing is held until an agent accepts</small></span><button className="btn sm soft" onClick=${ACT.raise}>+ ₦200</button></div>
      </div>
      <button className="btn text block" onClick=${ACT.cancelReq}>Cancel request</button>
    </section>
  </div>`;
}
const TL_NOTE = ['Price agreed in chat', 'Price fixed', 'Receipt checked', 'PIN or photo', 'Money released'];
function Needs({ s }) {
  const a = agent(), pend = s.items.filter(i => i.st === 'pending').pop();
  if (pend && pend.card === 'counter') return html`<button className="needs" onClick=${ACT.openChat}><span className="ico o"><${Ic} n="edit" s=${18}/></span><span className="tx"><b>New price from ${a.first}: ${fmt(pend.amt)}</b><small>Accept or decline in the chat</small></span><${Ic} n="chev" s=${18}/></button>`;
  if (pend && pend.card === 'item') return html`<button className="needs" onClick=${ACT.openChat}><span className="ico o"><${Ic} n="bag" s=${18}/></span><span className="tx"><b>Lock ${fmt(pend.amt)} for your items</b><small>Receipt and photos are in the chat</small></span><${Ic} n="chev" s=${18}/></button>`;
  if (pend && pend.card === 'photo') return html`<button className="needs" onClick=${ACT.openChat}><span className="ico o"><${Ic} n="camera" s=${18}/></span><span className="tx"><b>Approve the drop-off photo</b><small>Nothing is paid until you approve</small></span><${Ic} n="chev" s=${18}/></button>`;
  return null;
}
function Trip({ s }) {
  const a = agent(), st = stageInfo(s), api = useRef(), drag = useRef(null), box = useRef(), top = useRef(), chips = useRef(), c = CAT(s.cat) || CATS[0];
  const [H, setH] = useState(844), [topH, setTopH] = useState(250), [peek, setPeek] = useState(190), [moved, setMoved] = useState(false);
  useLayoutEffect(() => {
    if (box.current) setH(box.current.clientHeight);
    if (top.current && top.current.offsetHeight !== topH) setTopH(top.current.offsetHeight);
    if (chips.current) { const p = chips.current.offsetTop + chips.current.offsetHeight + 20; if (Math.abs(p - peek) > 1) setPeek(p); }
  });
  const sheetH = s.expanded ? H - topH - 24 : peek;
  const held = s.heldFee + s.heldItems;
  const down = e => { drag.current = { y:e.clientY, d:0 }; e.currentTarget.setPointerCapture(e.pointerId); };
  const move = e => { if (drag.current) drag.current.d = e.clientY - drag.current.y; };
  const up = () => { if (!drag.current) return; const d = drag.current.d; drag.current = null; if (Math.abs(d) < 6) ACT.expand(); else ACT.expand(d < 0); };
  return html`<div className="mapscreen" ref=${box}>
    <${MapCanvas} interactive=${true} scene=${sceneFor('live', s)} insets=${{ t:topH + 30, b:peek + 16, l:36, r:36 }} apiRef=${api} onUser=${() => setMoved(true)}/>
    <section className="tcard" ref=${top} aria-live="polite" aria-label="Errand status">
      <div className="tcrow">
        <button className="ib" onClick=${ACT.close} aria-label="Back to home"><${Ic} n="down" s=${24}/></button><span className="grow"></span>
        <button className="pillbtn sos" onClick=${() => ACT.sheet('sos')}><${Ic} n="shield" s=${16}/>Safety</button>
        <button className="pillbtn" onClick=${() => toast('Help', 'Not part of this prototype')}>Help</button>
      </div>
      <span className=${'tchip ' + (st.chip ? st.chip[1] : 'k')}>${st.chip && st.chip[1] === 'g' && s.phase !== 'done' ? html`<span className="dot"></span>` : null}${st.chip ? st.chip[0] : ''}</span>
      <h1 className="tbig">${st.big || st.title}</h1>
      <p className="tsub">${st.at ? `Estimated ${st.at} · ` : ''}${st.sub}</p>
      <${TBar} i=${st.i}/>
      <div className="tagent">
        <button className="who" onClick=${() => ACT.sheet('profile')} aria-label=${`${a.first}, see profile and reviews`}><${Face} who=${a.face}/><span className="tx"><b>${a.first} ${a.full.split(' ')[1][0]}.<${Verified} s=${15}/><span className="rt"><${StarF} s=${12}/>${a.rating}</span></b><small>${st.doing || ''}</small></span></button>
        <button className="cbtn" onClick=${ACT.openChat} aria-label=${`Chat with ${a.first}${s.unread ? `, ${s.unread} unread` : ''}`}><${Ic} n="chat" s=${20}/>${s.unread ? html`<span className="n">${s.unread}</span>` : null}</button>
        <button className="cbtn" onClick=${() => ACT.call(true)} aria-label=${`Call ${a.first}`}><${Ic} n="phone" s=${20}/></button>
      </div>
    </section>
    ${moved && !s.expanded ? html`<button className="fab" style=${{ right:'var(--gr)', bottom:(sheetH + 14) + 'px' }} onClick=${() => { api.current && api.current.recenter(); setMoved(false); }} aria-label="Recenter the map"><${Ic} n="locate"/></button>` : null}
    <section className="trip" style=${{ height:sheetH + 'px' }} aria-label="Errand details">
      <div className="grabzone" onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up} role="button" tabIndex="0" aria-label=${s.expanded ? 'Show more map' : 'Show more details'}
        onKeyDown=${e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ACT.expand(); } }}><span className="handle"></span></div>
      <div className="body">
        <${Needs} s=${s}/>
        ${s.phase === 'dropoff' ? html`<button className="btn pri block pinbtn" onClick=${ACT.showPin}><${Ic} n="lock" s=${19}/>Show hand-off PIN</button>` : null}
        <button className="errcard" onClick=${() => ACT.expand(true)} aria-label="Errand details">
          <span className="tile"><${Ic} n=${c.ic} s=${20}/></span>
          <span className="tx"><b>${PL(s.pick).name} to ${PL(s.drop).name}</b><small>${c.short} · ${s.buy ? 'agent buys items' : 'no purchase'}</small></span>
          <span className="held"><b>${fmt(held)}</b><small><${Ic} n="lock" s=${11}/>held</small></span>
        </button>
        <div className="qchips" ref=${chips}>
          <button className="chip" onClick=${() => ACT.sheet('share')}><${Ic} n="share" s=${16}/>Share live</button>
          <button className="chip" onClick=${() => ACT.expand(true)}><${Ic} n="doc" s=${16}/>Details</button>
          <button className="chip" onClick=${() => toast('Report started', 'Reviewed with the chat and GPS trail')}><${Ic} n="flag" s=${16}/>Report</button>
        </div>
        <div className="divider"></div>
        <div className="block"><h2 className="sec">Progress</h2>
          <ul className="tl">${stepsFor(s).map((t, k) => html`<li key=${k} className=${k < st.i ? 'done' : k === st.i ? 'now' : ''}><span className="dotx">${k < st.i ? html`<${Ic} n="check" s=${12} w=${3.2}/>` : null}</span><span><b>${t}</b><small>${k === 2 && !s.buy ? 'Heading to drop-off' : TL_NOTE[k]}</small></span><time>${k <= st.i ? TIMES[k] : ''}</time></li>`)}</ul></div>
        <div className="block"><h2 className="sec">Money held</h2>
          <ul className="lines"><li><span>Errand fee</span><span>${fmt(s.agreed)}</span></li><li><span>Service fee</span><span>${fmt(svc(s.agreed))}</span></li>${s.promo ? html`<li><span>Promo</span><span>−${fmt(PROMO)}</span></li>` : null}${s.heldItems ? html`<li><span>Items (locked)</span><span>${fmt(s.heldItems)}</span></li>` : null}<li className="tot"><span>Held until hand-off</span><span>${fmt(held)}</span></li></ul>
          <p className="note">${a.first} is paid only when you give your PIN or approve the drop-off photo.</p></div>
        <div className="block"><h2 className="sec">Errand</h2><p style=${{ margin:0 }}>${s.desc}</p>
          <div className="list"><div className="li"><span className="ico"><span className="mk pick"></span></span><span className="tx"><b>${PL(s.pick).name}</b><small>${PL(s.pick).addr}</small></span></div><div className="li"><span className="ico"><span className="mk drop"></span></span><span className="tx"><b>${PL(s.drop).name}</b><small>${PL(s.drop).addr}</small></span></div></div></div>
        <div className="list"><${Row} ic="x" t="Cancel errand" sub=${s.phase === 'accepted' ? `${a.first} accepts or rejects the request` : 'Items are bought: open a dispute instead'} on=${() => toast('Cancellation request sent', `${a.first} accepts or rejects it`)}/></div>
      </div>
    </section>
  </div>`;
}
function Chat({ s }) {
  const a = agent(), st = stageInfo(s), ta = useRef();
  useLayoutEffect(() => { const el = ta.current; if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px'; } }, [s.chat]);
  const hints = ['Where are you now?', 'Call me when you arrive', 'Please take a photo of the items'];
  return html`<div className="chat">
    <header className="chathead"><button className="ib" onClick=${ACT.closeChat} aria-label="Back"><${Ic} n="back" s=${24}/></button><button className="chatwho" onClick=${() => ACT.sheet('profile')} aria-label=${`${a.full}, see profile`}><${Face} who=${a.face}/><span className="tx"><b>${a.first} ${a.full.split(' ')[1][0]}.<${Verified} s=${16}/></b><small>${a.rating} ★ · ${st.title}</small></span></button>
      <button className="ib" onClick=${() => ACT.call(true)} aria-label=${`Call ${a.first} in the app`}><${Ic} n="phone" s=${21}/></button></header>
    <button className="pinned" style=${{ border:'none', textAlign:'left', width:'100%' }} onClick=${ACT.openErrand}><span className="tx"><b>${PL(s.pick).name} to ${PL(s.drop).name}</b><${Segs} i=${st.i}/></span>${st.eta ? html`<span className="note num" style=${{ fontWeight:700, color:'var(--ink)' }}>${st.eta} min</span>` : null}<${Ic} n="map" s=${18}/></button>
    <${ChatThread} s=${s}/>
    <div className="edock">
      <div className="hints">${hints.map(h => html`<button key=${h} className="hint-chip" onClick=${() => ACT.sendChat(h)}>${h}</button>`)}</div>
      <div className="composer">
        <button className="cb" aria-label="Add a photo" onClick=${() => ACT.sheet('attach')}><${Ic} n="plus"/></button>
        <label className="sr" htmlFor="chatbox">Message ${a.first}</label>
        <textarea id="chatbox" ref=${ta} rows="1" placeholder=${`Message ${a.first}`} value=${s.chat} onChange=${e => set({ chat:e.target.value })} onKeyDown=${e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ACT.sendChat(); } }}></textarea>
        <button className="cb" aria-label="Record a voice note" onClick=${() => toast('Hold to record a voice note', 'It sends like a message')}><${Ic} n="mic"/></button>
        <button className="cb send" aria-label="Send" disabled=${!s.chat.trim()} onClick=${() => ACT.sendChat()}><${Ic} n="up" s=${20} w=${2.4}/></button>
      </div>
      <p className="note" style=${{ textAlign:'center', marginTop:'8px', fontSize:'12px' }}>Calls aren't recorded. Confirm anything you agree on a call here.</p>
    </div>
  </div>`;
}
function Rate({ s }) {
  const a = agent(), f = svc(s.agreed), items = s.receiptTotal || 29350;
  return html`<div className="screen">
    <div className="pbody" style=${{ paddingTop:'28px', gap:'22px' }}>
      <div className="hero"><span className="tick"><${Ic} n="check" s=${36} w=${2.8}/></span><h1 className="t1">Delivered to Home</h1><p className="sub">2:46 PM · ${s.method === 'photo' ? 'drop-off photo approved' : 'confirmed with your PIN'}</p></div>
      <div className="block" style=${{ alignItems:'center', textAlign:'center' }}><${Face} who=${a.face} cls="lg"/><h2 className="t2">How was your errand with ${a.first}?</h2>
        <div className="stars" role="group" aria-label="Rating">${[1, 2, 3, 4, 5].map(n => html`<button key=${n} aria-pressed=${n <= s.rating} aria-label=${`${n} star${n > 1 ? 's' : ''}`} onClick=${() => ACT.star(n)}><${Ic} n="star" s=${34} w=${1.6}/></button>`)}</div></div>
      <div className="block"><h2 className="sec">Add a tip</h2><p className="note" style=${{ marginTop:'-6px' }}>It goes to ${a.first} in full.</p><div className="tips">${[0, 200, 500, 1000].map(n => html`<button key=${n} aria-pressed=${s.tip === n} onClick=${() => ACT.tip(n)}>${n ? fmt(n) : 'None'}</button>`)}</div></div>
      <div className="block"><h2 className="sec">Receipt</h2><ul className="lines"><li><span>Errand fee</span><span>${fmt(s.agreed)}</span></li><li><span>Service fee</span><span>${fmt(f)}</span></li>${s.promo ? html`<li><span>Promo</span><span>−${fmt(PROMO)}</span></li>` : null}<li><span>Items (Shoprite receipt)</span><span>${fmt(items)}</span></li>${s.tip ? html`<li><span>Tip</span><span>${fmt(s.tip)}</span></li>` : null}<li className="tot"><span>Total</span><span>${fmt(s.agreed + f + items + s.tip - (s.promo ? PROMO : 0))}</span></li></ul></div>
    </div>
    <footer className="sfoot"><button className="btn pri block" onClick=${ACT.submitRating}>${s.rating ? 'Submit' : 'Done'}</button></footer>
  </div>`;
}
function ErrandsTab({ s }) {
  return html`<div className="tabpage">
    <header className="phead big"><h1>Errands</h1></header>
    <div className="pbody">
      ${isLive(s) ? html`<div className="block"><h2 className="sec">Happening now</h2><${LiveCard} s=${s}/></div>` : null}
      ${s.newbie && !s.history.length && !isLive(s) ? html`<div className="empty"><span className="ico"><${Ic} n="history" s=${24}/></span><b>No errands yet</b><p className="note">Errands you request show here, with a receipt for each one.</p><button className="btn pri sm" onClick=${() => ACT.tab('home')}>Request an errand</button></div>` : null}
      ${s.newbie ? null : html`<div className="block"><h2 className="sec">Upcoming</h2>
        <button className="erow"><span className="thumb"><${Raw} svg=${ART.queue}/></span><span className="tx"><b>Queue at the passport office</b><small>Sat, 14 Nov · 8:00 AM</small><small>Alagbon Close, Ikoyi</small></span><span className="badge">Booked</span></button></div>`}
      ${s.history.length ? html`<div className="block"><h2 className="sec">Past</h2>
        <div className="list">${s.history.map((h, k) => html`<button key=${k} className="erow" onClick=${() => ACT.sheet('receipt', { k })}><span className="thumb"><${Raw} svg=${ART[h.art]}/></span><span className="tx"><b>${h.t}</b><small>${h.d}</small><small>${h.s}</small></span><span className="amt2 num">${fmt(h.a)}</span></button>`)}</div></div>` : null}
    </div>
  </div>`;
}
const TXTYPE = { bank:'Bank transfer in', lock:'Held in escrow', bag:'Errand payment', receipt:'Refund to wallet', route:'Errand payment' };
function WalletTab({ s }) {
  const held = s.heldFee + s.heldItems, total = useTween(s.balance + held);
  const groups = [];
  s.tx.forEach((t, k) => { const day = t.day || 'Today'; let g = groups.find(x => x.day === day); if (!g) groups.push(g = { day, rows:[] }); g.rows.push([t, k]); });
  return html`<div className="tabpage">
    <header className="phead big"><h1>Wallet</h1></header>
    <div className="pbody" style=${{ gap:'18px' }}>
      <section className="wbal" aria-label="Errand balance"><small>Errand balance</small><div className="num">${fmt(total)}</div></section>
      <div className="wbreak">
        <div className="wrow"><span className="tx"><b>Available to spend</b><small>Used when an agent accepts your errand</small></span><b className="num">${fmt(s.balance)}</b></div>
        <button className="wrow" disabled=${!held} onClick=${ACT.openErrand}><span className="tx"><b><${Ic} n="lock" s=${15}/>Held until hand-off</b><small>${held ? `Your ${PL(s.pick).name} run · tap to open it` : 'Nothing is held right now'}</small></span><b className="num">${fmt(held)}</b>${held ? html`<${Ic} n="chev" s=${16}/>` : null}</button>
        <button className="btn soft block" onClick=${() => ACT.sheet('howbal')}>How your balance works</button>
      </div>
      <div className="wtiles">
        <button className="wtile" onClick=${() => ACT.sheet('topup')}><${Ic} n="plus" s=${22}/>Add money</button>
        <button className="wtile" onClick=${() => ACT.sheet('promo')}><${Ic} n="gift" s=${22}/>Promo codes</button>
        <button className="wtile" onClick=${() => toast('Invite friends', 'Wallet credit when they finish their first errand')}><${Ic} n="users" s=${22}/>Invite friends</button>
      </div>
      <div className="divider"></div>
      <div className="block" style=${{ gap:'4px' }}><h2 className="sec">Latest transactions</h2>
        ${groups.length ? groups.map(g => html`<div key=${g.day}><p className="tday">${g.day}</p><div className="list">${g.rows.map(([t, k]) => html`<button key=${k} className="li txrow" onClick=${() => ACT.sheet('txn', { k })}><span className=${'tile' + (t.a > 0 ? ' g' : '')}><${Ic} n=${t.i} s=${19}/></span><span className="tx"><b>${t.n}</b><small>${t.d}</small></span><span className=${'wamt' + (t.a > 0 ? ' in' : '')}>${t.a > 0 ? '+' : '−'}${fmt(Math.abs(t.a))}</span><${Ic} n="chev" s=${16}/></button>`)}</div></div>`)
          : html`<div className="empty"><span className="ico"><${Ic} n="wallet" s=${24}/></span><b>No transactions yet</b><p className="note">Money you add by bank transfer, and what each errand costs, shows here.</p></div>`}
      </div>
      <p className="note wfoot"><${Ic} n="info" s=${16}/><span>Your balance is for errands and can't be withdrawn. If you close your account, support refunds what's left.</span></p>
    </div>
  </div>`;
}
function AccountTab({ s }) {
  const soon = t => () => toast(t, 'Not part of this prototype');
  return html`<div className="tabpage">
    <div className="pbody acct">
      <${AccHead} face="tolu" name="Tolu Adebayo" sub=${html`<${Verified} s=${15}/>ID verified · See how agents see you`} on=${() => ACT.sheet('me')}/>
      <${AccStats} items=${[[html`4.8<span style=${{ fontSize:'15px' }}> ★</span>`, 'Your rating'], [String(57 + s.history.length - HISTORY.length), 'Errands'], ['0', 'Disputes']]}/>
      <button className="invcard" onClick=${soon('Invite friends')}><span className="tx"><b>Invite friends, get errand credit</b><small>When they finish their first errand. Code TOLU2K</small></span><span className="disc"><${Ic} n="gift" s=${24}/></span></button>
      <nav className="menu" aria-label="Account">
        <${MRow} ic="pin" t="Saved places" right=${html`<small>3</small>`} on=${soon('Saved places')}/>
        <${MRow} ic="gift" t="Promo codes" right=${html`<span className="badge g">1 ready</span>`} on=${soon('Promo codes')}/>
        <${MRow} ic="shield" t="Safety" on=${soon('Safety')}/>
        <${MRow} ic="bell" t="Notifications" on=${soon('Notifications')}/>
        <${MRow} ic="help" t="Help" on=${soon('Help')}/>
      </nav>
      <${Minor} items=${[['Language', soon('Language'), '', 'English'], ['Terms and privacy', soon('Terms and privacy')], ['Log out', soon('Log out')], ['Delete account', soon('Delete account'), 'dang']]}/>
      <p className="ver">Jiffo 1.0 · prototype</p>
    </div>
  </div>`;
}
