/* Comptes facultatifs « Manette en main » : connexion (e-mail + mot de passe, ou Google) et
   synchronisation de la progression entre appareils, via Firebase (Auth + Firestore lite).

   - Rien ne se charge tant que window.GJV_FIREBASE (assets/firebase-config.js) est vide :
     le site fonctionne alors exactement comme avant, sans compte.
   - Ce qui est synchronisé : les clés du stockage local « gjv:… » et « guide-coches:… »
     (favoris, cases cochées, dernière partie lue, guides hors connexion), comme l'export de Mon espace.
   - Un document par utilisateur : progression/{uid} = { cles: {clé: valeur}, maj: {clé: horodatage} }.
     À chaque clé, la modification la plus récente l'emporte ; sans date connue (première connexion
     sur un appareil déjà utilisé), les cases cochées, favoris et lectures sont fusionnés.
   - Âge : chaque compte répond une fois à « As-tu 15 ans ou plus ? » (champ age15 = true, ou "parent"
     quand un moins de 15 ans confirme l'accord d'un parent). Aucune date de naissance n'est gardée ;
     tant que la question est sans réponse, rien n'est synchronisé.
   - Quota gratuit Firestore (20 000 écritures par jour) : au plus un envoi toutes les 30 s, un envoi en
     quittant la page, et aucun envoi quand rien n'a changé depuis le dernier. */
