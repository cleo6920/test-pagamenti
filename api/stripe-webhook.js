// api/stripe-webhook.js
const Stripe = require('stripe');

// ⚠️ USA LA SECRET DI TEST CHE HAI SU VERCEL (sk_test_...)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});

// Utility per leggere il RAW body (richiesto da Stripe per verificare la firma)
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    try {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).send('Method Not Allowed');
  }

  const sig = req.headers['stripe-signature'];
  if (!sig) {
    console.error('❌ Manca l’header stripe-signature');
    return res.status(400).send('Missing stripe-signature header');
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
    console.log('ℹ️ Webhook chiamato. Raw length:', rawBody.length);
  } catch (err) {
    console.error('❌ Errore lettura rawBody:', err);
    return res.status(500).send('Cannot read raw body');
  }

  let event;
  try {
    // ⚠️ Se la whsec non corrisponde esattamente, qui cadrai
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('❌ Verifica firma webhook fallita:', err.message);
    return res.status(401).send(`Webhook signature error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        console.log('✅ checkout.session.completed', {
          sessionId: session.id,
          email: session.customer_details?.email,
          name: session.customer_details?.name,
          amount_total: session.amount_total,
          currency: session.currency,
          shipping: session.shipping_details,
        });
        break;
      }

      case 'payment_intent.succeeded': {
        const pi = event.data.object;
        console.log('✅ payment_intent.succeeded', {
          id: pi.id,
          amount: pi.amount,
          currency: pi.currency,
        });
        break;
      }

      case 'payment_intent.payment_failed': {
        const pi = event.data.object;
        console.warn('⚠️ payment_intent.payment_failed', {
          id: pi.id,
          last_payment_error: pi.last_payment_error?.message,
        });
        break;
      }

      default:
        console.log('ℹ️ Evento non gestito:', event.type);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('❌ Errore nel handler:', err);
    return res.status(500).json({ error: 'Webhook handler error' });
  }
};
