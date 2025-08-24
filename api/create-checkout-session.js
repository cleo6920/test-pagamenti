// /api/create-checkout-session.js — Customer robusto + carrello reale + fix condizionali
import Stripe from 'stripe';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const {
      items = [],
      customer: customerInput = {}, // {name,email,phone,address:{line1,postal_code,city,state,country},note}
      shippingCostOverride = 0,     // numero in € (es. 10)
      success_url,                  // opzionale: se non passato uso origin/success.html
      cancel_url,                   // opzionale: se non passato uso origin/cancel.html
      metadata = {},               // opzionale
    } = req.body || {};

    // --- LINE ITEMS: supporta price (ID Stripe) o price_data dinamico ---
    const normalizedItems = items.length ? items : [{
      price_data: { currency: 'eur', product_data: { name: 'Prodotto di test (fallback)' }, unit_amount: 100 },
      quantity: 1,
    }];

    const line_items = normalizedItems.map((it) => {
      // Se arriva un ID price di Stripe, usa quello
      if (typeof it.price === 'string' && it.price.startsWith('price_')) {
        return {
          price: it.price,
          quantity: Math.max(1, Number(it.quantity ?? it.qty ?? 1)),
        };
      }

      // Altrimenti costruisci price_data dai campi numerici (in euro)
      const unitEuros = Number(it.amount ?? it.price ?? it.unit_amount ?? 0);
      const unitCents = Math.max(1, Math.round(unitEuros * 100)); // evita 0/NaN

      return {
        price_data: {
          currency: 'eur',
          product_data: { name: String(it.name || 'Prodotto') },
          unit_amount: unitCents,
        },
        quantity: Math.max(1, Number(it.quantity ?? it.qty ?? 1)),
      };
    });

    // --- Spedizione dinamica (una tariffa: a pagamento o gratuita) ---
    const shippingOptions = [{
      shipping_rate_data: {
        display_name: Number(shippingCostOverride) > 0 ? 'Poste – Standard' : 'Spedizione Gratuita',
        type: 'fixed_amount',
        fixed_amount: {
          amount: Math.max(0, Math.round(Number(shippingCostOverride) * 100)),
          currency: 'eur',
        },
        delivery_estimate: {
          minimum: { unit: 'business_day', value: 2 },
          maximum: { unit: 'business_day', value: 5 },
        },
      },
    }];

    // --- PREPARA / CREA CUSTOMER ---
    const email = (customerInput.email || '').trim().toLowerCase() || undefined;
    const name = (customerInput.name || '').trim() || undefined;
    const phone = (customerInput.phone || '').trim() || undefined;
    const note = (customerInput.note || '').trim() || undefined;

    const addr = customerInput.address || {};
    const addressForStripe = {
      line1: addr.line1 || undefined,
      line2: addr.line2 || undefined,
      postal_code: addr.postal_code || addr.cap || undefined,
      city: addr.city || undefined,
      state: addr.state || undefined,   // provincia
      country: (addr.country || 'IT').toUpperCase(),
    };

    let customerId;
    if (email) {
      const existing = await stripe.customers.list({ email, limit: 1 });
      if (existing.data.length > 0) {
        customerId = existing.data[0].id;
        await stripe.customers.update(customerId, {
          name,
          phone,
          address: addressForStripe,
          shipping: (name || addressForStripe.line1)
            ? { name: name || undefined, phone: phone || undefined, address: addressForStripe }
            : undefined,
          metadata: { note: note || '' },
        });
      } else {
        const created = await stripe.customers.create({
          email,
          name,
          phone,
          address: addressForStripe,
          shipping: (name || addressForStripe.line1)
            ? { name: name || undefined, phone: phone || undefined, address: addressForStripe }
            : undefined,
          metadata: { note: note || '' },
        });
        customerId = created.id;
      }
    }
    // Se non c’è email -> checkout come guest (niente customerId).

    const origin =
      req.headers.origin
      || (req.headers.host ? `https://${req.headers.host}` : 'http://localhost:3000');

    // --- Parametri base della sessione ---
    const sessionParams = {
      mode: 'payment',
      line_items,

      // Stripe capisce i metodi da solo; evitare il warning futuro:
      // payment_method_types: ['card'],

      billing_address_collection: 'required',
      phone_number_collection: { enabled: true },
      shipping_address_collection: { allowed_countries: ['IT', 'SM', 'VA'] },
      shipping_options: shippingOptions,

      success_url: success_url || `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancel_url || `${origin}/cancel.html`,

      allow_promotion_codes: true, // utile se usi codici promo
      metadata: {
        source: 'oasi-busatello-v4',
        name_initial: customerInput.name || '',
        email_initial: customerInput.email || '',
        phone_initial: customerInput.phone || '',
        address_line1_initial: addr.line1 || '',
        city_initial: addr.city || '',
        cap_initial: addr.postal_code || addr.cap || '',
        note: note || '',
        ...metadata,
      },
    };

    // --- customer_update SOLO se ho un customer ---
    if (customerId) {
      sessionParams.customer = customerId;
      sessionParams.customer_update = { address: 'auto', name: 'auto', shipping: 'auto' };
    } else if (email) {
      sessionParams.customer_email = email; // precompila l’email nel Checkout
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    return res.status(200).json({ id: session.id, url: session.url });

  } catch (err) {
    console.error('Stripe create session error:', err);
    return res.status(500).json({ error: err?.raw?.message || err.message || 'Stripe error' });
  }
}
