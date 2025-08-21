
// api/stripe-webhook.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

// Utility per leggere il RAW body (richiesto da Stripe per verificare la firma)
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = [];
    req.on('data', (chunk) => data.push(chunk));
    req.on('end', () => resolve(Buffer.concat(data)));
    req.on('error', reject);
  });
}

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
      process.env.STRIPE_WEBHOOK_SECRET // da impostare in Vercel
    );
  } catch (err) {
    console.error('❌ Verifica firma webhook fallita:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Gestisci solo l'evento che ci interessa
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    // Dati utili
    const email = session.customer_details?.email || '';
    const name = session.customer_details?.name || '';
    const shipping = session.shipping_details || null; // contiene indirizzo, nome, ecc.
    const amountTotal = session.amount_total; // in centesimi
    const currency = session.currency;

    console.log('✅ Ordine pagato:', {
      email,
      name,
      amountTotal,
      currency,
      shipping,
      sessionId: session.id,
    });
  }

  return res.status(200).json({ received: true });
};
