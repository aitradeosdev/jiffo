/* ================= Profiles: what the other side sees, shared by both apps ================= */
const BADGES = {
  'Great communication':{ ic:'chat', bg:'#1E5BBF' },
  'Careful with items':{ ic:'box', bg:'#B4541A' },
  'Fast':{ ic:'zap', bg:'#0A7A4A' },
  'Clear receipts':{ ic:'receipt', bg:'#6B3FB8' },
  'Clear instructions':{ ic:'doc', bg:'#1E5BBF' },
  'Ready at hand-off':{ ic:'check', bg:'#0A7A4A' },
  'Polite':{ ic:'star', bg:'#A86A00' },
  'Quick to reply':{ ic:'chat', bg:'#6B3FB8' }
};
const SPARK = '<svg class="sp" viewBox="0 0 72 72" aria-hidden="true"><path d="M15 13l1.7 4.3 4.3 1.7-4.3 1.7L15 25l-1.7-4.3L9 19l4.3-1.7z" fill="rgb(255 255 255 / .6)"/><path d="M57 10l1.2 2.8 2.8 1.2-2.8 1.2L57 18l-1.2-2.8-2.8-1.2 2.8-1.2z" fill="rgb(255 255 255 / .45)"/><path d="M59 49l1 2.5 2.5 1-2.5 1L59 56l-1-2.5-2.5-1 2.5-1z" fill="rgb(255 255 255 / .4)"/></svg>';
const StarF = ({ s = 14 }) => html`<svg width=${s} height=${s} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" dangerouslySetInnerHTML=${{ __html:ICONS.star }}></svg>`;
const Stars = ({ n, s = 13 }) => html`<span className="strs" role="img" aria-label=${`${n} out of 5 stars`}>${[1, 2, 3, 4, 5].map(k => html`<svg key=${k} width=${s} height=${s} viewBox="0 0 24 24" aria-hidden="true" fill=${k <= n ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" dangerouslySetInnerHTML=${{ __html:ICONS.star }}></svg>`)}</span>`;

function Badge({ label, n }) {
  const b = BADGES[label] || { ic:'star', bg:'#3B3B3B' };
  return html`<div className="bdg"><span className="disc" style=${{ background:b.bg }}><span dangerouslySetInnerHTML=${{ __html:SPARK }}></span><${Ic} n=${b.ic} s=${28} w=${2}/><span className="cnt">${n}</span></span><span className="bl">${label}</span></div>`;
}

/* p: { kind, name, face, since, area, verified, tier?, rating, errands, third:[value, label], ratings, compliments, reviews, dist?, facts? } */
function PublicProfile({ p, mine, actions }) {
  const agent = p.kind === 'agent', total = (p.compliments || []).reduce((a, [, n]) => a + n, 0);
  return html`<div className="pp">
    <div className="pphead">
      <span className="ppav"><${Face} who=${p.face} cls="xl"/><span className="ppver" title="Verified"><${Ic} n="check" s=${16} w=${3.2}/></span></span>
      <h2>${p.name}</h2>
      <p className="sub">${agent ? 'Agent' : 'Customer'} since ${p.since} · ${p.area}</p>
      <div className="pptags"><span className="badge g"><${Ic} n="shield" s=${12}/>${p.verified}</span>${p.tier ? html`<span className="badge"><span className="medal sm">B</span>${p.tier}</span>` : null}</div>
    </div>
    <div className="ppstats">
      <div><b>${p.rating}<${StarF} s=${17}/></b><small>Rating</small></div>
      <div><b>${p.errands}</b><small>Errands</small></div>
      <div><b>${p.third[0]}</b><small>${p.third[1]}</small></div>
    </div>
    ${total ? html`<section className="block"><div className="sechead"><h3>Compliments</h3><small>${total} in total</small></div>
      <div className="hscroll">${p.compliments.map(([l, n]) => html`<${Badge} key=${l} label=${l} n=${n}/>`)}</div></section>` : null}
    <section className="block"><div className="sechead"><h3>${agent ? 'What customers say' : 'What agents say'}</h3><small>${p.reviews.length} recent</small></div>
      <div className="hscroll">${p.reviews.map((r, k) => html`<article key=${k} className="revcard"><${Stars} n=${r.stars}/><p>${r.t}</p><div className="who"><${Face} who=${r.who} cls="sm"/><span className="tx"><b>${r.name}</b><small>${r.d}</small></span></div></article>`)}</div></section>
    ${p.dist ? html`<section className="rsum" aria-label="Ratings"><div className="big"><b>${p.rating}</b><${Stars} n=${5} s=${12}/><small>${p.ratings} ratings</small></div>
      <div className="rbars">${p.dist.map((v, k) => html`<div key=${k} className="rbar"><span>${5 - k}</span><i><em style=${{ width:v + '%' }}></em></i><small>${v}%</small></div>`)}</div></section>` : null}
    ${p.facts ? html`<div className="kv">${p.facts.map(([a, b]) => html`<div key=${a}><span>${a}</span><b>${b}</b></div>`)}</div>` : null}
    ${mine ? html`<p className="note" style=${{ textAlign:'center' }}>${mine}</p>` : actions}
  </div>`;
}

/* Account tab pieces: Bolt-style header, stat tiles, menu rows and small links */
function AccHead({ face, name, sub, on }) {
  return html`<button className="acchead" onClick=${on}><${Face} who=${face}/><span className="tx"><b>${name}</b><small>${sub}</small></span><${Ic} n="chev" s=${20}/></button>`;
}
const AccStats = ({ items }) => html`<div className="accstats">${items.map(([v, l]) => html`<div key=${l}><b>${v}</b><small>${l}</small></div>`)}</div>`;
const MRow = ({ ic, t, right, on }) => html`<button className="mrow" onClick=${on}><${Ic} n=${ic} s=${24} w=${1.75}/><span className="grow">${t}</span>${right || null}</button>`;
const Minor = ({ items }) => html`<div className="minor">${items.map(([t, on, cls, right]) => html`<button key=${t} className=${cls || ''} onClick=${on}><span>${t}</span>${right ? html`<small>${right}</small>` : null}</button>`)}</div>`;

/* Tracker progress: five steps, the current one animates */
function TBar({ i }) {
  return html`<div className="tbar" role="progressbar" aria-label="Errand progress" aria-valuemin="0" aria-valuemax="5" aria-valuenow=${i + 1}>${[0, 1, 2, 3, 4].map(k => html`<i key=${k} className=${k < i ? 'done' : k === i ? 'now' : ''}></i>`)}</div>`;
}
