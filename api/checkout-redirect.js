// api/checkout-redirect.js — usa gli items reali (se arrivano), altrimenti fallback 1 €
// Accetta POST (JSON o form) e anche GET con ?items=[...]
import Stripe from 'stripe';

export default async function handler(req, res) {
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    // ---- 1) Estrai gli items con massima tolleranza ----
    let items = [];
    const ct = String(req.headers['content-type'] || '').toLowerCase();

    // a) POST JSON: { items: [...] } o { cartItems: [...] }
    if (req.method === 'POST' && ct.includes('application/json')) {
      const b = req.body || {};
      if (Array.isArray(b.items)) items = b.items;
      else if (Array.isArray(b.cartItems)) items = b.cartItems;
    }

    // b) POST form-encoded: items come JSON in un campo "items"
    if (!items.length && req.method === 'POST' && ct.includes('application/x-www-form-urlencoded')) {
      const b = req.body || {};
      if (typeof b.items === 'string') {
        try { items = JSON.parse(b.items); } catch (_) {}
      }
      if (!items.length && typeof b.cartItems === 'string') {
        try { items = JSON.parse(b.cartItems); } catch (_) {}
      }
    }

    // c) GET con ?items=[...]
    if (!items.length && req.method === 'GET' && typeof req.query?.items === 'string') {
      try { items = JSON.parse(req.query.items); } catch (_) {}
    }

    // ---- 2) Mappa/normalizza; ignora eventuale riga "Spedizione" ----
    const filtered = (items || []).filter(
      it => String(it?.name || it?.title || '').trim().toLowerCase() !== 'spedizione'
    );

    const mapped = filtered.map(it => ({
      name: String(it.name ?? it.title ?? 'Prodotto'),
      amount: Math.max(0, Number(it.amount ?? it.price ?? 0)), // in EURO
      quantity: Math.max(1, Number(it.quantity ?? it.qty ?? 1)),
    })).filter(x => x.quantity > 0);

    const useFallback = mapped.length === 0;

    const line_items = (useFallback ? [{ name: 'Prodotto di test', amount: 1, quantity: 1 }] : mapped)
      .map(it => ({
        price_data: {
          currency: 'eur',
          product_data: { name: it.name },
          unit_amount: Math.round(it.amount * 100), // € → cent
        },
        quantity: it.quantity,
      }));

    // ---- 3) Crea la Checkout Session ----
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items,

      // Dati cliente richiesti su Stripe
      billing_address_collection: 'required',
      phone_number_collection: { enabled: true },
      shipping_address_collection: { allowed_countries: ['IT'] },

      // Corriere come shipping option (10,00 €)
      shipping_options: [
        {
          shipping_rate_data: {
            display_name: 'Poste – Standard',
            type: 'fixed_amount',
            fixed_amount: { amount: 1000, currency: 'eur' }, // 10,00 €
            delivery_estimate: {
              minimum: { unit: 'business_day', value: 2 },
              maximum: { unit: 'business_day', value: 5 },
            },
          },
        },
      ],

      success_url: 'https://test-pagamenti.vercel.app/success.html?session_id={CHECKOUT_SESSION_ID}',
      cancel_url:  'https://test-pagamenti.vercel.app/cancel.html',

      // Diagnostica utile in Dashboard
      metadata: {
        fallback_used: useFallback ? 'true' : 'false',
        items_len: String(useFallback ? 0 : mapped.length),
        first_item_name: useFallback ? 'Prodotto di test' : (mapped[0]?.name || ''),
        first_item_amount_eur: String(useFallback ? 1 : (mapped[0]?.amount ?? '')),
      },
    });

    // ---- 4) Redirect diretto a Stripe ----
    res.redirect(303, session.url);
  } catch (err) {
    console.error('checkout-redirect error:', err);
    res.status(500).send(err.message || 'Stripe error');
  }
}
