// api/create-checkout-session.js — usa carrello reale + precompila dati cliente su Stripe
import Stripe from 'stripe';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    // ===== 1) LEGGI PAYLOAD DAL FRONTEND =====
    const body = req.body || {};
    const rawItems = Array.isArray(body.items) ? body.items : [];
    const customerInput = body.customer || {};
    const shippingCostOverride = typeof body.shippingCostOverride === 'number' ? body.shippingCostOverride : 0; // Costo spedizione dal frontend

    // Mappa carrello (ignora eventuale riga "Spedizione" se già presente, ma il frontend non la invia più)
    const line_items = rawItems.map(it => ({
      price_data: {
        currency: 'eur',
        product_data: { name: String(it.name || 'Prodotto') },
        unit_amount: Math.round(Number(it.amount ?? it.price ?? 0) * 100), // € → cent
      },
      quantity: Math.max(1, Number(it.quantity ?? it.qty ?? 1)),
    }));

    // Se non ci sono articoli reali, aggiungi un articolo di fallback
    const useFallback = line_items.length === 0;
    if (useFallback) {
        line_items.push({
            price_data: { currency: 'eur', product_data: { name: 'Prodotto di test (fallback)' }, unit_amount: 100 }, // 1€
            quantity: 1,
        });
    }

    // ===== 2) PREPARA/REPERISCI CUSTOMER PER PREFILL =====
    const email = (customerInput.email || '').trim() || undefined;
    const name = (customerInput.name || '').trim() || undefined;
    const phone = (customerInput.phone || '').trim() || undefined;
    const note = (customerInput.note || '').trim() || undefined;

    // address object per Stripe (accetta solo campi validi e formattati correttamente)
    const addr = customerInput.address || {};
    const address = {
      line1: addr.line1 || undefined,
      line2: addr.line2 || undefined, // Se presente nel frontend
      postal_code: addr.postal_code || addr.cap || undefined,
      city: addr.city || undefined,
      state: addr.state || undefined, // Provincia (Stripe lo chiama 'state')
      country: (addr.country || 'IT').toUpperCase(), // Default IT
    };

    let customerId; // Se lo impostiamo, Stripe Checkout precompila i campi
    if (email) {
      // Prova a riusare un customer con stessa email, altrimenti creane uno
      const existing = await stripe.customers.list({ email, limit: 1 });
      if (existing.data.length) {
        customerId = existing.data[0].id;
        // Aggiorna info utili per il prefill sul Customer esistente
        await stripe.customers.update(customerId, {
          name,
          phone,
          address,
          // Se name o address.line1 sono presenti, imposta shipping
          shipping: (name || address.line1) ? { name: name || undefined, address } : undefined,
        });
      } else {
        const created = await stripe.customers.create({
          email,
          name,
          phone,
          address,
          shipping: (name || address.line1) ? { name: name || undefined, address } : undefined,
        });
        customerId = created.id;
      }
    }

    // ===== 3) GESTIONE COSTO DI SPEDIZIONE DINAMICO =====
    // Ora creiamo un shipping_rate on-the-fly usando il costo calcolato dal frontend
    let shippingOptions = [];
    if (shippingCostOverride > 0) {
        shippingOptions.push({
            shipping_rate_data: {
                display_name: 'Poste – Standard',
                type: 'fixed_amount',
                fixed_amount: { amount: Math.round(shippingCostOverride * 100), currency: 'eur' }, // Costo dal frontend in centesimi
                delivery_estimate: {
                    minimum: { unit: 'business_day', value: 2 },
                    maximum: { unit: 'business_day', value: 5 },
                },
            },
        });
    } else {
         // Opzione spedizione gratuita se il costo è 0
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


    // ===== 4) CREA LA CHECKOUT SESSION =====
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items,

      // Prefill: se passiamo "customer", Checkout precompila nome/telefono/indirizzo/email
      customer: customerId || undefined,
      // Se non abbiamo un customerId (es. email non fornita), usiamo customer_email direttamente
      customer_email: !customerId && email ? email : undefined,

      // Mostra e consente modifica: se il cliente cambia i dati su Checkout, li aggiorniamo sul Customer
      customer_update: { address: 'auto', name: 'auto', shipping: 'auto' },
      // Rimosso `customer_creation: 'if_required',` per evitare il conflitto

      // Mostra i campi su Checkout (anche se non c'è customer)
      billing_address_collection: 'required',
      phone_number_collection: { enabled: true },
      shipping_address_collection: { allowed_countries: ['IT'] },

      // Inietta le opzioni di spedizione dinamiche
      shipping_options: shippingOptions,

      // Redirect (usa req.headers.origin per dominio dinamico)
      success_url: `${req.headers.origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${req.headers.origin}/cancel.html`,

      // Diagnostica & nota cliente
      metadata: {
        fallback_used: useFallback ? 'true' : 'false',
        note: note || '',
        source: 'oasi-busatello-v2', // Versione aggiornata
        customer_name_initial: name || 'N/A',
        customer_email_initial: email || 'N/A',
        customer_phone_initial: phone || 'N/A',
        customer_address_initial: `${addr.line1 || ''}, ${addr.city || ''}, ${addr.postal_code || ''}`,
      },
    });

    return res.status(200).json({ id: session.id, url: session.url });
  } catch (err) {
    console.error('Stripe create session error:', err);
    return res.status(500).json({ error: err.message || 'Stripe error' });
  }
}


