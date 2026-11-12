/* ================= State, sample data, simulated agent ================= */
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fmt = n => '₦' + Math.round(n).toLocaleString('en-NG');
const svc = f => Math.min(1000, Math.max(100, Math.round(f * .1 / 10) * 10));
const PROMO = 300;
const AGENTS = {
  a1:{ first:'Chinedu', full:'Chinedu Okafor', face:'chinedu', rating:'4.9', errands:142, since:'March 2025', ratings:131, completion:'98%', langs:'English, Pidgin, Igbo', area:'Lekki and Victoria Island',
    compliments:[['Great communication', 64], ['Careful with items', 51], ['Fast', 47], ['Clear receipts', 38]], dist:[88, 9, 2, 1, 0],
    reviews:[
      { who:'kemi', name:'Kemi A.', stars:5, d:'2 days ago', t:'Found everything on my list and sent a photo of the receipt before paying. Very polite.' },
      { who:'femi', name:'Femi O.', stars:5, d:'Last week', t:'Stood in the bank queue for almost two hours and kept me updated the whole time.' },
      { who:'ibrahim', name:'Ibrahim Y.', stars:4, d:'Last week', t:'Good communication. Arrived a little after the ETA because of traffic on the expressway.' },
      { who:'aisha', name:'Aisha B.', stars:5, d:'3 weeks ago', t:'Asked before swapping a brand that was out of stock. Will request him again.' }
    ] },
  a2:{ first:'Aisha', full:'Aisha Bello', face:'aisha', rating:'4.8', errands:96, since:'June 2025', ratings:88, completion:'97%', langs:'English, Hausa, Pidgin', area:'Lekki Phase 1 and Ikate',
    compliments:[['Fast', 41], ['Great communication', 36], ['Careful with items', 30]], dist:[84, 12, 3, 1, 0],
    reviews:[
      { who:'tolu', name:'Tolu A.', stars:5, d:'Last week', t:'Picked up my parcel and dropped it with security exactly as I asked.' },
      { who:'kemi', name:'Kemi A.', stars:4, d:'2 weeks ago', t:'Quick and friendly. The receipt photo was a bit blurry.' }
    ] }
};
const agentPub = ag => ({ kind:'agent', name:`${ag.first} ${ag.full.split(' ')[1][0]}.`, face:ag.face, since:ag.since, area:ag.area, verified:'ID, BVN and address verified',
  rating:ag.rating, errands:ag.errands, third:[ag.completion, 'Completed'], ratings:ag.ratings, compliments:ag.compliments, reviews:ag.reviews, dist:ag.dist,
  facts:[['Speaks', ag.langs], ['Works around', ag.area]] });
const ME_PUB = { kind:'customer', name:'Tolu A.', face:'tolu', since:'January 2026', area:'Lekki Phase 1', verified:'ID and selfie verified', rating:'4.8', errands:57, third:['0', 'Disputes'], ratings:49,
  compliments:[['Clear instructions', 21], ['Ready at hand-off', 17], ['Polite', 15], ['Quick to reply', 9]],
  reviews:[{ who:'chinedu', name:'Chinedu O.', stars:5, d:'Yesterday', t:'Sent a clear list with brands, and was at the gate with the PIN ready.' },
    { who:'aisha', name:'Aisha B.', stars:5, d:'Last week', t:'Answered quickly when an item was out of stock.' },
    { who:'ibrahim', name:'Ibrahim Y.', stars:5, d:'3 weeks ago', t:'Was ready at the gate with the PIN.' }] };
