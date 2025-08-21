// /api/stripe-webhook.js
const Stripe = require("stripe");

// Inizializza Stripe con la tua secret key
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

// Legge il RAW body (necessario per verificare la firma del webhook)
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

module.exports = async (req, res) => {
  // Solo POST
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).send("Method Not Allowed");
  }

  let event;
  const sig = req.headers["stripe-signature"];

  try {
    // Ottieni il body grezzo
    const rawBody = await readRawBody(req);

    // Verifica firma: se STRIPE_WEBHOOK_SECRET è errato, qui lancia
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("❌ Webhook signature verification failed:", err.message);
    // 401 comunica meglio che è un problema di firma/autenticazione
    return res.status(401).send(`Webhook Error: ${err.message}`);
  }

  try {
    // Gestione eventi
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        console.log("✅ checkout.session.completed", {
          sessionId: session.id,
          email: session.customer_details?.email || "",
          name: session.customer_details?.name || "",
          amount_total: session.amount_total,
          currency: session.currency,
          shipping: session.shipping_details || null,
        });
        // TODO: salva ordine / invia email / aggiorna DB
        break;
      }

      case "payment_intent.succeeded": {
        const pi = event.data.object;
        console.log("✅ payment_intent.succeeded", {
          id: pi.id,
          amount: pi.amount,
          currency: pi.currency,
        });
        break;
      }

      case "payment_intent.payment_failed": {
        const pi = event.data.object;
        console.warn("⚠️ payment_intent.payment_failed", {
          id: pi.id,
          last_payment_error: pi.last_payment_error?.message,
        });
        break;
      }

      default: {
        // Altri eventi non gestiti esplicitamente
        console.log("ℹ️ Unhandled event type:", event.type);
      }
    }

    // Risposta OK al webhook (necessaria per evitare retry)
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("❌ Error handling event:", err);
    return res.status(500).json({ error: "Webhook handler error" });
  }
};
