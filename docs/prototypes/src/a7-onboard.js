/* ================= Agent sign-up: application checklist ================= */
const SLIDES = [
  ['lock', 'The fee is held before you move', "When you accept, the customer's errand fee is locked in escrow. It's paid to you when the customer confirms hand-off."],
  ['play', 'Agree the price, then Start service', 'You can send a new price until you tap Start service. After that the fee is fixed.'],
  ['camera', 'Buy, then send the amount with photos', 'On purchase errands you buy first, then send the item amount with a receipt photo and an items photo. The customer locks it.'],
  ['shield', 'Get paid with the PIN', "Mark it delivered, then enter the customer's 4-digit PIN. Item money is yours to withdraw at once."]
];

function AWelcome() {
  const cards = [['cart', 'Groceries from Shoprite', 'Lekki · 4.2 km', '₦1,500'], ['box', 'Parcel to Chevron Drive', 'Lekki · 6.1 km', '₦1,800'], ['users', 'Passport office queue', 'Ikoyi · Sat 8:00 AM', '₦6,000']];
  return html`<section className="ob welcome" aria-label="Welcome">
    <div className="wtop">
      <div className="brandline"><${Raw} cls="appic" svg=${APPICON('#0B0B0B', '#3DD68C')}/><${Raw} cls="wm" svg=${WORDMARK}/><small>Agent</small></div>
      <div className="jobcards" aria-hidden="true">${cards.map(([ic, t, sub, fee]) => html`<div key=${t} className="jc"><span className="ico"><${Ic} n=${ic} s=${19}/></span><span className="tx"><b>${t}</b><small>${sub}</small></span><span className="fee">${fee}</span></div>`)}</div>
    </div>
    <div className="wbot">
      <h1 className="obq">Earn running errands near you</h1>
      <ul className="perks">
        <li><span className="ico"><${Ic} n="clock" s=${17}/></span>Go online when it suits you</li>
        <li><span className="ico"><${Ic} n="tune" s=${17}/></span>Choose the errands you take</li>
        <li><span className="ico"><${Ic} n="bank" s=${17}/></span>Withdraw to your bank every day</li>
      </ul>
      <button className="btn pri block" onClick=${() => ACT.obStart('signup')}>Get started</button>
      <button className="btn soft block" onClick=${() => ACT.obStart('login')}>Log in</button>
    </div>
  </section>`;
}

function ABasics({ ob }) {
  const ok = ob.first.trim() && ob.last.trim() && /.+@.+\..+/.test(ob.email) && ob.state && ob.area.trim();
  const open = (STATES.find(x => x[0] === ob.state) || [])[1];
  return html`<${ObScreen} label="About you" back=${() => ACT.obTo('phone')} foot=${html`<${Continue} ok=${ok} on=${ACT.obBasicsNext} label=${open ? 'Continue' : 'Join the waitlist'}/>`}>
    <${Q} t="Tell us about you" sub="Use the name on your NIN. Customers see your first name and photo."/>
    <div className="pair">
      <input className="tin" aria-label="First name" autoComplete="given-name" placeholder="First name" value=${ob.first} onChange=${e => setOb({ first:e.target.value })}/>
      <input className="tin" aria-label="Last name" autoComplete="family-name" placeholder="Last name" value=${ob.last} onChange=${e => setOb({ last:e.target.value })}/>
    </div>
    <div className="fgroup"><label className="flabel" htmlFor="aem">Email</label><input id="aem" className="tin" type="email" autoComplete="email" value=${ob.email} onChange=${e => setOb({ email:e.target.value })}/></div>
    <div className="fgroup"><span className="flabel" id="stL">State you'll work in</span>
      <button className="input" aria-labelledby="stL" onClick=${() => set({ sheet:{ type:'states' } })}><span className="val">${ob.state}</span>${open ? null : html`<span className="badge o">Waitlist</span>`}<${Ic} n="down" s=${18}/></button></div>
    <div className="fgroup"><label className="flabel" htmlFor="area">Area</label><input id="area" className="tin" placeholder="For example Lekki" value=${ob.area} onChange=${e => setOb({ area:e.target.value })}/><p className="note">Errands come from around where you are when online. This only sets your starting area.</p></div>
  <//>`;
}

