// /api/create-checkout-session.js
const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  // apiVersion: '2024-04-10', // opzionale: se vuoi fissare la versione
});

module.exports = async (req, res) => {
  // Solo POST
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Origin assoluto per success/cancel
    const origin =
      req.headers.origin ||
      (req.headers.host ? `https://${req.headers.host}` : 'https://test-pagamenti.vercel.app');

    // Se vuoi passare items dal frontend:
    // const { items } = req.body || {};
    // Trasformali tu in line_items...
    // Per test fisso:
    const line_items = [
      {
        price_data: {
          currency: 'eur',
          product_data: { name: 'Prodotto di test' },
          unit_amount: 500, // 5,00 €
        },
        quantity: 1,
      },
    ];

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'], // solo carta (niente Link per ora)
      line_items,
      success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/cancel.html`,
    });

    // Variante A: ritorniamo direttamente l'URL (non serve Stripe.js sul client)
    return res.status(200).json({ url: session.url });

    // Variante B: se preferisci Stripe.js nel client:
    // return res.status(200).json({ id: session.id });
  } catch (err) {
    console.error('Stripe error:', err);
    // Mostra di più in test mode, così capiamo subito
    return res.status(500).json({
      error: err.message || 'Stripe session creation failed',
      type: err.type || null,
      code: err.code || null,
    });
  }
};
