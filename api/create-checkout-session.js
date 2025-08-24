// api/create-checkout-session.js — usa carrello reale + precompila dati cliente su Stripe (Opzione A: lascia fare tutto a Stripe per il Customer)
import Stripe from 'stripe';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const {
      items = [],
      customer = {},   // {name,email,phone,address,city,cap,note} dal frontend
      shippingCostOverride = 0, // Costo spedizione calcolato dal frontend
    } = req.body || {};

    const line_items = (items.length ? items : [{
      // Fallback se il carrello è vuoto (1€ di test)
      price_data: {
        currency: 'eur',
        product_data: { name: 'Prodotto di test (fallback)' },
        unit_amount: 100, // €1,00
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

    // Determina le opzioni di spedizione basate sul costo calcolato dal frontend
    let shippingOptions = [];
    if (shippingCostOverride > 0) {
        shippingOptions.push({
            shipping_rate_data: {
                display_name: 'Poste – Standard',
                type: 'fixed_amount',
                fixed_amount: { amount: Math.round(shippingCostOverride * 100), currency: 'eur' },
                delivery_estimate: {
                    minimum: { unit: 'business_day', value: 2 },
                    maximum: { unit: 'business_day', value: 5 },
                },
            },
        });
    } else {
         shippingOptions.push({
            shipping_rate_data: {
                display_name: 'Spedizione Gratuita',
                type: 'fixed_amount',
                fixed_amount: { amount: 0, currency: 'eur' },
                delivery_estimate: {
                    minimum: { unit: 'business_day', value: 2 },
                    maximum: { unit: 'business_day', value: 5 },
                },
            },
        });
    }


    const origin = req.headers.origin || `https://${req.headers.host}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items,

      // --- SOLUZIONE AL CONFLITTO ---
      // Lasciamo che Stripe gestisca la creazione/riuso del Customer.
      // Prende l'email, se esiste un Customer con quella email lo riusa,
      // altrimenti ne crea uno nuovo.
      customer_creation: 'always',
      customer_email: customer.email || undefined,
      // Non usiamo più 'customer: customerId' qui.

      // Permette a Stripe di aggiornare i dati del Customer se l'utente li modifica sul checkout
      customer_update: { address: 'auto', name: 'auto', shipping: 'auto' },

      // Mostra e richiede i campi indirizzo e telefono sul checkout
      billing_address_collection: 'required',
      phone_number_collection: { enabled: true },
      shipping_address_collection: { allowed_countries: ['IT'] },

      // Inietta le opzioni di spedizione dinamiche
      shipping_options: shippingOptions,

      success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/cancel.html`,

      // facoltativo: metadati utili per la tua dashboard Stripe
      metadata: {
        name_initial: customer.name || '',
        email_initial: customer.email || '',
        phone_initial: customer.phone || '',
        address_line1_initial: customer.address?.line1 || '', // Accesso sicuro
        city_initial: customer.address?.city || '',
        cap_initial: customer.address?.postal_code || customer.address?.cap || '',
        note: customer.note || '',
        source: 'oasi-busatello-v3', // Aggiornamento versione
      },
    });

    return res.status(200).json({ id: session.id, url: session.url });
  } catch (err) {
    console.error('Stripe create session error:', err);
    return res.status(500).json({ error: err.message || 'Stripe error' });
  }
}
