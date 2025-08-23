// api/create-checkout-session.js — usa il carrello reale + corriere 10 €, con fallback 1 €
import Stripe from 'stripe';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    // ITEMS dal frontend: [{ name, amount, quantity }] (amount in EURO)
    const raw = (req.body && Array.isArray(req.body.items)) ? req.body.items : [];

    // Ignoro eventuale riga "Spedizione" (la gestiamo come shipping option)
    const filtered = raw.filter(it => String(it?.name || '').trim().toLowerCase() !== 'spedizione');

    // Mappo e ripulisco
    const mapped = filtered.map(it => ({
      name: String(it.name || 'Prodotto'),
      amount: Math.max(0, Number(it.amount ?? it.price ?? 0)),  // € → numero
      quantity: Math.max(1, Number(it.quantity ?? it.qty ?? 1)),
    }));

    const useFallback = mapped.length === 0;

    // Se non arriva nulla, uso fallback 1 €
    const itemsToUse = useFallback ? [{ name: 'Prodotto di test', amount: 1, quantity: 1 }] : mapped;

    // Converto in centesimi
    const line_items = itemsToUse.map(it => ({
      price_data: {
        currency: 'eur',
        product_data: { name: it.name },
        unit_amount: Math.round(it.amount * 100), // € → cent
      },
      quantity: it.quantity,
    }));

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items,

      // Raccogli indirizzo + telefono
      billing_address_collection: 'required',
      phone_number_collection: { enabled: true },
      shipping_address_collection: { allowed_countries: ['IT'] },

      // Corriere mostrato in Stripe (10,00 €)
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

      // Redirect sul dominio buono
      success_url: 'https://test-pagamenti.vercel.app/success.html?session_id={CHECKOUT_SESSION_ID}',
      cancel_url:  'https://test-pagamenti.vercel.app/cancel.html',

      // Aiuta a capire in Dashboard se è partito il fallback
      metadata: { fallback_used: useFallback ? 'true' : 'false' },
    });

    return res.status(200).json({ id: session.id, url: session.url });
  } catch (err) {
    console.error('Stripe create session error:', err);
    return res.status(500).json({ error: err.message || 'Stripe error' });
  }
}

