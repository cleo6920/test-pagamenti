// api/checkout-redirect.js
import Stripe from 'stripe';

export default async function handler(req, res) {
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: { name: 'Prodotto di test' },
            unit_amount: 100, // 1,00 €
          },
          quantity: 1,
        },
      ],
      billing_address_collection: 'required',
      phone_number_collection: { enabled: true },
      shipping_address_collection: { allowed_countries: ['IT'] },
      shipping_options: [
        {
          shipping_rate_data: {
            display_name: 'Poste – Standard',
            type: 'fixed_amount',
            fixed_amount: { amount: 1000, currency: 'eur' }, // 10,00 €
            delivery_estimate: {
              minimum: { unit: 'business_day', value: 2 },
              maximum: { unit: 'business_day', value: 5 },
            },
          },
        },
      ],
      success_url: 'https://test-pagamenti.vercel.app/success.html?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://test-pagamenti.vercel.app/cancel.html',
    });

    res.redirect(303, session.url);
  } catch (err) {
    console.error('checkout-redirect error:', err);
    res.status(500).send(err.message || 'Stripe error');
  }
}
