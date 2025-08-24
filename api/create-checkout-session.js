// /api/create-checkout-session.js — Carta in primo piano, Link/Amazon opzionali, NO email/phone prefill
import Stripe from 'stripe';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const {
      items = [],
      customer: customerInput = {}, // { name, email, phone, address:{line1,postal_code,city,state,country}, note }
      shippingCostOverride = 0,     // es. 6 (euro)
      success_url,
      cancel_url,
      metadata = {},
    } = req.body || {};

    // --- LINE ITEMS (accetta price "price_..." o price_data in euro) ---
    const baseItems = items.length ? items : [{
      price_data: { currency: 'eur', product_data: { name: 'Prodotto di test (fallback)' }, unit_amount: 100 },
      quantity: 1,
    }];

    const line_items = baseItems.map((it) => {
      if (typeof it.price === 'string' && it.price.startsWith('price_')) {
        return { price: it.price, quantity: Math.max(1, Number(it.quantity ?? it.qty ?? 1)) };
      }
      const unitEuros = Number(it.amount ?? it.price ?? it.unit_amount ?? 0);
      const unitCents = Math.max(1, Math.round(unitEuros * 100));
      return {
        price_data: {
          currency: 'eur',
          product_data: { name: String(it.name || 'Prodotto') },
          unit_amount: unitCents,
        },
        quantity: Math.max(1, Number(it.quantity ?? it.qty ?? 1)),
      };
    });

    // --- Spedizione dinamica (una tariffa) ---
    const shippingOptions = [{
      shipping_rate_data: {
        display_name: Number(shippingCostOverride) > 0 ? 'Poste – Standard' : 'Spedizione Gratuita',
        type: 'fixed_amount',
        fixed_amount: { amount: Math.max(0, Math.round(Number(shippingCostOverride) * 100)), currency: 'eur' },
        delivery_estimate: { minimum: { unit: 'business_day', value: 2 }, maximum: { unit: 'business_day', value: 5 } },
      },
    }];

    // --- CUSTOMER per prefill (senza email e senza phone per non attivare Link) ---
    const name = (customerInput.name || '').trim() || undefined;
    const note = (customerInput.note || '').trim() || undefined;
    const emailHint = (customerInput.email || '').trim().toLowerCase() || undefined; // solo metadato, NON prefill
    // NON usiamo customerInput.phone

    const addr = customerInput.address || {};
    const addressForStripe = {
      line1: addr.line1 || undefined,
      line2: addr.line2 || undefined,
      postal_code: addr.postal_code || addr.cap || undefined,
      city: addr.city || undefined,
      state: addr.state || undefined,
      country: (addr.country || 'IT').toUpperCase(),
    };

    // Creiamo un customer “pulito” senza email/phone
    const createdCustomer = await stripe.customers.create({
      name,
      // phone: (omesso apposta)
      address: addressForStripe,
      shipping: (name || addressForStripe.line1)
        ? { name: name || undefined, /* phone omesso */, address: addressForStripe }
        : undefined,
      metadata: {
        note: note || '',
        email_hint: emailHint || '',
        source: 'oasi-busatello-v4',
      },
    });
    const customerId = createdCustomer.id;

    const origin =
      req.headers.origin
      || (req.headers.host ? `https://${req.headers.host}` : 'http://localhost:3000');

    // --- Parametri sessione: carta in primo piano, Link/Amazon abilitati ma non “dominanti” ---
    const sessionParams = {
      mode: 'payment',
      line_items,

      payment_method_types: ['card', 'link', 'amazon_pay'], // wallet visibili, ma niente login automatico

      billing_address_collection: 'required',
      // phone_number_collection: { enabled: true }, // DISABILITATO per non innescare Link via telefono
      shipping_address_collection: { allowed_countries: ['IT', 'SM', 'VA'] },
      shipping_options: shippingOptions,

      success_url: success_url || `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancel_url || `${origin}/cancel.html`,

      allow_promotion_codes: true,
      metadata: {
        source: 'oasi-busatello-v4',
        name_initial: name || '',
        email_initial: emailHint || '',
        address_line1_initial: addr.line1 || '',
        city_initial: addr.city || '',
        cap_initial: addr.postal_code || addr.cap || '',
        note: note || '',
        ...metadata,
      },

      customer: customerId,
      customer_update: { address: 'auto', name: 'auto', shipping: 'auto' },

      // NIENTE customer_email qui
    };

    const session = await stripe.checkout.sessions.create(sessionParams);
    return res.status(200).json({ id: session.id, url: session.url });

  } catch (err) {
    console.error('Stripe create session error:', err);
    return res.status(500).json({ error: err?.raw?.message || err.message || 'Stripe error' });
  }
}
