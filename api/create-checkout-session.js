// /api/create-checkout-session.js — Carta in primo piano, Link/Amazon opzionali
// Prefill: nome, telefono, indirizzo; provincia dedotta da state/province o CAP/città; NO email (evita Link auto)
import Stripe from 'stripe';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const {
      items = [],
      customer: customerInput = {}, // { name, email, phone, address:{line1,postal_code,city,state|province|prov|provincia,country}, note }
      shippingCostOverride = 0,
      success_url,
      cancel_url,
      metadata = {},
    } = req.body || {};

    // ---------- Utils: normalizza e deduce provincia ----------
    const normalizeProvince = (val) => {
      if (!val) return undefined;
      const raw = String(val).trim();
      if (!raw) return undefined;
      if (raw.length === 2) return raw.toUpperCase();
      const map = {
        // capoluoghi / comuni frequenti (aggiungi pure altri se ti servono)
        'mantova':'MN','verona':'VR','modena':'MO','ferrara':'FE','rovigo':'RO',
        'milano':'MI','monza e della brianza':'MB','monza':'MB','brescia':'BS',
        'parma':'PR','reggio emilia':'RE','bergamo':'BG','bologna':'BO',
        'padova':'PD','vicenza':'VI','trento':'TN','bolzano':'BZ',
        'cremona':'CR','pavia':'PV','lodi':'LO','lecco':'LC','como':'CO','sondrio':'SO','varese':'VA',
        'alpignano':'TO','torino':'TO','rivoli':'TO','collegno':'TO','pianezza':'TO',
        'novara':'NO','vercelli':'VC','biella':'BI','asti':'AT','alessandria':'AL','cuneo':'CN','aosta':'AO',
        'genova':'GE','savona':'SV','imperia':'IM','la spezia':'SP',
        'venezia':'VE','treviso':'TV','belluno':'BL','udine':'UD','gorizia':'GO','trieste':'TS',
        'ravenna':'RA','forlì-cesena':'FC','rimini':'RN','piacenza':'PC',
        'firenze':'FI','prato':'PO','pistoia':'PT','lucca':'LU','pisa':'PI','livorno':'LI','arezzo':'AR','siena':'SI','grosseto':'GR','massa':'MS',
        'ancona':'AN','pesaro':'PU','urbino':'PU','macerata':'MC','ascoli piceno':'AP','fermo':'FM',
        'terni':'TR','perugia':'PG',
        'roma':'RM','rieti':'RI','viterbo':'VT','latina':'LT','frosinone':'FR',
        'l aquila':'AQ','chieti':'CH','pescara':'PE','teramo':'TE',
        'napoli':'NA','salerno':'SA','caserta':'CE','benevento':'BN','avellino':'AV',
        'bari':'BA','barletta-andria-trani':'BT','andria':'BT','barletta':'BT','trani':'BT',
        'brindisi':'BR','lecce':'LE','taranto':'TA','foggia':'FG',
        'campobasso':'CB','isernia':'IS',
        'catanzaro':'CZ','cosenza':'CS','crotone':'KR','reggio calabria':'RC','vibo valentia':'VV',
        'palermo':'PA','trapani':'TP','agrigento':'AG','caltanissetta':'CL','enna':'EN','catania':'CT','messina':'ME','ragusa':'RG','siracusa':'SR',
        'cagliari':'CA','sassari':'SS','nuoro':'NU','oristano':'OR','sud sardegna':'SU'
      };
      const k = raw.toLowerCase();
      return map[k] || raw.toUpperCase();
    };

    // deduzione da CAP (5→4→3 cifre) o città — copertura ampia Italia
    const inferProvinceFromAddress = ({ postal_code, city }) => {
      const prefixMap = {
        // Piemonte / VdA / Liguria
        '100':'TO','101':'TO','111':'AO','120':'CN','121':'CN','130':'VC','131':'VC','139':'BI','140':'AT','141':'AT','150':'AL','151':'AL',
        '160':'GE','170':'SV','180':'IM','190':'SP',
        // Lombardia
        '200':'MI','201':'MI','208':'MB','210':'VA','211':'VA','220':'CO','230':'SO','238':'LC','239':'LC','240':'BG',
        '250':'BS','251':'BS','260':'CR','268':'LO','269':'LO','270':'PV',
        // Trentino-Alto Adige
        '380':'TN','381':'TN','390':'BZ','391':'BZ',
        // Veneto / Friuli VG
        '300':'VE','301':'VE','310':'TV','311':'TV','320':'BL','330':'UD','331':'UD','341':'TS','340':'GO',
        '350':'PD','360':'VI','361':'VI','370':'VR','371':'VR',
        // Emilia-Romagna
        '400':'BO','401':'BO','410':'MO','411':'MO','420':'RE','430':'PR','440':'FE','470':'FC','479':'RN','480':'RA',
        // Toscana
        '500':'FI','501':'FI','510':'PT','520':'AR','530':'SI','540':'MS','550':'LU','560':'PI','570':'LI','580':'GR','590':'PO',
        // Marche / Umbria
        '600':'AN','601':'AN','610':'PU','611':'PU','620':'MC','630':'AP','638':'FM','639':'FM',
        '050':'TR','051':'TR','060':'PG','061':'PG',
        // Lazio
        '001':'RM','010':'VT','011':'VT','020':'RI','030':'FR','040':'LT',
        // Abruzzo / Molise
        '640':'TE','641':'TE','650':'PE','660':'CH','670':'AQ','860':'CB','861':'IS',
        // Campania
        '800':'NA','801':'NA','810':'CE','820':'BN','830':'AV','840':'SA',
        // Puglia / Basilicata
        '700':'BA','701':'BA','710':'FG','720':'BR','730':'LE','740':'TA','750':'MT','760':'BT','851':'PZ','850':'PZ',
        // Calabria
        '870':'CS','871':'CS','880':'CZ','889':'KR','890':'RC','899':'VV',
        // Sicilia
        '900':'PA','901':'PA','910':'TP','920':'AG','930':'CL','940':'EN','950':'CT','960':'SR','970':'RG','980':'ME',
        // Sardegna
        '070':'SS','071':'SS','080':'NU','090':'CA','091':'CA','092':'SU','09070':'OR'
      };
      if (postal_code) {
        const pc = String(postal_code);
        for (const n of [5,4,3]) {
          const p = pc.slice(0, n);
          if (prefixMap[p]) return prefixMap[p];
        }
      }
      const cityMap = {
        'san giovanni del dosso':'MN','poggio rusco':'MN','sermide':'MN','felonica':'MN','mantova':'MN',
        'mirandola':'MO','modena':'MO','carpi':'MO',
        'verona':'VR','rovigo':'RO','ferrara':'FE','bologna':'BO','parma':'PR','reggio emilia':'RE','ravenna':'RA',
        'padova':'PD','vicenza':'VI','treviso':'TV','venezia':'VE','belluno':'BL',
        'trento':'TN','bolzano':'BZ',
        'milano':'MI','monza':'MB','brescia':'BS','bergamo':'BG','cremona':'CR','pavia':'PV','lodi':'LO','lecco':'LC','como':'CO','sondrio':'SO','varese':'VA',
        'alpignano':'TO','torino':'TO','rivoli':'TO','collegno':'TO','pianezza':'TO',
        'genova':'GE','savona':'SV','imperia':'IM','la spezia':'SP',
        'firenze':'FI','prato':'PO','pistoia':'PT','lucca':'LU','pisa':'PI','livorno':'LI','arezzo':'AR','siena':'SI','grosseto':'GR','massa':'MS',
        'ancona':'AN','pesaro':'PU','urbino':'PU','macerata':'MC','ascoli piceno':'AP','fermo':'FM',
        'terni':'TR','perugia':'PG',
        'roma':'RM','rieti':'RI','viterbo':'VT','latina':'LT','frosinone':'FR',
        'pescara':'PE','teramo':'TE','chieti':'CH','l aquila':'AQ',
        'napoli':'NA','salerno':'SA','caserta':'CE','benevento':'BN','avellino':'AV',
        'bari':'BA','barletta':'BT','andria':'BT','trani':'BT','brindisi':'BR','lecce':'LE','taranto':'TA','foggia':'FG',
        'campobasso':'CB','isernia':'IS',
        'catanzaro':'CZ','cosenza':'CS','crotone':'KR','reggio calabria':'RC','vibo valentia':'VV',
        'palermo':'PA','trapani':'TP','agrigento':'AG','caltanissetta':'CL','enna':'EN','catania':'CT','messina':'ME','ragusa':'RG','siracusa':'SR',
        'cagliari':'CA','sassari':'SS','nuoro':'NU','oristano':'OR','carbonia':'SU','iglesias':'SU'
      };
      if (city) {
        const k = String(city).toLowerCase().trim();
        if (cityMap[k]) return cityMap[k];
      }
      return undefined;
    };

    // ---------- Line items ----------
    const baseItems = items.length ? items : [{
      price_data: { currency: 'eur', product_data: { name: 'Prodotto di test (fallback)' }, unit_amount: 100 },
      quantity: 1,
    }];

    const line_items = baseItems.map((it) => {
      if (typeof it.price === 'string' && it.price.startsWith('price_')) {
        return { price: it.price, quantity: Math.max(1, Number(it.quantity ?? it.qty ?? 1)) };
      }
      const unitEuros = Number(it.amount ?? it.price ?? it.unit_amount ?? 0);
      const unitCents = Math.max(1, Math.round(unitEuros * 100));
      return {
        price_data: {
          currency: 'eur',
          product_data: { name: String(it.name || 'Prodotto') },
          unit_amount: unitCents,
        },
        quantity: Math.max(1, Number(it.quantity ?? it.qty ?? 1)),
      };
    });

    // ---------- Shipping ----------
    const shippingOptions = [{
      shipping_rate_data: {
        display_name: Number(shippingCostOverride) > 0 ? 'Poste – Standard' : 'Spedizione Gratuita',
        type: 'fixed_amount',
        fixed_amount: { amount: Math.max(0, Math.round(Number(shippingCostOverride) * 100)), currency: 'eur' },
        delivery_estimate: { minimum: { unit: 'business_day', value: 2 }, maximum: { unit: 'business_day', value: 5 } },
      },
    }];

    // ---------- Customer (NO email; SI telefono; provincia dedotta) ----------
    const name  = (customerInput.name  || '').trim() || undefined;
    const phone = (customerInput.phone || '').trim() || undefined; // prefill telefono (non attiva Link da solo)
    const note  = (customerInput.note  || '').trim() || undefined;
    const emailHint = (customerInput.email || '').trim().toLowerCase() || undefined; // solo metadato, NON prefill

    const addr = customerInput.address || {};
    const explicitProvince = addr.state || addr.province || addr.prov || addr.provincia;
    const inferredProvince = inferProvinceFromAddress({
      postal_code: addr.postal_code || addr.cap,
      city: addr.city,
    });
    const province = normalizeProvince(explicitProvince) || inferredProvince;

    const addressForStripe = {
      line1: addr.line1 || undefined,
      line2: addr.line2 || undefined,
      postal_code: addr.postal_code || addr.cap || undefined,
      city: addr.city || undefined,
      state: province || undefined, // <- provincia (sigla) se dedotta/trovata
      country: (addr.country || 'IT').toUpperCase(),
    };

    const createdCustomer = await stripe.customers.create({
      // email: (omessa apposta per non attivare Link)
      name,
      phone,
      address: addressForStripe,
      shipping: (name || addressForStripe.line1)
        ? { name: name || undefined, phone: phone || undefined, address: addressForStripe }
        : undefined,
      metadata: {
        note: note || '',
        email_hint: emailHint || '',
        source: 'oasi-busatello-v4',
      },
    });
    const customerId = createdCustomer.id;

    const origin =
      req.headers.origin
      || (req.headers.host ? `https://${req.headers.host}` : 'http://localhost:3000');

    // ---------- Sessione Checkout ----------
    const sessionParams = {
      mode: 'payment',
      line_items,

      // Manteniamo wallet ma mettiamo la carta in evidenza
      payment_method_types: ['card', 'link', 'amazon_pay'],

      billing_address_collection: 'required',
      phone_number_collection: { enabled: true },
      shipping_address_collection: { allowed_countries: ['IT', 'SM', 'VA'] },
      shipping_options: shippingOptions,

      success_url: success_url || `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancel_url || `${origin}/cancel.html`,

      allow_promotion_codes: true,
      metadata: {
        source: 'oasi-busatello-v4',
        name_initial: name || '',
        email_initial: emailHint || '',
        phone_initial: phone || '',
        address_line1_initial: addr.line1 || '',
        city_initial: addr.city || '',
        cap_initial: addr.postal_code || addr.cap || '',
        province_initial: province || '',
        note: note || '',
        ...metadata,
      },

      customer: customerId,
      customer_update: { address: 'auto', name: 'auto', shipping: 'auto' },

      // IMPORTANTISSIMO: niente customer_email (così Link resta opzionale)
    };

    const session = await stripe.checkout.sessions.create(sessionParams);
    return res.status(200).json({ id: session.id, url: session.url });

  } catch (err) {
    console.error('Stripe create session error:', err);
    return res.status(500).json({ error: err?.raw?.message || err.message || 'Stripe error' });
  }
}
