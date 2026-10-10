/* Comptes facultatifs « Manette en main » : connexion (e-mail + mot de passe, ou Google) et
   synchronisation de la progression entre appareils, via Firebase (Auth + Firestore lite).

   - Rien ne se charge tant que window.GJV_FIREBASE (assets/firebase-config.js) est vide :
     le site fonctionne alors exactement comme avant, sans compte.
   - Ce qui est synchronisé : les clés du stockage local « gjv:… » et « guide-coches:… »
     (favoris, cases cochées, dernière partie lue, guides hors connexion), comme l'export de Mon espace.
   - Un document par utilisateur : progression/{uid} = { cles: {clé: valeur}, maj: {clé: horodatage} }.
     À chaque clé, la modification la plus récente l'emporte ; sans date connue (première connexion
     sur un appareil déjà utilisé), les cases cochées, favoris et lectures sont fusionnés. */
const CONFIG = window.GJV_FIREBASE;
const MOTIF = /^(gjv:|guide-coches:)/;
const K_MAJ = "gjv-sync:maj";          // horodatage local de chaque clé modifiée
const K_COMPTE = "gjv-sync:compte";    // dernier uid connecté sur cet appareil
const SDK = "https://www.gstatic.com/firebasejs/10.12.2/";

function lireJSON(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
function ecrireBrut(k, v) { try { if (v == null) Storage.prototype.removeItem.call(localStorage, k); else Storage.prototype.setItem.call(localStorage, k, v); } catch (e) {} }

if (CONFIG && CONFIG.apiKey) demarrer().catch(e => console.warn("Compte indisponible :", e));

async function demarrer() {
  const [{ initializeApp }, A, F] = await Promise.all([
    import(SDK + "firebase-app.js"), import(SDK + "firebase-auth.js"), import(SDK + "firebase-firestore-lite.js")]);
  const app = initializeApp(CONFIG);
  const auth = A.getAuth(app);
  auth.languageCode = "fr";
  const db = F.getFirestore(app);
  let utilisateur = null, minuteur = null, dernierEnvoi = null, enCours = false;

  // --- suivi des modifications locales (pour savoir quelle version est la plus récente)
  const setOrig = Storage.prototype.setItem, rmOrig = Storage.prototype.removeItem;
  function noter(k) {
    if (!MOTIF.test(k)) return;
    const maj = lireJSON(K_MAJ, {}); maj[k] = Date.now();
    setOrig.call(localStorage, K_MAJ, JSON.stringify(maj));
    if (utilisateur) { clearTimeout(minuteur); minuteur = setTimeout(envoyer, 2500); }
  }
  Storage.prototype.setItem = function (k, v) { setOrig.call(this, k, v); if (this === localStorage) noter(String(k)); };
  Storage.prototype.removeItem = function (k) { rmOrig.call(this, k); if (this === localStorage) noter(String(k)); };

  function etatLocal() {
    const cles = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (MOTIF.test(k)) cles[k] = localStorage.getItem(k); }
    return { cles, maj: lireJSON(K_MAJ, {}) };
  }

  function fusionnerSansDate(k, a, b) {   // a = local, b = distant, chaînes JSON
    try {
      const x = JSON.parse(a), y = JSON.parse(b);
      if (k.startsWith("guide-coches:") && x && y && typeof x === "object") {
        const r = Object.assign({}, y); for (const c in x) if (x[c]) r[c] = true; return JSON.stringify(r);
      }
      if (k === "gjv:favoris" && Array.isArray(x) && Array.isArray(y)) return JSON.stringify([...new Set([...y, ...x])]);
      if (k === "gjv:lectures" && x && y) {
        const r = Object.assign({}, y); for (const g in x) if (!r[g] || (x[g].t || 0) > (r[g].t || 0)) r[g] = x[g]; return JSON.stringify(r);
      }
    } catch (e) {}
    return b;
  }

  // Fusionne le document distant dans le stockage local ; renvoie les clés modifiées localement.
  function appliquer(distant) {
    const local = etatLocal(), changees = [];
    const rc = (distant && distant.cles) || {}, rm = (distant && distant.maj) || {};
    const toutes = new Set([...Object.keys(local.cles), ...Object.keys(rc), ...Object.keys(rm)]);
    const maj = local.maj;
    toutes.forEach(k => {
      if (!MOTIF.test(k)) return;
      const tl = local.maj[k] || 0, td = rm[k] || 0;
      const vl = k in local.cles ? local.cles[k] : null, vd = k in rc ? rc[k] : null;
      let v = vl;
      if (td > tl) v = vd;
      else if (!tl && !td && vl != null && vd != null) v = fusionnerSansDate(k, vl, vd);
      else if (vl == null && vd != null && !tl) v = vd;
      if (v !== vl) { ecrireBrut(k, v); changees.push(k); }
      if (td > tl) maj[k] = td;
    });
    setOrig.call(localStorage, K_MAJ, JSON.stringify(maj));
    return changees;
  }

  async function recevoir() {
    const snap = await F.getDoc(F.doc(db, "progression", utilisateur.uid));
    return appliquer(snap.exists() ? snap.data() : null);
  }

  async function envoyer() {
    if (!utilisateur || enCours) return;
    enCours = true; afficherEtat("Synchronisation…");
    try {
      const { cles, maj } = etatLocal();
      // les suppressions voyagent aussi : une clé datée mais absente est envoyée vide
      for (const k in maj) if (!(k in cles) && MOTIF.test(k)) cles[k] = null;
      await F.setDoc(F.doc(db, "progression", utilisateur.uid), { cles, maj, appareil: navigator.userAgent.slice(0, 120), le: Date.now() });
      dernierEnvoi = new Date(); afficherEtat();
    } catch (e) { afficherEtat("Échec de la synchronisation : " + messageErreur(e)); }
    enCours = false;
  }

  async function synchroniser(recharger) {
    if (!utilisateur) return;
    try {
      const changees = await recevoir();
      await envoyer();
      // la page a lu le stockage à son chargement : on la recharge une fois si sa progression a changé
      if (recharger && changees.length && !sessionStorage.getItem("gjv-sync:recharge")) {
        sessionStorage.setItem("gjv-sync:recharge", "1"); location.reload(); return;
      }
    } catch (e) { afficherEtat("Échec de la synchronisation : " + messageErreur(e)); }
    sessionStorage.removeItem("gjv-sync:recharge");
  }

  // --- interface
  const style = document.createElement("style");
  style.textContent = `
.gjv-c-btn{font:600 13px/1 system-ui,sans-serif;cursor:pointer;border-radius:999px;padding:7px 12px;border:1px solid rgba(127,140,150,.45);background:transparent;color:inherit;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.gjv-c-btn:hover{border-color:#4fd6c8}
.gjv-c-fond{position:fixed;inset:0;z-index:10000;background:rgba(5,10,16,.72);display:flex;align-items:center;justify-content:center;padding:16px}
.gjv-c-boite{width:100%;max-width:400px;background:#101f30;color:#dfeef0;border:1px solid rgba(79,214,200,.35);border-radius:14px;padding:22px;font:15px/1.5 system-ui,sans-serif;box-shadow:0 20px 50px rgba(0,0,0,.5);max-height:calc(100vh - 32px);overflow:auto}
.gjv-c-boite h2{margin:0 0 4px;font:600 20px/1.3 system-ui,sans-serif;color:#f2f8f6}
.gjv-c-boite p{margin:.4rem 0;color:#c4d7db;font-size:14px}
.gjv-c-onglets{display:flex;gap:6px;margin:14px 0}
.gjv-c-onglets button{flex:1;padding:8px;border-radius:8px;border:1px solid rgba(133,196,196,.25);background:none;color:#8ea8b0;cursor:pointer;font:600 14px system-ui,sans-serif}
.gjv-c-onglets button[aria-pressed=true]{background:rgba(79,214,200,.12);color:#4fd6c8;border-color:#2a8f86}
.gjv-c-boite label{display:block;font-size:13px;color:#8ea8b0;margin:10px 0 4px}
.gjv-c-boite input{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;border:1px solid rgba(133,196,196,.3);background:#0a1420;color:#f2f8f6;font:15px system-ui,sans-serif}
.gjv-c-boite input:focus{outline:2px solid #4fd6c8;outline-offset:1px}
.gjv-c-principal,.gjv-c-second{width:100%;margin-top:14px;padding:11px;border-radius:9px;font:600 15px system-ui,sans-serif;cursor:pointer}
.gjv-c-principal{background:#4fd6c8;color:#0a1420;border:0}
.gjv-c-second{background:none;color:#dfeef0;border:1px solid rgba(133,196,196,.35)}
.gjv-c-lien{background:none;border:0;color:#4fd6c8;cursor:pointer;padding:0;font:inherit;font-size:13px;margin-top:8px}
.gjv-c-ou{display:flex;align-items:center;gap:10px;color:#5c7379;font-size:12px;margin:14px 0 0}.gjv-c-ou::before,.gjv-c-ou::after{content:"";flex:1;height:1px;background:rgba(133,196,196,.2)}
.gjv-c-msg{min-height:1.2em;font-size:13px;margin-top:10px;color:#ffb4a8}.gjv-c-msg.ok{color:#7fe3d6}
.gjv-c-fermer{float:right;background:none;border:0;color:#8ea8b0;font-size:22px;line-height:1;cursor:pointer}
.gjv-c-danger{color:#ff8272!important;border-color:rgba(255,130,114,.45)!important}
@media print{.gjv-c-btn{display:none}}`;
  document.head.appendChild(style);

  const bouton = document.createElement("button");
  bouton.type = "button"; bouton.className = "gjv-c-btn"; bouton.setAttribute("data-compte", "");
  bouton.innerHTML = '<span aria-hidden="true">👤</span><span class="gjv-c-lib">Se connecter</span>';
  const barre = document.querySelector(".barre-inner .search-box");      // guides
  const outils = document.querySelector(".entete .outils");               // pages du site
  if (barre) barre.parentNode.insertBefore(bouton, barre);
  else if (outils) outils.insertBefore(bouton, outils.firstChild);
  else { bouton.style.cssText = "position:fixed;top:12px;right:12px;z-index:9998"; document.body.appendChild(bouton); }
  if (barre && matchMedia("(max-width:560px)").matches) bouton.querySelector(".gjv-c-lib").style.display = "none";
  document.addEventListener("click", e => { if (e.target.closest("[data-compte]")) { e.preventDefault(); ouvrir(); } });

  let boite = null, etatTexte = "";
  function afficherEtat(t) {
    etatTexte = t || (dernierEnvoi ? "Progression synchronisée à " + dernierEnvoi.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) + "." : "");
    const el = boite && boite.querySelector("[data-etat]"); if (el) el.textContent = etatTexte;
    document.querySelectorAll("[data-compte-etat]").forEach(n => { n.textContent = utilisateur ? (utilisateur.email || "Connecté") + (etatTexte ? " — " + etatTexte : "") : "Non connecté : ta progression reste sur cet appareil."; });
  }

  function fermer() { if (boite) { boite.remove(); boite = null; } }
  function ouvrir(onglet) {
    fermer();
    boite = document.createElement("div"); boite.className = "gjv-c-fond";
    boite.addEventListener("click", e => { if (e.target === boite) fermer(); });
    document.addEventListener("keydown", function esc(e) { if (e.key === "Escape") { fermer(); document.removeEventListener("keydown", esc); } });
    boite.innerHTML = '<div class="gjv-c-boite" role="dialog" aria-modal="true" aria-labelledby="gjv-c-titre"><button type="button" class="gjv-c-fermer" aria-label="Fermer">×</button><div data-corps></div></div>';
    boite.querySelector(".gjv-c-fermer").onclick = fermer;
    document.body.appendChild(boite);
    if (utilisateur) vueConnecte(); else vueConnexion(onglet || "connexion");
  }
  const corps = () => boite.querySelector("[data-corps]");
  const message = (t, ok) => { const m = boite.querySelector(".gjv-c-msg"); if (m) { m.textContent = t || ""; m.classList.toggle("ok", !!ok); } };

  function vueConnexion(onglet) {
    const inscription = onglet === "inscription";
    corps().innerHTML = `
<h2 id="gjv-c-titre">Ton compte</h2>
<p>Facultatif : il sert à retrouver tes favoris et tes cases cochées sur tous tes appareils.</p>
<div class="gjv-c-onglets"><button type="button" data-o="connexion" aria-pressed="${!inscription}">Se connecter</button><button type="button" data-o="inscription" aria-pressed="${inscription}">Créer un compte</button></div>
<form novalidate>
<label for="gjv-c-mail">Adresse e-mail</label><input id="gjv-c-mail" type="email" autocomplete="email" required>
<label for="gjv-c-mdp">Mot de passe${inscription ? " (8 caractères minimum)" : ""}</label><input id="gjv-c-mdp" type="password" autocomplete="${inscription ? "new-password" : "current-password"}" required minlength="8">
${inscription ? '<label for="gjv-c-mdp2">Confirme le mot de passe</label><input id="gjv-c-mdp2" type="password" autocomplete="new-password" required>' : ""}
<button class="gjv-c-principal" type="submit">${inscription ? "Créer mon compte" : "Se connecter"}</button>
${inscription ? "" : '<button type="button" class="gjv-c-lien" data-oubli>Mot de passe oublié ?</button>'}
</form>
<div class="gjv-c-ou">ou</div>
<button type="button" class="gjv-c-second" data-google>Continuer avec Google</button>
<div class="gjv-c-msg" role="status"></div>
<p style="font-size:12px;color:#5c7379">En créant un compte, tu acceptes que ton adresse e-mail et ta progression soient conservées par Firebase (Google) pour ce service. Détails dans les <a style="color:#4fd6c8" href="${racine()}mentions-legales.html#compte">mentions légales</a>.</p>`;
    corps().querySelectorAll("[data-o]").forEach(b => b.onclick = () => vueConnexion(b.dataset.o));
    corps().querySelector("[data-google]").onclick = async () => {
      try { await A.signInWithPopup(auth, new A.GoogleAuthProvider()); fermer(); }
      catch (e) { message(messageErreur(e)); }
    };
    const oubli = corps().querySelector("[data-oubli]");
    if (oubli) oubli.onclick = async () => {
      const mail = corps().querySelector("#gjv-c-mail").value.trim();
      if (!mail) return message("Indique d'abord ton adresse e-mail.");
      try { await A.sendPasswordResetEmail(auth, mail); message("Si un compte existe pour cette adresse, un e-mail de réinitialisation vient de partir.", true); }
      catch (e) { message(messageErreur(e)); }
    };
    corps().querySelector("form").onsubmit = async e => {
      e.preventDefault();
      const mail = corps().querySelector("#gjv-c-mail").value.trim(), mdp = corps().querySelector("#gjv-c-mdp").value;
      if (!mail || !mdp) return message("Remplis l'adresse e-mail et le mot de passe.");
      try {
        if (inscription) {
          if (mdp.length < 8) return message("Le mot de passe doit faire au moins 8 caractères.");
          if (mdp !== corps().querySelector("#gjv-c-mdp2").value) return message("Les deux mots de passe ne sont pas identiques.");
          const r = await A.createUserWithEmailAndPassword(auth, mail, mdp);
          try { await A.sendEmailVerification(r.user); } catch (er) {}
        } else {
          await A.signInWithEmailAndPassword(auth, mail, mdp);
        }
        fermer();
      } catch (er) { message(messageErreur(er)); }
    };
  }

  function vueConnecte() {
    const u = utilisateur;
    corps().innerHTML = `
<h2 id="gjv-c-titre">Ton compte</h2>
<p>Connecté avec <strong>${echapper(u.email || "ton compte Google")}</strong>.</p>
${u.emailVerified || !u.email ? "" : '<p style="color:#e0a15c">Ton adresse n\'est pas encore confirmée : clique sur le lien reçu par e-mail. <button type="button" class="gjv-c-lien" data-renvoi>Renvoyer l\'e-mail</button></p>'}
<p>Tes favoris, tes cases cochées et ta partie en cours se synchronisent automatiquement sur tous les appareils où tu te connectes.</p>
<p data-etat style="color:#7fe3d6">${echapper(etatTexte)}</p>
<button type="button" class="gjv-c-principal" data-sync>Synchroniser maintenant</button>
<button type="button" class="gjv-c-second" data-sortie>Se déconnecter</button>
<button type="button" class="gjv-c-second gjv-c-danger" data-suppr>Supprimer mon compte</button>
<div class="gjv-c-msg" role="status"></div>`;
    corps().querySelector("[data-sync]").onclick = () => synchroniser(true);
    corps().querySelector("[data-sortie]").onclick = async () => { await A.signOut(auth); fermer(); };
    const renvoi = corps().querySelector("[data-renvoi]");
    if (renvoi) renvoi.onclick = async () => { try { await A.sendEmailVerification(u); message("E-mail renvoyé.", true); } catch (e) { message(messageErreur(e)); } };
    corps().querySelector("[data-suppr]").onclick = async () => {
      if (!confirm("Supprimer définitivement ton compte et la copie en ligne de ta progression ? Ta progression reste sur cet appareil.")) return;
      try { await F.deleteDoc(F.doc(db, "progression", u.uid)); await A.deleteUser(u); fermer(); }
      catch (e) { message(e.code === "auth/requires-recent-login" ? "Par sécurité, déconnecte-toi, reconnecte-toi, puis recommence la suppression." : messageErreur(e)); }
    };
  }

  A.onAuthStateChanged(auth, async u => {
    utilisateur = u;
    bouton.querySelector(".gjv-c-lib").textContent = u ? "Mon compte" : "Se connecter";
    bouton.title = u ? "Connecté : " + (u.email || "compte Google") : "Se connecter pour synchroniser ta progression";
    if (u) {
      // un autre compte se connecte sur cet appareil : ses données ne se mélangent pas aux dates du précédent
      if (localStorage.getItem(K_COMPTE) !== u.uid) { setOrig.call(localStorage, K_COMPTE, u.uid); rmOrig.call(localStorage, K_MAJ); }
      await synchroniser(true);
    }
    afficherEtat();
    if (boite) { if (u) vueConnecte(); else vueConnexion("connexion"); }
  });
  // reprise de l'onglet : on récupère ce qui a été fait ailleurs
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && utilisateur) synchroniser(true); });
  addEventListener("pagehide", () => { if (utilisateur && minuteur) { clearTimeout(minuteur); envoyer(); } });
}