function AWaitlist({ ob }) {
  return html`<${ObScreen} label="Waitlist" back=${() => ACT.obTo('basics')} foot=${html`<button className="btn pri block" onClick=${() => ACT.obTo('basics')}>Choose another state</button>`}>
    <div className="hero"><span className="tick" style=${{ background:'var(--urgent-soft)', color:'var(--urgent)' }}><${Ic} n="clock" s=${34}/></span><h1 className="obq">You're on the ${ob.state} waitlist</h1>
      <p className="sub">We have enough agents in ${ob.state} for now. We'll text +234 ${ob.phone} when a place opens, and your details stay saved.</p></div>
    <div className="kv"><div><span>Your place</span><b>214 in line</b></div><div><span>Usual wait</span><b>2 to 4 weeks</b></div></div>
  <//>`;
}

function AList({ ob, manual }) {
  const n = A_STEPS.filter(([k]) => ob.done[k]).length, all = n === A_STEPS.length, next = (A_STEPS.find(([k]) => !ob.done[k]) || [])[0];
  return html`<${ObScreen} label="Your application" back=${() => ACT.obTo('basics')} foot=${html`<${Continue} ok=${all} on=${ACT.obSubmit} label="Submit application"/><p className="note">${all ? (manual ? `Our team reviews it, usually within ${CONFIG.reviewHours} hours.` : `${CONFIG.provider} runs the checks straight away.`) : `${A_STEPS.length - n} step${A_STEPS.length - n > 1 ? 's' : ''} left`}</p>`}>
    <div><p className="cap">${ob.state} · ${ob.area}</p><h1 className="obq" style=${{ marginTop:'6px' }}>Welcome, ${ob.first}</h1><p className="sub" style=${{ marginTop:'8px' }}>Finish these to start earning. We save as you go, so you can stop and come back.</p></div>
    <div className="meter"><div className="mh"><span>Progress</span><b>${n} of ${A_STEPS.length} done</b></div><span className="bar1"><span style=${{ width:(n / A_STEPS.length * 100) + '%', transition:'width .4s var(--ease)' }}></span></span></div>
    <div className="list">${A_STEPS.map(([k, t, sub0, ic]) => {
      const d = ob.done[k], sub = manual ? sub0 : k === 'id' ? `NIN, BVN and a selfie, checked by ${CONFIG.provider}` : k === 'addr' ? `Confirmed by ${CONFIG.provider}, plus who to call` : sub0;
      return html`<button key=${k} className="li steprow" onClick=${() => ACT.obOpen(k)}><span className=${'ico' + (d ? ' g' : k === next ? ' k' : '')}><${Ic} n=${d ? 'check' : ic} s=${19}/></span><span className="tx"><b>${t}</b><small>${d ? 'Done' : sub}</small></span>${!d && k === next ? html`<span className="badge">Next</span>` : null}<${Ic} n="chev" s=${18}/></button>`;
    })}</div>
  <//>`;
}

