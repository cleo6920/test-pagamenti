// /api/stripe-webhook.js
const Stripe = require("stripe");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

// Legge il RAW body (obbligatorio per verificare la firma)
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).send("Method Not Allowed");
  }

  // 1) Prendiamo il secret e togliamo spazi invisibili
  const endpointSecret = (process.env.STRIPE_WEBHOOK_SECRET || "").trim();
  if (!endpointSecret) {
    console.error("❌ STRIPE_WEBHOOK_SECRET mancante");
    return res.status(500).send("Missing STRIPE_WEBHOOK_SECRET");
  }

  const sig = req.headers["stripe-signature"];
  if (!sig) {
    console.error("❌ Manca l'header stripe-signature");
    return res.status(400).send("Missing stripe-signature header");
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
    console.log("ℹ️ Webhook hit | raw bytes:", rawBody.length, "| sig bytes:", String(sig).length, "| secret len:", endpointSecret.length);
  } catch (err) {
    console.error("❌ Errore lettura raw body:", err);
    return res.status(500).send("Cannot read raw body");
  }

  let event;
  try {
    // 2) Verifica firma con raw body e secret TRIMMATO
    event = stripe.webhooks.constructEvent(rawBody, sig, endpointSecret);
  } catch (err) {
    console.error("❌ Firma webhook NON valida:", err.message);
    return res.status(401).send(`Webhook signature error: ${err.message}`);
  }

  try {
    console.log("✅ Evento ricevuto:", event.type);

    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object;
        console.log("💰 checkout.session.completed", {
          sessionId: s.id,
          email: s.customer_details?.email || "",
          amount_total: s.amount_total,
          currency: s.currency,
          shipping_ok: Boolean(s.shipping_details),
        });
        break;
      }
      case "payment_intent.succeeded": {
        const pi = event.data.object;
        console.log("💚 payment_intent.succeeded", { id: pi.id, amount: pi.amount, currency: pi.currency });
        break;
      }
      case "payment_intent.payment_failed": {
        const pi = event.data.object;
        console.warn("⚠️ payment_intent.payment_failed", { id: pi.id, err: pi.last_payment_error?.message });
        break;
      }
      default:
        console.log("ℹ️ Non gestito:", event.type);
    }

    // 3) Risposta veloce a Stripe
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("💥 Errore handler:", err);
    return res.status(500).json({ error: "Webhook handler error" });
  }
};
