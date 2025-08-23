// api/create-checkout-session.js — usa gli items reali, inclusa la spedizione dal frontend, senza spedizione fissa qui.
import Stripe from 'stripe';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // Inizializza Stripe con la chiave segreta
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    // ---- Prendi gli items dal frontend (amount in EURO) ----
    const rawItems = (req.body && Array.isArray(req.body.items)) ? req.body.items : [];

    // Se non ci sono articoli reali, usa un articolo di test come fallback
    // NON FILTRIAMO PIÙ LA SPEDIZIONE QUI. Il frontend la gestisce correttamente come un line_item.
    const itemsToProcess = rawItems.length === 0
      ? [{ name: 'Prodotto di test (fallback)', amount: 1, quantity: 1 }]
      : rawItems;

    // Mappa gli articoli nel formato richiesto da Stripe per line_items
    const line_items = itemsToProcess.map(it => ({
      price_data: {
        currency: 'eur',
        product_data: { name: String(it.name || 'Prodotto') },
        unit_amount: Math.round(Number(it.amount ?? it.price ?? 0) * 100), // € → cent
      },
      quantity: Math.max(1, Number(it.quantity ?? it.qty ?? 1)),
    }));

    // Creazione della sessione di checkout Stripe
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items, // Ora include la spedizione inviata dal frontend dal frontend

      // Raccogli indirizzo e telefono
      billing_address_collection: 'required',
      phone_number_collection: { enabled: true },
      shipping_address_collection: { allowed_countries: ['IT'] },

      // IMPORTANTISSIMO: RIMUOVIAAMO COMPLETAMENTE LE shipping_options fisse dal backend.
      // La spedizione è già inclusa come line_item dal frontend.
      // Le abbiamo commentate in precedenza, ora è essenziale che NON ci siano del tutto per evitare conflitti.
      // shipping_options: [
      //   {
      //     shipping_rate_data: {
      //       display_name: 'Poste – Standard',
      //       type: 'fixed_amount',
      //       fixed_amount: { amount: 1000, currency: 'eur' }, // 10,00 €
      //       delivery_estimate: {
      //         minimum: { unit: 'business_day', value: 2 },
      //         maximum: { unit: 'business_day', value: 5 },
      //       },
      //     },
      //   },
      // ],

      // URL di redirect dopo successo/cancellazione del pagamento
      success_url: `${req.headers.origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${req.headers.origin}/cancel.html`,

      // Per diagnosi in Dashboard (opzionale)
      metadata: {
        origin: 'miele-ecommerce-vercel',
        fallback_used: rawItems.length === 0 ? 'true' : 'false',
        // Puoi aggiungere altri metadati qui, es. ID utente, ID ordine locale, ecc.
      },
    });

    // Restituisci l'ID della sessione al frontend
    res.status(200).json({ id: session.id });

  } catch (error) {
    console.error('Errore nella creazione della sessione di checkout:', error);
    res.status(500).json({ error: error.message || 'Errore interno del server' });
  }
}