const PLACES = {
  shoprite:{ name:'Shoprite', addr:'Lekki–Epe Expressway, Lekki', km:'1.3 km', icon:'bag' },
  circle:{ name:'Circle Mall', addr:'Lekki–Epe Expressway, Osapa', km:'3.1 km', icon:'bag' },
  medplus:{ name:'Medplus Pharmacy', addr:'Admiralty Way, Lekki Phase 1', km:'0.6 km', icon:'pin' },
  gig:{ name:'GIG Logistics', addr:'Admiralty Way, Lekki Phase 1', km:'0.4 km', icon:'pin' },
  home:{ name:'Home', addr:'12 Admiralty Way, Lekki Phase 1', icon:'home' },
  work:{ name:'Work', addr:'5 Ligali Ayorinde Street, Victoria Island', icon:'work' }
};
const PL = k => PLACES[k] || { name:'', addr:'' };
const IDEAS = [
  { art:'groceries', short:'Groceries', cat:'groceries', pick:'shoprite', text:'Buy 1 carton of Indomie Onion Chicken and a 5 L Kings vegetable oil at Shoprite, then bring them to my house.' },
  { art:'parcel', short:'Parcels', cat:'parcel', pick:'gig', photos:1, text:'Collect my parcel from GIG Logistics and bring it home. The waybill is in the photo.' },
  { art:'pharmacy', short:'Pharmacy', cat:'pharmacy', buy:false, pick:'medplus', photos:1, text:'Collect my prescription at Medplus. It is paid for; the receipt is in the photo.' },
  { art:'queue', short:'Queues', cat:'queue', pick:'circle', text:'Stand in the queue for me from 8 AM and call me when you are three people from the front.' }
];
const STEPS = ['Accepted', 'Service started', 'Items bought', 'At drop-off', 'Completed'];
const stepsFor = s => s.buy ? STEPS : STEPS.map((t, k) => k === 2 ? 'On the way' : t);
const TIMES = ['2:05 PM', '2:09 PM', '2:31 PM', '2:44 PM', '2:46 PM'];
const ORDER = ['accept', 'counter', 'start', 'item', 'arrive', 'handoff'];
const DELAY = { accept:3800, counter:2600, start:2800, item:3200, receipt:3900, arrive:4200, handoff:7000 };
const LABEL = { accept:'Agent accepts', counter:'Agent sends a new price', start:'Agent taps Start service', item:'Agent sends the item amount with photos',
  receipt:'Agent uploads the receipt', arrive:'Agent marks it delivered', handoff:'Agent enters your PIN' };
const ITEM_LINES = [['Indomie Onion Chicken, carton of 40', 13200], ['Kings vegetable oil, 5 L', 16150]];
const HISTORY = [
  { t:'Pharmacy pickup', s:'Medplus · Chinedu O.', d:'Yesterday, 6:12 PM', a:1650, who:'chinedu', art:'pharmacy' },
  { t:'Parcel from GIG Logistics', s:'Admiralty Way · Kemi A.', d:'4 Nov, 11:40 AM', a:1980, who:'kemi', art:'parcel' },
  { t:'Suya from Glover Road', s:'Ikoyi · Ibrahim Y.', d:'28 Oct, 8:05 PM', a:2400, who:'ibrahim', art:'groceries' },
  { t:'Documents to the bank', s:'Victoria Island · Chinedu O.', d:'21 Oct, 10:15 AM', a:3100, who:'chinedu', art:'parcel' }
];

const draftReset = () => ({ cat:null, buy:false, focus:'pick', desc:'', photos:0, pick:null, drop:null, mid:false, when:'now', urgent:false, fee:1500, suggested:1500, km:4.2, mins:18, promo:false });
const errandReset = () => ({ phase:'none', items:[], typing:false, unread:0, step:0, waiting:null, skipCounter:false, agentId:'a1', agreed:0, heldFee:0, heldItems:0,
  receiptTotal:0, pinShown:false, method:'', rating:0, tip:0, chat:'', etab:'chat', expanded:false });
const OB0 = () => ({ step:'welcome', mode:'signup', phone:'803 214 5567', code:'', busy:false, first:'Tolu', last:'Adebayo', email:'tolu.adebayo@example.com', agree:false,
  invite:'', showInvite:false, idType:'nin', idNum:ID_TYPES.nin.sample, idPhoto:false, face:'idle', loc:false, notif:false });
