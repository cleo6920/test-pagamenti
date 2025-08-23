<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Test Checkout</title>
</head>
<body>
  <h1>Test Checkout</h1>
  <p>Premi il bottone: invia prodotti reali all’API e vai a Stripe.</p>
  <button id="go">Procedi al pagamento (test)</button>

  <script>
    document.getElementById('go').addEventListener('click', async () => {
      try {
        const resp = await fetch('/api/create-checkout-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: [
              { name: "Miele di Castagno (12×250g)", amount: 100.00, quantity: 1 },
              { name: "Spedizione", amount: 10.00, quantity: 1 } // verrà ignorata se hai messo shipping_options
            ]
          })
        });
        const data = await resp.json();
        if (data.url) window.location.href = data.url;
        else alert('Errore: ' + (data.error || 'risposta senza URL'));
      } catch (e) {
        alert('Eccezione: ' + e.message);
      }
    });
  </script>
</body>
</html>

