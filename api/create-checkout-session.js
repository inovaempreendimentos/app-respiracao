const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Preços base. Valores em unidades menores da moeda (centavos), exceto moedas "zero decimal".
const PRICING_TIERS = {
  usd: { currency: 'usd', monthly: 690, yearly: 6900 },   // $6.90 / $69
  eur: { currency: 'eur', monthly: 690, yearly: 6900 },   // €6.90 / €69
  brl: { currency: 'brl', monthly: 990, yearly: 9900 },   // R$9,90 / R$99
};

// América do Sul: mesmo valor real do Brasil, convertido pra moeda local do país.
// EC (Equador) usa USD como moeda oficial, então usa o tier "usd" direto, sem conversão.
const LATAM_CURRENCY_MAP = { AR: 'ARS', CL: 'CLP', CO: 'COP', PE: 'PEN', UY: 'UYU', EC: 'USD' };
const ZERO_DECIMAL_CURRENCIES = ['clp'];

async function getConvertedAmount(targetCurrency, interval){
  const brlAmount = interval === 'year' ? PRICING_TIERS.brl.yearly : PRICING_TIERS.brl.monthly;
  const res = await fetch(`https://api.frankfurter.app/latest?from=BRL&to=${targetCurrency}`);
  const data = await res.json();
  const rate = data.rates && data.rates[targetCurrency];
  if(!rate) throw new Error('rate not found');
  const isZero = ZERO_DECIMAL_CURRENCIES.includes(targetCurrency.toLowerCase());
  const brlReais = brlAmount / 100;
  const converted = brlReais * rate;
  return isZero ? Math.round(converted) : Math.round(converted * 100);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const origin = req.headers.origin || `https://${req.headers.host}`;
    const body = req.body || {};
    const interval = body.interval === 'year' ? 'year' : 'month';
    const tier = body.tier;
    const country = body.country;

    let currency, amount;

    if (tier === 'latam' && country && LATAM_CURRENCY_MAP[country]) {
      const targetCurrency = LATAM_CURRENCY_MAP[country];
      if (targetCurrency === 'USD') {
        currency = 'usd';
        amount = interval === 'year' ? PRICING_TIERS.usd.yearly : PRICING_TIERS.usd.monthly;
      } else {
        try {
          currency = targetCurrency.toLowerCase();
          amount = await getConvertedAmount(targetCurrency, interval);
        } catch (e) {
          // Se a conversão falhar por qualquer motivo, cai em segurança pra cobrança direta em BRL.
          currency = 'brl';
          amount = interval === 'year' ? PRICING_TIERS.brl.yearly : PRICING_TIERS.brl.monthly;
        }
      }
    } else {
      const base = PRICING_TIERS[tier] ? PRICING_TIERS[tier] : PRICING_TIERS.brl;
      currency = base.currency;
      amount = interval === 'year' ? base.yearly : base.monthly;
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: currency,
            product_data: {
              name: 'A Arte de Respirar — Subscription',
              description: 'Full access to every guided breathing practice, with voice and ambient music.',
            },
            unit_amount: amount,
            recurring: { interval: interval },
          },
          quantity: 1,
        },
      ],
      success_url: `${origin}/?paid=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?canceled=1`,
      metadata: {
        projeto: 'arte-respirar',
        tier: tier || '',
        country: country || '',
        interval: interval,
      },
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
