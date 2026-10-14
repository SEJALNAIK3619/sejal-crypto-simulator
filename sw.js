self.addEventListener('fetch', (event) => {
  // A minimal fetch handler is required for PWA installation
  event.respondWith(fetch(event.request));
});
