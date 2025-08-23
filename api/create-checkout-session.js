// api/create-checkout-session.js  — versione “sempre 1€” per sbloccarsi
import Stripe from 'stripe';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    // CREA SEMPRE UNA SESSIONE DA 1,00 € (ignora il body)
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: { name: 'Prodotto di test' },
            unit_amount: 100, // 1,00 €
          },
          quantity: 1,
        },
      ],

      // Richiedi indirizzo + telefono
      billing_address_collection: 'required',
      phone_number_collection: { enabled: true },
      shipping_address_collection: { allowed_countries: ['IT'] },

      // Mostra corriere 10,00 € (solo per vedere il riquadro “Corriere”)
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

      // Redirect fissati al dominio buono
      success_url: 'https://test-pagamenti.vercel.app/success.html?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://test-pagamenti.vercel.app/cancel.html',
      metadata: { version: 'always-1eur' },
    });

    return res.status(200).json({ id: session.id, url: session.url });
  } catch (err) {
    console.error('Stripe error:', err);
    return res.status(500).json({ error: err.message || 'Stripe error' });
  }
}

