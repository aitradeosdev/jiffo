/* ================= Sign-up and log in: screens both apps share ================= */
const SAMPLE_CODE = '284615';
const setOb = p => set(s => ({ ob:{ ...s.ob, ...(typeof p === 'function' ? p(s.ob) : p) } }));
const digits = (v, n) => String(v).replace(/\D/g, '').slice(0, n);
const spaced = (v, groups) => { const d = digits(v, groups.reduce((a, b) => a + b, 0)), out = []; let i = 0; for (const g of groups) { if (i >= d.length) break; out.push(d.slice(i, i + g)); i += g; } return out.join(' '); };
const notInProto = t => () => toast(t, 'Not part of this prototype');
const Flag = () => html`<svg className="flag" viewBox="0 0 3 2" aria-hidden="true"><rect width="3" height="2" fill="#FFFFFF"/><rect width="1" height="2" fill="#008751"/><rect x="2" width="1" height="2" fill="#008751"/></svg>`;

function ObScreen({ label, back, prog, foot, children }) {
  return html`<section className="ob" aria-label=${label}>
    <header className="obhead">
      ${back ? html`<button className="ib" onClick=${back} aria-label="Back"><${Ic} n="back" s=${24}/></button>` : html`<span style=${{ width:'44px', height:'44px' }}></span>`}
      ${prog != null ? html`<span className="obprog" role="progressbar" aria-label="Sign-up progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${Math.round(prog * 100)}><i style=${{ width:(prog * 100) + '%' }}></i></span>` : null}
    </header>
    <div className="obbody">${children}</div>
    ${foot ? html`<footer className="obfoot">${foot}</footer>` : null}
  </section>`;
}
const Q = ({ t, sub }) => html`<div><h1 className="obq">${t}</h1>${sub ? html`<p className="sub" style=${{ marginTop:'8px' }}>${sub}</p>` : null}</div>`;
const Continue = ({ ok, on, label }) => html`<button className="btn pri block" disabled=${!ok} onClick=${on}>${label || 'Continue'}</button>`;
function Tick({ on, toggle, id, children }) {
  return html`<div className="tickrow"><button className="cbox" role="checkbox" aria-checked=${on} aria-labelledby=${id} onClick=${toggle}>${on ? html`<${Ic} n="check" s=${15} w=${3}/>` : null}</button><span id=${id}>${children}</span></div>`;
}

function PhoneStep({ ob, back, prog, next, title }) {
  const ok = digits(ob.phone, 10).length === 10;
  return html`<${ObScreen} label="Phone number" back=${back} prog=${prog} foot=${html`<${Continue} ok=${ok} on=${next}/>`}>
    <${Q} t=${title}/>
    <div className="tel">
      <button className="ccode" onClick=${() => toast('Nigeria only for now', 'Other countries arrive through the country adapter')} aria-label="Country code: Nigeria, +234"><${Flag}/>+234<${Ic} n="down" s=${15}/></button>
      <input className="tin" aria-label="Phone number" inputMode="numeric" autoComplete="tel-national" placeholder="803 000 0000" value=${ob.phone} onChange=${e => setOb({ phone:spaced(e.target.value, [3, 3, 4]) })}/>
    </div>
    <p className="note">We'll text you a 6-digit code, or send it on WhatsApp if the text doesn't arrive. Standard rates may apply.</p>
  <//>`;
}

