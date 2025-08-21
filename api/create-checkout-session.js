// api/create-checkout-session.js
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { line_items = [], customerEmail } = req.body || {};

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items,
      customer_email: customerEmail || undefined,
      success_url: `${req.headers.origin}/?success=true`,
      cancel_url: `${req.headers.origin}/?canceled=true`,
    });

    // 🔴 IMPORTANTE: ritorna sessionId, non url
    res.status(200).json({ sessionId: session.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
