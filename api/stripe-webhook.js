// api/stripe-webhook.js
const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});

// Legge il RAW body (serve per verificare la firma)
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).send('Method Not Allowed');
  }

  const sig = req.headers['stripe-signature'];
  if (!sig) return res.status(400).send('Missing Stripe-Signature header');

  let event;
  try {
    const rawBody = await readRawBody(req);
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('❌ Signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        console.log('✅ checkout.session.completed', {
          sessionId: session.id,
          email: session.customer_details?.email,
          amount_total: session.amount_total,
          currency: session.currency,
          payment_status: session.payment_status,
        });
        // if (session.payment_status === 'paid') { /* TODO: fulfillment */ }
        break;
      }
      case 'payment_intent.succeeded': {
        const pi = event.data.object;
        console.log('✅ payment_intent.succeeded', { id: pi.id, amount: pi.amount });
        break;
      }
      case 'payment_intent.payment_failed': {
        const pi = event.data.object;
        console.warn('⚠️ payment_intent.payment_failed', {
          id: pi.id,
          error: pi.last_payment_error?.message,
        });
        break;
      }
      default:
        console.log('ℹ️ Unhandled event type:', event.type);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('❌ Handler error:', err);
    return res.status(500).json({ error: 'Webhook handler error' });
  }
};
