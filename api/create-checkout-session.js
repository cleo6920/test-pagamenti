// api/create-checkout-session.js
import Stripe from 'stripe';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const origin = process.env.NEXT_PUBLIC_SITE_URL || req.headers.origin || `https://${req.headers.host}`;

    // ✅ Pretendo i prodotti reali dal frontend
    const { items = [] } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'No items provided' });
    }

    // 🧹 Ignoro eventuale riga "Spedizione" nel payload (evita doppio addebito)
    const filtered = items.filter(
      it => String(it.name || '').trim().toLowerCase() !== 'spedizione'
    );

    // 🎯 Converto in line_items (amount atteso in EURO → centesimi)
    const line_items = filtered.map((it) => ({
      price_data: {
        currency: 'eur',
        product_data: { name: String(it.name || 'Prodotto') },
        unit_amount: Math.round(Number(it.amount) * 100), // 6.00 → 600
      },
      quantity: Number(it.quantity || 1),
    }));

    // ✅ Checkout con indirizzo + telefono
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items,

      billing_address_collection: 'required',
      phone_number_collection: { enabled: true },
      shipping_address_collection: { allowed_countries: ['IT'] },

      // 🚚 Spedizione come "shipping option" (10,00 €)
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

      // Redirect
      success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/cancel.html`,
    });

    return res.status(200).json({ id: session.id, url: session.url });
  } catch (err) {
    console.error('Stripe create session error:', err);
    return res.status(500).json({ error: err.message || 'Stripe error' });
  }
}
