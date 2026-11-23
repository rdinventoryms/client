// Inventory runs remotely. Only provide a message if the app entry page cannot load.
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);
  if (request.mode !== 'navigate' || url.origin !== scope.origin ||
      ![scope.pathname, scope.pathname + 'index.html'].includes(url.pathname)) return;

  event.respondWith(fetch(request).catch(() => new Response(
    '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Remourà Inventory</title><main style="max-width:30rem;margin:3rem auto;padding:1rem;font:1rem system-ui">' +
    '<h1>Remourà Inventory</h1><p>Connect to the internet to open your inventory workspace.</p>' +
    '<a href="./">Try again</a></main></html>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  )));
});