function AAddress({ ob, manual }) {
  const ok = ob.addr.trim() && ob.ecName.trim() && digits(ob.ecPhone, 10).length === 10 && (!manual || ob.addrPhoto);
  return html`<${ObScreen} label="Address and emergency contact" back=${() => ACT.obTo('list')} foot=${html`<${Continue} ok=${ok} on=${() => ACT.obMark('addr')} label="Save"/>`}>
    <${Q} t="Address and emergency contact"/>
    <div className="fgroup"><label className="flabel" htmlFor="addr">Home address</label><input id="addr" className="tin" autoComplete="street-address" value=${ob.addr} onChange=${e => setOb({ addr:e.target.value })}/><p className="note">${ob.area}, ${ob.state}. Only our safety team sees it.</p></div>
    ${manual ? html`<div className="fgroup"><span className="flabel">Proof of address</span><${Shot} label="Utility bill or tenancy receipt" sub="From the last 3 months, showing your name and this address" done=${ob.addrPhoto} art=${PHOTO.bill} take=${() => setOb({ addrPhoto:true })}/></div>`
      : html`<div className="waiting"><${Ic} n="shield" s=${19}/><span className="tx"><b>${CONFIG.provider} confirms this address</b><small>When you submit. They may send a field agent to visit.</small></span></div>`}
    <h2 className="sec" style=${{ margin:'4px 0 0' }}>Emergency contact</h2>
    <p className="note" style=${{ marginTop:'-10px' }}>We only call them if you press the emergency button, or can't be reached during an errand.</p>
    <div className="fgroup"><label className="flabel" htmlFor="ecn">Name</label><input id="ecn" className="tin" value=${ob.ecName} onChange=${e => setOb({ ecName:e.target.value })}/></div>
    <div className="fgroup"><label className="flabel" htmlFor="ecp">Phone number</label><div className="tel"><span className="ccode" aria-hidden="true"><${Flag}/>+234</span><input id="ecp" className="tin" inputMode="numeric" value=${ob.ecPhone} onChange=${e => setOb({ ecPhone:spaced(e.target.value, [3, 3, 4]) })}/></div></div>
    <div className="fgroup"><span className="flabel">Relationship</span><div className="chips" style=${{ flexWrap:'wrap' }}>${['Parent', 'Sibling', 'Spouse', 'Friend', 'Other'].map(r => html`<button key=${r} className="chip" aria-pressed=${ob.ecRel === r} onClick=${() => setOb({ ecRel:r })}>${r}</button>`)}</div></div>
  <//>`;
}

function ABank({ ob }) {
  const d = digits(ob.acct, 10);
  return html`<${ObScreen} label="Payout account" back=${() => ACT.obTo('list')} foot=${html`<${Continue} ok=${ob.acctOk} on=${() => ACT.obMark('bank')} label="Save"/>`}>
    <${Q} t="Payout account" sub="Earnings and item money are paid here. It must be in your own name."/>
    <div className="fgroup"><span className="flabel" id="bkL">Bank</span><button className="input" aria-labelledby="bkL" onClick=${() => set({ sheet:{ type:'banks' } })}><span className="ico" style=${{ width:'32px', height:'32px' }}><${Ic} n="bank" s=${17}/></span><span className="val">${ob.bank}</span><${Ic} n="down" s=${18}/></button></div>
    <div className="fgroup"><label className="flabel" htmlFor="acct">Account number</label><input id="acct" className="tin" inputMode="numeric" placeholder="10 digits" value=${d} onChange=${e => ACT.obAcct(e.target.value)} style=${{ letterSpacing:'.06em' }}/>
      ${d.length < 10 ? html`<button className="link" style=${{ alignSelf:'flex-start', fontSize:'14.5px' }} onClick=${() => ACT.obAcct('0123454821')}>Use the sample account number</button>` : null}</div>
    ${ob.looking ? html`<div className="waiting" role="status"><span className="spinner"></span><span className="tx"><b>Looking up the account name</b><small>${ob.bank}</small></span></div>` : null}
    ${ob.acctOk ? html`<div className="lookup"><span className="ico g"><${Ic} n="check" s=${18} w=${2.6}/></span><span className="tx"><b>${(ob.first + ' ' + ob.last).toUpperCase()}</b><small>${ob.done.id ? 'Matches the name on your NIN' : 'We match this to your NIN when you verify'}</small></span></div>` : null}
    <p className="note">Payouts never go to someone else's account. To change it later, you verify with a selfie.</p>
  <//>`;
}

