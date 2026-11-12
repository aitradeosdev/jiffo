/* ================= Customer sign-up and log in ================= */
const C_FLOW = ['phone', 'code', 'name', 'idtype', 'idnum', 'selfie', 'result', 'perms'];
const cprog = st => (C_FLOW.indexOf(st === 'verified' || st === 'pending' ? 'result' : st) + 1) / (C_FLOW.length + 1);

function CWelcome() {
  return html`<section className="ob welcome" aria-label="Welcome">
    <div className="wtop">
      <div className="brandline"><${Raw} cls="appic" svg=${APPICON('#0A7A4A', '#FFFFFF')}/><${Raw} cls="wm" svg=${WORDMARK}/></div>
      <div className="collage" aria-hidden="true">${['groceries', 'parcel', 'pharmacy', 'queue'].map((k, i) => html`<span key=${k} className=${'cc c' + i}><${Raw} svg=${ART[k]}/></span>`)}</div>
    </div>
    <div className="wbot">
      <h1 className="obq">Get your errands done</h1>
      <p className="sub">Groceries, parcels, pharmacy runs and queues, by verified agents near you. Your money is held until you have what you asked for.</p>
      <button className="btn pri block" onClick=${() => ACT.obStart('signup')}>Get started</button>
      <button className="btn soft block" onClick=${() => ACT.obStart('login')}>I already have an account</button>
    </div>
  </section>`;
}

function CName({ ob }) {
  const ok = ob.first.trim() && ob.last.trim() && /.+@.+\..+/.test(ob.email) && ob.agree;
  return html`<${ObScreen} label="Your details" back=${() => ACT.obTo('phone')} prog=${cprog('name')} foot=${html`<${Continue} ok=${ok} on=${() => ACT.obTo('idtype')}/>`}>
    <${Q} t="What's your name?" sub="Use the name on your ID, so we can match it."/>
    <div className="pair">
      <input className="tin" aria-label="First name" autoComplete="given-name" placeholder="First name" value=${ob.first} onChange=${e => setOb({ first:e.target.value })}/>
      <input className="tin" aria-label="Last name" autoComplete="family-name" placeholder="Last name" value=${ob.last} onChange=${e => setOb({ last:e.target.value })}/>
    </div>
    <div className="fgroup"><label className="flabel" htmlFor="em">Email</label>
      <input id="em" className="tin" type="email" autoComplete="email" placeholder="you@example.com" value=${ob.email} onChange=${e => setOb({ email:e.target.value })}/>
      <p className="note">For receipts. No marketing unless you ask for it.</p></div>
    ${ob.showInvite ? html`<div className="fgroup"><label className="flabel" htmlFor="inv">Invite code</label><input id="inv" className="tin" placeholder="For example TOLU2K" value=${ob.invite} onChange=${e => setOb({ invite:e.target.value.toUpperCase() })}/><p className="note">Your friend gets wallet credit after your first errand.</p></div>`
      : html`<button className="link" style=${{ alignSelf:'flex-start', fontSize:'15px' }} onClick=${() => setOb({ showInvite:true })}>Have an invite code?</button>`}
    <${Tick} id="agreeC" on=${ob.agree} toggle=${() => setOb(o => ({ agree:!o.agree }))}>I'm 18 or older and agree to the <button className="link" style=${{ fontSize:'inherit' }} onClick=${notInProto('Terms of use')}>Terms</button>. I've read the <button className="link" style=${{ fontSize:'inherit' }} onClick=${notInProto('Privacy notice')}>Privacy notice</button>.<//>
  <//>`;
}

function CVerified({ ob }) {
  return html`<${ObScreen} label="Verified" prog=${cprog('verified')} foot=${html`<${Continue} ok=${true} on=${() => ACT.obTo('perms')}/>`}>
    <div className="hero"><span className="tick"><${Ic} n="check" s=${36} w=${3}/></span><h1 className="obq">You're verified, ${ob.first}</h1><p className="sub">Your ID and selfie match. Agents see a verified badge next to your name.</p></div>
    <div className="kv">
      <div><span>Legal name</span><b>${ob.first} ${ob.last}</b></div>
      <div><span>Age</span><b>18 or older</b></div>
      <div><span>${ID_TYPES[ob.idType].name}</span><b>${maskId(ob.idType, ob.idNum)}</b></div>
      <div><span>Checked by</span><b>${CONFIG.provider}</b></div>
    </div>
    <div className="delivered"><${Ic} n="bank" s=${20}/><span className="tx"><b>Your account number is ready</b><small>Add money by bank transfer from any bank app. Cards aren't accepted.</small></span></div>
  <//>`;
}

