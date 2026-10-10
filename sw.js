/* Service worker de Manette en main, généré par outils/site.py : ne pas modifier à la main.
   - pages et ressources du site : gardées à l'installation (cache « gjv-coquille-<version> ») ;
   - guides : gardés à chaque ouverture (cache « gjv-guides », conservé d'une version à l'autre) ;
   - pages : réseau d'abord (pour avoir la dernière version), copie gardée si le réseau manque ou traîne ;
   - PDF : jamais mis en cache (trop lourds ; on les télécharge). */
var VERSION = "0e542e4e6b", COQUILLE = "gjv-coquille-" + VERSION, GUIDES = "gjv-guides";
var PORTEE = new URL("./", self.location).pathname;
var PRECACHE = ["./", "index.html", "guides.html", "mon-espace.html", "a-propos.html", "faq.html", "mentions-legales.html", "plan-du-site.html", "hors-ligne.html", "404.html", "site.webmanifest", "assets/recherche.json", "assets/favicon.svg", "assets/icone-192.png", "assets/fonts/inter-latin.woff2", "assets/fonts/inter-latin-ext.woff2", "assets/fonts/literata-700-latin.woff2", "guides/cyberpunk-2077/index.html", "guides/dark-souls-3/index.html", "guides/elden-ring/index.html", "guides/final-fantasy-ix/index.html", "guides/final-fantasy-vii/index.html", "guides/final-fantasy-vii-rebirth/index.html", "guides/final-fantasy-vii-remake/index.html", "guides/final-fantasy-x/index.html", "guides/hogwarts-legacy/index.html", "guides/octopath-traveler-2/index.html", "guides/pokemon-pokopia/index.html", "guides/spiritfarer/index.html", "guides/super-mario-odyssey/index.html", "assets/jaquettes/cyberpunk-2077.jpg", "assets/jaquettes/dark-souls-3.jpg", "assets/jaquettes/elden-ring.jpg", "assets/jaquettes/final-fantasy-ix.jpg", "assets/jaquettes/final-fantasy-vii.jpg", "assets/jaquettes/final-fantasy-vii-rebirth.jpg", "assets/jaquettes/final-fantasy-vii-remake.jpg", "assets/jaquettes/final-fantasy-x.jpg", "assets/jaquettes/hogwarts-legacy.jpg", "assets/jaquettes/octopath-traveler-2.jpg", "assets/jaquettes/pokemon-pokopia.jpg", "assets/jaquettes/spiritfarer.jpg", "assets/jaquettes/super-mario-odyssey.jpg", "assets/style.css?v=266d232d", "assets/site.js?v=152708e0", "assets/jeux.js?v=855e1140"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(COQUILLE).then(function (c) { return c.addAll(PRECACHE); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (cles) {
    return Promise.all(cles.filter(function (k) { return k.indexOf("gjv-coquille-") === 0 && k !== COQUILLE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function estGuide(chemin) { return /\/guides\/[^\/]+\/[^\/]+\.html$/.test(chemin); }
function cle(url) { return url.origin + url.pathname + (url.pathname.slice(-1) === "/" ? "index.html" : ""); }
function enCache(k) {
  return caches.match(k).then(function (r) { return r || (k.slice(-10) === "index.html" ? caches.match(k.slice(0, -10)) : r); });
}

function page(req, url) {
  var k = cle(url), nom = estGuide(url.pathname) ? GUIDES : COQUILLE;
  var reseau = fetch(req).then(function (rep) {
    if (rep.ok) { var copie = rep.clone(); caches.open(nom).then(function (c) { c.put(k, copie); }); }
    return rep;
  });
  // Réseau lent : au bout de 4 s, la copie gardée s'affiche (le réseau continue de la mettre à jour).
  var delai = new Promise(function (ok) { setTimeout(ok, 4000); }).then(function () {
    return enCache(k).then(function (r) { return r || reseau; });
  });
  return Promise.race([reseau, delai]).catch(function () {
    return enCache(k).then(function (r) { return r || caches.match(PORTEE + "hors-ligne.html"); });
  });
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.indexOf(PORTEE) !== 0 || /\.pdf$/i.test(url.pathname)) return;
  if (req.mode === "navigate") { e.respondWith(page(req, url)); return; }
  e.respondWith(caches.match(req).then(function (r) {
    return r || fetch(req).then(function (rep) {
      if (rep.ok && /\/assets\//.test(url.pathname)) { var copie = rep.clone(); caches.open(COQUILLE).then(function (c) { c.put(req, copie); }); }
      else if (rep.ok && /\/guides\/.+\.(jpe?g|png|webp)$/i.test(url.pathname)) { var img = rep.clone(); caches.open(GUIDES).then(function (c) { c.put(req, img); }); }
      return rep;
    });
  }));
});
