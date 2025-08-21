// api/create-checkout-session.js
const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // opzionale: leggi eventuali line_items da req.body
    const body = req.body || {};
    const line_items = Array.isArray(body.line_items) && body.line_items.length
      ? body.line_items
      : [
          {
            price_data: {
              currency: 'eur',
              product_data: { name: 'Prodotto di test' },
              unit_amount: 500,
            },
            quantity: 1,
          },
        ];

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items,
      success_url: `${req.headers.origin || 'https://' + req.headers.host}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin || 'https://' + req.headers.host}/cancel.html`,
    });

    // *** QUI: restituiamo sessionId coerente col frontend ***
    return res.status(200).json({ sessionId: session.id });
  } catch (err) {
    console.error('Stripe create session error:', err);
    return res.status(500).json({ error: err.message || 'Stripe error' });
  }
};