function fresh() {
  return { ob:null, newbie:false, kyc:CONFIG.kyc, idState:'ok', tab:'home', screen:null, sheet:null, call:false, toast:null, auto:true, draft:'', ...draftReset(), ...errandReset(), balance:52300, sos:false, shared:false,
    history:HISTORY.slice(), etype:'active',
    tx:[
      { n:'Transfer in', d:'GTBank •••• 0193 · 9:12 AM', a:50000, i:'bank' },
      { n:'Pharmacy pickup', d:'Errand fee and item · 6:12 PM', a:-6450, i:'bag', day:'Yesterday' },
      { n:'Item difference returned', d:'Pharmacy pickup · 6:15 PM', a:350, i:'receipt', day:'Yesterday' },
      { n:'Parcel from GIG Logistics', d:'Errand fee · 11:40 AM', a:-1980, i:'route', day:'4 Nov' }
    ] };
}
const store = (() => {
  let s = fresh(); const subs = new Set();
  return { get:() => s, set(p) { s = { ...s, ...(typeof p === 'function' ? p(s) : p) }; subs.forEach(f => f()); }, reset() { s = fresh(); subs.forEach(f => f()); }, sub(f) { subs.add(f); return () => subs.delete(f); } };
})();
const S = () => store.get();
const set = p => store.set(p);
const viewingChat = s => s.screen === 'chat';
let uid = 0;
const push = (...its) => set(s => {
  const add = its.map(i => ({ id:'m' + (++uid), ...((i.kind === 'agent' || i.card === 'choice') && !i.who ? { who:s.agentId } : {}), ...i }));
  const bump = add.filter(i => i.kind === 'agent' || i.kind === 'app').length;
  return { items:[...s.items, ...add], unread:viewingChat(s) ? 0 : s.unread + bump };
});
const patchItem = (id, p) => set(s => ({ items:s.items.map(i => i.id === id ? { ...i, ...p } : i) }));
const findCard = c => [...S().items].reverse().find(i => i.card === c);
const agent = () => AGENTS[S().agentId];
const ACTIVE = ['accepted', 'started', 'bought', 'dropoff', 'photo', 'dispute'];
const holdFor = (s, fee = s.fee) => fee + svc(fee) - (s.promo ? PROMO : 0);

let REPLAY = false;
const timers = new Set();
let stepT = null, toastT = null;
function later(fn, ms) { if (REPLAY) { fn(); return; } const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); }
function clearAll() { timers.forEach(clearTimeout); timers.clear(); clearTimeout(stepT); }
function says(who, text, extra, then) {
  if (REPLAY) { push({ kind:who, text, ...extra }); then && then(); return; }
  set({ typing:who });
  later(() => { set({ typing:false }); push({ kind:who, text, ...extra }); then && then(); }, who === 'app' ? 600 : 1150);
}
function toast(text, sub, go) {
  if (REPLAY) return;
  set({ toast:{ text, sub, go, k:Date.now() } });
  clearTimeout(toastT); toastT = setTimeout(() => set({ toast:null }), 4200);
}
const notify = (text, sub) => { if (!viewingChat(S()) || S().sheet) toast(text, sub, 'chat'); };

