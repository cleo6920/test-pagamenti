// api/create-checkout-session.js
import Stripe from 'stripe';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    // Se arrivano item dal frontend li uso, altrimenti metto un prodotto di test
    let line_items = [];
    if (req.body && Array.isArray(req.body.items) && req.body.items.length > 0) {
      line_items = req.body.items.map((it) => ({
        price_data: {
          currency: 'eur',
          product_data: { name: it.name || 'Prodotto' },
          // it.amount è in euro → converto in centesimi
          unit_amount: Math.round((it.amount ?? 0) * 100),
        },
        quantity: it.quantity ?? 1,
      }));
    } else {
      // Fallback di test
      line_items = [
        {
          price_data: {
            currency: 'eur',
            product_data: { name: 'Prodotto di test' },
            unit_amount: 100, // 1,00 €
          },
          quantity: 1,
        },
      ];
    }

    // Calcolo origin per i redirect (funziona su Vercel e in locale)
    const origin = req.headers.origin || `https://${req.headers.host}`;

    // CREAZIONE SESSIONE CHECKOUT
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items,

      // 👇 STEP 1: attivo raccolta INDIRIZZO + TELEFONO
      billing_address_collection: 'required',
      phone_number_collection: { enabled: true },
      shipping_address_collection: { allowed_countries: ['IT'] },

      // Redirect
      success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/cancel.html`,
    });

    // Risposta al frontend (mantengo id per compatibilità; aggiungo url se ti serve)
    return res.status(200).json({ id: session.id, url: session.url });
  } catch (err) {
    console.error('Stripe create session error:', err);
    return res.status(500).json({ error: err.message || 'Stripe error' });
  }
}



