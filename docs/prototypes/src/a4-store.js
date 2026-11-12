/* ================= Agent app: state, data, simulated customer ================= */
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fmt = n => '₦' + Math.round(n).toLocaleString('en-NG');
const COMMISSION = 0.15;   // Bronze sample, set in admin
const INSTANT_FEE = 100;   // sample, set in admin
const CUSTOMER_PIN = '4827';
const ME = { first:'Chinedu', full:'Chinedu Okafor', face:'chinedu', rating:'4.9', errands:142, tier:'Bronze' };
const CUST = { first:'Tolu', short:'Tolu A.', face:'tolu', rating:'4.8', errands:57, since:'January 2026',
  reviews:[{ who:'kemi', name:'Kemi A.', stars:5, d:'Last week', t:'Clear instructions and answered quickly.' }, { who:'ibrahim', name:'Ibrahim Y.', stars:5, d:'3 weeks ago', t:'Was ready at the gate with the PIN.' }] };
const CUST_PUB = { kind:'customer', name:CUST.short, face:CUST.face, since:CUST.since, area:'Lekki Phase 1', verified:'ID and selfie verified', rating:CUST.rating, errands:CUST.errands, third:['0', 'Disputes'], ratings:49,
  compliments:[['Clear instructions', 21], ['Ready at hand-off', 17], ['Polite', 15], ['Quick to reply', 9]],
  reviews:[{ who:'aisha', name:'Aisha B.', stars:5, d:'Last week', t:'Answered quickly when an item was out of stock.' }, ...CUST.reviews] };
const ME_PUB = { kind:'agent', name:'Chinedu O.', face:'chinedu', since:'March 2025', area:'Lekki and Victoria Island', verified:'ID, BVN and address verified', tier:'Bronze',
  rating:ME.rating, errands:ME.errands, third:['98%', 'Completed'], ratings:131,
  compliments:[['Great communication', 64], ['Careful with items', 51], ['Fast', 47], ['Clear receipts', 38]], dist:[88, 9, 2, 1, 0],
  reviews:[{ who:'kemi', name:'Kemi A.', stars:5, d:'2 days ago', t:'Found everything on my list and sent a photo of the receipt before paying. Very polite.' },
    { who:'femi', name:'Femi O.', stars:5, d:'Last week', t:'Stood in the bank queue for almost two hours and kept me updated the whole time.' },
    { who:'aisha', name:'Aisha B.', stars:5, d:'3 weeks ago', t:'Asked before swapping a brand that was out of stock.' }],
  facts:[['Speaks', 'English, Pidgin, Igbo'], ['Works around', 'Lekki and Victoria Island']] };
const DESC = 'Buy 1 carton of Indomie Onion Chicken and a 5 L Kings vegetable oil at Shoprite, then bring them to my house.';
const BOARD = [
  { id:0, cat:'groceries', fee:1500, km:4.2, to:1.3, urgent:true, buy:true, when:'Now', art:'groceries', title:'Groceries from Shoprite', from:'Shoprite, Lekki', dest:'12 Admiralty Way', who:'tolu', name:'Tolu A.', rating:'4.8' },
  { id:1, cat:'parcel', fee:1800, km:6.1, to:2.4, buy:false, when:'Now', art:'parcel', title:'Parcel to Chevron Drive', from:'GIG Logistics, Admiralty Way', dest:'Chevron Drive, Lekki', who:'kemi', name:'Kemi O.', rating:'4.9' },
  { id:2, cat:'pharmacy', fee:1200, km:2.3, to:1.9, buy:true, when:'Now', art:'pharmacy', title:'Prescription from Medplus', from:'Medplus, Admiralty Way', dest:'Freedom Way, Lekki Phase 1', who:'ibrahim', name:'Ibrahim Y.', rating:'4.7' },
  { id:3, cat:'shopping', fee:1400, km:3.0, to:3.4, buy:false, when:'Now', art:'parcel', title:'Return a phone to Circle Mall', from:'Fola Osibo Road', dest:'Circle Mall, Osapa', who:'femi', name:'Femi O.', rating:'4.6' },
  { id:4, cat:'queue', fee:6000, km:9.8, to:7.5, buy:false, sched:true, when:'Sat, 14 Nov · 8:00 AM', art:'queue', title:'Passport collection queue', from:'Alagbon Close, Ikoyi', dest:'Alagbon Close, Ikoyi', who:'aisha', name:'Ada N.', rating:'5.0' },
  { id:5, cat:'food', fee:1300, km:2.8, to:1.1, buy:true, when:'Now', title:'Lunch from a buka on Admiralty Way', from:'Mama Put, Admiralty Way', dest:'Lekki Phase 1 office', who:'femi', name:'Femi O.', rating:'4.6' },
  { id:6, cat:'laundry', fee:1700, km:3.6, to:2.0, buy:true, when:'Now', title:'Dry cleaning pickup', from:'Klean Dry Cleaners, Fola Osibo', dest:'Freedom Way, Lekki Phase 1', who:'kemi', name:'Kemi O.', rating:'4.9' }
];
/* Errand preferences: a switch per category plus purchase errands. Urgent pushes and the board follow them. */
const PREFS0 = () => ({ cats:Object.fromEntries(CATS.map(c => [c.k, true])), buy:true });
const matches = (j, p) => !!p.cats[j.cat] && (!j.buy || p.buy);
const prefLine = p => { const n = CATS.filter(c => p.cats[c.k]).length; return `${n === CATS.length ? 'All' : n + ' of ' + CATS.length} categories · purchase errands ${p.buy ? 'on' : 'off'}`; };
const FILTERS = [['near', 'Nearest'], ['fee', 'Highest fee'], ['buy', 'Buying items'], ['sched', 'Scheduled']];
const STEPS = ['Accepted', 'Service started', 'Items bought', 'Delivered', 'Completed'];
const QUICK = ["I'm on my way", "I'm at the store", 'Traffic is heavy, small delay', "I'm at your gate"];
const LINES = [['Indomie Onion Chicken, carton of 40', 13200], ['Kings vegetable oil, 5 L', 16150]];

