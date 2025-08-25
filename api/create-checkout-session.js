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

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Items mancanti', code: 'MISSING_ITEMS' });
    }

    // --- utils ---
    const onlyDigits = (s = '') => String(s).replace(/[^\\d]/g, '');
    const normalizePhone = (raw, country = 'IT') => {
      if (!raw) return undefined;
      let s = String(raw).trim();
      if (s.startsWith('00')) s = '+' + s.slice(2);
      s = s.replace(/(?!^\\+)[^\\d]/g, '');
      if (s.startsWith('+')) {
        const t = '+' + onlyDigits(s.slice(1));
        return t.length >= 7 ? t : undefined; // Minimo 7 cifre dopo il '+' per essere un telefono internazionale valido
      }
      // Per numeri italiani senza prefisso, aggiungiamo +39
      const t = '+39' + onlyDigits(s);
      return t.length >= 7 ? t : undefined;
    };

    // --- Determina l'origine in modo più robusto ---
    // Preferiamo VERCEL_URL se disponibile (ambiente Vercel), altrimenti si basa sugli headers della richiesta
    const defaultOrigin = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}` 
      : (req.headers.origin || (req.headers.host ? `https://${req.headers.host}` : 'http://localhost:3000'));

    // Estrai e normalizza i dati del cliente
    const {
      name,
      email: emailHint,
      phone: rawPhone,
      address: addr = {},
      city,
      cap: rawCap,
      province,
      note,
    } = customerInput;

    const formattedPhone = normalizePhone(rawPhone);
    const formattedCap = onlyDigits(rawCap);

    const line_items = items.map(item => ({
      price_data: {
        currency: 'eur',
        product_data: {
          name: item.name,
        },
        unit_amount: Math.round(item.amount * 100), // Prezzo in centesimi di Euro
      },
      quantity: item.quantity,
    }));

    // Aggiungi il costo di spedizione come un line_item separato se > 0
    if (shippingCostOverride > 0) {
      line_items.push({
        price_data: {
          currency: 'eur',
          product_data: {
            name: 'Costo di Spedizione',
            description: 'Spese di spedizione per il tuo ordine.',
          },
          unit_amount: Math.round(shippingCostOverride * 100), // Spedizione in centesimi di Euro
        },
        quantity: 1,
      });
    }

    // Crea un nuovo cliente Stripe o usa uno esistente, basandoci sull'email
    // Per semplicità, creiamo sempre un nuovo cliente, Stripe si occupa delle deduplicazioni basate sull'email
    const createdCustomer = await stripe.customers.create({
      email: emailHint,
      name: name,
      phone: formattedPhone,
      address: {
        line1: addr.line1,
        postal_code: formattedCap,
        city: city,
        state: province, // Stato/provincia come sigla (es. 'RM', 'MI')
        country: 'IT',
      },
      metadata: { initial_origin: defaultOrigin, source: 'oasi-busatello-v4' },
    });
    const customerId = createdCustomer.id;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items,
      billing_address_collection: 'required', // Richiede l'indirizzo di fatturazione
      phone_number_collection: { enabled: true }, // Raccoglie il numero di telefono
      shipping_address_collection: { allowed_countries: ['IT', 'SM', 'VA'] }, // Permette solo Italia, San Marino, Vaticano per la spedizione
      shipping_options: [], // Rimosse opzioni di spedizione definite qui, gestite dal frontend tramite shippingCostOverride
      success_url: success_url || `${defaultOrigin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  cancel_url  || `${defaultOrigin}/?checkout=cancel`,
      allow_promotion_codes: true, // Permette codici promozionali Stripe
      metadata: {
        source: 'oasi-busatello-v4',
        name_initial: name || '',
        email_initial: emailHint || '',
        phone_initial: formattedPhone || '',
        address_line1_initial: addr.line1 || '',
        city_initial: city || '',
        cap_initial: formattedCap || '',
        province_initial: province || '',
        note: note || '',
        ...metadata,
      },
      customer: customerId,
      customer_update: { address: 'auto', name: 'auto', shipping: 'auto' }
    });

    res.status(200).json({ id: session.id });
  } catch (err) {
    console.error('Error creating checkout session:', err);
    res.status(500).json({ error: err.message || 'Error creating checkout session' });
  }
}
