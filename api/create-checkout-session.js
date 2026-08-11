const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Tabela de preços por força de moeda. Mantida no servidor (não confia no valor vindo do
// navegador) pra ninguém conseguir manipular o preço pelo DevTools.
const PRICING_TIERS = {
  usd: { currency: 'usd', amount: 990 },  // $9.90 — moeda forte (EUA, Europa Ocidental, etc.)
  brl: { currency: 'brl', amount: 1490 }, // R$ 14,90 — Brasil e resto da América Latina
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const origin = req.headers.origin || `https://${req.headers.host}`;
    const body = req.body || {};
    const tier = PRICING_TIERS[body.tier] ? body.tier : 'brl';
    const price = PRICING_TIERS[tier];

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: price.currency,
            product_data: {
              name: 'A Arte de Respirar — Subscription',
              description: 'Full access to every guided breathing practice, with voice and ambient music.',
            },
            unit_amount: price.amount,
            recurring: { interval: 'month' },
          },
          quantity: 1,
        },
      ],
      success_url: `${origin}/?paid=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?canceled=1`,
      metadata: {
        projeto: 'arte-respirar',
        tier: tier,
      },
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