const itemReset = () => ({ receipt:false, photo:false, noReceipt:false, lines:LINES.map(l => [...l]) });
const jobReset = () => ({ phase:'idle', items:[], typing:false, unread:0, agreed:1500, pending:null, cAmt:2000, item:itemReset(), itemAmt:0,
  pin:'', pinErr:false, wait:600, calls:0, shot:false, rating:0, tip:0, method:'', expanded:false, chat:'', reqLeft:20, cameraFor:null });
/* Sign-up: states switched on in admin (false = new agents waitlisted there), banks from the payout adapter */
const STATES = [['Lagos', true], ['FCT Abuja', true], ['Rivers', true], ['Oyo', true], ['Ogun', true], ['Enugu', true], ['Kano', false]];
const BANKS = ['Access Bank', 'First Bank', 'GTBank', 'Kuda', 'Moniepoint', 'OPay', 'PalmPay', 'UBA', 'Zenith Bank'];
const A_STEPS = [
  ['id', 'Identity', 'NIN, BVN and a selfie', 'shield'],
  ['addr', 'Address and emergency contact', 'Where you live and who to call', 'home'],
  ['bank', 'Payout account', 'In your own name', 'bank'],
  ['prefs', 'Errand preferences', 'Categories and purchase errands', 'tune'],
  ['learn', 'How errands work', 'Four short screens and the agent terms', 'info']
];
const CHECKS = ['NIN matches your details', 'BVN matches your details', 'Selfie matches your ID photo', 'Age 18 or older', 'Address confirmed', 'Bank account name matches your ID', 'No other agent account on this NIN'];
const MANUAL_ITEMS = ['NIN and NIN slip photo received', 'BVN received', 'Selfie received', 'Proof of address received', 'Bank account name matches', 'Review by our team'];
const OB0 = () => ({ step:'welcome', mode:'signup', phone:'806 551 0294', code:'', busy:false, first:'Chinedu', last:'Okafor', email:'chinedu.okafor@example.com', state:'Lagos', area:'Lekki',
  nin:ID_TYPES.nin.sample, ninPhoto:false, bvn:ID_TYPES.bvn.sample, addrPhoto:false, face:'idle', done:{}, addr:'14 Fola Osibo Road, Lekki Phase 1', ecName:'Ngozi Okafor', ecPhone:'803 447 1902', ecRel:'Sibling',
  bank:'GTBank', acct:'', looking:false, acctOk:false, slide:0, agree:false, checks:0, flag:null });
