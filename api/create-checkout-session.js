// api/create-checkout-session.js  (o pages/api/create-checkout-session.js)
import Stripe from 'stripe';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const origin =
      process.env.NEXT_PUBLIC_SITE_URL ||
      req.headers.origin ||
      `https://${req.headers.host}`;

    // -------- 1) NORMALIZZA INPUT DAL FRONTEND (compatibilità massima) --------
    const body = req.body || {};

    // Formati supportati:
    // A) { items: [{ name, amount, quantity }, ...] }           // preferito
    // B) { cartItems: [{ title/name, price/amount, qty }, ...] }
    // C) { name, amount, quantity }                              // singolo
    // D) { product, price, qty }                                 // singolo (vecchio)
    let items = [];

    if (Array.isArray(body.items) && body.items.length > 0) {
      items = body.items.map((it) => ({
        name: it.name ?? it.title ?? 'Prodotto',
        amount: it.amount ?? it.price ?? 0,
        quantity: it.quantity ?? it.qty ?? 1,
      }));
    } else if (Array.isArray(body.cartItems) && body.cartItems.length > 0) {
      items = body.cartItems.map((it) => ({
        name: it.name ?? it.title ?? 'Prodotto',
        amount: it.amount ?? it.price ?? 0,
        quantity: it.quantity ?? it.qty ?? 1,
      }));
    } else if (body.name || body.product) {
      items = [
        {
          name: body.name ?? body.product ?? 'Prodotto',
          amount: body.amount ?? body.price ?? 0,
          quantity: body.quantity ?? body.qty ?? 1,
        },
      ];
    }

    // 🧹 Ignora eventuale riga "Spedizione" inviata nel payload (evita doppio addebito)
    const filtered = (items || []).filter(
      (it) => String(it?.name || '').trim().toLowerCase() !== 'spedizione'
    );

    // Se non arriva nulla → fallback di sicurezza (1 €) per non bloccare il flusso
    const safeItems =
      filtered.length > 0
        ? filtered
        : [{ name: 'Prodotto di test', amount: 1, quantity: 1 }];

    // -------- 2) CONVERSIONE IN line_items (EURO → CENT) --------
    const line_items = safeItems.map((it) => ({
      price_data: {
        currency: 'eur',
        product_data: { name: String(it.name || 'Prodotto') },
        unit_amount: Math.round(Number(it.amount || 0) * 100), // 6.00 → 600
      },
      quantity: Number(it.quantity || 1),
    }));

    // -------- 3) CREA LA CHECKOUT SESSION (indirizzo+telefono + shipping option) --------
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items,

      // Richiesta dati cliente su Stripe
      billing_address_collection: 'required',
      phone_number_collection: { enabled: true },
      shipping_address_collection: { allowed_countries: ['IT'] },

      // Spedizione mostrata come "Corriere" (non come riga prodotto)
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

      // Info utili in Dashboard per capire se è partito il fallback
      metadata: {
        fallback_used: filtered.length === 0 ? 'true' : 'false',
      },

      success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/cancel.html`,
    });

    return res.status(200).json({ id: session.id, url: session.url });
  } catch (err) {
    console.error('Stripe create session error:', err);
    return res.status(500).json({ error: err.message || 'Stripe error' });
  }
}