function APrefs({ s }) {
  return html`<${ObScreen} label="Errand preferences" back=${() => ACT.obTo('list')} foot=${html`<${Continue} ok=${true} on=${() => ACT.obMark('prefs')} label="Save"/>`}>
    <${Q} t="Which errands do you want?" sub="Everything is on to start. You'll only get requests that match, and you can change this any time."/>
    <${PrefsBody} p=${s.prefs}/>
  <//>`;
}

function ALearn({ ob }) {
  const i = ob.slide, last = SLIDES.length, onTerms = i >= last;
  if (onTerms) return html`<${ObScreen} label="Agent terms" back=${() => ACT.obSlide(last - 1)} foot=${html`<${Continue} ok=${ob.agree} on=${() => ACT.obMark('learn')} label="Agree and finish"/>`}>
    <${Q} t="Agent terms" sub="The short version. The full terms are one tap away."/>
    <ul className="terms">
      ${["You're an independent contractor, not an employee.", 'You choose your own hours and which errands you take.', 'You handle your own tax on what you earn.', 'On purchase errands, item money is your risk until the customer locks the amount.', 'Customers rate you, and repeated cancellations add strikes.'].map(t => html`<li key=${t}><${Ic} n="check" s=${16} w=${2.6}/><span>${t}</span></li>`)}
    </ul>
    <button className="link" style=${{ alignSelf:'flex-start', fontSize:'15px' }} onClick=${notInProto('Full agent terms')}>Read the full agent terms</button>
    <${Tick} id="agreeA" on=${ob.agree} toggle=${() => setOb(o => ({ agree:!o.agree }))}>I'm 18 or older and agree to the agent terms.<//>
  <//>`;
  const [ic, t, p] = SLIDES[i];
  return html`<${ObScreen} label="How errands work" back=${() => i ? ACT.obSlide(i - 1) : ACT.obTo('list')} foot=${html`<div className="dots" aria-hidden="true">${[...SLIDES, 0].map((_, k) => html`<i key=${k} className=${k === i ? 'on' : ''}></i>`)}</div><button className="btn pri block" onClick=${() => ACT.obSlide(i + 1)}>${i === last - 1 ? 'Last step: the terms' : 'Next'}</button>`}>
    <p className="cap">How errands work · ${i + 1} of ${last}</p>
    <div className="slide" key=${i}><span className="big"><${Ic} n=${ic} s=${46} w=${1.6}/></span><h1 className="obq">${t}</h1><p>${p}</p></div>
  <//>`;
}

function ASubmitted({ ob }) {
  return html`<${ObScreen} label="Application sent" foot=${html`<button className="btn soft block" onClick=${notInProto('Support chat')}><${Ic} n="chat" s=${18}/>Message support</button>`}>
    <div className="hero"><span className="tick" style=${{ background:'var(--urgent-soft)', color:'var(--urgent)' }}><${Ic} n="clock" s=${34}/></span><h1 className="obq">Application sent, ${ob.first}</h1>
      <p className="sub">Our team checks your NIN, BVN, selfie and proof of address by hand, usually within ${CONFIG.reviewHours} hours. We'll text you the result.</p></div>
    <${CheckList} items=${MANUAL_ITEMS} n=${MANUAL_ITEMS.length - 1}/>
  <//>`;
}

function AChecking({ ob }) {
  return html`<${ObScreen} label="Checking your application">
    <${Q} t="Checking your application" sub=${`${CONFIG.provider} is running the checks. Usually under a minute; an address visit can take longer. You can leave the app, we'll text you.`}/>
    <${CheckList} items=${CHECKS} n=${ob.checks}/>
  <//>`;
}