function fresh() {
  return { ob:null, kyc:CONFIG.kyc, custPhoto:CONFIG.custPhotoBeforeAccept, tab:'home', screen:null, sheet:null, call:false, toast:null, auto:true, online:false, selfie:'idle', filter:'near', prefs:PREFS0(), ...jobReset(),
    avail:4850, pend:2550, today:6400, todayN:3, week:[9200, 7800, 11400, 6400, 0, 0, 0], range:'week', wd:{ mode:'sched', done:false },
    history:[
      { t:'Pharmacy pickup', s:'Medplus · 12:10 PM', fee:1200, tip:200, items:6100, art:'pharmacy' },
      { t:'Parcel to Chevron Drive', s:'GIG Logistics · 10:25 AM', fee:2400, tip:0, items:0, art:'parcel' },
      { t:'Documents to Victoria Island', s:'8:40 AM', fee:3700, tip:0, items:0, art:'parcel' }
    ] };
}
const store = (() => {
  let s = fresh(); const subs = new Set();
  return { get:() => s, set(p) { s = { ...s, ...(typeof p === 'function' ? p(s) : p) }; subs.forEach(f => f()); }, reset() { s = fresh(); subs.forEach(f => f()); }, sub(f) { subs.add(f); return () => subs.delete(f); } };
})();
const S = () => store.get();
const set = p => store.set(p);
const net = a => a - Math.round(a * COMMISSION);
let uid = 0;
const push = (...its) => set(s => {
  const add = its.map(i => ({ id:'m' + (++uid), ...i }));
  const bump = add.filter(i => i.kind === 'them').length;
  return { items:[...s.items, ...add], unread:s.screen === 'chat' ? 0 : s.unread + bump };
});
const patchItem = (id, p) => set(s => ({ items:s.items.map(i => i.id === id ? { ...i, ...p } : i) }));
const findCard = c => [...S().items].reverse().find(i => i.card === c);
const sys = (text, icon = 'info') => push({ kind:'sys', text, icon });
let REPLAY = false;
const timers = new Set();
let custT = null, pingT = null, toastT = null, waitT = null, reqT = null;
function later(fn, ms) { if (REPLAY) { fn(); return; } const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); }
function clearAll() { timers.forEach(clearTimeout); timers.clear(); [custT, pingT].forEach(clearTimeout); [waitT, reqT].forEach(clearInterval); }
function says(text, then) {
  if (REPLAY) { push({ kind:'them', text }); then && then(); return; }
  set({ typing:true }); later(() => { set({ typing:false }); push({ kind:'them', text }); then && then(); }, 1100);
}
function toast(text, sub, go) {
  if (REPLAY) return;
  set({ toast:{ text, sub, go, k:Date.now() } }); clearTimeout(toastT); toastT = setTimeout(() => set({ toast:null }), 4200);
}
const notify = (text, sub, go = 'chat') => { if (S().screen !== 'chat') toast(text, sub, go); };