function CPending({ ob }) {
  const t = ID_TYPES[ob.idType];
  return html`<${ObScreen} label="ID sent for review" prog=${cprog('pending')} foot=${html`<${Continue} ok=${true} on=${() => ACT.obTo('perms')}/>`}>
    <div className="hero"><span className="tick" style=${{ background:'var(--urgent-soft)', color:'var(--urgent)' }}><${Ic} n="clock" s=${34}/></span><h1 className="obq">We're checking your ID</h1>
      <p className="sub">A person on our team compares your ${t.short}, its photo and your selfie, usually within ${CONFIG.reviewHours} hours. We'll text you.</p></div>
    <${CheckList} items=${['Phone number confirmed', `${t.name} received`, 'Selfie received', 'Review by our team']} n=${3}/>
    <p className="note">Meanwhile you can look around. Adding money and requesting errands open once you're approved.</p>
  <//>`;
}

function CPerms({ ob }) {
  const btn = (on, k) => html`<button className=${'btn sm ' + (on ? 'soft' : 'pri')} onClick=${() => setOb({ [k]:true })} disabled=${on}>${on ? 'Allowed' : 'Allow'}</button>`;
  return html`<${ObScreen} label="Permissions" prog=${cprog('perms')} foot=${html`<${Continue} ok=${true} on=${ACT.obDone} label=${ob.loc && ob.notif ? 'Start using Jiffo' : 'Continue'}/><button className="btn text block" onClick=${ACT.obDone}>Not now</button>`}>
    <${Q} t="Two quick permissions" sub="Both are optional. You can change them later in your phone's settings."/>
    <div className="list">
      <div className="li"><span className="ico"><${Ic} n="locate" s=${19}/></span><span className="tx"><b>Location</b><small style=${{ whiteSpace:'normal' }}>Fills in your address and shows agents nearby. Agents never see it.</small></span>${btn(ob.loc, 'loc')}</div>
      <div className="li"><span className="ico"><${Ic} n="bell" s=${19}/></span><span className="tx"><b>Notifications</b><small style=${{ whiteSpace:'normal' }}>When your agent accepts, sends a price, starts and arrives.</small></span>${btn(ob.notif, 'notif')}</div>
    </div>
  <//>`;
}

function Onboard({ s }) {
  const ob = s.ob, st = ob.step, login = ob.mode === 'login';
  if (st === 'welcome') return html`<${CWelcome}/>`;
  if (st === 'phone') return html`<${PhoneStep} ob=${ob} back=${() => ACT.obTo('welcome')} prog=${login ? null : cprog('phone')} next=${() => ACT.obTo('code')} title=${login ? 'Welcome back. What’s your phone number?' : 'What’s your phone number?'}/>`;
  if (st === 'code') return html`<${CodeStep} key=${ob.mode} ob=${ob} back=${() => ACT.obTo('phone')} prog=${login ? null : cprog('code')} onCode=${ACT.obCode}/>`;
  if (st === 'name') return html`<${CName} ob=${ob}/>`;
  const manual = s.kyc === 'manual';
  if (st === 'idtype') return html`<${IdTypeStep} back=${() => ACT.obTo('name')} prog=${cprog('idtype')} types=${CONFIG.customerIds} pick=${ACT.obPickId} sub="Every customer and agent is verified, so you know who's running your errand and they know who they're running it for."/>`;
  if (st === 'idnum') return html`<${IdNumStep} ob=${ob} back=${() => ACT.obTo('idtype')} prog=${cprog('idnum')} next=${() => ACT.obTo('selfie')} photo=${manual} why=${manual ? 'Then a selfie, so our team can match your face to the ID.' : 'Then a quick selfie, matched to the photo the issuer holds. You must be 18 or older.'}/>`;
  if (st === 'selfie') return html`<${FaceStep} ob=${ob} back=${() => ACT.obTo('idnum')} shoot=${ACT.obShoot} who="tolu" manual=${manual}/>`;
  if (st === 'verified') return html`<${CVerified} ob=${ob}/>`;
  if (st === 'pending') return html`<${CPending} ob=${ob}/>`;
  if (st === 'perms') return html`<${CPerms} ob=${ob}/>`;
  return null;
}
