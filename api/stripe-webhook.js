// /api/stripe-webhook.js
const Stripe = require("stripe");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

// RAW body (obbligatorio per verifica firma)
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Prova a verificare la firma con uno qualunque dei segreti configurati
function verifyWithAnySecret(rawBody, sig, secretsCsv) {
  const secrets = String(secretsCsv || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  if (secrets.length === 0) {
    throw new Error("No webhook secrets configured");
  }

  let lastErr;
  for (const secret of secrets) {
    try {
      return stripe.webhooks.constructEvent(rawBody, sig, secret);
    } catch (err) {
      lastErr = err;
    }
  }
  // Se nessuno ha funzionato, rilancia l’ultimo errore
  throw lastErr || new Error("Signature verification failed");
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).send("Method Not Allowed");
  }

  const sig = req.headers["stripe-signature"];
  if (!sig) {
    return res.status(400).send("Missing stripe-signature header");
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (err) {
    console.error("❌ Cannot read raw body:", err);
    return res.status(500).send("Cannot read raw body");
  }

  let event;
  try {
    // ✅ supporta più whsec separati da virgola
    event = verifyWithAnySecret(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRETS || process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("❌ Webhook signature verification failed:", err.message);
    return res.status(401).send(`Webhook signature error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object;
        console.log("✅ checkout.session.completed", {
          sessionId: s.id,
          email: s.customer_details?.email || "",
          name: s.customer_details?.name || "",
          amount_total: s.amount_total,
          currency: s.currency,
          shipping_ok: Boolean(s.shipping_details),
        });
        break;
      }
      case "payment_intent.succeeded": {
        const pi = event.data.object;
        console.log("✅ payment_intent.succeeded", { id: pi.id, amount: pi.amount, currency: pi.currency });
        break;
      }
      case "payment_intent.payment_failed": {
        const pi = event.data.object;
        console.warn("⚠️ payment_intent.payment_failed", { id: pi.id, err: pi.last_payment_error?.message });
        break;
      }
      default:
        console.log("ℹ️ Unhandled event type:", event.type);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("💥 Webhook handler error:", err);
    return res.status(500).json({ error: "Webhook handler error" });
  }
};
