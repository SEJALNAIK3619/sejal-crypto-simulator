const CACHE_NAME = 'sejal-crypto-v1';
const assets = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon.png"
];

// Ensure your install listener uses these relative assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(assets);
    })
  );
});
