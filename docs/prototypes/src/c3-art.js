/* ================= Icons, avatars, illustrations ================= */
const ICONS = {
  menu:'<path d="M4 8.5h16M4 15.5h10"/>', plus:'<path d="M12 5v14M5 12h14"/>', minus:'<path d="M5 12h14"/>',
  up:'<path d="M12 19V5M5.5 11.5L12 5l6.5 6.5"/>', right:'<path d="M5 12h14M13 6l6 6-6 6"/>',
  mic:'<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  wallet:'<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H17v3"/><path d="M4 7.5V17a2 2 0 0 0 2 2h14V8H6.5A2.5 2.5 0 0 1 4 7.5z"/><path d="M16 13.5h1"/>',
  x:'<path d="M6 6l12 12M18 6L6 18"/>', back:'<path d="M15 18l-6-6 6-6"/>', chev:'<path d="M9 6l6 6-6 6"/>', down:'<path d="M6 9l6 6 6-6"/>',
  check:'<path d="M20 6L9 17l-5-5"/>',
  phone:'<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  more:'<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  shield:'<path d="M12 3l8 3v6c0 4.8-3.4 8-8 9-4.6-1-8-4.2-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  verified:'<path d="M12 2.8l2.3 1.7 2.8-.2.9 2.7 2.3 1.6-.9 2.7.9 2.7-2.3 1.6-.9 2.7-2.8-.2L12 21.2l-2.3-1.7-2.8.2-.9-2.7-2.3-1.6.9-2.7-.9-2.7 2.3-1.6.9-2.7 2.8.2z"/><path d="M8.8 12.2l2.2 2.2 4.2-4.4"/>',
  star:'<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8L3.5 9.7l5.9-.8z"/>',
  camera:'<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  image:'<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M20.5 16l-5-5-8 8.5"/>',
  receipt:'<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  bag:'<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
  search:'<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  edit:'<path d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/><path d="M17.5 3.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z"/>',
  home:'<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>', work:'<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5h6v2M3 13h18"/>',
  gift:'<rect x="3.5" y="8" width="17" height="4" rx="1"/><path d="M5 12v8h14v-8M12 8v12M12 8c-1.2-2.8-4.8-3.2-4.8-1.2S10 8 12 8zm0 0c1.2-2.8 4.8-3.2 4.8-1.2S14 8 12 8z"/>',
  help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17h.01"/>',
  alert:'<path d="M12 3.5l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
  share:'<circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="M8.2 10.8l7.6-4.1M8.2 13.2l7.6 4.1"/>',
  lock:'<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  bank:'<path d="M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20.5h18"/>',
  chat:'<path d="M4 5h16v11H9.5L4 20z"/>', pin:'<path d="M12 21s-7-6.1-7-11.2A7 7 0 0 1 19 9.8C19 14.9 12 21 12 21z"/><circle cx="12" cy="10" r="2.5"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', cal:'<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  zap:'<path d="M13 2.5L4.5 14H11l-1 7.5L19.5 10H13z"/>', info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  play:'<circle cx="12" cy="12" r="9"/><path d="M10 8.5l5.5 3.5-5.5 3.5z"/>', map:'<path d="M9 4L3.5 6v14L9 18l6 2 5.5-2V4L15 6z"/><path d="M9 4v14M15 6v14"/>',
  expand:'<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>', locate:'<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5"/>',
  eye:'<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff:'<path d="M3 3l18 18M10.6 6.1A9.7 9.7 0 0 1 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-3 3.6M6.4 7.6A16 16 0 0 0 2.5 12s3.5 6 9.5 6a9.5 9.5 0 0 0 4-.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  speaker:'<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/>',
  micoff:'<path d="M4 4l16 16"/><path d="M9 9v2a3 3 0 0 0 5.1 2.1M15 10.5V6a3 3 0 0 0-5.8-1M5 11a7 7 0 0 0 11.3 5.5M19 11a7 7 0 0 1-.4 2.3M12 18v3"/>',
  flag:'<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>', ban:'<circle cx="12" cy="12" r="9"/><path d="M5.7 5.7l12.6 12.6"/>',
  copy:'<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M5 15.5V5.5A1.5 1.5 0 0 1 6.5 4h10"/>',
  route:'<circle cx="6" cy="18" r="2.4"/><circle cx="18" cy="6" r="2.4"/><path d="M8.4 18H16a3 3 0 0 0 0-6H8a3 3 0 0 1 0-6h7.6"/>',
  nav:'<path d="M12 2.5l7.5 18-7.5-4-7.5 4z"/>', history:'<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5M3.5 4v4.5H8"/><path d="M12 8v4l3 2"/>',
  users:'<circle cx="8.5" cy="8" r="3"/><path d="M3 20a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9" r="2.4"/><path d="M15.5 14.6A4.8 4.8 0 0 1 21 19.5"/>',
  cart:'<circle cx="9" cy="20" r="1.4"/><circle cx="17.5" cy="20" r="1.4"/><path d="M2.5 4h2.6l2.4 11.5h11l2-8.5H6.2"/>',
  food:'<path d="M6 3v6a2 2 0 0 0 4 0V3M8 11v10M17.5 21V3c-2 1-3.5 3.5-3.5 7 0 1.7.9 3 3.5 3"/>',
  pill:'<path d="M10.6 20.1a4.9 4.9 0 0 1-6.9-6.9l9.5-9.5a4.9 4.9 0 0 1 6.9 6.9z"/><path d="M8.5 8.5l7 7"/>',
  shirt:'<path d="M8.5 3.5 4 5.8 2.5 10l3 1.2v9.3h13v-9.3l3-1.2L20 5.8l-4.5-2.3a3.6 3.6 0 0 1-7 0z"/>',
  box:'<path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9"/>',
  spark:'<path d="M12 3.5l1.9 5.6 5.6 1.9-5.6 1.9L12 18.5l-1.9-5.6L4.5 11l5.6-1.9z"/>',
  tune:'<path d="M4 7h9M18 7h2M4 17h3M11 17h9"/><circle cx="15.5" cy="7" r="2.3"/><circle cx="9" cy="17" r="2.3"/>',
  card:'<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><circle cx="8.5" cy="11" r="2"/><path d="M5.5 16.2a3 3 0 0 1 6 0M14 10h4.5M14 13.5h3"/>',
  bell:'<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  trash:'<path d="M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5l1 13.5h9l1-13.5M10 10.5v6M14 10.5v6"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>', power:'<path d="M12 3v8"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/>',
  chart:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', backspace:'<path d="M21 5H9l-6 7 6 7h12z"/><path d="M12.5 9.5l5 5M17.5 9.5l-5 5"/>',
  face:'<circle cx="12" cy="12" r="9"/><path d="M9 10h.01M15 10h.01M8.5 14.5a4.5 4.5 0 0 0 7 0"/>',
  finger:'<path d="M6.5 7.5A7.5 7.5 0 0 1 19 10.5c0 2.2-.3 4.4-.9 6.5"/><path d="M5 11.5c0-1 .2-2 .6-2.9M8.5 20c.9-2 1.5-4.7 1.5-7.5a2 2 0 0 1 4 0c0 3-.5 5.9-1.4 8.5"/><path d="M5.3 15.5c.4-1.2.7-2.6.7-4a6 6 0 0 1 1.1-3.5M15.8 19.5c.5-1.8.8-3.6.9-5.5"/>',
  doc:'<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>', globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
  out:'<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/>', trophy:'<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20.5h7M10 17h4v3.5h-4z"/>'
};
/* Categories: set by admin per country. Both apps read the same list. buy = where the Agent buys items switch starts. */
const CATS = [
  { k:'groceries', name:'Groceries & market', short:'Groceries', ic:'cart', art:'groceries', buy:true, eg:'A Shoprite run, a market list' },
  { k:'food', name:'Food & drinks', short:'Food', ic:'food', buy:true, eg:'Lunch from a buka, a restaurant order' },
  { k:'pharmacy', name:'Pharmacy', short:'Pharmacy', ic:'pill', art:'pharmacy', buy:true, eg:'Over-the-counter medicine, baby supplies' },
  { k:'shopping', name:'Shopping & returns', short:'Shopping', ic:'bag', buy:true, eg:'Buy from a store, return an item' },
  { k:'laundry', name:'Laundry', short:'Laundry', ic:'shirt', buy:true, eg:'Dry cleaner drop-off and pickup' },
  { k:'parcel', name:'Parcels & documents', short:'Parcels', ic:'box', art:'parcel', buy:false, eg:'Drop off a parcel, collect documents' },
  { k:'queue', name:'Queues & in-person tasks', short:'Queues', ic:'users', art:'queue', buy:false, eg:'Hold a place in a queue, submit forms' },
  { k:'other', name:'Anything else', short:'Other', ic:'spark', buy:false, eg:'Any legal errand that fits none of these' }
];
const CAT = k => CATS.find(c => c.k === k) || null;
const icon = (n, s = 22, sw = 1.85) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ''}</svg>`;
/* Jiffo brand: the j mark (badges, toasts, chat), the wordmark (letters take the text colour, the speed ball takes the brand green) and the app icons */
const GLYPH = `<svg viewBox="240.16 120 623.08 790" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M350.16 427H465.16A25 25 0 0 1 465.16 477H350.16A25 25 0 0 1 350.16 427ZM280.16 515H437.16A25 25 0 0 1 437.16 565H280.16A25 25 0 0 1 280.16 515ZM370.16 603H409.16A25 25 0 0 1 409.16 653H370.16A25 25 0 0 1 370.16 603Z"/><path fill="currentColor" transform="translate(468.16 162) skewX(-12) scale(0.75) translate(56.67 743)" d="M23 187L23 187Q-8 188-26.50 176Q-45 164-52 146Q-59 128-55.50 109.50Q-52 91-39 77.50Q-26 64-6 62L-6 62Q27 60 42 44.50Q57 29 57-3L57-3L57-412Q57-455 80-478Q103-501 146-501L146-501Q189-501 212-478Q235-455 235-412L235-412L235-20Q235 47 212 92.50Q189 138 142.50 161.50Q96 185 23 187ZM145-572L145-572Q97-572 71.50-594Q46-616 46-658L46-658Q46-699 71.50-721Q97-743 145-743L145-743Q193-743 218.50-721Q244-699 244-658L244-658Q244-616 218.50-594Q193-572 145-572Z"/></svg>`;
const WORDMARK = `<svg viewBox="-13.33 -154.18 408.73 193.6" role="img" aria-label="Jiffo"><path fill="currentColor" d="M4.60 37.40L4.60 37.40Q-1.60 37.60-5.30 35.20Q-9 32.80-10.40 29.20Q-11.80 25.60-11.10 21.90Q-10.40 18.20-7.80 15.50Q-5.20 12.80-1.20 12.40L-1.20 12.40Q5.40 12 8.40 8.90Q11.40 5.80 11.40-0.60L11.40-0.60L11.40-82.40Q11.40-91 16-95.60Q20.60-100.20 29.20-100.20L29.20-100.20Q37.80-100.20 42.40-95.60Q47-91 47-82.40L47-82.40L47-4Q47 9.40 42.40 18.50Q37.80 27.60 28.50 32.30Q19.20 37 4.60 37.40ZM86.40 1.80L86.40 1.80Q78 1.80 73.40-3.20Q68.80-8.20 68.80-17.60L68.80-17.60L68.80-80.80Q68.80-90.20 73.40-95.20Q78-100.20 86.40-100.20L86.40-100.20Q95-100.20 99.70-95.20Q104.40-90.20 104.40-80.80L104.40-80.80L104.40-17.60Q104.40-8.20 99.80-3.20Q95.20 1.80 86.40 1.80ZM152.20 1.80L152.20 1.80Q143.60 1.80 139-2.80Q134.40-7.40 134.40-16.20L134.40-16.20L134.40-72.20L129.20-72.20Q122.80-72.20 119.30-75.60Q115.80-79 115.80-85.40L115.80-85.40Q115.80-91.80 119.30-95.10Q122.80-98.40 129.20-98.40L129.20-98.40L144.60-98.40L134.40-89L134.40-94.60Q134.40-116.80 145.50-127.90Q156.60-139 178.60-141.20L178.60-141.20L184.40-141.80Q190.80-142.60 194.60-140.30Q198.40-138 199.80-134.30Q201.20-130.60 200.50-126.60Q199.80-122.60 197.40-119.80Q195-117 191-116.60L191-116.60L188.20-116.40Q178-115.60 174-112Q170-108.40 170-101.40L170-101.40L170-94.80L165.60-98.40L181.40-98.40Q188-98.40 191.40-95.10Q194.80-91.80 194.80-85.40L194.80-85.40Q194.80-79 191.40-75.60Q188-72.20 181.40-72.20L181.40-72.20L170-72.20L170-16.20Q170 1.80 152.20 1.80ZM236.40 1.80L236.40 1.80Q227.80 1.80 223.20-2.80Q218.60-7.40 218.60-16.20L218.60-16.20L218.60-72.20L213.40-72.20Q207-72.20 203.50-75.60Q200-79 200-85.40L200-85.40Q200-91.80 203.50-95.10Q207-98.40 213.40-98.40L213.40-98.40L228.80-98.40L218.60-89L218.60-94.60Q218.60-116.80 229.70-127.90Q240.80-139 262.80-141.20L262.80-141.20L268.60-141.80Q275-142.60 278.80-140.30Q282.60-138 284-134.30Q285.40-130.60 284.70-126.60Q284-122.60 281.60-119.80Q279.20-117 275.20-116.60L275.20-116.60L272.40-116.40Q262.20-115.60 258.20-112Q254.20-108.40 254.20-101.40L254.20-101.40L254.20-94.80L249.80-98.40L265.60-98.40Q272.20-98.40 275.60-95.10Q279-91.80 279-85.40L279-85.40Q279-79 275.60-75.60Q272.20-72.20 265.60-72.20L265.60-72.20L254.20-72.20L254.20-16.20Q254.20 1.80 236.40 1.80ZM339.20 2.20L339.20 2.20Q322.80 2.20 310.60-4Q298.40-10.20 291.60-21.80Q284.80-33.40 284.80-49.20L284.80-49.20Q284.80-61.20 288.60-70.70Q292.40-80.20 299.60-86.90Q306.80-93.60 316.80-97.10Q326.80-100.60 339.20-100.60L339.20-100.60Q355.60-100.60 367.80-94.40Q380-88.20 386.70-76.70Q393.40-65.20 393.40-49.20L393.40-49.20Q393.40-37.40 389.60-27.80Q385.80-18.20 378.70-11.50Q371.60-4.80 361.50-1.30Q351.40 2.20 339.20 2.20ZM339.20-24L339.20-24Q344.60-24 348.80-26.70Q353-29.40 355.30-34.90Q357.60-40.40 357.60-49.20L357.60-49.20Q357.60-62.60 352.40-68.50Q347.20-74.40 339.20-74.40L339.20-74.40Q333.80-74.40 329.60-71.80Q325.40-69.20 323-63.70Q320.60-58.20 320.60-49.20L320.60-49.20Q320.60-36 325.80-30Q331-24 339.20-24Z"/><path class="acc" d="M66.8 -132.49A19.7 19.7 0 1 0 106.2 -132.49A19.7 19.7 0 1 0 66.8 -132.49ZM17.35 -142.93H54.39A4.14 4.14 0 0 1 54.39 -134.65H17.35A4.14 4.14 0 0 1 17.35 -142.93ZM32.13 -126.38H54.39A4.14 4.14 0 0 1 54.39 -118.1H32.13A4.14 4.14 0 0 1 32.13 -126.38Z"/></svg>`;
const APPICON = (bg, fg) => `<svg viewBox="0 0 1024 1024" aria-hidden="true"><rect width="1024" height="1024" rx="230" fill="${bg}"/><path fill="${fg}" d="M350.16 427H465.16A25 25 0 0 1 465.16 477H350.16A25 25 0 0 1 350.16 427ZM280.16 515H437.16A25 25 0 0 1 437.16 565H280.16A25 25 0 0 1 280.16 515ZM370.16 603H409.16A25 25 0 0 1 409.16 653H370.16A25 25 0 0 1 370.16 603Z"/><path fill="${fg}" transform="translate(468.16 162) skewX(-12) scale(0.75) translate(56.67 743)" d="M23 187L23 187Q-8 188-26.50 176Q-45 164-52 146Q-59 128-55.50 109.50Q-52 91-39 77.50Q-26 64-6 62L-6 62Q27 60 42 44.50Q57 29 57-3L57-3L57-412Q57-455 80-478Q103-501 146-501L146-501Q189-501 212-478Q235-455 235-412L235-412L235-20Q235 47 212 92.50Q189 138 142.50 161.50Q96 185 23 187ZM145-572L145-572Q97-572 71.50-594Q46-616 46-658L46-658Q46-699 71.50-721Q97-743 145-743L145-743Q193-743 218.50-721Q244-699 244-658L244-658Q244-616 218.50-594Q193-572 145-572Z"/></svg>`;

