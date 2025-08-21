// /api/create-checkout-session.js
// Compatibile con Vercel (CommonJS)
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Helpers -------------------------------------------------------
function isStripeLineItem(item) {
  // item nel formato Stripe se ha price_data e quantity
  return item && item.price_data && typeof item.quantity !== 'undefined';
}

function normalizeToStripeLineItems(rawItems) {
  // Accetta array di oggetti semplici: { name, price, quantity }
  // dove price è in euro (numero o stringa) -> convertiamo in centesimi
  return (rawItems || []).map((it) => {
    const name = it.name || it.title || 'Articolo';
    // supporta price (EUR) come numero o stringa
    const eur = typeof it.price === 'string' ? parseFloat(it.price) : Number(it.price);
    const qty = Number(it.quantity || 1);
    const unit_amount = isFinite(eur) ? Math.round(eur * 100) : 0;

    return {
      price_data: {
        currency: 'eur',
        product_data: { name },
        unit_amount: unit_amount > 0 ? unit_amount : 0
      },
      quantity: qty > 0 ? qty : 1
    };
  }).filter(x => x.price_data.unit_amount > 0);
}
// ---------------------------------------------------------------

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
      (req.headers.host ? `https://${req.headers.host}` : 'https://example.vercel.app');

    // Legge il body (Vercel lo parsifica se Content-Type è application/json)
    const body = req.body || {};
    let { line_items, items, cart, customerEmail } = body;

    // 1) Se arrivano line_items già in formato Stripe, li uso
    let finalLineItems = Array.isArray(line_items) && line_items.length
      ? line_items
      : null;

    // 2) Altrimenti provo a trasformare un carrello semplice -> formato Stripe
    if (!finalLineItems) {
      const raw = Array.isArray(items) ? items
                : Array.isArray(cart) ? cart
                : null;

      if (raw && raw.length) {
        finalLineItems = normalizeToStripeLineItems(raw);
      }
    }

    // 3) Fallback: se ancora nulla, metto un prodotto di test da 5,00 €
    if (!finalLineItems || finalLineItems.length === 0) {
      finalLineItems = [
        {
          price_data: {
            currency: 'eur',
            product_data: { name: 'Prodotto di test' },
            unit_amount: 500
          },
          quantity: 1
        }
      ];
    }

    // Crea la sessione di checkout
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'], // niente Link per evitare edge cases in test
      line_items: finalLineItems,
      customer_email: customerEmail || undefined,
      success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/cancel.html`
    });

    // Log utile per incrociare in Stripe Dashboard (Developers > Events)
    console.log('Stripe Checkout session created:', session.id);

    // 👉 Frontend con Stripe.js: serve l'id
    return res.status(200).json({ id: session.id });

    // Se preferisci il redirect diretto via URL, usa:
    // return res.status(200).json({ url: session.url });

  } catch (err) {
    console.error('Stripe error:', err);
    return res.status(500).json({
      error: err.message || 'Stripe session creation failed',
      type: err.type || null,
      code: err.code || null
    });
  }
};