/* ---------- Agent side ---------- */
const AG = {
  accept() {
    const s = S(), a = agent(), hold = holdFor(s);
    set({ phase:'accepted', agreed:s.fee, balance:s.balance - hold, heldFee:hold, tx:[{ n:'Held for errand', d:`${PL(s.pick).name} run · ${a.first}`, a:-hold, i:'lock' }, ...s.tx],
      ...(s.screen === 'matching' ? { screen:'trip' } : {}) });
    if (!S().items.length) push({ kind:'user', text:s.desc, photos:s.photos });
    push({ kind:'sys', icon:'lock', text:`${a.first} accepted your errand. ${fmt(hold)} is held until hand-off.` });
    says('agent', s.buy && s.cat === 'groceries' ? `Good afternoon Tolu, I'm ${a.first}. I'm close to Shoprite now. Kings vegetable oil, 5 litres, is that right?` : `Good afternoon Tolu, I'm ${a.first}. I'm close to ${PL(s.pick).name} now. Anything else I should know before I start?`);
    if (S().screen !== 'trip') toast(`${a.first} accepted your errand`, 'Tap to follow them', 'trip');
  },
  counter() {
    set({ waiting:'counter' });
    says('agent', 'Traffic is heavy on the expressway this afternoon. Can we do ₦2,000?', {}, () => {
      push({ kind:'agent', card:'counter', amt:2000, was:S().agreed, st:'pending' });
      set({ sheet:{ type:'counter', id:findCard('counter').id } });
    });
  },
  start() {
    const a = agent(); set({ phase:'started' });
    push({ kind:'sys', icon:'play', text:`${a.first} started the service. The errand fee is now fixed at ${fmt(S().agreed)}.` });
    notify(`${a.first} started the service`, 'Follow them on the map');
  },
  item() {
    set({ waiting:'item' });
    says('agent', 'Got everything on your list. Here is the receipt and a photo of the items.', {}, () => {
      push({ kind:'agent', card:'item', amt:29350, st:'pending', lines:ITEM_LINES, photos:true });
      notify('Item amount: ₦29,350', 'Receipt and photos attached. Lock it to continue');
    });
  },
  receipt() {
    const s = S(), total = 29350, back = s.heldItems - total;
    set({ phase:'bought', heldItems:total, balance:s.balance + back, receiptTotal:total, tx:back > 0 ? [{ n:'Item difference returned', d:'Shoprite run', a:back, i:'receipt' }, ...s.tx] : s.tx });
    push({ kind:'agent', card:'receipt', total, locked:total + back, back });
    if (back > 0) push({ kind:'sys', icon:'check', text:`${fmt(back)} went back to your wallet. The receipt came in under the locked amount.` });
    says('agent', 'Paid and on my way to you now.');
    notify('Receipt uploaded', `${fmt(back)} returned to your wallet`);
  },
  arrive() {
    const a = agent(); set({ phase:'dropoff', pinShown:false });
    says('agent', `I'm at your gate on Admiralty Way${S().buy ? ' with your items' : ''}.`, {}, () => push({ kind:'sys', icon:'check', text:`${a.first} marked the errand delivered. Tap Show hand-off PIN on the tracker once you have everything.` }));
    if (S().screen !== 'trip') toast(`${a.first} marked it delivered`, 'Show your PIN when you have your items', 'trip');
  },
  handoff() { finish('pin'); },
  photo() {
    set({ phase:'photo' });
    says('agent', 'Nobody answered at the gate, so I left the bag with your security man. Photo attached.', {}, () => push({ kind:'agent', card:'photo', st:'pending' }));
    notify('Drop-off photo needs your approval', 'Nothing is paid until you approve');
  }
};
function curIdx(s) { let i = s.step; while ((ORDER[i] === 'counter' && s.skipCounter) || (ORDER[i] === 'item' && !s.buy)) i++; return i; }
function nextStep() {
  const s = S();
  if (!['matching', 'accepted', 'started', 'bought', 'dropoff'].includes(s.phase) || s.waiting) return null;
  return ORDER[curIdx(s)] || null;
}
function runStep(k) {
  k = k || nextStep(); if (!k) return;
  const s = S(), i = curIdx(s);
  set({ step:k === 'photo' ? ORDER.length : i + 1 });
  AG[k](); schedule();
}
function schedule() {
  clearTimeout(stepT); if (REPLAY || !S().auto) return;
  const k = nextStep(); if (k) stepT = setTimeout(() => runStep(k), DELAY[k]);
}
function finish(method) {
  set({ phase:'done', method, heldFee:0, heldItems:0, sheet:null, screen:'rate' });
  push({ kind:'sys', icon:'check', text:method === 'pin' ? 'Hand-off confirmed with your PIN.' : 'You approved the drop-off photo.' });
}