/* ---------- Customer side (simulated) ---------- */
const CU = {
  counter() {
    const c = findCard('counter'); if (!c || c.st !== 'pending') return;
    patchItem(c.id, { st:'accepted' }); set({ agreed:c.amt, pending:null });
    says(`Okay, ${fmt(c.amt)} is fine.`); sys(`Tolu accepted ${fmt(c.amt)}. The new amount is held for you.`, 'check');
    notify(`Tolu accepted ${fmt(c.amt)}`, 'Tap Start service when you set off', 'trip');
  },
  counterNo() {
    const c = findCard('counter'); if (!c || c.st !== 'pending') return;
    patchItem(c.id, { st:'declined' }); set({ pending:null });
    says("Let's keep it at ₦1,500 please."); sys(`Tolu declined and kept you on the errand. The price stays at ${fmt(S().agreed)}.`);
    notify('Tolu declined the new price', 'They kept you on the errand', 'trip');
  },
  lock() {
    const c = findCard('item'); if (!c || c.st !== 'pending') return;
    patchItem(c.id, { st:'accepted' }); set({ phase:'bought' });
    sys(`Tolu locked ${fmt(c.amt)}. You're paid it at hand-off, withdrawable at once.`, 'lock');
    notify(`Tolu locked ${fmt(c.amt)}`, 'Head to the drop-off', 'trip');
  },
  approve() { const c = findCard('photo'); if (!c || c.st !== 'pending') return; patchItem(c.id, { st:'approved' }); finish('photo'); }
};
function nextCustomer() {
  const s = S();
  if (s.pending) return 'counter';
  if (s.phase === 'itemsent') return 'lock';
  if (s.phase === 'photo') return 'approve';
  return null;
}
const CDELAY = { counter:3000, lock:3200, approve:4200 };
const CLABEL = { counter:'Customer accepts the new price', lock:'Customer locks the item amount', approve:'Customer approves the drop-off photo' };
function runCustomer(k) { k = k || nextCustomer(); if (!k) return; CU[k](); scheduleC(); }
function scheduleC() { clearTimeout(custT); if (REPLAY || !S().auto) return; const k = nextCustomer(); if (k) custT = setTimeout(() => runCustomer(k), CDELAY[k]); }
function schedulePing(ms) {
  clearTimeout(pingT); if (REPLAY || !S().auto) return;
  pingT = setTimeout(() => { const s = S(); if (s.online && s.phase === 'idle' && !s.sheet && !s.screen) openPing(); }, ms);
}
function openPing() {
  if (!matches(BOARD[0], S().prefs)) {
    toast("This urgent request wouldn't reach you", `It's ${CAT(BOARD[0].cat).name} with a purchase. Your preferences leave it out.`);
    return;
  }
  set({ phase:'request', sheet:{ type:'request' }, reqLeft:20 });
  if (REPLAY) return;
  clearInterval(reqT);
  reqT = setInterval(() => {
    const s = S(); if (s.phase !== 'request') { clearInterval(reqT); return; }
    if (s.reqLeft <= 1) { clearInterval(reqT); set({ phase:'idle', sheet:null }); toast('Request passed to the next agent', 'It timed out'); schedulePing(9000); return; }
    set({ reqLeft:s.reqLeft - 1 });
  }, 1000);
}
function finish(method) {
  const s = S(), n = net(s.agreed), items = s.itemAmt;
  clearInterval(waitT);
  set({ phase:'done', method, screen:'done', sheet:null, pend:s.pend + n, today:s.today + n, todayN:s.todayN + 1, avail:s.avail + items, week:s.week.map((v, i) => i === 3 ? v + n : v),
    history:[{ t:'Groceries from Shoprite', s:'Shoprite · 2:46 PM', fee:s.agreed, tip:0, items, art:'groceries' }, ...s.history] });
  sys(method === 'pin' ? 'PIN accepted. Errand complete.' : 'Tolu approved your drop-off photo. Errand complete.', 'check');
  later(() => { set(x => ({ tip:500, pend:x.pend + 500, today:x.today + 500, week:x.week.map((v, i) => i === 3 ? v + 500 : v), history:x.history.map((h, i) => i ? h : { ...h, tip:500 }) })); toast('Tolu tipped you ₦500', 'Tips go to you in full'); }, 2600);
}

