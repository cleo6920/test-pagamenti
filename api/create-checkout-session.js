// /api/create-checkout-session.js
// - Provincia dedotta SOLO dal CAP (fonte di verità). Niente city-map.
// - Blocchi: 422 INVALID_CAP (CAP IT non 5 cifre) | 422 PROVINCE_CONFLICT (se passi una provincia diversa da quella del CAP).
// - Normalizzazione telefono in E.164 (+39...) per migliorare il prefill di Stripe.
// - Link/Amazon opzionali (no email prefill). Carta in primo piano.
// - Niente prodotto di test: se mancano items -> 400 MISSING_ITEMS.

import Stripe from 'stripe';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const {
      items,
      customer: customerInput = {}, // { name, email, phone, address:{line1,postal_code|cap,city,state|province|prov|provincia,country}, note }
      shippingCostOverride = 0,
      success_url,
      cancel_url,
      metadata = {},
    } = req.body || {};

    // ---------- Items obbligatori ----------
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Items mancanti', code: 'MISSING_ITEMS' });
    }

    // ---------- Utils ----------
    const onlyDigits = (s = '') => String(s).replace(/[^\d]/g, '');

    // Normalizza telefono in E.164 (assume IT se non passa country o è IT)
    const normalizePhone = (raw, country = 'IT') => {
      if (!raw) return undefined;
      let s = String(raw).trim();
      // 00.. -> +..
      if (s.startsWith('00')) s = '+' + s.slice(2);
      // togli spazi e punteggiatura, lascia "+"
      s = s.replace(/(?!^\+)[^\d]/g, '');
      const isPlus = s.startsWith('+');

      if (isPlus) {
        const digits = '+' + onlyDigits(s.slice(1));
        // controllo lunghezza plausibile E.164 (max 15 cifre dopo +, min ~6)
        if (digits.length < 7 || digits.length > 16) return undefined;
        return digits;
      }

      const ctry = (country || 'IT').toUpperCase();
      const d = onlyDigits(s);
      if (!d) return undefined;

      // Italia: in E.164 i numeri geografici mantengono lo 0 (es. 02..., 06...).
      // Quindi +39 + d così com’è (sia mobili che fissi).
      if (ctry === 'IT') {
        return '+39' + d;
      }

      // Fallback generico: aggiungi comunque +39 se non noto (puoi adattarlo per paesi esteri)
      return '+39' + d;
    };

    const normalizeProvince = (val) => {
      if (!val) return undefined;
      const raw = String(val).trim();
      if (!raw) return undefined;
      if (raw.length === 2) return raw.toUpperCase();
      const map = {
        'mantova':'MN','verona':'VR','modena':'MO','ferrara':'FE','rovigo':'RO',
        'milano':'MI','monza e della brianza':'MB','monza':'MB','brescia':'BS',
        'parma':'PR','reggio emilia':'RE','bergamo':'BG','bologna':'BO',
        'padova':'PD','vicenza':'VI','trento':'TN','bolzano':'BZ',
        'cremona':'CR','pavia':'PV','lodi':'LO','lecco':'LC','como':'CO','sondrio':'SO','varese':'VA',
        'torino':'TO','alpignano':'TO','rivoli':'TO','collegno':'TO','pianezza':'TO',
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

    // Provincia dal CAP (5→4→3 cifre)
    const provinceFromCap = (postal_code) => {
      if (!postal_code) return undefined;
      const pc = String(postal_code).trim();
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
        '700':'BA','701':'BA','710':'FG','720':'BR','730':'LE','740':'TA','750':'MT','760':'BT','850':'PZ','851':'PZ',
        // Calabria
        '870':'CS','871':'CS','880':'CZ','889':'KR','890':'RC','899':'VV',
        // Sicilia
        '900':'PA','901':'PA','910':'TP','920':'AG','930':'CL','940':'EN','950':'CT','960':'SR','970':'RG','980':'ME',
        // Sardegna
        '070':'SS','071':'SS','080':'NU','090':'CA','091':'CA','092':'SU','09070':'OR'
      };
      for (const n of [5, 4, 3]) {
        const p = pc.slice(0, n);
        if (prefixMap[p]) return prefixMap[p];
      }
      return undefined;
    };

    // ---------- Line items ----------
    const line_items = items.map((it) => {
      if (typeof it.price === 'string' && it.price.startsWith('price_')) {
        return { price: it.price, quantity: Math.max(1, Number(it.quantity ?? it.qty ?? 1)) };
      }
      const unitEuros = Number(it.amount ?? it.price ?? it.unit_amount);
      if (!isFinite(unitEuros) || unitEuros <= 0) {
        throw new Error(`Importo non valido per l'articolo "${it.name ?? ''}"`);
      }
      return {
        price_data: {
          currency: 'eur',
          product_data: { name: String(it.name || 'Articolo') },
          unit_amount: Math.round(unitEuros * 100),
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

    // ---------- Customer & indirizzo ----------
    const name  = (customerInput.name  || '').trim() || undefined;
    const rawPhone = (customerInput.phone || '').trim();
    const note  = (customerInput.note  || '').trim() || undefined;
    const emailHint = (customerInput.email || '').trim().toLowerCase() || undefined; // metadato, NON prefill

    const addr = customerInput.address || {};
    const rawCap   = String(addr.postal_code || addr.cap || '').trim() || undefined;
    const city     = addr.city || undefined;
    const country  = (addr.country || 'IT').toUpperCase();
    const provIn   = addr.state || addr.province || addr.prov || addr.provincia; // se presente

    // Normalizza telefono (migliora prefill su Stripe)
    const phone = normalizePhone(rawPhone, country);

    // Validazioni specifiche Italia
    let province; // quella che useremo
    if (country === 'IT') {
      if (rawCap && !/^\d{5}$/.test(rawCap)) {
        return res.status(422).json({ error: 'CAP non valido: deve avere 5 cifre.', code: 'INVALID_CAP' });
      }
      const fromCap = provinceFromCap(rawCap);
      const explicit = normalizeProvince(provIn);

      // Se mi passi una provincia esplicita e NON coincide con quella dedotta dal CAP → blocco
      if (explicit && fromCap && explicit !== fromCap) {
        return res.status(422).json({
          error: `Provincia incoerente con CAP: CAP ${rawCap} → ${fromCap}, ma hai passato ${explicit}.`,
          code: 'PROVINCE_CONFLICT',
          details: { capProvince: fromCap, providedProvince: explicit },
        });
      }

      province = explicit || fromCap || undefined; // preferisci quella del CAP
    } else {
      province = normalizeProvince(provIn); // per estero non imponiamo regole sul CAP
    }

    const addressForStripe = {
      line1: addr.line1 || undefined,
      line2: addr.line2 || undefined,
      postal_code: rawCap || undefined,
      city: city || undefined,
      state: province || undefined,   // <- precompila "Provincia" con sigla (es. MN)
      country,
    };

    // Customer (senza email → Link non parte da solo)
    const createdCustomer = await stripe.customers.create({
      name,
      phone, // E.164
      address: addressForStripe,
      shipping: (name || addressForStripe.line1)
        ? { name: name || undefined, phone: phone || undefined, address: addressForStripe }
        : undefined,
      metadata: { note: note || '', email_hint: emailHint || '', source: 'oasi-busatello-v4' },
    });
    const customerId = createdCustomer.id;

    const origin = req.headers.origin || (req.headers.host ? `https://${req.headers.host}` : 'http://localhost:3000');

    // ---------- Checkout Session ----------
    const sessionParams = {
      mode: 'payment',
      line_items,

      // Lasciamo a Stripe decidere i metodi (card + wallet). Niente email → Link resta opzionale.
      // payment_method_types: ['card','link','amazon_pay'],

      billing_address_collection: 'required',
      phone_number_collection: { enabled: true },
      shipping_address_collection: { allowed_countries: ['IT', 'SM', 'VA'] },
      shipping_options: shippingOptions,

      success_url: success_url || `${origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  cancel_url  || `${origin}/?checkout=cancel`,

      allow_promotion_codes: true,
      metadata: {
        source: 'oasi-busatello-v4',
        name_initial: name || '',
        email_initial: emailHint || '',
        phone_initial: phone || '',
        address_line1_initial: addr.line1 || '',
        city_initial: city || '',
        cap_initial: rawCap || '',
        province_initial: province || '',
        note: note || '',
        ...metadata,
      },

      customer: customerId,
      customer_update: { address: 'auto', name: 'auto', shipping: 'auto' },
      // niente customer_email
    };

    const session = await stripe.checkout.sessions.create(sessionParams);
    return res.status(200).json({ id: session.id, url: session.url });

  } catch (err) {
    console.error('Stripe create session error:', err);
    return res.status(500).json({ error: err?.raw?.message || err.message || 'Stripe error' });
  }
}
