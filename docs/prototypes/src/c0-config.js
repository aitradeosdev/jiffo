/* ================= Admin settings the prototypes read =================
   In the product these come from the admin panel, per country (country adapter). */
const CONFIG = {
  kyc:'manual',              // 'manual': our screens, admin reviews by hand. 'provider': the enabled ID provider checks. Never both.
  provider:'QoreID',         // the identity provider adapter switched on in admin (provider mode only)
  customerIds:['nin', 'dl', 'voter', 'passport'],   // ID types customers may choose; admin sets the list
  agentIds:['nin', 'bvn'],                           // agents need both, plus address verification
  reviewHours:24,            // manual review target
  custPhotoBeforeAccept:false // agents see the customer's photo on requests before accepting (admin toggle)
};
/* ID types the Nigeria country adapter knows. Another country adds its own. */
const ID_TYPES = {
  nin:{ name:'NIN slip or card', short:'NIN', doc:'NIN slip or card', label:'National Identification Number (NIN)', len:11, groups:[4, 3, 4], sample:'2201 384 5576', ic:'shield',
    hint:"Don't know it? Dial *346# from the phone number linked to your NIN." },
  bvn:{ name:'BVN', short:'BVN', label:'Bank Verification Number (BVN)', len:11, groups:[3, 4, 4], sample:'221 4583 9021', ic:'bank',
    hint:'Dial *565*0# from the phone number linked to your bank account.' },
  dl:{ name:"Driver's licence", short:"driver's licence", doc:"driver's licence", label:"Driver's licence number", min:9, max:14, sample:'LAG12345AA12', ic:'card',
    hint:'As printed on the front of the licence.' },
  voter:{ name:"Voter's card (PVC)", short:"voter's card", doc:"voter's card", label:'Voter identification number (VIN)', min:19, max:19, sample:'90F5B0A1B2C3D4E5F67', ic:'card',
    hint:'The 19 characters on the front of your PVC.' },
  passport:{ name:'International passport', short:'passport', doc:'passport photo page', label:'Passport number', min:8, max:9, sample:'A12345678', ic:'card',
    hint:'On the photo page of your passport.' }
};