/* ---------- Customer actions ---------- */
const ACT = {
  tab(t) { set({ tab:t, screen:null, sheet:null }); },
  ask() {
    const s = S();
    if (ACTIVE.includes(s.phase) || s.phase === 'matching') { toast('This prototype runs one errand at a time', 'Finish or reset the current one first'); return; }
    set({ ...draftReset(), desc:s.draft.trim(), draft:'', screen:'plan', urgent:s.urgent, focus:s.draft.trim() ? 'pick' : 'desc' });
  },
  idea(i) { const d = IDEAS[i]; if (ACTIVE.includes(S().phase) || S().phase === 'matching') return ACT.ask(); set({ ...draftReset(), cat:d.cat, buy:d.buy ?? CAT(d.cat).buy, desc:d.text, pick:d.pick, photos:d.photos || 0, screen:'plan', focus:'drop' }); },
  pickCat(k) {
    const s = S(), c = CAT(k);
    if (s.screen === 'plan') { set({ cat:k, buy:c.buy, sheet:null }); return; }
    if (ACTIVE.includes(s.phase) || s.phase === 'matching') { set({ sheet:null }); return ACT.ask(); }
    set({ ...draftReset(), cat:k, buy:c.buy, screen:'plan', focus:'desc', sheet:null });
  },
  toggleBuy() { set(s => ({ buy:!s.buy })); },
  place(k) { if (ACTIVE.includes(S().phase) || S().phase === 'matching') return ACT.ask(); set({ ...draftReset(), drop:k, screen:'plan', focus:'desc' }); },
  close() { set({ screen:null }); },
  back(to) { set({ screen:to || null }); },
  addPhoto() { set(s => ({ photos:Math.min(4, s.photos + 1), sheet:null })); },
  openStop(which) { set({ sheet:{ type:'stop', which } }); },
  chooseStop(k) { const w = S().sheet && S().sheet.which; set({ [w === 'pick' ? 'pick' : 'drop']:k, sheet:null }); },
  toggleMid() { set(s => s.mid ? { mid:false, km:4.2, mins:18, suggested:1500, fee:Math.max(500, s.fee - 300) } : { mid:true, km:5.1, mins:24, suggested:1800, fee:s.fee + 300 }); },
  setWhen(w) { set({ when:w }); },
  toggleUrgent() { set(s => ({ urgent:!s.urgent })); },
  toReview() { const s = S(); if (!s.cat || !s.desc.trim() || !s.pick || !s.drop) return; set({ screen:'review' }); },
  fee(d) { set(s => ({ fee:Math.max(500, s.fee + d) })); },
  applyPromo() { set({ promo:true, sheet:null }); toast('LEKKI300 applied', `${fmt(PROMO)} off this errand. Your agent is still paid in full.`); },
  request() {
    const s = S(), hold = holdFor(s);
    if (s.balance < hold) { set({ sheet:{ type:'topup', shortBy:hold - s.balance } }); return false; }
    set({ ...errandReset(), phase:'matching', screen:'matching' });
    schedule(); return true;
  },
  raise() { set(s => ({ fee:s.fee + 200 })); toast(`Price raised to ${fmt(S().fee)}`, 'Agents nearby see the new price'); },
  cancelReq() { clearAll(); set({ ...errandReset(), screen:'review' }); toast('Request cancelled', 'Nothing was charged'); },
  openErrand() { set({ screen:'trip', tab:'home' }); },
  openChat() { set({ screen:'chat', unread:0, sheet:null }); },
  closeChat() { set({ screen:S().phase === 'none' ? null : 'trip' }); },
  setFocus(f) { set({ focus:f }); },
  pickPlace(k) { const s = S(); if (s.focus === 'drop') set({ drop:k, focus:s.pick ? 'drop' : 'pick' }); else set({ pick:k, focus:s.drop ? 'pick' : 'drop' }); },
  etab(t) { set(s => ({ etab:t, unread:t === 'chat' ? 0 : s.unread })); },
  expand(v) { set(s => ({ expanded:typeof v === 'boolean' ? v : !s.expanded })); },
  sendChat(t) {
    const s = S(), text = (t || s.chat).trim(); if (!text) return;
    push({ kind:'user', text }); set({ chat:'' });
    if (ACTIVE.includes(s.phase) && !s.typing) says('agent', text.startsWith('Where') ? 'Inside Shoprite now, at the checkout.' : 'Okay, noted.');
  },
  acceptCounter(id) {
    const c = S().items.find(i => i.id === id); if (!c || c.st !== 'pending') return;
    const s = S(), hold = holdFor(s, c.amt), diff = hold - s.heldFee;
    patchItem(id, { st:'accepted' });
    set({ balance:s.balance - diff, heldFee:hold, agreed:c.amt, fee:c.amt, waiting:null, sheet:null, tx:[{ n:'Hold adjusted', d:'New price accepted', a:-diff, i:'lock' }, ...s.tx] });
    push({ kind:'sys', icon:'check', text:`You accepted ${fmt(c.amt)}. ${fmt(hold)} is now held.` });
    schedule();
  },
  declineCounter(id) {
    const c = S().items.find(i => i.id === id); if (!c || c.st !== 'pending') return;
    patchItem(id, { st:'declined' });
    set({ sheet:{ type:'choice', amt:c.amt } });
  },
  keepAgent() {
    set({ waiting:null, sheet:null });
    push({ kind:'sys', icon:'info', text:`You declined the new price. It stays at ${fmt(S().agreed)}.` });
    says('agent', 'No problem, we keep it at the old price.'); schedule();
  },
  newAgent() {
    const s = S();
    set({ ...errandReset(), sheet:null, balance:s.balance + s.heldFee, agentId:'a2', skipCounter:true, phase:'matching', screen:'matching', items:[], tx:[{ n:'Hold released', d:'Offer cancelled', a:s.heldFee, i:'lock' }, ...s.tx] });
    toast('Offer cancelled', 'Your errand went back to matching, with no fee for you');
    schedule();
  },
  showPin() { set({ sheet:{ type:'pin' }, pinShown:true }); },
  acceptItem(id) {
    const s = S(), c = s.items.find(i => i.id === id); if (!c || c.st !== 'pending') return;
    if (s.balance < c.amt) { set({ sheet:{ type:'topup', shortBy:c.amt - s.balance } }); return; }
    patchItem(id, { st:'accepted' });
    set({ phase:'bought', balance:s.balance - c.amt, heldItems:c.amt, receiptTotal:c.amt, waiting:null, tx:[{ n:'Locked for items', d:'Shoprite run', a:-c.amt, i:'bag' }, ...s.tx] });
    push({ kind:'sys', icon:'lock', text:`${fmt(c.amt)} is locked for your items. ${agent().first} is paid at hand-off.` });
    says('agent', 'Thank you. On my way to you now.');
    schedule();
  },
  askItem() { const el = document.getElementById('chatbox'); if (el) el.focus(); },
  approvePhoto(id) { patchItem(id, { st:'approved' }); finish('photo'); },
  disputePhoto(id) {
    patchItem(id, { st:'disputed' }); set({ phase:'dispute' });
    push({ kind:'sys', icon:'flag', text:`Dispute opened. Both amounts stay frozen. ${agent().first} has 24 hours to respond, then our team decides.` });
  },
  togglePin() { set(s => ({ pinShown:!s.pinShown })); },
  star(n) { set({ rating:n }); },
  tip(n) { set({ tip:n }); },
  submitRating() {
    const s = S(), a = agent();
    const entry = { t:`${PL(s.pick).name} run`, s:`${PL(s.drop).name} · ${a.first} ${a.full.split(' ')[1][0]}.`, d:'Today, 2:46 PM', a:s.agreed + svc(s.agreed) + (s.receiptTotal || 0) + s.tip, who:a.face, art:'groceries' };
    set({ ...errandReset(), ...draftReset(), screen:null, tab:'home', history:[entry, ...s.history], balance:s.balance - s.tip,
      tx:s.tip ? [{ n:`Tip for ${a.first}`, d:'Shoprite run', a:-s.tip, i:'gift' }, ...s.tx] : s.tx });
    toast('Thanks for rating', 'Your receipt is saved in Errands', 'errands');
  },
  sheet(type, extra) { set({ sheet:{ type, ...(extra || {}) } }); },
  closeSheet() { set({ sheet:null }); },
  call(on) { set({ call:on, sheet:null }); },
  sosAlert() { set({ sos:true }); },
  shareLive() { set({ shared:true, sheet:null }); toast('Live errand shared', 'Mum and Femi can follow until hand-off'); },
  sentMoney() {
    set({ sheet:null });
    later(() => { set(s => ({ balance:s.balance + 20000, tx:[{ n:'Transfer in', d:'GTBank •••• 0193 · Just now', a:20000, i:'bank' }, ...s.tx] })); toast('₦20,000 added to your wallet', 'From GTBank •••• 0193'); }, 1600);
  },
  toastGo() {
    const g = S().toast && S().toast.go; set({ toast:null });
    if (g === 'chat' && S().phase !== 'none') ACT.openChat();
    else if (g === 'trip' && S().phase !== 'none') ACT.openErrand();
    else if (g === 'errands') ACT.tab('errands');
  },
  autoplay() { set(s => ({ auto:!s.auto })); schedule(); },
  next() { runStep(); },
  photoPath() { runStep('photo'); },
  reset() { clearAll(); store.reset(); if (location.hash) history.replaceState(null, '', location.pathname + location.search); },
  /* Sign-up and log in */
  obStart(mode) { set(s => ({ ob:{ ...(s.ob || OB0()), step:'phone', mode, code:'', busy:false } })); },
  obTo(step) { setOb({ step, ...(step === 'selfie' ? { face:'idle' } : {}), ...(step === 'code' ? { code:'', busy:false } : {}) }); },
  obCode(v) {
    setOb({ code:v }); if (v.length < 6) return;
    setOb({ busy:true });
    later(() => {
      if (S().ob.mode === 'login') { set({ ob:null, tab:'home', screen:null }); toast('Welcome back, Tolu', 'Logged in on this phone'); return; }
      setOb({ busy:false, step:'name' });
    }, 1100);
  },
  obPickId(k) { setOb({ idType:k, idNum:ID_TYPES[k].sample, idPhoto:false, step:'idnum' }); },
  obShoot() { const manual = S().kyc === 'manual'; setOb({ face:'checking' }); later(() => { setOb({ face:'ok' }); later(() => setOb({ step:manual ? 'pending' : 'verified' }), 900); }, manual ? 1100 : 1800); },
  obDone() {
    const first = S().ob.first.trim() || 'there', pending = S().kyc === 'manual';
    set({ ob:null, newbie:true, idState:pending ? 'pending' : 'ok', tab:'home', screen:null, sheet:null, balance:0, history:[], tx:[] });
    toast(`Welcome to Jiffo, ${first}`, pending ? "We'll text you when your ID is approved" : 'Add money by bank transfer to request your first errand');
  },
  setKyc(m) { CONFIG.kyc = m; set({ kyc:m }); },
  approveId() { set({ idState:'ok' }); toast("You're verified", 'Add money by bank transfer to request your first errand'); }
};
function stageInfo(s) {
  const a = AGENTS[s.agentId].first, pick = PL(s.pick).name, pend = s.items.filter(i => i.st === 'pending').pop();
  switch (s.phase) {
    case 'matching': return { i:-1, title:'Finding an agent', sub:'Nothing is held until an agent accepts' };
    case 'accepted': return pend && pend.card === 'counter'
      ? { i:0, title:`${a} sent a new price`, sub:'Accept or decline it before they start', big:'Answer the new price', chip:['Your turn', 'o'], doing:'Waiting for your answer' }
      : { i:0, title:`${a} accepted your errand`, sub:'Agree on the price before they start', big:`${a} accepted`, chip:['Accepted', 'g'], doing:`Heading towards ${pick}`, eta:6 };
    case 'started': return s.waiting === 'item'
      ? { i:1, title:`${a} sent the item amount`, sub:'Check the receipt and photos, then lock it', big:'Check the item amount', chip:['Your turn', 'o'], doing:`At ${pick} · receipt sent` }
      : { i:1, title:`${a} is heading to ${pick}`, sub:`Price fixed at ${fmt(s.agreed)}`, big:`At ${pick} in 6 min`, chip:['On time', 'g'], doing:`Heading to ${pick}`, eta:6, at:'2:37 PM' };
    case 'bought': return { i:2, title:`${a} is on the way to you`, sub:'Items bought · 12 Admiralty Way', big:'With you in 12 min', chip:['On time', 'g'], doing:'On the way with your items', eta:12, at:'2:43 PM' };
    case 'dropoff': return { i:3, title:`${a} marked it delivered`, sub:'Check your items, then show your PIN', big:`${a} is at your gate`, chip:['At your door', 'g'], doing:'Waiting at 12 Admiralty Way' };
    case 'photo': return { i:3, title:'Drop-off photo sent', sub:'Approve it or open a dispute in the chat', big:'Approve the drop-off photo', chip:['Your turn', 'o'], doing:'Left your items with security' };
    case 'dispute': return { i:3, title:'Dispute open', sub:`${a} has 24 hours to respond`, big:'Dispute open', chip:['Under review', 'r'], doing:'Admin is reviewing the evidence' };
    case 'done': return { i:4, title:'Errand complete', sub:'Rate and tip', big:'Delivered', chip:['Completed', 'g'], doing:'Errand complete' };
  }
  return { i:-1, title:'', sub:'' };
}

