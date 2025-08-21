// /api/create-checkout-session.js
const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const origin =
      req.headers.origin ||
      (req.headers.host ? `https://${req.headers.host}` : 'https://test-pagamenti.vercel.app');

    // Per il test lasciamo items fissi
    const line_items = [
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
      payment_method_types: ['card'], // niente Link, per ora
      line_items,
      success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/cancel.html`,
    });

    // Log utile per incrociare con Stripe Dashboard
    console.log('Checkout session created', session.id);

    // 👉 ritorniamo SOLO l'id
    return res.status(200).json({ id: session.id });
  } catch (err) {
    console.error('Stripe error:', err);
    return res.status(500).json({
      error: err.message || 'Stripe session creation failed',
      type: err.type || null,
      code: err.code || null,
    });
  }
};