/* People: flat illustrated portraits */
const PEOPLE = {
  tolu:{ skin:'#8B5A3C', hair:'#1B1410', shirt:'#E0A93B', bg:'#F6E7C8', style:'bun' },
  chinedu:{ skin:'#5A3824', hair:'#141010', shirt:'#0E7A4D', bg:'#CDEBDB', style:'short' },
  aisha:{ skin:'#87573A', hair:'#5B2C83', shirt:'#2F5D8C', bg:'#E7DAF2', style:'wrap' },
  ibrahim:{ skin:'#6A4329', hair:'#121010', shirt:'#3B4A5A', bg:'#DCE3EA', style:'cap' },
  kemi:{ skin:'#7A4A2E', hair:'#1C1412', shirt:'#C2410C', bg:'#FBE1CF', style:'braids' },
  femi:{ skin:'#4E3020', hair:'#0F0D0C', shirt:'#6B7280', bg:'#E5E7EB', style:'short' }
};
function face(key) {
  const p = PEOPLE[key] || PEOPLE.femi;
  const hair = {
    short:`<path d="M20.5 27c-.5-9.5 4.6-15 11.5-15s12 5.5 11.5 15c-1.6-4.6-5.8-7.4-11.5-7.4S22.1 22.4 20.5 27z" fill="${p.hair}"/>`,
    cap:`<path d="M19.5 25c0-9 5.5-14 12.5-14s12.5 5 12.5 14z" fill="${p.hair}"/><path d="M19 25h26" stroke="${p.hair}" stroke-width="2.5" stroke-linecap="round"/>`,
    bun:`<circle cx="32" cy="10.5" r="6" fill="${p.hair}"/><path d="M20.5 28c-.8-10 4.8-15.5 11.5-15.5S44.3 18 43.5 28c-2-5.2-6.3-8.5-11.5-8.5S22.5 22.8 20.5 28z" fill="${p.hair}"/>`,
    braids:`<path d="M20 30c-1-11 5-17 12-17s13 6 12 17c-1.5-6-6-9.5-12-9.5S21.5 24 20 30z" fill="${p.hair}"/><path d="M20.5 28v14M43.5 28v14" stroke="${p.hair}" stroke-width="4" stroke-linecap="round"/>`,
    wrap:`<path d="M18 24.5C18 14 24.5 8.5 32 8.5S46 14 46 24.5c-3.5-3.2-8.2-5-14-5s-10.5 1.8-14 5z" fill="${p.hair}"/><circle cx="41" cy="10.5" r="4.5" fill="${p.hair}"/>`
  }[p.style];
  return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true"><rect width="64" height="64" fill="${p.bg}"/>
    <path d="M7 64c2.5-12.5 12-19 25-19s22.5 6.5 25 19z" fill="${p.shirt}"/>
    <path d="M27 36h10v9.5c-1.6 1.6-3.2 2.4-5 2.4s-3.4-.8-5-2.4z" fill="${p.skin}" opacity=".88"/>
    <ellipse cx="20.6" cy="29" rx="2.2" ry="3" fill="${p.skin}"/><ellipse cx="43.4" cy="29" rx="2.2" ry="3" fill="${p.skin}"/>
    <ellipse cx="32" cy="28" rx="11.5" ry="13.2" fill="${p.skin}"/>
    ${hair}
    <ellipse cx="27.6" cy="29.3" rx="1.25" ry="1.45" fill="#140E0B"/><ellipse cx="36.4" cy="29.3" rx="1.25" ry="1.45" fill="#140E0B"/>
    <path d="M28.8 34.6q3.2 2.3 6.4 0" stroke="#140E0B" stroke-width="1.4" fill="none" stroke-linecap="round" opacity=".75"/>
  </svg>`;
}

/* Spot illustrations for errand ideas */
const ART = {
  groceries:`<svg viewBox="0 0 64 64" aria-hidden="true"><ellipse cx="32" cy="58" rx="20" ry="3" style="fill:var(--ill-d)"/><rect x="33" y="5" width="7" height="24" rx="3.5" transform="rotate(18 36 17)" style="fill:var(--ill-c)"/><path d="M19 26c-1-8 5-13 11-13-.5 6-4 11-11 13z" style="fill:var(--ill-a)"/><path d="M24 25c2-6 7-9 12-8-2 5-6 8-12 8z" style="fill:var(--ill-b)"/><path d="M13 24h38l-3.5 32h-31z" style="fill:var(--ill-e)"/><path d="M13 24h38l-.6 5.5H13.6z" style="fill:#000;opacity:.12"/><rect x="21" y="36" width="22" height="7" rx="3.5" style="fill:var(--ill-f);opacity:.85"/></svg>`,
  parcel:`<svg viewBox="0 0 64 64" aria-hidden="true"><ellipse cx="32" cy="58" rx="21" ry="3" style="fill:var(--ill-d)"/><path d="M32 8l21 10.5L32 29 11 18.5z" style="fill:var(--ill-c)"/><path d="M11 18.5L32 29v26L11 44.5z" style="fill:var(--ill-e)"/><path d="M53 18.5L32 29v26l21-10.5z" style="fill:var(--ill-e);opacity:.72"/><path d="M21.5 13.2l21 10.5v8.5l-5-2.5v-8.5l-21-10.5z" style="fill:var(--ill-f);opacity:.9"/></svg>`,
  pharmacy:`<svg viewBox="0 0 64 64" aria-hidden="true"><ellipse cx="32" cy="58" rx="20" ry="3" style="fill:var(--ill-d)"/><rect x="15" y="9" width="22" height="8" rx="3" style="fill:var(--ill-a)"/><rect x="13" y="16" width="26" height="40" rx="7" style="fill:var(--ill-f);stroke:var(--ill-d);stroke-width:2"/><rect x="17" y="27" width="18" height="16" rx="3" style="fill:var(--ill-b)"/><path d="M26 31v8M22 35h8" style="stroke:var(--ill-a);stroke-width:2.6;stroke-linecap:round"/><g transform="rotate(-35 48 42)"><rect x="40" y="36" width="16" height="12" rx="6" style="fill:var(--ill-e)"/><rect x="48" y="36" width="8" height="12" rx="0" style="fill:var(--ill-c)"/><rect x="40" y="36" width="16" height="12" rx="6" style="fill:none;stroke:var(--ill-f);stroke-width:1.5"/></g></svg>`,
  queue:`<svg viewBox="0 0 64 64" aria-hidden="true"><ellipse cx="32" cy="58" rx="26" ry="3" style="fill:var(--ill-d)"/><circle cx="14" cy="22" r="6" style="fill:var(--ill-c)"/><path d="M5 56c0-13 4-22 9-22s9 9 9 22z" style="fill:var(--ill-c)"/><circle cx="32" cy="18" r="6.5" style="fill:var(--ill-a)"/><path d="M22 56c0-15 4.5-24 10-24s10 9 10 24z" style="fill:var(--ill-a)"/><circle cx="50" cy="22" r="6" style="fill:var(--ill-e)"/><path d="M41 56c0-13 4-22 9-22s9 9 9 22z" style="fill:var(--ill-e)"/></svg>`
};
/* Photo stand-ins used in cards */
const PHOTO = {
  receipt:`<svg viewBox="0 0 120 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="120" height="150" style="fill:var(--surface-3)"/><g transform="rotate(-4 60 75)"><path d="M28 14h64v118l-6-4-6 4-6-4-6 4-6-4-6 4-6-4-6 4-6-4-6 4z" fill="#FDFDFB"/><rect x="44" y="22" width="32" height="6" rx="3" fill="#C9CCC8"/><g fill="#DADDD9"><rect x="36" y="38" width="34" height="4" rx="2"/><rect x="74" y="38" width="10" height="4" rx="2"/><rect x="36" y="48" width="28" height="4" rx="2"/><rect x="74" y="48" width="10" height="4" rx="2"/><rect x="36" y="58" width="38" height="4" rx="2"/><rect x="74" y="58" width="10" height="4" rx="2"/></g><rect x="36" y="74" width="48" height="1.5" fill="#C9CCC8"/><rect x="36" y="82" width="20" height="6" rx="3" fill="#9EA39F"/><rect x="66" y="82" width="18" height="6" rx="3" fill="#6E736F"/><g fill="#C9CCC8"><rect x="40" y="100" width="2" height="14"/><rect x="44" y="100" width="1" height="14"/><rect x="47" y="100" width="3" height="14"/><rect x="52" y="100" width="1" height="14"/><rect x="55" y="100" width="2" height="14"/><rect x="59" y="100" width="1" height="14"/><rect x="62" y="100" width="3" height="14"/><rect x="67" y="100" width="1" height="14"/><rect x="70" y="100" width="2" height="14"/><rect x="74" y="100" width="1" height="14"/><rect x="77" y="100" width="3" height="14"/></g></g></svg>`,
  items:`<svg viewBox="0 0 120 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="120" height="150" style="fill:var(--brand-soft)"/><rect y="104" width="120" height="46" style="fill:var(--ill-d)"/><rect x="14" y="58" width="56" height="50" rx="4" fill="#E9A23B"/><rect x="14" y="58" width="56" height="12" rx="4" fill="#D98E25"/><text x="42" y="92" text-anchor="middle" font-family="Inter,sans-serif" font-weight="800" font-size="11" fill="#7A2E0E">NOODLES</text><path d="M84 40h16l3 10v52a6 6 0 0 1-6 6H87a6 6 0 0 1-6-6V50z" fill="#F4C430" opacity=".95"/><rect x="86" y="30" width="12" height="11" rx="2" fill="#1E7A3C"/><rect x="83" y="64" width="18" height="20" rx="3" fill="#1E7A3C"/><text x="92" y="77" text-anchor="middle" font-family="Inter,sans-serif" font-weight="800" font-size="7" fill="#FFF">5L</text></svg>`,
  gate:`<svg viewBox="0 0 160 120" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="160" height="120" fill="#BFD3E0"/><rect y="78" width="160" height="42" fill="#9A9A92"/><rect x="18" y="20" width="124" height="62" fill="#E7E1D3"/><g fill="#3E4A42"><rect x="34" y="30" width="92" height="52"/></g><g stroke="#56645A" stroke-width="3"><path d="M44 30v52M56 30v52M68 30v52M80 30v52M92 30v52M104 30v52M116 30v52"/></g><rect x="30" y="26" width="100" height="6" fill="#2C352F"/><path d="M60 98h30l-3 18H63z" fill="#E9A23B"/><path d="M66 98v-5a9 9 0 0 1 18 0v5" stroke="#B7791F" stroke-width="3" fill="none"/></svg>`,
  idcard:`<svg viewBox="0 0 160 110" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="160" height="110" fill="#8C8C8C"/><g transform="rotate(-3 80 55)"><rect x="14" y="14" width="132" height="84" rx="8" fill="#F4F7F2"/><rect x="14" y="14" width="132" height="18" rx="8" fill="#0A7A4A"/><rect x="14" y="24" width="132" height="8" fill="#0A7A4A"/><rect x="24" y="40" width="34" height="42" rx="4" fill="#C9D3CC"/><circle cx="41" cy="54" r="8" fill="#8E9A91"/><path d="M29 80a12 10 0 0 1 24 0z" fill="#8E9A91"/><rect x="66" y="42" width="60" height="6" rx="3" fill="#2B2B2B"/><rect x="66" y="54" width="44" height="5" rx="2.5" fill="#9AA39C"/><rect x="66" y="64" width="52" height="5" rx="2.5" fill="#9AA39C"/><rect x="66" y="74" width="36" height="5" rx="2.5" fill="#9AA39C"/><rect x="24" y="88" width="98" height="4" rx="2" fill="#C9D3CC"/></g></svg>`,
  bill:`<svg viewBox="0 0 120 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="120" height="150" fill="#9A9A9A"/><g transform="rotate(2 60 75)"><rect x="16" y="10" width="88" height="130" rx="3" fill="#FAFAF7"/><rect x="24" y="18" width="30" height="8" rx="2" fill="#E0602B"/><rect x="24" y="34" width="56" height="4" rx="2" fill="#2B2B2B"/><rect x="24" y="42" width="44" height="3" rx="1.5" fill="#A3A3A3"/><rect x="24" y="48" width="50" height="3" rx="1.5" fill="#A3A3A3"/><rect x="24" y="62" width="72" height="22" rx="2" fill="#EFEFEA"/><rect x="28" y="67" width="30" height="3" rx="1.5" fill="#7A7A7A"/><rect x="72" y="67" width="20" height="3" rx="1.5" fill="#7A7A7A"/><rect x="28" y="75" width="36" height="3" rx="1.5" fill="#7A7A7A"/><rect x="72" y="75" width="20" height="3" rx="1.5" fill="#7A7A7A"/><rect x="24" y="94" width="40" height="4" rx="2" fill="#2B2B2B"/><rect x="70" y="94" width="26" height="4" rx="2" fill="#2B2B2B"/><rect x="24" y="112" width="72" height="3" rx="1.5" fill="#C4C4C4"/><rect x="24" y="119" width="60" height="3" rx="1.5" fill="#C4C4C4"/></g></svg>`
};
