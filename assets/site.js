/* ===================================
   MANETTE EN MAIN : COMPORTEMENTS DU SITE
   ===================================
   Tout est stocké dans le navigateur du visiteur (localStorage), rien ne part
   sur un serveur. Les clés :
   - theme, confort          : préférences d'affichage, partagées avec Clicked
                               (même adresse bloundsk.github.io, mêmes valeurs) ;
   - guide-coches:<jeu>      : cases cochées, écrites par les guides eux-mêmes
                               (exporter.py) : le site ne fait que les lire ;
   - gjv:favoris             : liste des jeux mis en favori ;
   - gjv:lectures            : dernier passage dans chaque guide (écrit par le
                               petit script ajouté aux copies des guides).
   Les données des jeux (titres, parties, nombre de cases) viennent de
   jeux.js, généré par outils/site.py. */
(function () {
  "use strict";

  var racine = document.documentElement;
  var BASE = racine.getAttribute("data-racine") || "";
  var GJV = window.GJV || { jeux: [] };
  var parSlug = {};
  GJV.jeux.forEach(function (j) { parSlug[j.slug] = j; });

  /* ---------- Stockage ---------- */
  function lire(cle, defaut) {
    try { var v = JSON.parse(localStorage.getItem(cle)); return v == null ? defaut : v; } catch (e) { return defaut; }
  }
  function ecrire(cle, valeur) {
    try { localStorage.setItem(cle, JSON.stringify(valeur)); } catch (e) { /* navigation privée : rien n'est mémorisé */ }
  }
  function echapper(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  function norm(s) { return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/œ/g, "oe").replace(/æ/g, "ae"); }

  /* ---------- Thème ---------- */
  var bTheme = document.getElementById("theme-toggle");
  function majIconeTheme() {
    if (!bTheme) return;
    var sombre = racine.classList.contains("dark-mode");
    bTheme.setAttribute("aria-pressed", String(sombre));
    bTheme.setAttribute("aria-label", sombre ? "Passer en thème clair" : "Passer en thème sombre");
    bTheme.title = sombre ? "Thème clair" : "Thème sombre";
  }
  majIconeTheme();
  if (bTheme) bTheme.addEventListener("click", function () {
    var sombre = racine.classList.toggle("dark-mode");
    try { localStorage.setItem("theme", sombre ? "dark" : "light"); } catch (e) {}
    majIconeTheme();
  });
  if (window.matchMedia) {
    var media = window.matchMedia("(prefers-color-scheme: dark)");
    var suivre = function (e) {
      var choix = null; try { choix = localStorage.getItem("theme"); } catch (er) {}
      if (choix) return;
      racine.classList.toggle("dark-mode", e.matches); majIconeTheme();
    };
    if (media.addEventListener) media.addEventListener("change", suivre); else if (media.addListener) media.addListener(suivre);
  }

  /* ---------- Confort de lecture ---------- */
  var CONFORT_MAX = { interligne: 2, espacement: 2, police: 1 };
  function lireConfort() {
    var brut = lire("confort", {}), net = { interligne: 0, espacement: 0, police: 0 };
    Object.keys(net).forEach(function (k) { var v = parseInt(brut[k], 10); if (v >= 1 && v <= CONFORT_MAX[k]) net[k] = v; });
    return net;
  }
  var confort = lireConfort();
  function appliquerConfort() {
    Object.keys(CONFORT_MAX).forEach(function (k) {
      for (var v = 1; v <= CONFORT_MAX[k]; v++) racine.classList.toggle("confort-" + k + "-" + v, confort[k] === v);
    });
    document.querySelectorAll(".confort-choix button").forEach(function (b) {
      b.setAttribute("aria-pressed", String(confort[b.dataset.confort] === parseInt(b.dataset.valeur, 10)));
    });
  }
  appliquerConfort();
  var panneau = document.querySelector(".confort");
  if (panneau) {
    panneau.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-confort]");
      if (!b) return;
      confort[b.dataset.confort] = parseInt(b.dataset.valeur, 10);
      appliquerConfort(); ecrire("confort", confort);
    });
    panneau.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && panneau.open) { panneau.open = false; panneau.querySelector("summary").focus(); }
    });
    document.addEventListener("click", function (e) { if (panneau.open && !panneau.contains(e.target)) panneau.open = false; });
  }

  /* ---------- Menu mobile et bouton « haut de page » ---------- */
  var bMenu = document.getElementById("menu-toggle"), nav = document.getElementById("nav");
  if (bMenu && nav) bMenu.addEventListener("click", function () {
    var ouvert = nav.classList.toggle("ouvert");
    bMenu.setAttribute("aria-expanded", String(ouvert));
  });
  var bHaut = document.getElementById("haut");
  if (bHaut) {
    window.addEventListener("scroll", function () { bHaut.classList.toggle("visible", window.scrollY > 700); }, { passive: true });
    bHaut.addEventListener("click", function () { window.scrollTo({ top: 0, behavior: "smooth" }); });
  }

  /* ---------- Favoris ---------- */
  function favoris() { var f = lire("gjv:favoris", []); return Array.isArray(f) ? f.filter(function (s) { return parSlug[s]; }) : []; }
  function majFavoris() {
    var f = favoris();
    document.querySelectorAll("[data-favori]").forEach(function (b) {
      var actif = f.indexOf(b.dataset.favori) !== -1, titre = (parSlug[b.dataset.favori] || {}).titre || "";
      b.setAttribute("aria-pressed", String(actif));
      b.setAttribute("aria-label", (actif ? "Retirer des favoris : " : "Ajouter aux favoris : ") + titre);
      b.title = actif ? "Retirer des favoris" : "Ajouter aux favoris";
      var lib = b.querySelector(".lib"); if (lib) lib.textContent = actif ? "Dans tes favoris" : "Ajouter aux favoris";
    });
    document.querySelectorAll(".btn-espace .pastille").forEach(function (p) { p.textContent = f.length ? String(f.length) : ""; });
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-favori]");
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    var f = favoris(), i = f.indexOf(b.dataset.favori);
    if (i === -1) f.push(b.dataset.favori); else f.splice(i, 1);
    ecrire("gjv:favoris", f); majFavoris();
    if (document.getElementById("espace")) rendreEspace();
  });
  majFavoris();

  /* ---------- Progression (lue dans les cases cochées des guides) ---------- */
  function progression(slug) {
    var j = parSlug[slug]; if (!j) return null;
    var etat = lire("guide-coches:" + slug, {}), brut = {};
    Object.keys(etat || {}).forEach(function (k) {
      if (etat[k] !== true) return;
      var s = k.split("|")[0]; brut[s] = (brut[s] || 0) + 1;
    });
    var faits = 0, parts = {}, finies = 0;
    j.parties.forEach(function (p) {
      var n = Math.min(brut[p.s] || 0, p.n); parts[p.s] = n; faits += n;
      if (p.n && n === p.n) finies++;
    });
    return { faits: faits, total: j.total, pct: j.total ? Math.round(faits / j.total * 100) : 0, parts: parts, finies: finies };
  }
  function lectures() { var l = lire("gjv:lectures", {}); return l && typeof l === "object" ? l : {}; }

  function majProgressions() {
    document.querySelectorAll("[data-prog]").forEach(function (el) {
      var p = progression(el.dataset.prog); if (!p) return;
      var toujours = el.hasAttribute("data-toujours");
      el.classList.toggle("active", toujours || p.faits > 0);
      var i = el.querySelector(".barre i"); if (i) i.style.width = p.pct + "%";
      var t = el.querySelector("small");
      if (t) t.innerHTML = "<span>" + p.faits + " / " + p.total + " objectifs cochés</span><span>" + p.pct + " %</span>";
    });
    var som = document.querySelector(".sommaire[data-jeu]");
    if (som) {
      var p = progression(som.dataset.jeu), j = parSlug[som.dataset.jeu];
      j.parties.forEach(function (part) {
        var li = som.querySelector('li[data-s="' + part.s + '"]'); if (!li) return;
        var n = p.parts[part.s] || 0, c = li.querySelector(".c");
        if (c && part.n) c.textContent = n + " / " + part.n;
        li.classList.toggle("fini", part.n > 0 && n === part.n);
        li.classList.toggle("encours", n > 0 && n < part.n);
      });
    }
  }
  majProgressions();
  window.addEventListener("storage", function () { majProgressions(); majFavoris(); });

  /* ---------- « Reprendre ta partie » ---------- */
  function jeuxCommences() {
    var lec = lectures();
    return GJV.jeux.map(function (j) {
      var p = progression(j.slug), l = lec[j.slug];
      return { j: j, p: p, l: l, t: l ? l.t : 0 };
    }).filter(function (x) { return x.p.faits > 0 || x.l; })
      .sort(function (a, b) { return b.t - a.t || b.p.pct - a.p.pct; });
  }
  function carteReprise(x) {
    var partie = x.l && x.l.a ? x.j.parties.filter(function (p) { return p.a === x.l.a; })[0] : null;
    var url = BASE + x.j.guide + (partie ? "#" + partie.a : "");
    var sous = partie ? "Reprendre à : " + partie.t : (x.p.faits ? x.p.faits + " objectifs cochés" : "Ouvrir le guide");
    return '<a class="reprise" href="' + url + '" style="--c1:' + x.j.c1 + ";--c2:" + x.j.c2 + '">' +
      '<span class="emoji" aria-hidden="true">' + x.j.emoji + "</span><div><b>" + echapper(x.j.titre) + "</b><span>" +
      echapper(sous) + '</span><div class="barre"><i style="width:' + x.p.pct + '%"></i></div></div></a>';
  }
  var zoneReprise = document.getElementById("reprises");
  if (zoneReprise) {
    var liste = jeuxCommences().slice(0, 6);
    if (liste.length) {
      zoneReprise.querySelector(".reprises").innerHTML = liste.map(carteReprise).join("");
      zoneReprise.hidden = false;
    }
  }

  /* ---------- Catalogue : filtres, tri, recherche ---------- */
  var cat = document.getElementById("catalogue");
  if (cat) {
    var champ = cat.querySelector("input[type=search]"), tri = cat.querySelector("select"),
        grille = cat.querySelector(".grille"), vide = cat.querySelector(".vide"), tag = "",
        cartes = Array.prototype.slice.call(grille.querySelectorAll(".carte"));
    var params = new URLSearchParams(location.search);
    if (params.get("genre")) tag = params.get("genre");
    if (params.get("q")) champ.value = params.get("q");
    var appliquer = function () {
      var q = norm(champ.value.trim()), n = 0;
      cat.querySelectorAll(".puces-filtre button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.tag === tag)); });
      cartes.forEach(function (c) {
        var ok = (!tag || c.dataset.tags.split("|").indexOf(tag) !== -1) && (!q || norm(c.dataset.texte).indexOf(q) !== -1);
        c.hidden = !ok; if (ok) n++;
      });
      vide.classList.toggle("visible", n === 0);
      var cle = tri.value;
      cartes.slice().sort(function (a, b) {
        if (cle === "recent") return b.dataset.ajout.localeCompare(a.dataset.ajout);
        if (cle === "long") return b.dataset.pages - a.dataset.pages;
        if (cle === "annee") return b.dataset.annee - a.dataset.annee;
        if (cle === "progression") return (progression(b.dataset.slug).pct - progression(a.dataset.slug).pct);
        return a.dataset.titre.localeCompare(b.dataset.titre, "fr");
      }).forEach(function (c) { grille.appendChild(c); });
    };
    cat.querySelector(".puces-filtre").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      tag = b.dataset.tag; appliquer();
    });
    champ.addEventListener("input", appliquer);
    tri.addEventListener("change", appliquer);
    appliquer();
  }

  /* ---------- Mon espace ---------- */
  function rendreEspace() {
    var zone = document.getElementById("espace"); if (!zone) return;
    var f = favoris(), commences = jeuxCommences(), totalFaits = 0, totalFinies = 0;
    commences.forEach(function (x) { totalFaits += x.p.faits; totalFinies += x.p.finies; });
    zone.querySelector('[data-tuile="favoris"]').textContent = f.length;
    zone.querySelector('[data-tuile="commences"]').textContent = commences.length;
    zone.querySelector('[data-tuile="objectifs"]').textContent = totalFaits.toLocaleString("fr-FR");
    zone.querySelector('[data-tuile="parties"]').textContent = totalFinies;

    var grilleFav = zone.querySelector("#mes-favoris .grille"), n = 0;
    grilleFav.querySelectorAll(".carte").forEach(function (c) { var ok = f.indexOf(c.dataset.slug) !== -1; c.hidden = !ok; if (ok) n++; });
    zone.querySelector("#mes-favoris .message-vide").hidden = n > 0;

    var prog = zone.querySelector("#ma-progression .lignes");
    prog.innerHTML = commences.map(function (x) {
      var lec = x.l && x.l.t ? "Dernière lecture le " + new Date(x.l.t).toLocaleDateString("fr-FR", { day: "numeric", month: "long" }) : "";
      var partie = x.l && x.l.a ? x.j.parties.filter(function (p) { return p.a === x.l.a; })[0] : null;
      return '<div class="ligne-prog" style="--c1:' + x.j.c1 + ";--c2:" + x.j.c2 + '"><span class="emoji" aria-hidden="true">' + x.j.emoji +
        '</span><div><h3><a href="' + BASE + x.j.fiche + '">' + echapper(x.j.titre) + '</a></h3><p class="sous">' +
        x.p.faits + " / " + x.p.total + " objectifs · " + x.p.finies + " / " + x.j.parties.filter(function (p) { return p.n; }).length +
        " parties terminées" + (lec ? " · " + lec : "") + '</p><div class="barre"><i style="width:' + x.p.pct + '%"></i></div>' +
        '<div class="liens"><a href="' + BASE + x.j.guide + (partie ? "#" + partie.a : "") + '">' + (partie ? "Reprendre : " + echapper(partie.t) : "Ouvrir le guide") +
        '</a><a href="' + BASE + x.j.fiche + '#sommaire">Voir le détail par partie</a></div></div></div>';
    }).join("");
    zone.querySelector("#ma-progression .message-vide").hidden = commences.length > 0;
  }
  var espace = document.getElementById("espace");
  if (espace) {
    rendreEspace();
    espace.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-action]"); if (!b) return;
      var action = b.dataset.action;
      if (action === "exporter") {
        var donnees = { site: "manette-en-main", version: 1, date: new Date().toISOString(), cles: {} };
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (/^(gjv:|guide-coches:)/.test(k)) donnees.cles[k] = localStorage.getItem(k);
        }
        var blob = new Blob([JSON.stringify(donnees, null, 1)], { type: "application/json" });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "manette-en-main-progression-" + new Date().toISOString().slice(0, 10) + ".json";
        document.body.appendChild(a); a.click(); a.remove();
      } else if (action === "importer") {
        espace.querySelector("#fichier-import").click();
      } else if (action === "effacer") {
        if (!window.confirm("Effacer tes favoris et toutes les cases cochées de tous les guides ? Cette action ne peut pas être annulée.")) return;
        var aSuppr = [];
        for (var j = 0; j < localStorage.length; j++) { var c = localStorage.key(j); if (/^(gjv:|guide-coches:)/.test(c)) aSuppr.push(c); }
        aSuppr.forEach(function (c) { localStorage.removeItem(c); });
        rendreEspace(); majFavoris(); annoncer("Tout a été effacé.");
      }
    });
    espace.querySelector("#fichier-import").addEventListener("change", function (e) {
      var fichier = e.target.files[0]; if (!fichier) return;
      var lecteur = new FileReader();
      lecteur.onload = function () {
        try {
          var d = JSON.parse(lecteur.result);
          if (!d || d.site !== "manette-en-main" || typeof d.cles !== "object") throw new Error("format");
          var n = 0;
          Object.keys(d.cles).forEach(function (k) {
            if (/^(gjv:|guide-coches:)/.test(k) && typeof d.cles[k] === "string") { localStorage.setItem(k, d.cles[k]); n++; }
          });
          rendreEspace(); majFavoris(); annoncer("Progression importée : " + n + " éléments restaurés.");
        } catch (er) { annoncer("Ce fichier n'est pas une sauvegarde de Manette en main."); }
        e.target.value = "";
      };
      lecteur.readAsText(fichier);
    });
  }
  function annoncer(msg) {
    var z = document.getElementById("annonce"); if (!z) { window.alert(msg); return; }
    z.textContent = msg; z.hidden = false;
    clearTimeout(annoncer.t); annoncer.t = setTimeout(function () { z.hidden = true; }, 6000);
  }

  /* ---------- Application et lecture hors connexion ----------
     sw.js (généré par outils/site.py) garde les pages du site et chaque guide ouvert.
     Les guides gardés vivent dans le cache « gjv-guides » : on peut en ajouter un depuis
     sa fiche sans l'ouvrir, et les retirer depuis Mon espace. */
  var CACHE_GUIDES = "gjv-guides";
  var swOk = "serviceWorker" in navigator && "caches" in window && (location.protocol === "https:" || location.hostname === "localhost");
  if (swOk) navigator.serviceWorker.register(BASE + "sw.js").catch(function () {});
  function urlAbsolue(u) { var x = new URL(u, location.href); return x.origin + x.pathname; }
  function estGarde(u) {
    return caches.open(CACHE_GUIDES).then(function (c) { return c.match(urlAbsolue(u)); }).then(function (r) { return !!r; });
  }
  function enMo(octets) { return (octets / 1048576).toFixed(1).replace(".", ",") + " Mo"; }

  document.querySelectorAll("[data-hors-ligne]").forEach(function (b) {
    if (!swOk) return;
    var url = b.getAttribute("data-hors-ligne"), lib = b.querySelector(".lib"), info = b.parentNode.querySelector(".hl-info");
    function maj(garde) {
      b.hidden = false; b.disabled = false;
      b.setAttribute("aria-pressed", String(garde));
      lib.textContent = garde ? "Retirer de cet appareil" : "Garder hors connexion";
      if (info) info.textContent = garde ? "✓ Ce guide est gardé sur cet appareil : il s'ouvre même sans réseau." : "";
    }
    estGarde(url).then(maj);
    b.addEventListener("click", function () {
      b.disabled = true;
      estGarde(url).then(function (garde) {
        if (garde) return caches.open(CACHE_GUIDES).then(function (c) { return c.delete(urlAbsolue(url)); }).then(function () { maj(false); });
        lib.textContent = "Téléchargement…";
        return fetch(url, { cache: "no-cache" }).then(function (rep) {
          if (!rep.ok) throw new Error(rep.status);
          return caches.open(CACHE_GUIDES).then(function (c) { return c.put(urlAbsolue(url), rep); });
        }).then(function () { maj(true); }, function () { maj(false); if (info) info.textContent = "Le téléchargement a échoué : vérifie ta connexion et réessaie."; });
      });
    });
  });

  function rendreHorsLigne() {
    var listes = document.querySelectorAll("[data-liste-hors-ligne]");
    if (!listes.length) return;
    var zoneVide = function (l, vide) { var m = l.parentNode.querySelector(".message-vide"); if (m) m.hidden = !vide; };
    if (!("caches" in window)) { listes.forEach(function (l) { zoneVide(l, true); }); return; }
    caches.open(CACHE_GUIDES).then(function (c) {
      return c.keys().then(function (reqs) {
        return Promise.all(reqs.map(function (r) {
          return c.match(r).then(function (rep) { return rep ? rep.blob() : null; }).then(function (b) { return { url: r.url, taille: b ? b.size : 0 }; });
        }));
      });
    }).then(function (gardes) {
      var lignes = gardes.map(function (g) {
        var m = new URL(g.url).pathname.match(/\/guides\/([^\/]+)\/([^\/]+)\.html$/), j = m && parSlug[m[1]];
        if (!j) return "";
        var variante = /-compact$/.test(m[2]) ? " · version compacte" : /-express$/.test(m[2]) ? " · version express" : "";
        return '<div class="ligne-prog" style="--c1:' + j.c1 + ";--c2:" + j.c2 + '"><span class="emoji" aria-hidden="true">' + j.emoji +
          '</span><div><h3><a href="' + echapper(g.url) + '">' + echapper(j.titre) + variante + '</a></h3><p class="sous">Gardé sur cet appareil · ' +
          enMo(g.taille) + '</p><div class="liens"><a href="' + echapper(g.url) + '">Ouvrir</a>' +
          '<button type="button" class="lien-bouton" data-retirer="' + echapper(g.url) + '">Retirer de l\'appareil</button></div></div></div>';
      }).filter(Boolean);
      listes.forEach(function (l) { l.innerHTML = lignes.join(""); zoneVide(l, !lignes.length); });
    });
  }
  rendreHorsLigne();
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-retirer]");
    if (!b) return;
    caches.open(CACHE_GUIDES).then(function (c) { return c.delete(b.getAttribute("data-retirer")); }).then(rendreHorsLigne);
  });

  // Bouton « Installer l'application » (Chrome, Edge, Android) ; sur iPhone, le texte d'aide suffit.
  var invite = null;
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault(); invite = e;
    document.querySelectorAll("[data-installer]").forEach(function (b) { b.hidden = false; });
  });
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-installer]");
    if (!b || !invite) return;
    invite.prompt();
    invite.userChoice.then(function () { invite = null; b.hidden = true; });
  });
  window.addEventListener("appinstalled", function () {
    document.querySelectorAll("[data-installer]").forEach(function (b) { b.hidden = true; });
  });

  /* ---------- Signaler une erreur (fiche du jeu) ----------
     Ouvre la messagerie avec un message prérempli ; l'adresse n'est pas écrite en clair dans la page. */
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-signaler]");
    if (!b) return;
    var jeu = b.getAttribute("data-signaler"), a = "docmaster.contact" + String.fromCharCode(64) + "proton.me";
    var corps = "Guide : " + jeu + "\nPartie : \nPage : " + location.href +
      "\n\nCe que dit le guide :\n\n\nCe que je vois à l'écran :\n\n\nPlateforme et version du jeu (si tu la connais) :\n";
    location.href = "mailto:" + a + "?subject=" + encodeURIComponent("Erreur dans le guide " + jeu) + "&body=" + encodeURIComponent(corps);
  });

  /* ---------- Recherche globale ---------- */
  var index = null, chargement = null;
  function chargerIndex() {
    if (index) return Promise.resolve(index);
    if (!chargement) chargement = fetch(BASE + "assets/recherche.json").then(function (r) { return r.json(); }).then(function (d) {
      index = d.map(function (e) { return { type: e[0], t: e[1], s: e[2], g: e[3], a: e[4], n: norm(e[1]), ns: norm(e[2] || "") }; });
      return index;
    });
    return chargement;
  }
  var fond = document.createElement("div");
  fond.className = "recherche-fond";
  fond.innerHTML = '<div class="recherche-boite" role="dialog" aria-modal="true" aria-label="Recherche dans tous les guides">' +
    '<div class="recherche-champ"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' +
    '<input type="search" placeholder="Un jeu, une zone, un boss, un objet…" aria-label="Rechercher" autocomplete="off" spellcheck="false">' +
    '<button type="button" aria-label="Fermer la recherche"><kbd>Échap</kbd></button></div>' +
    '<div class="resultats" role="listbox"></div>' +
    '<div class="recherche-pied"><span><kbd>↑</kbd> <kbd>↓</kbd> naviguer</span><span><kbd>Entrée</kbd> ouvrir</span><span><kbd>/</kbd> rechercher depuis n\'importe quelle page</span></div></div>';
  document.body.appendChild(fond);
  var rChamp = fond.querySelector("input"), rRes = fond.querySelector(".resultats"), dernierFocus = null;

  function ouvrirRecherche(texte) {
    dernierFocus = document.activeElement;
    fond.classList.add("ouvert"); document.body.style.overflow = "hidden";
    if (typeof texte === "string") rChamp.value = texte;
    rChamp.focus(); rChamp.select();
    rRes.innerHTML = '<p class="info">Chargement de l\'index…</p>';
    chargerIndex().then(chercher, function () { rRes.innerHTML = '<p class="info">L\'index de recherche n\'a pas pu être chargé.</p>'; });
  }
  function fermerRecherche() {
    fond.classList.remove("ouvert"); document.body.style.overflow = "";
    if (dernierFocus && dernierFocus.focus) dernierFocus.focus();
  }
  function surligner(texte, q) {
    if (!q) return echapper(texte);
    var n = norm(texte), i = n.indexOf(q);
    if (i === -1) return echapper(texte);
    return echapper(texte.slice(0, i)) + "<mark>" + echapper(texte.slice(i, i + q.length)) + "</mark>" + echapper(texte.slice(i + q.length));
  }
  function chercher() {
    if (!index) return;
    var brut = rChamp.value.trim(), q = norm(brut), mots = q.split(/\s+/).filter(Boolean);
    if (!mots.length) {
      rRes.innerHTML = '<p class="info">Cherche dans les ' + GJV.jeux.length + " guides : un jeu, une zone, un boss, une arme, un objet… " +
        "Les résultats t'emmènent directement à la bonne partie du guide.</p>";
      return;
    }
    var groupes = { j: [], p: [], o: [] }, LIM = { j: 6, p: 10, o: 30 };
    for (var i = 0; i < index.length; i++) {
      var e = index[i], ok = true, dansTitre = false;
      for (var m = 0; m < mots.length; m++) {
        if (e.n.indexOf(mots[m]) !== -1) dansTitre = true;
        else if (e.ns.indexOf(mots[m]) === -1) { ok = false; break; }
      }
      // au moins un mot doit figurer dans le nom lui-même (sauf pour un jeu, cherchable par genre)
      if (!ok || (!dansTitre && e.type !== "j")) continue;
      var score = e.n === q ? 0 : e.n.indexOf(q) === 0 ? 1 : (" " + e.n).indexOf(" " + mots[0]) !== -1 ? 2 : e.n.indexOf(q) !== -1 ? 3 : 4;
      groupes[e.type].push({ e: e, score: score });
    }
    var titres = { j: "Jeux", p: "Parties de guide", o: "Objets, équipements et butin" }, html = "", total = 0;
    ["j", "p", "o"].forEach(function (t) {
      var l = groupes[t].sort(function (a, b) { return a.score - b.score || a.e.t.length - b.e.t.length; });
      if (!l.length) return;
      total += l.length;
      html += "<h4>" + titres[t] + (l.length > LIM[t] ? " · " + LIM[t] + " sur " + l.length : "") + "</h4>";
      l.slice(0, LIM[t]).forEach(function (r) {
        var j = GJV.jeux[r.e.g], url = BASE + (r.e.type === "j" ? j.fiche : j.guide + (r.e.a ? "#" + r.e.a : ""));
        var sous = r.e.type === "j" ? r.e.s : j.titre + (r.e.s ? " · " + r.e.s : "");
        html += '<a href="' + url + '" role="option"><span class="e" aria-hidden="true">' + j.emoji + "</span><span><b>" +
          surligner(r.e.t, q) + "</b><small>" + echapper(sous) + "</small></span></a>";
      });
    });
    rRes.innerHTML = total ? html : '<p class="info">Rien trouvé pour « ' + echapper(brut) + " ». Essaie un mot plus court, ou le nom anglais entre parenthèses dans les guides.</p>";
    var premier = rRes.querySelector("a"); if (premier) premier.classList.add("actif");
  }
  rChamp.addEventListener("input", chercher);
  rChamp.addEventListener("keydown", function (e) {
    var liens = Array.prototype.slice.call(rRes.querySelectorAll("a")), i = liens.indexOf(rRes.querySelector("a.actif"));
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault(); if (!liens.length) return;
      if (i !== -1) liens[i].classList.remove("actif");
      i = e.key === "ArrowDown" ? Math.min(i + 1, liens.length - 1) : Math.max(i - 1, 0);
      liens[i].classList.add("actif"); liens[i].scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && i !== -1) { e.preventDefault(); location.href = liens[i].href; }
  });
  fond.addEventListener("click", function (e) { if (e.target === fond || e.target.closest(".recherche-champ button")) fermerRecherche(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && fond.classList.contains("ouvert")) { fermerRecherche(); return; }
    var cible = e.target, saisie = cible && (cible.tagName === "INPUT" || cible.tagName === "TEXTAREA" || cible.tagName === "SELECT" || cible.isContentEditable);
    if ((e.key === "/" && !saisie) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k")) { e.preventDefault(); ouvrirRecherche(); }
  });
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-ouvrir-recherche]");
    if (b) { e.preventDefault(); ouvrirRecherche(b.dataset.requete); }
  });
})();