/* ---------- Agent actions ---------- */
const ACT = {
  tab(t) { set({ tab:t, screen:null, sheet:null }); },
  goOnline() { if (S().selfie !== 'ok') { set({ screen:'selfie' }); return; } set({ online:true }); schedulePing(4000); },
  goOffline() { clearTimeout(pingT); set({ online:false }); },
  takeSelfie() {
    set({ selfie:'checking' });
    later(() => { set({ selfie:'ok' }); later(() => { set({ online:true, screen:null }); toast("You're online", 'Matched to your ID. Errands near you are on the board.'); schedulePing(4000); }, 900); }, 1600);
  },
  filter(f) { set({ filter:f }); },
  prefs() { set({ sheet:{ type:'prefs' } }); },
  prefCat(k) { set(s => ({ prefs:{ ...s.prefs, cats:{ ...s.prefs.cats, [k]:!s.prefs.cats[k] } } })); },
  prefBuy() { set(s => ({ prefs:{ ...s.prefs, buy:!s.prefs.buy } })); },
  prefAll(on) { set(s => ({ prefs:{ ...s.prefs, cats:Object.fromEntries(CATS.map(c => [c.k, on])) } })); },
  openJob(id) { set({ sheet:{ type:'job', id } }); },
  acceptJob(id) { if (id !== 0) { set({ sheet:null }); toast('This prototype runs the Shoprite errand end to end', 'Open the urgent Shoprite card to try it'); return; } ACT.accept(); },
  accept() {
    clearInterval(reqT); clearTimeout(pingT);
    set({ ...jobReset(), phase:'accepted', screen:'trip', sheet:null });
    sys('You accepted Tolu’s errand. ₦1,500 is held for you until hand-off.', 'lock');
    push({ kind:'them', text:DESC });
    push({ kind:'them', text:'Please get the 5 litre Kings oil, not a smaller one. Thank you!' });
  },
  decline() { clearInterval(reqT); set({ phase:'idle', sheet:null }); toast('Request passed to the next agent'); schedulePing(9000); },
  openTrip() { set({ screen:'trip' }); },
  openChat() { set({ screen:'chat', unread:0, sheet:null }); },
  closeChat() { set({ screen:'trip' }); },
  close() { set({ screen:null, sheet:null }); },
  expand(v) { set(s => ({ expanded:typeof v === 'boolean' ? v : !s.expanded })); },
  counterSheet() { if (S().phase !== 'accepted' || S().pending) return; set({ sheet:{ type:'counter' }, cAmt:S().agreed + 500 }); },
  cStep(d) { set(s => ({ cAmt:Math.max(500, s.cAmt + d) })); },
  sendCounter() { const s = S(); push({ kind:'me', card:'counter', amt:s.cAmt, was:s.agreed, st:'pending' }); set({ pending:s.cAmt, sheet:null }); toast(`New price sent: ${fmt(s.cAmt)}`, 'Tolu sees it as a popup and in the chat', 'chat'); scheduleC(); },
  askStart() { if (S().pending) return; set({ sheet:{ type:'start' } }); },
  start() { set({ phase:'started', sheet:null }); sys(`You started the service. The price is fixed at ${fmt(S().agreed)} and Tolu’s tracker shows Service started.`, 'play'); },
  openItem() { if (S().phase !== 'started') return; set({ screen:'item' }); },
  camera(kind) { set({ screen:'camera', cameraFor:kind, shot:false }); },
  shutter() { set({ shot:true }); },
  retake() { set({ shot:false }); },
  usePhoto() {
    const s = S(), k = s.cameraFor;
    if (k === 'drop') { set({ phase:'photo', screen:'trip' }); push({ kind:'me', card:'photo', st:'pending' }); scheduleC(); return; }
    set({ item:{ ...s.item, [k]:true }, screen:'item', cameraFor:null });
  },
  toggleNoReceipt() { set(s => ({ item:{ ...s.item, noReceipt:!s.item.noReceipt, receipt:false } })); },
  line(k, f, v) { set(s => { const lines = s.item.lines.map(l => [...l]); lines[k][f] = f ? (Number(String(v).replace(/[^0-9]/g, '')) || 0) : v; return { item:{ ...s.item, lines } }; }); },
  sendItem() {
    const s = S(), amt = s.item.lines.reduce((a, l) => a + (Number(l[1]) || 0), 0);
    if (!s.item.receipt || !s.item.photo || !amt) return;
    push({ kind:'me', card:'item', amt, lines:s.item.lines, st:'pending', noReceipt:s.item.noReceipt });
    set({ phase:'itemsent', itemAmt:amt, screen:'trip' });
    toast('Item amount sent', 'Tolu checks your photos and locks it', 'chat'); scheduleC();
  },
  askDelivered() { set({ sheet:{ type:'delivered' } }); },
  delivered() { set({ phase:'delivered', sheet:null }); sys('You marked the errand delivered. Tolu can now see their PIN.', 'check'); },
  openPin() { set({ screen:'pin', pin:'', pinErr:false }); },
  key(d) {
    const s = S(); if (s.pin.length >= 4) return;
    const pin = s.pin + d; set({ pin, pinErr:false });
    if (pin.length === 4) { if (pin === CUSTOMER_PIN) finish('pin'); else { set({ pinErr:true }); later(() => set({ pin:'' }), 900); } }
  },
  del() { set(s => ({ pin:s.pin.slice(0, -1), pinErr:false })); },
  notAnswering() {
    set({ screen:'wait' }); clearInterval(waitT);
    if (!REPLAY) waitT = setInterval(() => { const s = S(); if (s.wait <= 0 || s.phase === 'unreachable') { clearInterval(waitT); return; } set({ wait:s.wait - 1 }); }, 1000);
  },
  skipWait() { set({ wait:0 }); },
  markUnreachable() { const s = S(); if (s.wait > 0 || !s.calls) return; clearInterval(waitT); set({ phase:'unreachable' }); sys('You marked Tolu unreachable. They have 24 hours to arrange redelivery or collection. Our team can step in at any time.', 'flag'); },
  call(on) { set(s => ({ call:on, sheet:null, calls:on ? s.calls + 1 : s.calls })); },
  sendChat(t) { const s = S(), text = (t || s.chat).trim(); if (!text) return; push({ kind:'me', text }); set({ chat:'' }); if (!s.typing && s.phase !== 'idle') says('Okay, thank you.'); },
  star(n) { set({ rating:n }); },
  toBoard() { clearAll(); set({ ...jobReset(), screen:null, tab:'home', sheet:null }); schedulePing(12000); },
  range(r) { set({ range:r }); },
  wdMode(m) { set(s => ({ wd:{ ...s.wd, mode:m } })); },
  confirmWd() { const s = S(); if (s.avail <= 0) return; const amt = s.avail - (s.wd.mode === 'instant' ? INSTANT_FEE : 0); set({ wd:{ ...s.wd, done:true, amt, when:s.wd.mode === 'instant' ? 'in a few minutes' : 'today at 6:00 PM' }, avail:0 }); },
  closeWd() { set({ wd:{ mode:'sched', done:false }, sheet:null }); },
  sheet(type, extra) { set({ sheet:{ type, ...(extra || {}) } }); },
  closeSheet() { if (S().sheet && S().sheet.type === 'request') return ACT.decline(); set({ sheet:null }); },
  directions(where) { toast(`Opening ${where} in your maps app`, 'Directions open in the phone’s own maps app'); },
  toastGo() { const g = S().toast && S().toast.go; set({ toast:null }); if (g === 'chat' && S().phase !== 'idle') ACT.openChat(); else if (g === 'trip' && S().phase !== 'idle') ACT.openTrip(); },
  autoplay() { set(s => ({ auto:!s.auto })); scheduleC(); const s = S(); if (s.auto && s.online && s.phase === 'idle') schedulePing(3000); },
  custNext() { runCustomer(); },
  custDecline() { CU.counterNo(); scheduleC(); },
  sendPing() { set({ online:true, selfie:'ok', screen:null, tab:'home' }); openPing(); },
  reset() { clearAll(); store.reset(); if (location.hash) history.replaceState(null, '', location.pathname + location.search); },
  /* Sign-up and log in */
  obStart(mode) { set(s => ({ ob:{ ...(s.ob || OB0()), step:'phone', mode, code:'', busy:false } })); },
  obTo(step) { setOb({ step, ...(step === 'selfie' ? { face:'idle' } : {}), ...(step === 'code' ? { code:'', busy:false } : {}), ...(step === 'learn' ? { slide:0 } : {}) }); },
  obCode(v) {
    setOb({ code:v }); if (v.length < 6) return;
    setOb({ busy:true });
    later(() => {
      if (S().ob.mode === 'login') { set({ ob:null, tab:'home', screen:null, online:false, selfie:'idle' }); toast('Welcome back, Chinedu', 'Tap GO to go online'); return; }
      setOb({ busy:false, step:'basics' });
    }, 1100);
  },
  obState(n) { setOb({ state:n }); set({ sheet:null }); },
  obBasicsNext() { const o = S().ob, open = (STATES.find(x => x[0] === o.state) || [])[1]; ACT.obTo(open ? 'list' : 'waitlist'); },
  obOpen(k) { ACT.obTo({ id:'nin', addr:'address', bank:'bank', prefs:'prefs', learn:'learn' }[k]); },
  setKyc(m) { CONFIG.kyc = m; set({ kyc:m }); },
  togglePhoto() { CONFIG.custPhotoBeforeAccept = !CONFIG.custPhotoBeforeAccept; set({ custPhoto:CONFIG.custPhotoBeforeAccept }); },
  approveApp() { if (S().ob && S().ob.step === 'submitted') setOb({ step:'approved' }); },
  obMark(k) { setOb(o => ({ done:{ ...o.done, [k]:true }, step:'list' })); },
  obShoot() {
    const manual = S().kyc === 'manual'; setOb({ face:'checking' });
    later(() => { setOb({ face:'ok' }); later(() => { ACT.obMark('id'); toast('Identity done', manual ? 'It goes to our team when you submit' : 'Your selfie is now your profile photo'); }, 900); }, manual ? 1100 : 1800);
  },
  obBank(n) { setOb({ bank:n, acctOk:false, looking:false }); set({ sheet:null }); if (digits(S().ob.acct, 10).length === 10) ACT.obAcct(S().ob.acct); },
  obAcct(v) {
    const d = digits(v, 10); setOb({ acct:d, acctOk:false, looking:d.length === 10 });
    if (d.length === 10) later(() => { if (digits(S().ob.acct, 10) === d) setOb({ looking:false, acctOk:true }); }, 1000);
  },
  obSlide(n) { setOb({ slide:n }); },
  obSubmit() {
    if (S().kyc === 'manual') { setOb({ step:'submitted' }); return; }
    setOb({ step:'checking', checks:0, flag:null });
    const tick = () => later(() => { const n = S().ob.checks + 1; setOb({ checks:n }); if (n < CHECKS.length) tick(); else later(() => setOb({ step:'approved' }), 700); }, 750);
    tick();
  },
  obFinish() { set(s => ({ ob:null, tab:'home', screen:null, online:false, selfie:'idle' })); toast("You're a Jiffo agent", 'Tap GO when you want your first errand'); }
};
function stageInfo(s) {
  const earn = fmt(net(s.agreed));
  switch (s.phase) {
    case 'accepted': return s.pending
      ? { i:0, title:`Waiting for Tolu to answer ${fmt(s.pending)}`, sub:'New prices are allowed until you tap Start service', big:'New price sent', tsub:`Tolu sees ${fmt(s.pending)} as a popup. You can't start until they answer.`, chip:['Waiting for Tolu', 'k'], doing:'Reading your new price', next:'Shoprite', eta:6 }
      : { i:0, title:'Agree the price, then start', sub:'New prices are allowed until you tap Start service', big:'Agree the price', tsub:'Then tap Start service. New prices are allowed until then.', chip:['Accepted', 'g'], doing:'Expecting you at Shoprite', next:'Shoprite', eta:6 };
    case 'started': return { i:1, title:'Buy the items at Shoprite', sub:`Price fixed at ${fmt(s.agreed)}. Then send the item amount with photos.`, big:'Buy the items', tsub:'At Shoprite. Then send the item amount with the receipt and items photos.', chip:['Your turn', 'o'], doing:'Following you on the map', next:'Shoprite' };
    case 'itemsent': return { i:1, title:`Waiting for Tolu to lock ${fmt(s.itemAmt)}`, sub:'They check your receipt and photos', big:`${fmt(s.itemAmt)} sent`, tsub:'Tolu checks your receipt and photos, then locks it. Our team steps in after 30 minutes.', chip:['Waiting for Tolu', 'k'], doing:'Checking your receipt', next:'Shoprite' };
    case 'bought': return { i:2, title:'Take the items to Tolu', sub:'12 Admiralty Way, Lekki Phase 1', big:'Drop-off in 12 min', tsub:'12 Admiralty Way, Lekki Phase 1 · 4.2 km', chip:['On the way', 'g'], doing:'Expecting you at 12 Admiralty Way', next:'12 Admiralty Way', eta:12 };
    case 'delivered': return { i:3, title:'Ask Tolu for their PIN', sub:'They see it once you marked it delivered', big:"Ask for Tolu's PIN", tsub:'They can see it now that you marked it delivered', chip:['Your turn', 'o'], doing:'Opening the PIN', next:'12 Admiralty Way' };
    case 'photo': return { i:3, title:'Drop-off photo sent', sub:'Waiting for Tolu to approve', big:'Drop-off photo sent', tsub:'Waiting for Tolu to approve. It approves itself after 24 hours.', chip:['Waiting for Tolu', 'k'], doing:'Reviewing your photo', next:'12 Admiralty Way' };
    case 'unreachable': return { i:3, title:'Customer unreachable', sub:'Tolu has 24 hours to arrange redelivery', big:'Customer unreachable', tsub:'Tolu has 24 hours to arrange redelivery. Admin can step in.', chip:['On hold', 'r'], doing:'Not answering', next:'12 Admiralty Way' };
    case 'done': return { i:4, title:'Errand complete', sub:`${earn} earned`, big:`You earned ${earn}`, tsub:'Paid with the PIN', chip:['Completed', 'g'], doing:'Errand complete' };
  }
  return { i:-1, title:'', sub:'' };
}

