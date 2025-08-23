// api/create-checkout-session.js — robusto: accetta JSON/FORM, GET/POST, fallback 1€
import Stripe from 'stripe';

export default async function handler(req, res) {
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    // 1) Permettiamo sia POST che GET (alcuni bottoni possono fare GET per errore)
    if (req.method !== 'POST' && req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // 2) Normalizza il body: JSON, form-encoded o query (GET)
    let items = [];
    const ct = (req.headers['content-type'] || '').toLowerCase();

    // a) JSON standard
    if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
      if (Array.isArray(req.body.items)) items = req.body.items;
      else if (Array.isArray(req.body.cartItems)) items = req.body.cartItems;
    }

    // b) application/x-www-form-urlencoded (es. form HTML)
    //    Vercel la converte in object tipo { "items[0][name]": "...", ... }
    if (items.length === 0 && ct.includes('application/x-www-form-urlencoded')) {
      const b = req.body || {};
      // supporto semplice: items come JSON in un campo "items"
      if (b.items && typeof b.items === 'string') {
        try { items = JSON.parse(b.items); } catch {}
      }
    }

    // c) GET con query ?items=[...]
    if (items.length === 0 && req.method === 'GET') {
      const q = req.query || {};
      if (q.items && typeof q.items === 'string') {
        try { items = JSON.parse(q.items); } catch {}
      }
    }

    // 3) Mappatura campi flessibile
    const mapped = (items || []).map(it => ({
      name: it.name ?? it.title ?? 'Prodotto',
      amount: Number(it.amount ?? it.price ?? 0),
      quantity: Number(it.quantity ?? it.qty ?? 1),
    })).filter(x => x.quantity > 0);

    // 4) Se vuoto → fallback da 1€
    const safeItems = mapped.length > 0
      ? mapped
      : [{ name: 'Prodotto di test', amount: 1, quantity: 1 }];

    // 5) Costruisci line_items (EURO -> CENT)
    const line_items = safeItems.map(it => ({
      price_data: {
        currency: 'eur',
        product_data: { name: String(it.name) },
        unit_amount: Math.round(it.amount * 100),
      },
      quantity: it.quantity,
    }));

    // 6) Crea sessione (indirizzo + telefono + shipping option 10€)
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items,

      billing_address_collection: 'required',
      phone_number_collection: { enabled: true },
      shipping_address_collection: { allowed_countries: ['IT'] },

      shipping_options: [
        {
          shipping_rate_data: {
            display_name: 'Poste – Standard',
            type: 'fixed_amount',
            fixed_amount: { amount: 1000, currency: 'eur' },
            delivery_estimate: {
              minimum: { unit: 'business_day', value: 2 },
              maximum: { unit: 'business_day', value: 5 },
            },
          },
        },
      ],

      success_url: 'https://test-pagamenti.vercel.app/success.html?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://test-pagamenti.vercel.app/cancel.html',
      metadata: { robust: 'true' },
    });

    return res.status(200).json({ id: session.id, url: session.url });
  } catch (err) {
    console.error('Stripe create session error:', err);
    return res.status(500).json({ error: err.message || 'Stripe error' });
  }
}