const CONFIG = window.GJV_FIREBASE;
const MOTIF = /^(gjv:|guide-coches:)/;
const K_MAJ = "gjv-sync:maj";          // horodatage local de chaque clé modifiée
const K_COMPTE = "gjv-sync:compte";    // dernier uid connecté sur cet appareil
const SDK = "https://www.gstatic.com/firebasejs/10.12.2/";
const DELAI_ENVOI = 30000;             // regroupe les modifications : une écriture toutes les 30 s au plus
const K_INVITE = "gjv:invite-vue";      // l'invitation à créer un compte n'apparaît qu'une fois

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
  let age15 = null, ageEnAttente = null, pret = false, ageManquant = false, signatureDistante = null;

  // --- suivi des modifications locales (pour savoir quelle version est la plus récente)
  const setOrig = Storage.prototype.setItem, rmOrig = Storage.prototype.removeItem;
  function noter(k) {
    if (!MOTIF.test(k)) return;
    const maj = lireJSON(K_MAJ, {}); maj[k] = Date.now();
    setOrig.call(localStorage, K_MAJ, JSON.stringify(maj));
    if (utilisateur && pret && !minuteur) minuteur = setTimeout(() => { minuteur = null; envoyer(); }, DELAI_ENVOI);
    if (!utilisateur && k.startsWith("guide-coches:")) peutEtreInviter();
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

  // Empreinte stable d'un état (clés triées) : sert à ne rien écrire quand rien n'a changé.
  function signature(cles, maj, age) {
    const trie = o => Object.keys(o || {}).sort().map(k => [k, o[k]]);
    return JSON.stringify([trie(cles), trie(maj), age || null]);
  }

  async function envoyer() {
    if (!utilisateur || enCours || !pret) return;
    const { cles, maj } = etatLocal();
    // les suppressions voyagent aussi : une clé datée mais absente est envoyée vide
    for (const k in maj) if (!(k in cles) && MOTIF.test(k)) cles[k] = null;
    const s = signature(cles, maj, age15);
    if (s === signatureDistante) { dernierEnvoi = dernierEnvoi || new Date(); afficherEtat(); return; }
    enCours = true; afficherEtat("Synchronisation…");
    try {
      await F.setDoc(F.doc(db, "progression", utilisateur.uid), { cles, maj, age15, appareil: navigator.userAgent.slice(0, 120), le: Date.now() });
      signatureDistante = s; dernierEnvoi = new Date(); afficherEtat();
    } catch (e) { afficherEtat("Échec de la synchronisation : " + messageErreur(e)); }
    enCours = false;
  }

  async function synchroniser(recharger) {
    if (!utilisateur) return;
    try {
      const snap = await F.getDoc(F.doc(db, "progression", utilisateur.uid));
      const distant = snap.exists() ? snap.data() : null;
      age15 = (distant && distant.age15) || age15 || ageEnAttente;
      if (!age15) { pret = false; ageManquant = true; demanderAge(); return; }   // rien ne se synchronise sans réponse
      pret = true; ageManquant = false;
      signatureDistante = distant ? signature(distant.cles, distant.maj, distant.age15) : null;
      const changees = appliquer(distant);
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
.gjv-c-age{border:1px solid rgba(133,196,196,.25);border-radius:10px;padding:10px 12px 12px;margin:14px 0 0}
.gjv-c-age legend{padding:0 6px;font-weight:600;color:#f2f8f6;font-size:14px}
.gjv-c-boite .gjv-c-age label{display:flex;gap:9px;align-items:flex-start;color:#dfeef0;font-size:14px;margin:8px 0 0;cursor:pointer}
.gjv-c-boite .gjv-c-age input{width:auto;margin:3px 0 0;flex:none;accent-color:#4fd6c8}
.gjv-c-parent{margin-top:6px;padding-top:6px;border-top:1px dashed rgba(133,196,196,.25)}
.gjv-c-boite a{color:#4fd6c8}
.gjv-c-invite{position:fixed;left:50%;bottom:72px;transform:translateX(-50%);z-index:9997;width:min(430px,calc(100vw - 24px));box-sizing:border-box;background:#101f30;color:#dfeef0;border:1px solid rgba(79,214,200,.45);border-radius:14px;padding:14px 16px;font:14px/1.5 system-ui,sans-serif;box-shadow:0 12px 34px rgba(0,0,0,.45)}
.gjv-c-invite b{color:#f2f8f6}.gjv-c-invite p{margin:0 0 10px}
.gjv-c-invite div{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
.gjv-c-invite button{font:600 14px system-ui,sans-serif;border-radius:999px;padding:8px 14px;cursor:pointer;border:1px solid rgba(133,196,196,.35);background:none;color:#dfeef0}
.gjv-c-invite button[data-oui]{background:#4fd6c8;color:#0a1420;border-color:#4fd6c8}
@media (max-width:560px){.entete .gjv-c-btn .gjv-c-lib{display:none}.entete .gjv-c-btn{padding:7px 10px}}
@media print{.gjv-c-btn,.gjv-c-invite{display:none}}`;
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
    if (utilisateur) { if (ageManquant) demanderAge(); else vueConnecte(); } else vueConnexion(onglet || "connexion");
  }
  const corps = () => boite.querySelector("[data-corps]");
  const message = (t, ok) => { const m = boite.querySelector(".gjv-c-msg"); if (m) { m.textContent = t || ""; m.classList.toggle("ok", !!ok); } };

  // --- âge : une seule question, sans date de naissance
  function champAge() {
    return `<fieldset class="gjv-c-age"><legend>As-tu 15 ans ou plus ?</legend>
<label><input type="radio" name="gjv-age" value="oui"> Oui</label>
<label><input type="radio" name="gjv-age" value="non"> Non, j'ai moins de 15 ans</label>
<div class="gjv-c-parent" hidden><label><input type="checkbox" id="gjv-c-parent"> Un de mes parents (ou la personne qui s'occupe de moi) est d'accord pour que je crée ce compte.</label>
<p style="font-size:13px;margin:8px 0 0">Montre-lui d'abord <a href="${racine()}mentions-legales.html#moins-de-15-ans" target="_blank" rel="noopener">ce qu'il faut savoir</a> : ça prend une minute.</p></div></fieldset>`;
  }
  function brancherAge() {
    corps().querySelectorAll('input[name="gjv-age"]').forEach(r => r.onchange = () => {
      corps().querySelector(".gjv-c-parent").hidden = r.value !== "non" || !r.checked;
    });
  }
  // Renvoie true (15 ans ou plus), "parent" (moins de 15 ans avec l'accord d'un parent) ou null en affichant pourquoi.
  function lireAge() {
    const r = corps().querySelector('input[name="gjv-age"]:checked');
    if (!r) { message("Réponds d'abord à la question sur ton âge."); return null; }
    if (r.value === "oui") return true;
    if (!corps().querySelector("#gjv-c-parent").checked) { message("Avant 15 ans, il faut l'accord d'un de tes parents pour créer un compte. Tu peux lire tous les guides sans compte."); return null; }
    return "parent";
  }
  function demanderAge() {
    if (!boite) ouvrir();
    corps().innerHTML = `
<h2 id="gjv-c-titre">Une dernière question</h2>
<p>Avant de synchroniser ta progression, on a besoin de savoir une seule chose. Aucune date de naissance n'est enregistrée.</p>
${champAge()}
<button type="button" class="gjv-c-principal" data-valider>Valider</button>
<button type="button" class="gjv-c-second" data-annuler>Annuler et supprimer ce compte</button>
<div class="gjv-c-msg" role="status"></div>`;
    brancherAge();
    corps().querySelector("[data-valider]").onclick = () => {
      const a = lireAge(); if (!a) return;
      ageEnAttente = a; fermer(); synchroniser(true);
    };
    corps().querySelector("[data-annuler]").onclick = async () => {
      try { await A.deleteUser(utilisateur); fermer(); }
      catch (e) { await A.signOut(auth); fermer(); }
    };
  }

  // --- invitation discrète, une seule fois, après la 10e case cochée sans compte
  let authConnu = false;
  function peutEtreInviter() {
    if (!authConnu || utilisateur || localStorage.getItem(K_INVITE) || document.querySelector(".gjv-c-invite")) return;
    let n = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("guide-coches:")) { const o = lireJSON(k, {}); for (const c in o) if (o[c] === true) n++; }
    }
    if (n < 10) return;
    ecrireBrut(K_INVITE, "1");
    const d = document.createElement("div"); d.className = "gjv-c-invite"; d.setAttribute("role", "status");
    d.innerHTML = `<p><b>Déjà ${n} cases cochées !</b> Elles ne sont gardées que dans ce navigateur. Un compte gratuit permet de les retrouver sur ton téléphone ou un autre ordinateur.</p>
<div><button type="button" data-non>Plus tard</button><button type="button" data-oui>Créer un compte</button></div>`;
    d.querySelector("[data-non]").onclick = () => d.remove();
    d.querySelector("[data-oui]").onclick = () => { d.remove(); ouvrir("inscription"); };
    document.body.appendChild(d);
  }

  function vueConnexion(onglet) {
    const inscription = onglet === "inscription";
    corps().innerHTML = `
<h2 id="gjv-c-titre">Ton compte</h2>
<p>Facultatif : il sert à retrouver tes favoris et tes cases cochées sur tous tes appareils.</p>
<div class="gjv-c-onglets"><button type="button" data-o="connexion" aria-pressed="${!inscription}">Se connecter</button><button type="button" data-o="inscription" aria-pressed="${inscription}">Créer un compte</button></div>
${inscription ? champAge() : ""}
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
    if (inscription) brancherAge();
    corps().querySelector("[data-google]").onclick = async () => {
      if (inscription) { const a = lireAge(); if (!a) return; ageEnAttente = a; }
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
          const a = lireAge(); if (!a) return;
          ageEnAttente = a;
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
    utilisateur = u; authConnu = true;
    if (!u) { age15 = null; ageEnAttente = null; pret = false; ageManquant = false; signatureDistante = null; clearTimeout(minuteur); minuteur = null; }
    else document.querySelectorAll(".gjv-c-invite").forEach(d => d.remove());
    bouton.querySelector(".gjv-c-lib").textContent = u ? "Mon compte" : "Se connecter";
    bouton.title = u ? "Connecté : " + (u.email || "compte Google") : "Se connecter pour synchroniser ta progression";
    if (u) {
      // un autre compte se connecte sur cet appareil : ses données ne se mélangent pas aux dates du précédent
      if (localStorage.getItem(K_COMPTE) !== u.uid) { setOrig.call(localStorage, K_COMPTE, u.uid); rmOrig.call(localStorage, K_MAJ); }
      await synchroniser(true);
    }
    afficherEtat();
    if (boite) { if (!u) vueConnexion("connexion"); else if (pret) vueConnecte(); }
  });
  // reprise de l'onglet : on récupère ce qui a été fait ailleurs ; en le quittant, on envoie ce qui attendait
  document.addEventListener("visibilitychange", () => {
    if (!utilisateur) return;
    if (document.visibilityState === "visible") synchroniser(true);
    else if (minuteur) { clearTimeout(minuteur); minuteur = null; envoyer(); }
  });
  addEventListener("pagehide", () => { if (utilisateur && minuteur) { clearTimeout(minuteur); minuteur = null; envoyer(); } });
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
