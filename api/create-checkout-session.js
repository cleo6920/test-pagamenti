// api/create-checkout-session.js
import Stripe from 'stripe';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const {
      items = [],
      customer = {},              // {name,email,phone,address,city,cap,note}
      shippingCostOverride = 0,   // in euro
    } = req.body || {};

    // Carrello o fallback
    const line_items = (items.length ? items : [{
      price_data: {
        currency: 'eur',
        product_data: { name: 'Prodotto di test (fallback)' },
        unit_amount: 100, // 1 €
      },
      quantity: 1,
    }]).map(it => ({
      price_data: {
        currency: 'eur',
        product_data: { name: String(it.name || 'Prodotto') },
        unit_amount: Math.round(Number(it.amount ?? it.price ?? 0) * 100),
      },
      quantity: Math.max(1, Number(it.quantity ?? it.qty ?? 1)),
    }));

    // Opzioni di spedizione
    const shippingOptions = [
      {
        shipping_rate_data: {
          display_name: shippingCostOverride > 0 ? 'Poste – Standard' : 'Spedizione Gratuita',
          type: 'fixed_amount',
          fixed_amount: { amount: Math.round(shippingCostOverride * 100), currency: 'eur' },
          delivery_estimate: {
            minimum: { unit: 'business_day', value: 2 },
            maximum: { unit: 'business_day', value: 5 },
          },
        },
      },
    ];

    const origin = req.headers.origin || `https://${req.headers.host}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items,

      // 🔑 Niente conflitto customer/customer_creation
      customer_creation: 'always',
      customer_email: customer.email || undefined,

      billing_address_collection: 'required',
      phone_number_collection: { enabled: true },
      shipping_address_collection: { allowed_countries: ['IT'] },
      shipping_options: shippingOptions,

      success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${origin}/cancel.html`,

      metadata: {
        name_initial: customer.name || '',
        email_initial: customer.email || '',
        phone_initial: customer.phone || '',
        address_line1_initial: customer.address?.line1 || '',
        city_initial: customer.address?.city || '',
        cap_initial: customer.address?.postal_code || customer.address?.cap || '',
        note: customer.note || '',
        source: 'oasi-busatello-v3',
      },
    });

    return res.status(200).json({ id: session.id, url: session.url });
  } catch (err) {
    console.error('Stripe create session error:', err);
    return res.status(500).json({ error: err.message || 'Stripe error' });
  }
}
