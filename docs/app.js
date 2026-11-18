/* PWA Techniciens — interface des interventions.
   Elle ne parle qu'au relais Cloudflare « pannes-techniciens », qui fait ce que fait AppSheet :
   lire les interventions actives et modifier les mêmes cellules de la feuille, au même format.
   Aucun mot de passe n'est conservé sur l'appareil : seulement un jeton de session signé par le relais. */
(() => {
  'use strict';

  const VERSION_APPLI = 'Version 1.8';   // affichee a la connexion et dans Mon compte
  const URL_RELAIS = 'https://pannes-techniciens.marc-dongiovanni.workers.dev';
  const DELAI_MS = 20000;
  const RAFRAICHIR_MS = 60000;

  /* ---------- Types d'intervention : couleurs et icônes (mêmes que les maquettes) ---------- */
  const SVG = (d, extra) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  const ICONES = {
    'PANNE': SVG('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>'),
    'MACHINE A CAFE': SVG('<path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M17 11h1.5a2.5 2.5 0 0 1 0 5H17"/><path d="M8 3v3M12 3v3"/>'),
    'ENTRETIEN': SVG('<path d="m16 22-1-4"/><path d="M19 14a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2h-3a1 1 0 0 1-1-1V4a2 2 0 0 0-4 0v5a1 1 0 0 1-1 1H6a2 2 0 0 0-2 2v1a1 1 0 0 0 1 1"/><path d="M19 14H5l-1.973 6.767A1 1 0 0 0 4 22h16a1 1 0 0 0 .973-1.233z"/><path d="m8 22 1-4"/>'),
    'LIVRAISON': SVG('<path d="M1 4h14v12H1z"/><path d="M15 9h4l3 3v4h-7z"/><circle cx="5.5" cy="18.5" r="2"/><circle cx="18.5" cy="18.5" r="2"/>'),
    'LIVRAISON HORECA': SVG('<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>'),
    'RAPPEL': SVG('<path d="M12 3 2 21h20z"/><path d="M12 10v5M12 18h.01"/>'),
    'AUTRE': SVG('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01"/>')
  };
  const COULEURS = {
    'PANNE': 'panne', 'MACHINE A CAFE': 'cafe', 'ENTRETIEN': 'entretien',
    'LIVRAISON': 'livraison', 'LIVRAISON HORECA': 'horeca', 'RAPPEL': 'rappel', 'AUTRE': 'entretien'
  };
  const LIBELLES = {
    'PANNE': 'Panne', 'MACHINE A CAFE': 'Machine à café', 'ENTRETIEN': 'Entretien',
    'LIVRAISON': 'Livraison', 'LIVRAISON HORECA': 'Livraison Horeca', 'RAPPEL': 'Alerte', 'AUTRE': 'Autre'
  };
  const ORDRE_TYPES = ['PANNE', 'MACHINE A CAFE', 'ENTRETIEN', 'LIVRAISON', 'LIVRAISON HORECA', 'RAPPEL', 'AUTRE'];

  const FLECHE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
  const CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width:20px;height:20px;flex:none"><path d="M9 5l7 7-7 7"/></svg>';

  const MESSAGES = {
    identifiants: 'Nom ou mot de passe incorrect.',
    bloque: 'Trop d’essais. Réessaie dans 10 minutes.',
    compte_desactive: 'Ce compte est désactivé. Préviens Marc.',
    session_invalide: 'Ta session a expiré. Reconnecte-toi.',
    changer_mdp: 'Tu dois d’abord choisir ton mot de passe.',
    mdp_actuel: 'Le mot de passe actuel est incorrect.',
    mdp_court: 'Le mot de passe doit faire au moins 6 caractères.',
    mdp_identique: 'Choisis un mot de passe différent du provisoire.',
    deja_prise: 'Cette intervention vient d’être prise par quelqu’un d’autre.',
    pas_en_attente: 'Cette intervention n’est plus en attente.',
    pas_en_cours: 'Cette intervention n’est pas en cours.',
    deja_reservee: 'Cette intervention est déjà réservée.',
    pas_reservee: 'Cette intervention n’est pas réservée.',
    deja_inscrit: 'Tu es déjà sur cette intervention.',
    deja_terminee: 'Cette intervention est déjà terminée.',
    rappel_non_prenable: 'Une alerte se termine avec « Fait ».',
    rappel_utiliser_fait: 'Une alerte se termine avec « Fait ».',
    pas_un_rappel: 'Cette intervention n’est pas une alerte.',
    intervention_introuvable: 'Intervention introuvable : la liste a changé.',
    colonne_manquante: 'La feuille a changé (colonne manquante). Préviens Marc.',
    existe_deja: 'Ce nom existe déjà.',
    inconnu: 'Technicien inconnu.',
    nom_invalide: 'Nom invalide (lettres, chiffres, espaces et tirets).',
    dernier_admin: 'Impossible : il doit rester un administrateur.',
    refuse: 'Action réservée à l’administrateur.',
    appareil_invalide: 'Appareil inconnu.',
    erreur_serveur: 'Erreur du serveur.',
    reseau: 'Pas de connexion au serveur.',
    delai: 'Le serveur ne répond pas.'
  };
  const dire = (e) => MESSAGES[e] || ('Erreur : ' + e);

  /* ---------- Session : jeton seulement, jamais le mot de passe ---------- */
  const CLE = 'tech_jeton';
  function lireJeton() { try { return localStorage.getItem(CLE) || sessionStorage.getItem(CLE) || ''; } catch (e) { return ''; } }
  function garderJeton(j, rester) {
    try {
      localStorage.removeItem(CLE); sessionStorage.removeItem(CLE);
      (rester ? localStorage : sessionStorage).setItem(CLE, j);
    } catch (e) {}
  }
  function oublierJeton() { try { localStorage.removeItem(CLE); sessionStorage.removeItem(CLE); } catch (e) {} }
  function resterCoche() { try { return !!localStorage.getItem(CLE); } catch (e) { return false; } }

  const etat = { jeton: '', moi: null, interventions: [], filtreType: '', filtreStatut: '',
                 chargement: false, erreur: '', minuteur: 0, enCours: false };

  /* ---------- Appels au relais ---------- */
  async function appeler(corps) {
    const ctrl = new AbortController();
    const minuteur = setTimeout(() => ctrl.abort(), DELAI_MS);
    try {
      const rep = await fetch(URL_RELAIS, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({}, corps, etat.jeton ? { jeton: etat.jeton } : {})),
        cache: 'no-store', credentials: 'omit', signal: ctrl.signal
      });
      const texte = await rep.text();
      if (!rep.ok) return { ok: false, erreur: 'reseau' };
      let j; try { j = JSON.parse(texte); } catch (e) { return { ok: false, erreur: 'erreur_serveur' }; }
      if (j && j.jeton) { etat.jeton = j.jeton; garderJeton(j.jeton, resterCoche()); }
      if (j && !j.ok && j.erreur === 'session_invalide') { etat.jeton = ''; etat.moi = null; oublierJeton(); }
      return j;
    } catch (e) {
      return { ok: false, erreur: e && e.name === 'AbortError' ? 'delai' : 'reseau' };
    } finally { clearTimeout(minuteur); }
  }

  /* ---------- Utilitaires d'affichage ---------- */
  const $ = (id) => document.getElementById(id);
  const app = () => document.getElementById('app');
  function ech(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // Numéro de série de la feuille -> Date (heure affichée dans la feuille).
  function dateDeSerie(v) {
    if (typeof v !== 'number' || !isFinite(v) || v <= 0) return null;
    return new Date(Math.round((v - 25569) * 86400) * 1000);
  }
  function heureDe(iso) {
    if (!iso) return '';
    const m = /T(\d\d:\d\d)/.exec(iso);
    return m ? m[1] : '';
  }
  // Depuis combien de temps, en texte court (« 2 h », « 3 j »).
  function depuis(iso, maintenantSerie) {
    if (!iso) return '';
    const d = new Date(iso + 'Z'), maintenant = dateDeSerie(maintenantSerie);
    if (!maintenant || isNaN(d)) return '';
    const min = Math.max(0, Math.round((maintenant - d) / 60000));
    if (min < 60) return min + ' min';
    if (min < 1440) return Math.round(min / 60) + ' h';
    return Math.round(min / 1440) + ' j';
  }
  function initiale(nom) { return String(nom || '?').trim().charAt(0).toUpperCase(); }

  /* ---------- Écran : connexion ---------- */
  function vueConnexion(msg) {
    const nomUrl = (location.hash.match(/[#&]u=([^&]+)/) || [])[1] || '';
    app().innerHTML =
      '<div class="connexion">' +
        '<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px 0 0">' +
          '<div class="logo-rond">' + ICONES['PANNE'] + '</div>' +
          '<div style="text-align:center">' +
            '<div style="font-weight:800;font-size:1.85rem;letter-spacing:-.02em">Pannes Jeux</div>' +
            '<div style="font-size:.95rem;color:var(--doux);margin-top:2px">Service technique</div>' +
          '</div>' +
        '</div>' +
        '<form id="f-login" style="display:flex;flex-direction:column;gap:14px">' +
          '<div class="bloc" style="gap:16px;border-radius:20px;padding:20px">' +
            (msg ? '<div class="msg msg-err">' + ech(msg) + '</div>' : '') +
            '<div class="champ"><label for="nom">Nom</label>' +
              '<input id="nom" name="username" type="text" autocomplete="username" autocapitalize="characters" ' +
              'spellcheck="false" required value="' + ech(decodeURIComponent(nomUrl)) + '" style="font-weight:700"></div>' +
            '<div class="champ"><label for="mdp">Mot de passe</label>' +
              '<div style="position:relative;display:flex">' +
                '<input id="mdp" name="password" type="password" autocomplete="current-password" required style="padding-right:56px">' +
                '<button type="button" id="voir" aria-label="Afficher le mot de passe" style="position:absolute;right:4px;top:4px;width:44px;height:44px;border:0;background:transparent;color:var(--doux);display:flex;align-items:center;justify-content:center">' +
                  SVG('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>') + '</button>' +
              '</div></div>' +
            '<label class="case" for="rester"><input type="checkbox" id="rester"' + (resterCoche() ? ' checked' : ' checked') + '> Rester connecté sur cet appareil</label>' +
            '<button class="btn btn-principal" type="submit" id="b-login">Se connecter</button>' +
          '</div>' +
          '<div style="text-align:center;font-size:.88rem;color:var(--doux);padding:0 12px;line-height:1.45">Mot de passe perdu ? Préviens Marc, il le réinitialise.</div>' +
        '</form>' +
        '<div style="text-align:center;font-size:.72rem;color:var(--doux);padding:18px 0 28px">' + VERSION_APPLI + '</div>' +
      '</div>';
    $('voir').addEventListener('click', () => {
      const c = $('mdp'); c.type = c.type === 'password' ? 'text' : 'password';
    });
    $('f-login').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const b = $('b-login'); b.disabled = true; b.textContent = 'Connexion...';
      const rester = $('rester').checked;
      etat.jeton = '';
      const r = await appeler({ action: 'login', nom: $('nom').value, motdepasse: $('mdp').value, rester });
      if (!r.ok) { vueConnexion(dire(r.erreur)); return; }
      garderJeton(r.jeton, rester);
      etat.jeton = r.jeton; etat.moi = r.utilisateur;
      if (location.hash) history.replaceState(null, '', location.pathname);
      router();
    });
  }

  /* ---------- Écran : choisir son mot de passe (imposé) ---------- */
  function vueMotDePasse(msg) {
    app().innerHTML =
      '<div class="page">' +
        '<div style="padding:56px 20px 8px">' +
          '<div style="font-weight:800;font-size:1.75rem;letter-spacing:-.02em">Choisis ton mot de passe</div>' +
          '<div style="font-size:.95rem;color:var(--doux);margin-top:4px">Bonjour ' + ech(etat.moi.nom) + '</div>' +
        '</div>' +
        '<form id="f-mdp" class="contenu" style="gap:16px">' +
          '<div class="msg msg-info" style="display:flex;gap:12px;align-items:flex-start">' +
            SVG('<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>').replace('<svg', '<svg style="width:22px;height:22px;flex:none;margin-top:1px"') +
            '<span>Tu utilises un mot de passe provisoire. Remplace-le par le tien pour continuer.</span></div>' +
          (msg ? '<div class="msg msg-err">' + ech(msg) + '</div>' : '') +
          '<div class="bloc" style="gap:16px;border-radius:20px;padding:20px">' +
            '<div class="champ"><label for="a">Mot de passe provisoire</label>' +
              '<input id="a" type="password" autocomplete="current-password" required></div>' +
            '<div class="champ"><label for="n">Nouveau mot de passe</label>' +
              '<input id="n" type="password" autocomplete="new-password" minlength="6" required style="border:2px solid var(--cours)"></div>' +
            '<div style="font-size:.85rem;color:var(--doux);line-height:1.5">6 caractères minimum, et différent du provisoire.</div>' +
          '</div>' +
          '<div style="font-size:.82rem;line-height:1.45;color:var(--doux);padding:0 4px">Tu ne le retapes qu’une fois : l’appli te reconnaît ensuite sur ce téléphone. Si tu l’oublies, préviens Marc.</div>' +
          '<button class="btn btn-principal" type="submit" id="b-mdp" style="margin-top:4px">Enregistrer et continuer</button>' +
        '</form>' +
      '</div>';
    $('f-mdp').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const b = $('b-mdp'); b.disabled = true; b.textContent = 'Enregistrement...';
      const r = await appeler({ action: 'changer_mdp', ancien: $('a').value, nouveau: $('n').value });
      if (!r.ok) { vueMotDePasse(dire(r.erreur)); return; }
      etat.moi = r.utilisateur;
      router();
    });
  }

  /* ---------- Écran : liste des interventions ---------- */
  function carteHtml(i) {
    const c = COULEURS[i.type] || 'panne';
    const estRappel = i.type === 'RAPPEL';
    let etiq = '';
    if (i.statut === 'En cours') {
      etiq = '<span class="etiq etiq-cours">En cours · ' + ech(i.techniciens.join(' , ') || '?') + '</span>';
    } else if (i.reservePar) {
      etiq = '<span class="etiq etiq-reserve">Réservé ' + ech(i.reservePar) + '</span>';
    } else {
      const d = depuis(i.horodateurTexte, etat.maintenant);
      etiq = '<span class="etiq etiq-attente">En attente' + (d ? ' · ' + d : '') + '</span>';
    }
    const titre = estRappel ? 'Alerte' : ech(i.cafe);
    const sous = estRappel ? 'Rappel' : ech([i.ville, i.appareil].filter(Boolean).join(' · '));
    const texte = ech(i.encaisser || i.natureCourte || i.nature);
    return '<button class="carte" data-h="' + i.horodateur + '" data-l="' + i.ligne + '">' +
      '<div class="liseret" style="background:var(--' + c + ')"></div>' +
      '<div class="carte-corps">' +
        '<div class="carte-haut">' +
          '<span class="tuile" style="background:var(--' + c + '-c);border-color:var(--' + c + ');color:var(--' + c + '-f)">' + (ICONES[i.type] || ICONES['PANNE']) + '</span>' +
          '<span class="carte-titres"><span class="nom">' + titre + '</span><span class="sous">' + sous + '</span></span>' +
        '</div>' +
        '<div class="etiqs">' + etiq + '</div>' +
        (texte ? '<div class="nature' + (estRappel ? ' rappel' : '') + '">' + texte + '</div>' : '') +
        (i.livraisonLe ? '<div class="info-liv">' + ech(i.livraisonLe) + '</div>' : '') +
      '</div></button>';
  }

  function vueListe() {
    const parType = {};
    etat.interventions.forEach((i) => { parType[i.type] = (parType[i.type] || 0) + 1; });
    const types = ORDRE_TYPES;                       // toujours tous les types, même à 0
    const compteurs = types.map((t) => {
      const c = COULEURS[t];
      return '<button data-type="' + t + '" aria-pressed="' + (etat.filtreType === t) + '" aria-label="' + (parType[t] || 0) + ' ' + ech(LIBELLES[t]) + '" ' +
        'style="background:var(--' + c + '-c);border-color:var(--' + c + ');color:var(--' + c + '-f)">' +
        (ICONES[t] || '') + '<b>' + (parType[t] || 0) + '</b></button>';
    }).join('');

    let liste = etat.interventions;
    if (etat.filtreType) liste = liste.filter((i) => i.type === etat.filtreType);
    if (etat.filtreStatut === 'attente') liste = liste.filter((i) => i.statut === 'En attente');
    if (etat.filtreStatut === 'cours') liste = liste.filter((i) => i.statut === 'En cours');
    if (etat.filtreStatut === 'moi') liste = liste.filter((i) => i.techniciens.includes(etat.moi.nom) || i.reservePar === etat.moi.nom);

    const jour = new Date().toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' });
    app().innerHTML =
      '<header>' +
        '<div class="titre-ligne">' +
          '<div><h1>Interventions</h1><div class="sous">' + ech(jour.charAt(0).toUpperCase() + jour.slice(1)) + ' · ' +
            etat.interventions.length + ' à traiter</div></div>' +
          '<button class="btn-actu' + (etat.chargement ? ' occupe' : '') + '" id="b-actu" aria-label="Actualiser">' +
            SVG('<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>') + '</button>' +
          '<button class="btn-compte" id="b-compte"><span class="pastille">' + ech(initiale(etat.moi.nom)) + '</span>' + ech(etat.moi.nom) + '</button>' +
        '</div>' +
        (compteurs ? '<div class="compteurs" id="cpt">' + compteurs + '</div>' : '') +
        '<div class="filtres" id="filt">' +
          '<button data-s="" aria-pressed="' + (etat.filtreStatut === '') + '">Toutes</button>' +
          '<button data-s="attente" aria-pressed="' + (etat.filtreStatut === 'attente') + '">En attente</button>' +
          '<button data-s="cours" aria-pressed="' + (etat.filtreStatut === 'cours') + '">En cours</button>' +
          '<button data-s="moi" aria-pressed="' + (etat.filtreStatut === 'moi') + '">Les miennes</button>' +
        '</div>' +
      '</header>' +
      '<main id="liste">' +
        (etat.erreur ? '<div class="msg msg-err">' + ech(etat.erreur) + '</div>' : '') +
        (etat.chargement && !etat.interventions.length ? '<div class="chargement"><span class="tourne"></span> Chargement...</div>' :
          liste.length ? liste.map(carteHtml).join('') :
          '<div class="vide">Aucune intervention à afficher.<br>Tire vers le bas pour actualiser.</div>') +
      '</main>' +
      '<footer>' +
        '<button aria-current="page">' + SVG('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>') + 'Liste</button>' +
        '<button class="btn-plus" id="b-nouvelle" aria-label="Nouvelle intervention">' +
          SVG('<path d="M12 5v14M5 12h14"/>') + '</button>' +
        '<button id="b-compte2">' + SVG('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>') + 'Compte</button>' +
      '</footer>';

    const cpt = $('cpt');
    if (cpt) cpt.addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-type]'); if (!b) return;
      etat.filtreType = etat.filtreType === b.dataset.type ? '' : b.dataset.type; vueListe();
    });
    $('filt').addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-s]'); if (!b) return;
      etat.filtreStatut = b.dataset.s; vueListe();
    });
    $('liste').addEventListener('click', (ev) => {
      const b = ev.target.closest('.carte'); if (!b) return;
      const i = etat.interventions.find((x) => String(x.horodateur) === b.dataset.h);
      if (i) vueDetail(i);
    });
    $('b-actu').addEventListener('click', () => chargerListe(true));
    $('b-nouvelle').addEventListener('click', vueNouvelle);
    $('b-compte').addEventListener('click', vueCompte);
    $('b-compte2').addEventListener('click', vueCompte);
  }

  async function chargerListe(forcer) {
    if (etat.chargement) return;
    etat.chargement = true;
    if (forcer) { etat.erreur = ''; vueListe(); }
    const r = await appeler({ action: 'liste' });
    etat.chargement = false;
    if (!r.ok) {
      if (r.erreur === 'session_invalide') { router(); return; }
      etat.erreur = dire(r.erreur);
    } else {
      etat.erreur = ''; etat.interventions = r.interventions; etat.maintenant = r.maintenant;
    }
    if (document.querySelector('header')) vueListe();
  }

  /* ---------- Écrans : nouvelle intervention (café, appareil, nature, prendre ou déposer) ---------- */

  // Types proposés à la création, dans l'ordre d'AppSheet. Les appareils de jeu sont listés ensuite.
  const TYPES_CREATION = ['PANNE', 'MACHINE A CAFE', 'ENTRETIEN', 'LIVRAISON', 'LIVRAISON HORECA', 'AUTRE'];
  const APPAREILS_JEU = ['MONTANA LUXE II', 'DAYTONA', 'NEVADA', 'ZEUS', 'ARIZONA', 'MK3', 'MK4', 'ACTION PACK',
    'TOP MACHINE', 'GREYHOUND', 'TEXAS', 'KICKER', 'BILLARD', 'FLECHE', 'INDETERMINE'];
  let brouillon = null;
  let listeCafes = null;

  function vueNouvelle() {
    brouillon = { licence: '', cafe: '', ville: '', type: '', machines: [], appareil: '', nature: '', filtres: null };
    etapeType();
  }

  // Barre du haut commune aux écrans de création, avec le numéro d'étape.
  function barreCreation(titre, etape, retour) {
    return '<div class="barre-haut"><button class="btn-retour" id="b-ret" aria-label="Retour">' + FLECHE + '</button>' +
      '<div><h2>' + ech(titre) + '</h2>' +
      '<div style="font-size:.8rem;color:var(--doux)">Étape ' + etape + ' sur 4</div></div></div>';
  }

  /* --- Étape 1 : le type d'intervention --- */
  function etapeType() {
    const ligne = (v) => {
      const c = COULEURS[v] || 'panne';
      return '<button class="ligne-tech" data-t="' + ech(v) + '">' +
        '<span class="tuile" style="background:var(--' + c + '-c);border-color:var(--' + c + ');color:var(--' + c + '-f)">' +
          (ICONES[v] || ICONES['PANNE']) + '</span>' +
        '<span style="flex:1;font-size:1rem;font-weight:700">' + ech(LIBELLES[v] || v) + '</span>' + CHEVRON + '</button>';
    };
    app().innerHTML =
      '<div class="page">' + barreCreation('Type d’intervention', 1) +
        '<div class="contenu">' + TYPES_CREATION.map(ligne).join('') + '</div></div>';
    $('b-ret').addEventListener('click', () => { vueListe(); chargerListe(); });
    document.querySelector('.contenu').addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-t]'); if (!b) return;
      brouillon.type = b.dataset.t;
      brouillon.machines = [];
      // Les livraisons Horeca visent les adresses Z, le reste les cafés C.
      brouillon.filtres = brouillon.type === 'LIVRAISON HORECA' ? { c: false, z: true } : { c: true, z: false };
      etapeCafe();
    });
  }

  /* --- Étape 2 : l'établissement, filtré par type de licence --- */
  async function etapeCafe(msg) {
    const f = brouillon.filtres || (brouillon.filtres = { c: true, z: false });
    const casePour = (cle, texte) => {
      const pris = !!f[cle];
      return '<button class="filtre-lic' + (pris ? ' pris' : '') + '" data-f="' + cle + '">' +
        '<span class="coche' + (pris ? ' prise' : '') + '">' + (pris ? SVG('<path d="M20 6L9 17l-5-5"/>') : '') + '</span>' +
        ech(texte) + '</button>';
    };
    app().innerHTML =
      '<div class="page">' + barreCreation('Quel établissement ?', 2) +
        '<div style="padding:4px 16px 0;display:flex;gap:8px">' + casePour('c', 'Cafés') + casePour('z', 'Horeca') + '</div>' +
        '<div style="padding:8px 16px"><input id="q" type="search" placeholder="Chercher un nom ou une ville" ' +
          'autocomplete="off" spellcheck="false" style="width:100%;box-sizing:border-box;height:52px;border-radius:14px;' +
          'border:1px solid var(--bord);background:var(--doux2);padding:0 14px;font-size:1.05rem"></div>' +
        '<div class="contenu" id="c" style="padding-top:0">' +
          (msg ? '<div class="msg msg-err">' + ech(msg) + '</div>' : '') +
          '<div class="chargement"><span class="tourne"></span> Chargement...</div>' +
        '</div></div>';
    $('b-ret').addEventListener('click', () => etapeType());

    if (!listeCafes) {
      const r = await appeler({ action: 'cafes' });
      if (!r.ok) {
        if (r.erreur === 'session_invalide') { router(); return; }
        $('c').innerHTML = '<div class="msg msg-err">' + ech(dire(r.erreur)) + '</div>';
        return;
      }
      listeCafes = r.cafes;
    }
    // La première lettre de la licence dit le genre : C pour un café, Z pour une adresse Horeca.
    const genre = (lic) => (txtMaj(lic)[0] === 'Z' ? 'z' : 'c');
    const dessiner = () => {
      const q = ($('q').value || '').trim().toUpperCase();
      let l = listeCafes.filter((x) => f[genre(x.licence)]);
      if (q) l = l.filter((x) => (x.nom + ' ' + x.ville + ' ' + x.licence).toUpperCase().indexOf(q) >= 0);
      const nb = l.length;
      l = l.slice(0, 40);
      $('c').innerHTML =
        '<div style="font-size:.82rem;color:var(--doux);padding:0 4px 2px">' +
          (f.c || f.z ? nb + (q ? ' résultat' : ' établissement') + (nb > 1 ? 's' : '') : 'Coche au moins une case') +
          (nb > 40 ? ' · 40 affichés, affine ta recherche' : '') + '</div>' +
        (nb ? l.map((x) => '<button class="ligne-tech" data-l="' + ech(x.licence) + '" data-n="' + ech(x.nom) + '">' +
          '<span style="flex:1;min-width:0"><span style="display:block;font-size:1rem;font-weight:700">' + ech(x.nom) + '</span>' +
          '<span style="display:block;font-size:.82rem;color:var(--doux)">' + ech(x.ville || '—') + ' · ' + ech(x.licence) + '</span></span>' +
          CHEVRON + '</button>').join('')
          : '<div class="vide">Aucun établissement ne correspond.</div>');
    };
    document.querySelector('.page').addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-f]'); if (!b) return;
      f[b.dataset.f] = !f[b.dataset.f];
      etapeCafe();
    });
    $('q').addEventListener('input', dessiner);
    $('c').addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-l]'); if (!b) return;
      const x = listeCafes.find((y) => y.licence === b.dataset.l && y.nom === b.dataset.n);
      if (!x) return;
      brouillon.licence = x.licence; brouillon.cafe = x.nom; brouillon.ville = x.ville;
      if (brouillon.type === 'PANNE') etapeMachines(); else { brouillon.appareil = brouillon.type; etapeNature(); }
    });
    dessiner();
    $('q').focus();
  }
  function txtMaj(v) { return String(v == null ? '' : v).trim().toUpperCase(); }

  /* --- Étape 2b : quelles machines sont en panne (plusieurs possibles) --- */
  function etapeMachines(msg) {
    const choisies = brouillon.machines || [];
    const ligne = (v) => {
      const pris = choisies.indexOf(v) >= 0;
      return '<button class="ligne-tech" data-m="' + ech(v) + '"' +
        (pris ? ' style="border:2px solid var(--panne);background:var(--panne-c)"' : '') + '>' +
        '<span class="coche' + (pris ? ' prise' : '') + '">' + (pris ? SVG('<path d="M20 6L9 17l-5-5"/>') : '') + '</span>' +
        '<span style="flex:1;font-size:1rem;font-weight:700">' + ech(v) + '</span></button>';
    };
    app().innerHTML =
      '<div class="page">' + barreCreation('Quelle machine ?', 3) +
        '<div class="contenu" style="padding-bottom:8px">' +
          (msg ? '<div class="msg msg-err">' + ech(msg) + '</div>' : '') +
          '<div style="font-size:.85rem;color:var(--doux);padding:0 4px;line-height:1.45">' +
            'Touche toutes les machines en panne. Tu peux en choisir plusieurs.</div>' +
          APPAREILS_JEU.map(ligne).join('') +
        '</div>' +
        '<div class="actions">' +
          '<button class="btn btn-principal" id="b-ok"' + (choisies.length ? '' : ' disabled') + '>' +
            (choisies.length ? 'Continuer avec ' + choisies.length + ' machine' + (choisies.length > 1 ? 's' : '') : 'Choisis au moins une machine') +
          '</button>' +
        '</div></div>';
    $('b-ret').addEventListener('click', () => etapeCafe());
    document.querySelector('.contenu').addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-m]'); if (!b) return;
      const v = b.dataset.m, i = choisies.indexOf(v);
      if (i >= 0) choisies.splice(i, 1); else choisies.push(v);
      brouillon.machines = choisies;
      etapeMachines();
    });
    $('b-ok').addEventListener('click', () => {
      if (!brouillon.machines.length) return;
      brouillon.appareil = brouillon.machines.join(' , ');
      etapeNature();
    });
  }

  // Affichage : le type choisi, et le détail (machines pour une panne).
  function typeDeValeur() { return brouillon.type || 'PANNE'; }
  function libelleValeur() {
    if (brouillon.type === 'PANNE') return (brouillon.machines || []).join(' , ') || 'Panne';
    return LIBELLES[brouillon.type] || brouillon.type;
  }

  /* --- Étape 3 : la nature de la panne --- */
  function etapeNature(msg) {
    const t = typeDeValeur(), c = COULEURS[t] || 'panne';
    app().innerHTML =
      '<div class="page">' + barreCreation('Que se passe-t-il ?', 3) +
        '<form id="f" class="contenu">' +
          (msg ? '<div class="msg msg-err">' + ech(msg) + '</div>' : '') +
          '<div class="bloc" style="flex-direction:row;align-items:center;gap:12px">' +
            '<span class="tuile" style="background:var(--' + c + '-c);border-color:var(--' + c + ');color:var(--' + c + '-f)">' +
              (ICONES[t] || ICONES['PANNE']) + '</span>' +
            '<span style="flex:1;min-width:0"><span style="display:block;font-size:1rem;font-weight:700">' + ech(brouillon.cafe) + '</span>' +
            '<span style="display:block;font-size:.82rem;color:var(--doux)">' + ech(libelleValeur()) + ' · ' + ech(brouillon.ville) + '</span></span></div>' +
          '<div class="champ"><label for="n">Nature de la panne</label>' +
            '<textarea id="n" rows="5" placeholder="Décris le problème en quelques mots">' + ech(brouillon.nature) + '</textarea></div>' +
          '<button class="btn btn-principal" type="submit">Continuer</button>' +
        '</form></div>';
    $('b-ret').addEventListener('click', () => brouillon.type === 'PANNE' ? etapeMachines() : etapeCafe());
    $('f').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const n = $('n').value.trim();
      if (!n) { etapeNature('Décris le problème avant de continuer.'); return; }
      brouillon.nature = n;
      etapeChoix();
    });
  }

  /* --- Étape 4 : je la prends ou je la dépose --- */
  function etapeChoix(msg) {
    const t = typeDeValeur(), c = COULEURS[t] || 'panne';
    app().innerHTML =
      '<div class="page">' + barreCreation('Tu la prends ?', 4) +
        '<div class="contenu">' +
          (msg ? '<div class="msg msg-err">' + ech(msg) + '</div>' : '') +
          '<div class="carte" style="box-shadow:none">' +
            '<div class="liseret" style="background:var(--' + c + ')"></div>' +
            '<div class="carte-corps">' +
              '<div class="carte-haut">' +
                '<span class="tuile" style="background:var(--' + c + '-c);border-color:var(--' + c + ');color:var(--' + c + '-f)">' +
                  (ICONES[t] || ICONES['PANNE']) + '</span>' +
                '<span class="carte-titres"><span class="nom">' + ech(brouillon.cafe) + '</span>' +
                '<span class="sous">' + ech(brouillon.ville) + ' · ' + ech(libelleValeur()) + '</span></span></div>' +
              '<div class="nature">' + ech(brouillon.nature) + '</div>' +
            '</div></div>' +
        '</div>' +
        '<div class="actions">' +
          '<button class="btn btn-prendre" id="b-prendre">' +
            SVG('<path d="M20 6L9 17l-5-5"/>') + 'Je la prends</button>' +
          '<button class="btn btn-second" id="b-deposer">' +
            SVG('<path d="M12 5v14M5 12h14"/>') + 'Je la dépose pour tout le monde</button>' +
          '<div style="text-align:center;font-size:.8rem;color:var(--doux);line-height:1.45">' +
            'Déposée : elle part en attente et le groupe est prévenu du lundi au vendredi, de 9 h à 17 h.</div>' +
        '</div></div>';
    $('b-ret').addEventListener('click', () => etapeNature());
    $('b-prendre').addEventListener('click', () => envoyerCreation(true));
    $('b-deposer').addEventListener('click', () => envoyerCreation(false));
  }

  async function envoyerCreation(prendre) {
    if (etat.enCours) return;
    etat.enCours = true;
    const b = $(prendre ? 'b-prendre' : 'b-deposer');
    const autre = $(prendre ? 'b-deposer' : 'b-prendre');
    b.disabled = true; autre.disabled = true; b.textContent = 'Enregistrement...';
    const r = await appeler({ action: 'creer', licence: brouillon.licence, cafe: brouillon.cafe,
                              appareil: brouillon.appareil, nature: brouillon.nature, prendre });
    etat.enCours = false;
    if (!r.ok) {
      if (r.erreur === 'session_invalide') { router(); return; }
      etapeChoix(dire(r.erreur));
      return;
    }
    etapeConfirmation(prendre);
  }

  /* --- Confirmation --- */
  function etapeConfirmation(prendre) {
    const vert = prendre ? 'var(--cours)' : 'var(--accent)';
    app().innerHTML =
      '<div class="page">' +
        '<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:24px;text-align:center">' +
          '<div style="width:90px;height:90px;border-radius:45px;background:' + vert + ';color:#fff;display:flex;align-items:center;justify-content:center">' +
            SVG('<path d="M20 6L9 17l-5-5"/>').replace('<svg', '<svg style="width:46px;height:46px" stroke-width="2.5"') + '</div>' +
          '<div><div style="font-weight:800;font-size:1.5rem;letter-spacing:-.02em">' +
            (prendre ? 'Intervention prise' : 'Intervention déposée') + '</div>' +
            '<div style="font-size:.95rem;color:var(--doux);margin-top:6px;line-height:1.5">' + ech(brouillon.cafe) + '<br>' +
            (prendre ? 'Elle est en cours à ton nom.' : 'Elle est en attente pour tout le monde.') + '</div></div>' +
        '</div>' +
        '<div class="actions">' +
          '<button class="btn btn-principal" id="b-liste">Voir la liste</button>' +
          '<button class="btn btn-second" id="b-encore">Encoder une autre intervention</button>' +
        '</div></div>';
    $('b-liste').addEventListener('click', () => { vueListe(); chargerListe(true); });
    $('b-encore').addEventListener('click', vueNouvelle);
  }

  /* ---------- Écran : détail d'une intervention ---------- */
  function vueDetail(i, msg) {
    const c = COULEURS[i.type] || 'panne';
    const estRappel = i.type === 'RAPPEL';
    const aMoi = i.techniciens.includes(etat.moi.nom);
    const adresse = [i.cafe, i.adresse, [i.codePostal, i.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    const maps = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(adresse);

    let etiqs = '';
    if (i.statut === 'En cours') {
      etiqs += '<span class="etiq etiq-cours">En cours · ' + ech(i.techniciens.join(' , ') || '?') + '</span>';
    } else {
      const d = depuis(i.horodateurTexte, etat.maintenant);
      etiqs += '<span class="etiq etiq-attente">En attente' + (d ? ' depuis ' + d : '') + '</span>';
      if (i.reserveLe) etiqs += '<span class="etiq etiq-reserve">' + ech(i.reserveLe) + '</span>';
    }
    const h = heureDe(i.horodateurTexte);
    if (h) etiqs += '<span class="etiq" style="background:var(--carte);border:1px solid var(--bord)">Ajoutée à ' + h + '</span>';

    let boutons = '';
    if (estRappel) {
      boutons = '<button class="btn btn-prendre" data-a="fait">Marquer comme fait</button>';
    } else if (i.statut === 'En attente') {
      boutons = '<button class="btn btn-prendre" data-a="prendre">Prendre cette intervention</button>' +
        '<div class="deux">' +
          (i.reservePar === etat.moi.nom
            ? '<button class="btn btn-second" data-a="liberer">Libérer</button>'
            : (i.reservePar ? '' : '<button class="btn btn-reserver" data-a="reserver">Réserver pour moi</button>')) +
        '</div>';
    } else if (i.statut === 'En cours') {
      boutons = (aMoi
          ? '<button class="btn btn-principal" data-a="cloture">Clôturer l’intervention</button>'
          : '<button class="btn btn-prendre" data-a="accompagner">Accompagner ' + ech(i.techniciens[0] || '') + '</button>') +
        (aMoi ? '' : '<div style="text-align:center;font-size:.82rem;color:var(--doux)">Ton nom sera ajouté : ' +
          ech(i.techniciens.concat([etat.moi.nom]).join(' , ')) + '</div>');
    }

    app().innerHTML =
      '<div class="page">' +
        '<div class="barre-haut"><button class="btn-retour" id="b-ret" aria-label="Retour à la liste">' + FLECHE + '</button>' +
          '<span style="font-size:.95rem;font-weight:600;color:var(--doux)">Intervention</span></div>' +
        '<div style="padding:8px 20px 18px;display:flex;flex-direction:column;gap:14px">' +
          '<div style="display:flex;align-items:center;gap:14px">' +
            '<span class="tuile" style="width:56px;height:56px;border-radius:18px;background:var(--' + c + '-c);border-color:var(--' + c + ');color:var(--' + c + '-f)">' +
              (ICONES[i.type] || '').replace('<svg', '<svg style="width:30px;height:30px"') + '</span>' +
            '<div><div style="font-weight:800;font-size:1.45rem;letter-spacing:-.02em">' + ech(estRappel ? 'Alerte' : i.cafe) + '</div>' +
              '<div style="font-size:.88rem;color:var(--doux);margin-top:2px">' + ech(LIBELLES[i.type] + (i.appareil && !estRappel ? ' · ' + i.appareil : '')) + '</div></div>' +
          '</div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap">' + etiqs + '</div>' +
        '</div>' +
        '<div class="contenu" style="padding-top:0">' +
          (msg ? '<div class="msg msg-err">' + ech(msg) + '</div>' : '') +
          (i.nature ? '<div class="bloc"><div class="lib">Problème signalé</div><div class="val">' + ech(i.nature) + '</div></div>' : '') +
          (i.encaisser ? '<div class="msg msg-info">' + ech(i.encaisser) + '</div>' : '') +
          (i.consigne ? '<div class="msg msg-info">' + ech(i.consigne) + '</div>' : '') +
          (i.livraisonLe ? '<div class="bloc"><div class="lib">Livraison</div><div class="val">' + ech(i.livraisonLe) + '</div></div>' : '') +
          (estRappel ? '' :
            '<div class="carte-plan">' +
              '<iframe title="Carte" loading="lazy" referrerpolicy="no-referrer" src="https://maps.google.com/maps?q=' + encodeURIComponent(adresse) + '&z=15&output=embed"></iframe>' +
              '<div class="carte-adresse">' +
                SVG('<path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>') +
                '<span style="flex:1"><span style="display:block;font-size:.75rem;color:var(--doux)">Adresse</span>' +
                '<span style="display:block;font-size:.95rem;font-weight:600">' + ech(adresse) + '</span></span>' +
              '</div>' +
              // Téléphone du café : permet d'appeler avant de se déplacer.
              (i.telephone ? '<a class="carte-tel" href="tel:' + ech(String(i.telephone).replace(/[^0-9+]/g, '')) + '">' +
                SVG('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>') +
                '<span style="flex:1"><span style="display:block;font-size:.75rem;color:var(--doux)">Téléphone</span>' +
                '<span style="display:block;font-size:.95rem;font-weight:700">' + ech(i.telephone) + '</span></span>' +
                CHEVRON + '</a>' : '') +
              '</div>' +
            '<div class="itineraire">' +
              '<a class="it-plan" href="https://maps.apple.com/?daddr=' + encodeURIComponent(adresse) + '&dirflg=d" target="_blank" rel="noopener">' +
                SVG('<path d="M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3z"/><path d="M9 4v13M15 7v13"/>') + 'Plan</a>' +
              '<a class="it-maps" href="https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(adresse) + '&travelmode=driving" target="_blank" rel="noopener">' +
                SVG('<path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>') + 'Maps</a>' +
              '<a class="it-waze" href="https://www.waze.com/ul?q=' + encodeURIComponent(adresse) + '&navigate=yes" target="_blank" rel="noopener">' +
                SVG('<circle cx="12" cy="11" r="8"/><path d="M9 10h.01M15 10h.01M9 14.5a4 4 0 0 0 6 0"/>') + 'Waze</a>' +
            '</div>') +
          (i.debut ? '<div class="bloc"><div class="lib">Début</div><div class="val">' + ech(i.debut.replace('T', ' à ')) + '</div></div>' : '') +
        '</div>' +
        (boutons ? '<div class="actions" id="act">' + boutons + '</div>' : '') +
      '</div>';

    $('b-ret').addEventListener('click', () => { vueListe(); chargerListe(); });
    const act = $('act');
    if (act) act.addEventListener('click', async (ev) => {
      const b = ev.target.closest('button[data-a]'); if (!b) return;
      if (b.dataset.a === 'cloture') { vueCloture(i); return; }
      if (etat.enCours) return;
      etat.enCours = true;
      const avant = b.textContent; b.disabled = true; b.textContent = 'En cours...';
      const r = await appeler({ action: b.dataset.a, horodateur: i.horodateur, ligne: i.ligne });
      etat.enCours = false;
      if (!r.ok) {
        if (r.erreur === 'session_invalide') { router(); return; }
        await chargerListeSilencieuse();
        const maj = etat.interventions.find((x) => x.horodateur === i.horodateur);
        vueDetail(maj || i, dire(r.erreur));
        return;
      }
      await chargerListeSilencieuse();
      vueListe();
    });
  }

  async function chargerListeSilencieuse() {
    const r = await appeler({ action: 'liste' });
    if (r.ok) { etat.interventions = r.interventions; etat.maintenant = r.maintenant; etat.erreur = ''; }
  }

  /* ---------- Écran : clôture ---------- */
  function vueCloture(i, msg) {
    const estCafe = i.type === 'MACHINE A CAFE';
    app().innerHTML =
      '<div class="page">' +
        '<div class="barre-haut"><button class="btn-retour" id="b-ret" aria-label="Retour">' + FLECHE + '</button>' +
          '<div><h2>Clôturer l’intervention</h2>' +
          '<div style="font-size:.82rem;color:var(--doux)">' + ech([i.cafe, i.appareil].filter(Boolean).join(' · ')) + '</div></div></div>' +
        '<form id="f-clo" class="contenu">' +
          (msg ? '<div class="msg msg-err">' + ech(msg) + '</div>' : '') +
          '<div class="bloc" style="flex-direction:row;align-items:center;gap:14px">' +
            '<span class="tuile" style="background:var(--accent-clair);border-color:var(--accent-clair);color:var(--accent-fonce)">' +
              SVG('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>') + '</span>' +
            '<span style="flex:1"><span style="display:block;font-size:.75rem;color:var(--doux)">Début de l’intervention</span>' +
            '<span style="display:block;font-size:1.05rem;font-weight:800">' + ech(i.debut ? i.debut.replace('T', ' à ') : 'non renseigné') + '</span></span></div>' +
          '<div class="bloc"><div class="champ"><label for="nat">Nature / travail effectué</label>' +
            '<textarea id="nat" rows="4">' + ech(i.nature) + '</textarea></div></div>' +
          (estCafe ?
            '<div class="bloc" style="gap:14px">' +
              '<div class="lib">Rapport machine à café</div>' +
              '<div class="champ"><label for="tm">Type de machine</label><input id="tm" type="text"></div>' +
              '<div class="champ"><label for="ns">Numéro de série</label><input id="ns" type="text"></div>' +
              '<div class="champ"><label for="com">Commentaire</label><textarea id="com" rows="3"></textarea></div>' +
              '<div class="champ"><label for="sig">Nom du signataire</label><input id="sig" type="text"></div>' +
              '<div style="font-size:.82rem;color:var(--doux);line-height:1.45">La signature du client et les pièces remplacées seront ajoutées dans une prochaine version.</div>' +
            '</div>' : '') +
          '<button class="btn btn-prendre" type="submit" id="b-clo" style="margin-top:4px">Terminer l’intervention</button>' +
        '</form>' +
      '</div>';
    $('b-ret').addEventListener('click', () => vueDetail(i));
    $('f-clo').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const b = $('b-clo'); b.disabled = true; b.textContent = 'Enregistrement...';
      const corps = { action: 'terminer', horodateur: i.horodateur, ligne: i.ligne, nature: $('nat').value };
      if (estCafe) {
        corps.typeMachine = $('tm').value; corps.numeroSerie = $('ns').value;
        corps.commentaire = $('com').value; corps.nomSignataire = $('sig').value;
      }
      const r = await appeler(corps);
      if (!r.ok) {
        if (r.erreur === 'session_invalide') { router(); return; }
        vueCloture(i, dire(r.erreur)); return;
      }
      await chargerListeSilencieuse();
      vueListe();
    });
  }

  /* ---------- Écran : mon compte ---------- */
  function vueCompte() {
    const admin = etat.moi.role === 'admin';
    app().innerHTML =
      '<div class="page">' +
        '<div class="barre-haut"><button class="btn-retour" id="b-ret" aria-label="Retour à la liste">' + FLECHE + '</button>' +
          '<span style="font-size:.95rem;font-weight:600;color:var(--doux)">Mon compte</span></div>' +
        '<div style="padding:12px 20px 20px;display:flex;align-items:center;gap:16px">' +
          '<span class="rond moi" style="width:72px;height:72px;border-radius:36px;font-size:1.8rem">' + ech(initiale(etat.moi.nom)) + '</span>' +
          '<div><div style="font-weight:800;font-size:1.6rem;letter-spacing:-.01em">' + ech(etat.moi.nom) + '</div>' +
            '<span class="badge ' + (admin ? 'badge-admin' : 'badge-actif') + '" style="display:inline-block;margin-top:4px">' +
            (admin ? 'Administrateur' : 'Technicien') + '</span></div>' +
        '</div>' +
        '<div class="contenu" style="gap:10px">' +
          (admin ? '<button class="ligne-tech" id="b-tech">' +
            '<span class="rond" style="border-radius:12px;background:var(--accent-clair);color:var(--accent-fonce)">' +
              SVG('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>').replace('<svg', '<svg style="width:22px;height:22px"') + '</span>' +
            '<span style="flex:1;font-size:1rem;font-weight:700">Gérer les techniciens</span>' + CHEVRON + '</button>' : '') +
          '<button class="ligne-tech" id="b-chg">' +
            '<span class="rond" style="border-radius:12px">' + SVG('<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>').replace('<svg', '<svg style="width:22px;height:22px"') + '</span>' +
            '<span style="flex:1;font-size:1rem;font-weight:700">Changer mon mot de passe</span>' + CHEVRON + '</button>' +
          '<button class="btn btn-rouge" id="b-out" style="margin-top:8px">' +
            SVG('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>') + 'Se déconnecter</button>' +
        '</div>' +
        '<div style="text-align:center;font-size:.72rem;color:var(--doux);padding:14px 0 28px">' + VERSION_APPLI + '</div>' +
      '</div>';
    $('b-ret').addEventListener('click', () => { vueListe(); chargerListe(); });
    $('b-chg').addEventListener('click', () => vueChangerMdp());
    $('b-out').addEventListener('click', () => {
      oublierJeton(); etat.jeton = ''; etat.moi = null; etat.interventions = []; vueConnexion();
    });
    const bt = $('b-tech'); if (bt) bt.addEventListener('click', () => vueTechniciens());
  }

  function vueChangerMdp(msg, ok) {
    app().innerHTML =
      '<div class="page">' +
        '<div class="barre-haut"><button class="btn-retour" id="b-ret" aria-label="Retour">' + FLECHE + '</button>' +
          '<h2>Changer mon mot de passe</h2></div>' +
        '<form id="f" class="contenu">' +
          (msg ? '<div class="msg ' + (ok ? 'msg-ok' : 'msg-err') + '">' + ech(msg) + '</div>' : '') +
          '<div class="bloc" style="gap:16px">' +
            '<div class="champ"><label for="a">Mot de passe actuel</label><input id="a" type="password" autocomplete="current-password" required></div>' +
            '<div class="champ"><label for="n">Nouveau mot de passe</label><input id="n" type="password" autocomplete="new-password" minlength="6" required></div>' +
          '</div>' +
          '<button class="btn btn-principal" type="submit" id="b">Enregistrer</button>' +
        '</form></div>';
    $('b-ret').addEventListener('click', vueCompte);
    $('f').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const b = $('b'); b.disabled = true; b.textContent = 'Enregistrement...';
      const r = await appeler({ action: 'changer_mdp', ancien: $('a').value, nouveau: $('n').value });
      if (!r.ok) { vueChangerMdp(dire(r.erreur), false); return; }
      etat.moi = r.utilisateur;
      vueChangerMdp('Mot de passe modifié.', true);
    });
  }

  /* ---------- Écran : gérer les techniciens (administrateur) ---------- */
  let ouvert = '';
  async function vueTechniciens(msg, ok) {
    app().innerHTML =
      '<div class="page">' +
        '<div class="barre-haut"><button class="btn-retour" id="b-ret" aria-label="Retour">' + FLECHE + '</button>' +
          '<h2>Techniciens</h2></div>' +
        '<div class="contenu" id="c"><div class="chargement"><span class="tourne"></span> Chargement...</div></div>' +
      '</div>';
    $('b-ret').addEventListener('click', vueCompte);
    const r = await appeler({ action: 'admin_liste' });
    if (!r.ok) { $('c').innerHTML = '<div class="msg msg-err">' + ech(dire(r.erreur)) + '</div>'; return; }
    const lignes = r.utilisateurs.map((u) => {
      const moi = u.nom === etat.moi.nom;
      const badge = !u.actif ? '<span class="badge badge-off">Désactivé</span>'
        : u.provisoire ? '<span class="badge badge-prov">Mdp provisoire</span>'
        : u.role === 'admin' ? '<span class="badge badge-admin">Admin</span>'
        : '<span class="badge badge-actif">Actif</span>';
      const haut = '<span class="rond' + (moi ? ' moi' : '') + '">' + ech(initiale(u.nom)) + '</span>' +
        '<span style="flex:1;font-size:1rem;font-weight:800">' + ech(u.nom) +
        (moi ? ' <span style="font-size:.8rem;font-weight:600;color:var(--doux)">· toi</span>' : '') + '</span>' + badge;
      if (ouvert !== u.nom) {
        return '<button class="ligne-tech" data-n="' + ech(u.nom) + '">' + haut + (moi ? '' : CHEVRON) + '</button>';
      }
      return '<div class="ligne-tech ouvert"><div style="min-height:64px;display:flex;align-items:center;gap:12px">' + haut + '</div>' +
        '<div class="petits">' +
          '<button class="pr" data-act="admin_reinitialiser" data-n="' + ech(u.nom) + '">Réinitialiser</button>' +
          '<button class="sec" data-act="' + (u.actif ? 'admin_desactiver' : 'admin_activer') + '" data-n="' + ech(u.nom) + '">' +
            (u.actif ? 'Désactiver' : 'Réactiver') + '</button>' +
          '<button data-act="admin_supprimer" data-n="' + ech(u.nom) + '">Supprimer</button>' +
        '</div></div>';
    }).join('');
    $('c').innerHTML =
      (msg ? '<div class="msg ' + (ok ? 'msg-ok' : 'msg-err') + '">' + ech(msg) + '</div>' : '') +
      '<div style="font-size:.82rem;color:var(--doux);padding:0 4px 4px">' + r.utilisateurs.length + ' comptes. Touche un nom pour agir.</div>' +
      lignes +
      '<form id="f-add" class="bloc" style="gap:12px;margin-top:8px">' +
        '<div class="lib">Ajouter un technicien</div>' +
        '<div class="champ"><label for="nn" class="sr">Nom</label>' +
          '<input id="nn" type="text" placeholder="DAVID" autocapitalize="characters" spellcheck="false" required style="font-weight:700"></div>' +
        '<div class="champ"><label for="mp">Mot de passe provisoire</label><input id="mp" type="text" value="123456"></div>' +
        '<button class="btn btn-principal" type="submit" id="b-add" style="height:50px">Ajouter</button>' +
      '</form>';

    $('c').addEventListener('click', async (ev) => {
      const a = ev.target.closest('button[data-act]');
      if (a) {
        if (a.dataset.act === 'admin_supprimer' && !confirm('Supprimer définitivement le compte ' + a.dataset.n + ' ?')) return;
        a.disabled = true;
        const res = await appeler({ action: a.dataset.act, nom: a.dataset.n });
        if (!res.ok) { vueTechniciens(dire(res.erreur), false); return; }
        ouvert = '';
        let m = 'Compte ' + a.dataset.n + ' mis à jour.';
        if (res.motdepasse) m = 'Mot de passe de ' + a.dataset.n + ' remis à « ' + res.motdepasse + ' ». Il devra le changer.';
        vueTechniciens(m, true);
        return;
      }
      const l = ev.target.closest('button[data-n]'); if (!l) return;
      ouvert = ouvert === l.dataset.n ? '' : l.dataset.n;
      vueTechniciens();
    });
    $('f-add').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const b = $('b-add'); b.disabled = true; b.textContent = 'Ajout...';
      const nom = $('nn').value, mdp = $('mp').value;
      const res = await appeler({ action: 'admin_ajouter', nom, motdepasse: mdp });
      if (!res.ok) { vueTechniciens(dire(res.erreur), false); return; }
      ouvert = '';
      vueTechniciens('Compte ' + res.nom + ' créé. Mot de passe provisoire : « ' + res.motdepasse + ' ».', true);
    });
  }

  /* ---------- Aiguillage ---------- */
  async function router() {
    if (!etat.jeton) { vueConnexion(); return; }
    if (!etat.moi) {
      app().innerHTML = '<div class="chargement" style="padding:80px"><span class="tourne"></span> Connexion...</div>';
      const r = await appeler({ action: 'moi' });
      if (!r.ok) { vueConnexion(r.erreur === 'session_invalide' ? '' : dire(r.erreur)); return; }
      etat.moi = r.utilisateur;
    }
    if (etat.moi.doitChanger) { vueMotDePasse(); return; }
    vueListe();
    chargerListe();
  }

  /* ---------- Démarrage ---------- */
  etat.jeton = lireJeton();
  router();

  // Actualisation régulière quand l'appli est au premier plan et qu'on est sur la liste.
  setInterval(() => {
    if (document.hidden || !etat.moi || etat.moi.doitChanger) return;
    if (document.querySelector('header')) chargerListe();
  }, RAFRAICHIR_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && etat.moi && !etat.moi.doitChanger && document.querySelector('header')) chargerListe();
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js')
      .then((reg) => { reg.update(); setInterval(() => reg.update(), 300000); }).catch(() => {}));
  }
})();