function racine() { return new URL("../", import.meta.url).href; }   // compte.js est dans assets/
function echapper(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function messageErreur(e) {
  const c = (e && e.code) || "";
  const m = {
    "auth/invalid-email": "Cette adresse e-mail n'est pas valide.",
    "auth/missing-password": "Indique ton mot de passe.",
    "auth/weak-password": "Mot de passe trop faible : 8 caractères minimum.",
    "auth/email-already-in-use": "Un compte existe déjà avec cette adresse : connecte-toi, ou utilise « Mot de passe oublié ».",
    "auth/invalid-credential": "Adresse e-mail ou mot de passe incorrect.",
    "auth/wrong-password": "Adresse e-mail ou mot de passe incorrect.",
    "auth/user-not-found": "Adresse e-mail ou mot de passe incorrect.",
    "auth/too-many-requests": "Trop de tentatives : patiente quelques minutes avant de réessayer.",
    "auth/network-request-failed": "Pas de connexion internet.",
    "auth/popup-closed-by-user": "Fenêtre Google fermée avant la fin de la connexion.",
    "auth/popup-blocked": "Ton navigateur a bloqué la fenêtre Google : autorise les fenêtres surgissantes pour ce site.",
    "auth/unauthorized-domain": "Ce domaine n'est pas encore autorisé dans Firebase.",
    "auth/operation-not-allowed": "Ce mode de connexion n'est pas encore activé.",
    "permission-denied": "Accès refusé par la base de données (règles Firestore).",
  };
  if (c.startsWith("auth/api-key-not-valid")) return "La configuration Firebase du site est invalide (clé API).";
  return m[c] || "Une erreur est survenue" + (c ? " (" + c + ")" : "") + ".";
}