function CodeStep({ ob, back, prog, onCode }) {
  const [left, setLeft] = useState(45), [via, setVia] = useState('SMS'), ref = useRef();
  useEffect(() => { const t = setInterval(() => setLeft(x => Math.max(0, x - 1)), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { if (ref.current) ref.current.focus({ preventScroll:true }); }, []);
  const c = ob.code;
  return html`<${ObScreen} label="Verification code" back=${back} prog=${prog}>
    <${Q} t="Enter the 6-digit code" sub=${html`Sent by ${via} to +234 ${ob.phone}. <button className="link" style=${{ fontSize:'14.5px' }} onClick=${back}>Change number</button>`}/>
    <label className="otp"><span className="sr">6-digit code</span>
      <input ref=${ref} inputMode="numeric" autoComplete="one-time-code" maxLength="6" value=${c} disabled=${ob.busy} onChange=${e => onCode(digits(e.target.value, 6))}/>
      ${[0, 1, 2, 3, 4, 5].map(i => html`<span key=${i} aria-hidden="true" className=${!ob.busy && i === Math.min(c.length, 5) ? 'on' : ''}>${c[i] || ''}</span>`)}
    </label>
    ${ob.busy ? html`<div className="waiting" role="status"><span className="spinner"></span><span className="tx"><b>Checking the code</b></span></div>`
      : html`<button className="autofill" onClick=${() => onCode(SAMPLE_CODE)}><${Ic} n="chat" s=${16}/>From Messages: ${SAMPLE_CODE.slice(0, 3)} ${SAMPLE_CODE.slice(3)}</button>`}
    <div className="list">
      <button className="li" disabled=${left > 0} style=${{ opacity:left > 0 ? .55 : 1 }} onClick=${() => { setVia('SMS'); setLeft(60); toast('New code sent by SMS'); }}><span className="ico"><${Ic} n="history" s=${19}/></span><span className="tx"><b>Resend code by SMS</b><small>${left > 0 ? `Available in 0:${String(left).padStart(2, '0')}` : 'Available now'}</small></span></button>
      <button className="li" onClick=${() => { setVia('WhatsApp'); setLeft(60); toast('Code sent on WhatsApp'); }}><span className="ico"><${Ic} n="chat" s=${19}/></span><span className="tx"><b>Get the code on WhatsApp</b><small>If the text doesn't arrive</small></span></button>
    </div>
  <//>`;
}

const idOk = (k, v) => { const t = ID_TYPES[k]; if (t.len) return digits(v, t.len).length === t.len; const n = v.replace(/\s/g, '').length; return n >= t.min && n <= t.max; };
const idFmt = (k, v) => { const t = ID_TYPES[k]; return t.len ? spaced(v, t.groups) : v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, t.max); };
const maskId = (k, v) => { const c = String(v).replace(/\s/g, ''); return '•••• ' + c.slice(-4); };

function IdTypeStep({ back, prog, types, pick, sub }) {
  return html`<${ObScreen} label="Choose an ID" back=${back} prog=${prog}>
    <${Q} t="Which ID will you use?" sub=${sub}/>
    <div className="list">${types.map(k => { const t = ID_TYPES[k]; return html`<button key=${k} className="li" onClick=${() => pick(k)}><span className="ico"><${Ic} n=${t.ic} s=${19}/></span><span className="tx"><b>${t.name}</b><small>${t.label}</small></span><${Ic} n="chev" s=${18}/></button>`; })}</div>
  <//>`;
}

/* Capture tile: in the app this opens the camera. */
function Shot({ label, sub, done, art, take }) {
  const [busy, setBusy] = useState(false);
  const go = () => { if (busy) return; setBusy(true); setTimeout(() => { setBusy(false); take(); }, 700); };
  return html`<button className=${'idshot' + (done ? ' done' : '')} onClick=${go} aria-label=${done ? `${label}: taken. Retake` : `${label}: take photo`}>
    ${done ? html`<span className="pic" dangerouslySetInnerHTML=${{ __html:art }}></span><span className="ok"><${Ic} n="check" s=${15} w=${3}/></span><span className="retake"><${Ic} n="camera" s=${13}/>Retake</span>`
      : html`<span className="ico">${busy ? html`<span className="spinner"></span>` : html`<${Ic} n="camera" s=${20}/>`}</span><span className="tx"><b>${label}</b><small>${sub}</small></span>`}
  </button>`;
}

function IdNumStep({ ob, back, prog, next, why, photo, k = ob.idType, field = 'idNum', photoField = 'idPhoto', review = photo }) {
  const t = ID_TYPES[k], v = ob[field], ok = idOk(k, v) && (!photo || ob[photoField]);
  return html`<${ObScreen} label=${t.name} back=${back} prog=${prog} foot=${html`<${Continue} ok=${ok} on=${next}/>`}>
    <${Q} t=${`Your ${t.short}`} sub=${why}/>
    <div className="fgroup"><label className="flabel" htmlFor="idn">${t.label}</label>
      <input id="idn" className="tin" inputMode=${t.len ? 'numeric' : 'text'} autoCapitalize="characters" placeholder=${t.len ? `${t.len} digits` : `${t.min === t.max ? t.min : t.min + ' to ' + t.max} characters`} value=${v} onChange=${e => setOb({ [field]:idFmt(k, e.target.value) })} style=${{ letterSpacing:'.04em' }}/>
      <p className="note">${t.hint}</p></div>
    ${photo ? html`<div className="fgroup"><span className="flabel">Photo of your ${t.doc}</span><${Shot} label=${`Front of your ${t.doc}`} sub="All four corners in frame, no glare" done=${ob[photoField]} art=${PHOTO.idcard} take=${() => setOb({ [photoField]:true })}/></div>` : null}
    <div className="list">${review ? html`
      <div className="li"><span className="ico"><${Ic} n="users" s=${19}/></span><span className="tx"><b>Checked by our team</b><small style=${{ whiteSpace:'normal' }}>A person compares your ID, its photo and your selfie, usually within ${CONFIG.reviewHours} hours</small></span></div>
      <div className="li"><span className="ico"><${Ic} n="eyeoff" s=${19}/></span><span className="tx"><b>Never shown to anyone else</b><small style=${{ whiteSpace:'normal' }}>Only the review team sees it, and the photo is deleted after the decision</small></span></div>` : html`
      <div className="li"><span className="ico"><${Ic} n="shield" s=${19}/></span><span className="tx"><b>Checked by ${CONFIG.provider}</b><small style=${{ whiteSpace:'normal' }}>Our identity provider checks it with the issuer, such as NIMC</small></span></div>
      <div className="li"><span className="ico"><${Ic} n="eyeoff" s=${19}/></span><span className="tx"><b>We don't keep your ID</b><small style=${{ whiteSpace:'normal' }}>We keep the result, your legal name and date of birth</small></span></div>`}
    </div>
  <//>`;
}

function FaceStep({ ob, back, shoot, who, manual }) {
  const st = ob.face;
  const title = st === 'ok' ? (manual ? 'Selfie taken' : 'Selfie matched') : st === 'checking' ? (manual ? 'Checking the photo' : 'Blink, then turn your head slowly') : 'Take a selfie';
  const sub = st === 'idle' ? (manual ? 'Fit your face in the oval, in good light, with nothing covering it.' : 'Fit your face in the oval. You will be asked to blink and turn your head.') : st === 'checking' ? (manual ? 'Making sure your face is clear.' : 'Checking it is really you, then matching to your ID photo.') : (manual ? 'It goes to our team with your ID.' : 'Your selfie matches your ID photo.');
  return html`<section className=${'facecam' + (manual ? '' : ' sdk')} aria-label="Selfie">
    ${manual ? null : html`<span className="sdkbadge"><${Ic} n="shield" s=${13}/>Secured by ${CONFIG.provider}</span>`}
    <button className="ib" onClick=${back} aria-label="Back" disabled=${st !== 'idle'}><${Ic} n="back" s=${24}/></button>
    <div style=${{ display:'flex', flexDirection:'column', alignItems:'center', gap:'8px' }} aria-live="polite"><h1 className="t2">${title}</h1><p>${sub}</p></div>
    <div className=${'faceoval' + (st === 'ok' ? ' ok' : '')}>${st === 'idle' ? html`<${Ic} n="face" s=${56} w=${1.4}/>` : html`<${Face} who=${who}/>`}</div>
    ${st === 'idle' ? html`<button className="shutter" onClick=${shoot} aria-label="Take selfie"><span></span></button>`
      : st === 'checking' ? html`<span className="spinner light" role="status" aria-label="Checking"></span>`
      : html`<span className="okdot"><${Ic} n="check" s=${30} w=${3}/></span>`}
  </section>`;
}

function ConsentStep({ ob, back, next }) {
  const [st, setSt] = useState('idle');
  const go = () => { setSt('busy'); setTimeout(() => { setSt('ok'); setTimeout(next, 700); }, 1300); };
  return html`<${ObScreen} label="Approve the BVN check" back=${back} foot=${html`<button className="btn pri block" disabled=${st !== 'idle'} onClick=${go}>${st === 'ok' ? 'Approved' : st === 'busy' ? 'Waiting for NIBSS…' : 'Approve with NIBSS'}</button>`}>
    <${Q} t="Approve the BVN check" sub="NIBSS asks you to approve every BVN check. You'll get a code by text on the phone number linked to your BVN."/>
    <div className="list">
      <div className="li"><span className="ico"><${Ic} n="bank" s=${19}/></span><span className="tx"><b>BVN ${maskId('bvn', ob.bvn)}</b><small>Checked by ${CONFIG.provider} through NIBSS</small></span></div>
      <div className="li"><span className="ico"><${Ic} n="eyeoff" s=${19}/></span><span className="tx"><b>Read once, not kept</b><small style=${{ whiteSpace:'normal' }}>We keep only whether it matched your name and date of birth</small></span></div>
    </div>
    ${st === 'busy' ? html`<div className="waiting" role="status"><span className="spinner"></span><span className="tx"><b>Enter the NIBSS code</b><small>In the NIBSS iGree screen that opened</small></span></div>` : null}
    ${st === 'ok' ? html`<div className="lookup"><span className="ico g"><${Ic} n="check" s=${18} w=${2.6}/></span><span className="tx"><b>Approved on NIBSS</b><small>Continuing to your selfie</small></span></div>` : null}
  <//>`;
}

function CheckList({ items, n, flag }) {
  return html`<ul className="ckl">${items.map((t, i) => {
    const cls = flag === i && i < n ? 'warn' : i < n ? 'done' : i === n ? 'now' : '';
    return html`<li key=${i} className=${cls}><span className="ckd">${cls === 'warn' ? html`<${Ic} n="alert" s=${14} w=${2.4}/>` : cls === 'done' ? html`<${Ic} n="check" s=${14} w=${3}/>` : cls === 'now' ? html`<span className="spinner sm"></span>` : null}</span>${t}</li>`;
  })}</ul>`;
}

/* Prototype panel: the admin switch between manual review and the identity provider. Only one is ever on. */
function KycCard({ kyc, pending, approve, setKyc, who }) {
  return html`<div className="pcard">
    <h3>Admin: identity checks</h3>
    <div className="seg2" role="group" aria-label="Identity checks">
      <button aria-pressed=${kyc === 'manual'} onClick=${() => setKyc('manual')}>Manual review</button>
      <button aria-pressed=${kyc === 'provider'} onClick=${() => setKyc('provider')}>Provider: ${CONFIG.provider}</button>
    </div>
    <p className="note">${kyc === 'manual' ? `Our own screens collect the ${who === 'agent' ? 'NIN, BVN, selfie and proof of address' : 'ID, its photo and a selfie'}. Admin reviews each one in the verification queue.` : `${CONFIG.provider} checks everything and sends back only the result. Manual review is off.`} Try sign-up after switching.</p>
    ${pending ? html`<button className="btn pri" onClick=${approve}><${Ic} n="check" s=${18}/>Approve as admin</button>` : null}
  </div>`;
}