/* ---------- Jumps ---------- */
const JUMP = {
  offline() {},
  selfie() { set({ screen:'selfie' }); },
  board() { set({ selfie:'ok', online:true }); },
  request() { JUMP.board(); openPing(); },
  trip() { JUMP.board(); ACT.accept(); },
  counter() { JUMP.trip(); ACT.counterSheet(); },
  chat() { JUMP.trip(); set({ cAmt:2000 }); ACT.sendCounter(); set({ screen:'chat', unread:0 }); },
  started() { JUMP.chat(); CU.counter(); ACT.start(); set({ screen:'trip' }); },
  item() { JUMP.started(); ACT.openItem(); },
  itemready() { JUMP.item(); set(s => ({ item:{ ...s.item, receipt:true, photo:true } })); },
  itemsent() { JUMP.itemready(); ACT.sendItem(); },
  bought() { JUMP.itemsent(); CU.lock(); },
  delivered() { JUMP.bought(); ACT.delivered(); },
  pin() { JUMP.delivered(); ACT.openPin(); set({ pin:'48' }); },
  dropphoto() { JUMP.delivered(); ACT.camera('drop'); set({ shot:true }); },
  unreachable() { JUMP.delivered(); ACT.notAnswering(); set({ wait:0, calls:1 }); },
  done() { JUMP.delivered(); finish('pin'); set(x => ({ tip:500, pend:x.pend + 500, today:x.today + 500, rating:5 })); },
  earnings() { JUMP.done(); set({ screen:null, tab:'earnings' }); },
  withdraw() { JUMP.earnings(); set({ sheet:{ type:'withdraw' } }); },
  history() { JUMP.done(); set({ screen:null, tab:'errands' }); },
  account() { JUMP.board(); set({ tab:'account' }); },
  me() { JUMP.board(); set({ tab:'account', sheet:{ type:'me' } }); },
  custprofile() { JUMP.trip(); set({ sheet:{ type:'cust' } }); },
  prefs() { JUMP.board(); set({ sheet:{ type:'prefs' } }); },
  apply() { set({ ob:OB0() }); },
  aphone() { set({ ob:{ ...OB0(), step:'phone' } }); },
  acode() { set({ ob:{ ...OB0(), step:'code' } }); },
  basics() { set({ ob:{ ...OB0(), step:'basics' } }); },
  waitlist() { set({ ob:{ ...OB0(), step:'waitlist', state:'Kano' } }); },
  checklist() { set({ ob:{ ...OB0(), step:'list', done:{ id:true, prefs:true } } }); },
  aid() { set({ ob:{ ...OB0(), step:'nin' } }); },
  abvn() { set({ ob:{ ...OB0(), step:'bvn', ninPhoto:true } }); },
  aconsent() { CONFIG.kyc = 'provider'; set({ kyc:'provider', ob:{ ...OB0(), step:'bvnconsent' } }); },
  submitted() { set({ ob:{ ...OB0(), step:'submitted', done:{ id:true, addr:true, bank:true, prefs:true, learn:true } } }); },
  aselfie() { set({ ob:{ ...OB0(), step:'selfie' } }); },
  address() { set({ ob:{ ...OB0(), step:'address', done:{ id:true } } }); },
  bank() { set({ ob:{ ...OB0(), step:'bank', done:{ id:true, addr:true }, acct:'0123454821', acctOk:true } }); },
  learn() { set({ ob:{ ...OB0(), step:'learn', slide:2, done:{ id:true, addr:true, bank:true, prefs:true } } }); },
  terms() { set({ ob:{ ...OB0(), step:'learn', slide:4, done:{ id:true, addr:true, bank:true, prefs:true } } }); },
  ready() { set({ ob:{ ...OB0(), step:'list', done:{ id:true, addr:true, bank:true, prefs:true, learn:true } } }); },
  checking() { set({ ob:{ ...OB0(), step:'checking', checks:3, done:{ id:true, addr:true, bank:true, prefs:true, learn:true } } }); },
  approved() { set({ ob:{ ...OB0(), step:'approved', checks:CHECKS.length } }); },
  underreview() { set({ ob:{ ...OB0(), step:'review', checks:CHECKS.length, flag:2 } }); },
  alogin() { set({ ob:{ ...OB0(), step:'phone', mode:'login' } }); },
  filtered() { JUMP.board(); set(s => ({ prefs:{ cats:{ ...s.prefs.cats, groceries:false, laundry:false }, buy:false } })); }
};
function jump(n) {
  if (!JUMP[n]) return;
  clearAll(); store.reset();
  REPLAY = true; try { JUMP[n](); } finally { REPLAY = false; }
  set({ toast:null, typing:false }); scheduleC();
  if (n === 'board') schedulePing(6000);
  if (n === 'request') openPing();
}
