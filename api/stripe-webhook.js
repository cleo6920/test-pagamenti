// api/stripe-webhook.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

// Richiede RAW body (niente JSON parsing)
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Disabilita il body parser
module.exports.config = {
  api: { bodyParser: false },
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).send('Method Not Allowed');
  }

  let event;
  const sig = req.headers['stripe-signature'];

  try {
    const rawBody = await readRawBody(req);
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('❌ Verifica firma webhook fallita:', err.message);
    return res.status(401).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        console.log('✅ checkout.session.completed', {
          id: session.id,
          email: session.customer_details?.email,
          name: session.customer_details?.name,
          amount_total: session.amount_total,
          currency: session.currency,
        });
        break;
      }
      case 'payment_intent.succeeded': {
        const pi = event.data.object;
        console.log('✅ payment_intent.succeeded', { id: pi.id, amount: pi.amount });
        break;
      }
      default:
        console.log('ℹ️ Unhandled event type:', event.type);
    }
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('❌ Error handling event:', err);
    return res.status(500).json({ error: 'Webhook handler error' });
  }
};