/* ---------- Jumps for the prototype panel ---------- */
const JUMP = {
  home() {},
  plan() { ACT.idea(0); },
  review() { ACT.idea(0); set({ drop:'home' }); ACT.toReview(); },
  matching() { JUMP.review(); ACT.request(); },
  trip() { JUMP.matching(); runStep('accept'); },
  chat() { JUMP.trip(); runStep('counter'); set({ screen:'chat', unread:0 }); },
  live() { JUMP.chat(); ACT.acceptCounter(findCard('counter').id); runStep('start'); set({ screen:'trip' }); },
  items() { JUMP.chat(); ACT.acceptCounter(findCard('counter').id); runStep('start'); runStep('item'); set({ screen:'chat', unread:0 }); },
  pin() { JUMP.items(); ACT.acceptItem(findCard('item').id); runStep('arrive'); set({ screen:'trip', unread:0, sheet:{ type:'pin' } }); },
  delivered() { JUMP.items(); ACT.acceptItem(findCard('item').id); runStep('arrive'); set({ screen:'trip', unread:0 }); },
  counter() { JUMP.trip(); runStep('counter'); set({ screen:'trip' }); },
  profile() { JUMP.trip(); set({ sheet:{ type:'profile' } }); },
  photo() { JUMP.items(); ACT.acceptItem(findCard('item').id); runStep('photo'); set({ screen:'chat', unread:0 }); },
  rate() { JUMP.pin(); runStep('handoff'); ACT.star(5); ACT.tip(500); },
  errands() { JUMP.items(); set({ screen:null, tab:'errands' }); },
  wallet() { JUMP.items(); set({ screen:null, tab:'wallet' }); },
  account() { set({ tab:'account' }); },
  me() { set({ tab:'account', sheet:{ type:'me' } }); },
  categories() { set({ ...draftReset(), screen:'plan', focus:'desc', sheet:{ type:'cats' } }); },
  welcome() { set({ ob:OB0() }); },
  signphone() { set({ ob:{ ...OB0(), step:'phone' } }); },
  signcode() { set({ ob:{ ...OB0(), step:'code' } }); },
  signname() { set({ ob:{ ...OB0(), step:'name' } }); },
  signid() { set({ ob:{ ...OB0(), step:'idtype', agree:true } }); },
  signidnum() { set({ ob:{ ...OB0(), step:'idnum', agree:true } }); },
  signselfie() { set({ ob:{ ...OB0(), step:'selfie', agree:true, idPhoto:true } }); },
  signresult() { set({ ob:{ ...OB0(), step:S().kyc === 'manual' ? 'pending' : 'verified', agree:true, idPhoto:true, face:'ok' } }); },
  signperms() { set({ ob:{ ...OB0(), step:'perms', agree:true, face:'ok' } }); },
  newhome() { set({ ob:OB0() }); ACT.obDone(); },
  login() { set({ ob:{ ...OB0(), step:'phone', mode:'login' } }); },
  nobuy() { set({ ...draftReset(), cat:'parcel', buy:false, desc:'Collect my parcel from GIG Logistics and bring it home. The waybill is in the photo.', photos:1, pick:'gig', drop:'home', screen:'plan', focus:'desc' }); ACT.toReview(); ACT.request(); runStep('accept'); set({ skipCounter:true }); runStep('start'); set({ screen:'trip' }); }
};
function jump(n) {
  if (!JUMP[n]) return;
  clearAll(); store.reset();
  REPLAY = true; try { JUMP[n](); } finally { REPLAY = false; }
  set({ toast:null, typing:false }); schedule();
}