function AApproved({ ob }) {
  return html`<${ObScreen} label="Approved" foot=${html`<${Continue} ok=${true} on=${ACT.obFinish} label="Start earning"/>`}>
    <div className="hero"><span className="tick"><${Ic} n="check" s=${36} w=${3}/></span><h1 className="obq">You're approved, ${ob.first}</h1><p className="sub">Go online whenever you're ready. Your first time online each day starts with a quick selfie check.</p></div>
    <div className="kv">
      <div><span>Tier</span><b>Bronze · 15% commission</b></div>
      <div><span>Errand earnings</span><b>Withdrawable after 24 hours</b></div>
      <div><span>Item money</span><b>Withdrawable at once</b></div>
      <div><span>Payout account</span><b>${ob.bank} •••• ${digits(ob.acct || '0123454821', 10).slice(-4)}</b></div>
    </div>
  <//>`;
}

function AReview({ ob }) {
  return html`<${ObScreen} label="Under review" foot=${html`<button className="btn soft block" onClick=${notInProto('Support chat')}><${Ic} n="chat" s=${18}/>Message support</button>`}>
    <div className="hero"><span className="tick" style=${{ background:'var(--urgent-soft)', color:'var(--urgent)' }}><${Ic} n="clock" s=${34}/></span><h1 className="obq">Your application is under review</h1>
      <p className="sub">${CONFIG.provider} couldn't match your selfie to your ID photo after three tries. Our team looks at the result within ${CONFIG.reviewHours} hours and texts you.</p></div>
    <${CheckList} items=${CHECKS} n=${CHECKS.length} flag=${ob.flag}/>
  <//>`;
}

function Onboard({ s }) {
  const ob = s.ob, st = ob.step, login = ob.mode === 'login', manual = s.kyc === 'manual';
  if (st === 'welcome') return html`<${AWelcome}/>`;
  if (st === 'phone') return html`<${PhoneStep} ob=${ob} back=${() => ACT.obTo('welcome')} next=${() => ACT.obTo('code')} title=${login ? 'Welcome back. What’s your phone number?' : 'What’s your phone number?'}/>`;
  if (st === 'code') return html`<${CodeStep} key=${ob.mode} ob=${ob} back=${() => ACT.obTo('phone')} onCode=${ACT.obCode}/>`;
  if (st === 'basics') return html`<${ABasics} ob=${ob}/>`;
  if (st === 'waitlist') return html`<${AWaitlist} ob=${ob}/>`;
  if (st === 'list') return html`<${AList} ob=${ob} manual=${manual}/>`;
  if (st === 'nin') return html`<${IdNumStep} ob=${ob} k="nin" field="nin" photoField="ninPhoto" photo=${manual} back=${() => ACT.obTo('list')} next=${() => ACT.obTo('bvn')} why="Step 1 of 3. Customers see a verified badge on every agent."/>`;
  if (st === 'bvn') return html`<${IdNumStep} ob=${ob} k="bvn" field="bvn" photo=${false} review=${manual} back=${() => ACT.obTo('nin')} next=${() => ACT.obTo(manual ? 'selfie' : 'bvnconsent')} why="Step 2 of 3. It confirms the payout account is yours. We can't move money with it."/>`;
  if (st === 'bvnconsent') return html`<${ConsentStep} ob=${ob} back=${() => ACT.obTo('bvn')} next=${() => ACT.obTo('selfie')}/>`;
  if (st === 'selfie') return html`<${FaceStep} ob=${ob} back=${() => ACT.obTo('bvn')} shoot=${ACT.obShoot} who="chinedu" manual=${manual}/>`;
  if (st === 'address') return html`<${AAddress} ob=${ob} manual=${manual}/>`;
  if (st === 'submitted') return html`<${ASubmitted} ob=${ob}/>`;
  if (st === 'bank') return html`<${ABank} ob=${ob}/>`;
  if (st === 'prefs') return html`<${APrefs} s=${s}/>`;
  if (st === 'learn') return html`<${ALearn} ob=${ob}/>`;
  if (st === 'checking') return html`<${AChecking} ob=${ob}/>`;
  if (st === 'approved') return html`<${AApproved} ob=${ob}/>`;
  if (st === 'review') return html`<${AReview} ob=${ob}/>`;
  return null;
}
