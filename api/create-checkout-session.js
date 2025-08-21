// api/create-checkout-session.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // leggi eventuale body JSON con line_items
    let line_items = null;
    if (req.headers['content-type']?.includes('application/json') && req.body) {
      if (Array.isArray(req.body.line_items) && req.body.line_items.length > 0) {
        line_items = req.body.line_items;
      }
    }

    // fallback: 1€ di test se non arrivano articoli
    if (!line_items) {
      line_items = [
        {
          price_data: {
            currency: 'eur',
            product_data: { name: 'Prodotto di test' },
            unit_amount: 100,
          },
          quantity: 1,
        },
      ];
    }

    const origin = req.headers.origin || `https://${req.headers.host}`;
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items,
      success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/cancel.html`,
    });

    // Risposta coerente col frontend
    return res.status(200).json({ id: session.id });
  } catch (err) {
    console.error('Stripe create session error:', err);
    return res.status(500).json({ error: err.message || 'Stripe error' });
  }
};
