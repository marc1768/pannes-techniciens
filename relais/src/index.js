/**
 * Relais « techniciens » — Cloudflare Worker + Durable Object
 *
 * Indépendant du relais d'encodage des pannes. Il fait ce que fait AppSheet : lire les interventions
 * actives dans la feuille Google et modifier les mêmes cellules, au même format. Il ajoute la connexion
 * de chaque technicien par son nom (comme le livre de recettes) et un module administrateur.
 *
 * Toutes les requêtes sont des POST JSON ({ action, ... }). Réponses : { ok: true, ... } ou { ok: false, erreur }.
 *
 * Secrets Cloudflare (jamais dans ce code) :
 *   GOOGLE_SA_JSON   fichier JSON complet de la clé du compte de service (même compte que l'autre relais)
 *   SETUP_KEY        clé servant UNE fois à créer le premier compte administrateur
 * Variables (wrangler.toml) : SHEET_ID, ONGLET_REPONSES, ORIGINE_AUTORISEE
 *
 * Sécurité des comptes :
 *  - mots de passe hachés (PBKDF2-SHA-256 + sel), jamais conservés en clair ;
 *  - session = jeton signé (HMAC) valable 365 jours si « rester connecté », sinon 12 heures ;
 *  - chaque compte a un numéro de version : réinitialiser, désactiver ou changer le mot de passe invalide
 *    toutes les sessions déjà ouvertes ;
 *  - le changement du mot de passe provisoire est imposé par le serveur (aucune autre action n'est acceptée avant) ;
 *  - 5 échecs depuis une même adresse IP = blocage de 10 minutes (adresse jamais stockée, seulement une empreinte).
 *
 * Tout passe par UN SEUL Durable Object : les écritures dans la feuille se font une à la fois.
 */

import { DurableObject } from 'cloudflare:workers';
import {
  APPAREILS, STATUTS_ACTIFS, txt, telephone, listeValeurs, joindre, nettoyer, typeDe, priorite, reserveLe, livraisonLe,
  encaisser, natureCourte, consigne, ticketLiv, colonne, serieBruxelles, isoDepuisSerie, FORMAT_DATE_HEURE,
  FORMAT_DUREE, dureeSerie, texteBruxelles, fenetreNotification
} from './calculs.js';

const MDP_PROVISOIRE = '123456';
const URL_APPLI = 'https://marc1768.github.io/pannes-techniciens/';   // lien envoyé dans l'invitation
const MDP_MIN = 6;
const ITERATIONS = 100000;
const MAX_ECHECS = 5;
const BLOCAGE_MS = 600 * 1000;
const JETON_LONG_MS = 365 * 86400 * 1000;
const JETON_COURT_MS = 12 * 3600 * 1000;
const LIGNES_LISTE = 500;
const CACHE_DETAILS_MS = 60 * 1000;   // le détail change à chaque vente : cache court
const CACHE_PLACES_MS = 600 * 1000;      // liste des cafés : 10 minutes
// Titre de la notification Pushover selon le type, comme la PWA d'encodage.
const TITRES = { 'MACHINE A CAFE': 'Machine à café', 'ENTRETIEN': 'Nouvel entretien',
                 'LIVRAISON': 'Nouvelle livraison', 'LIVRAISON HORECA': 'Nouvelle livraison Horeca',
                 'RAPPEL': 'Nouvelle alerte' };
const COLONNES_REQUISES = ['Horodateur', 'Technicien', 'Café/Salle:', 'Ville', 'Appareils café', 'Nature de la panne',
  'Début', 'Fin', 'Durée', 'Statut', 'ReservePar', 'DateLivraison'];

/* ---------- Point d'entrée Worker : CORS + transmission au Durable Object ---------- */

export default {
  async fetch(request, env) {
    const origine = request.headers.get('Origin') || '';
    const autorisee = String(env.ORIGINE_AUTORISEE || '').split(',').map((s) => s.trim()).filter(Boolean);
    const entetesCors = {
      'Access-Control-Allow-Origin': autorisee.includes(origine) ? origine : (autorisee[0] || '*'),
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin'
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: entetesCors });
    let corps;
    if (request.method === 'GET') corps = { action: '__ping' };
    else if (request.method === 'POST') { try { corps = JSON.parse(await request.text()); } catch (e) { corps = null; } }
    let resultat;
    if (!corps || typeof corps !== 'object') resultat = { ok: false, erreur: 'erreur_serveur' };
    else {
      const stub = env.RELAIS.get(env.RELAIS.idFromName('principal'));
      const ip = (env.TEST_IP_HEADER && request.headers.get(env.TEST_IP_HEADER)) || request.headers.get('CF-Connecting-IP') || 'inconnue';
      try { resultat = await stub.traiter(corps, ip); }
      catch (e) { console.error('Relais erreur : ' + (e && e.stack || e)); resultat = { ok: false, erreur: 'erreur_serveur' }; }
    }
    return new Response(JSON.stringify(resultat), {
      headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, entetesCors)
    });
  }
};

/* ---------- Durable Object ---------- */

export class Relais extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
    this.jetonGoogle_ = null;
    this.positions = null;
    this.places = null;
    this.sheetIdNum = null;
    this.derniereLigne = 0;
    this.verrou = Promise.resolve();
    this.cleSel = null;
    this.cleJeton = null;
  }

  async traiter(req, ip) {
    try {
      if (req.action === '__ping') return { ok: true, message: 'Service actif' };
      const empreinte = await this.empreinteIp(ip);
      switch (req.action) {
        case 'installer': return await this.installer(req, empreinte);
        case 'login': return await this.login(req, empreinte);
      }
      // Toutes les autres actions demandent une session valide.
      const u = await this.verifierJeton(req.jeton);
      if (!u) return { ok: false, erreur: 'session_invalide' };
      if (req.action === 'moi') return await this.moi(u, req.jeton);
      if (req.action === 'changer_mdp') return await this.changerMdp(u, req);
      if (u.provisoire) return { ok: false, erreur: 'changer_mdp' };        // imposé par le serveur
      if (req.action.indexOf('admin_') === 0) {
        if (u.role !== 'admin') return { ok: false, erreur: 'refuse' };
        // L'envoi du mail peut prendre quelques secondes : hors verrou, il ne bloque pas les autres.
        if (req.action === 'admin_inviter') return await this.inviter(u, req);
        return await this.avecVerrou(() => this.admin(u, req));
      }
      switch (req.action) {
        case 'liste': return await this.liste();
        case 'cafes': return await this.cafes();
        case 'creer': return await this.avecVerrou(() => this.creer(u, req));
        case 'prendre': return await this.avecVerrou(() => this.agir('prendre', u, req));
        case 'accompagner': return await this.avecVerrou(() => this.agir('accompagner', u, req));
        case 'reserver': return await this.avecVerrou(() => this.agir('reserver', u, req));
        case 'liberer': return await this.avecVerrou(() => this.agir('liberer', u, req));
        case 'terminer': return await this.avecVerrou(() => this.agir('terminer', u, req));
        case 'fait': return await this.avecVerrou(() => this.agir('fait', u, req));
        default: return { ok: false, erreur: 'action_inconnue' };
      }
    } catch (e) {
      console.error('Relais erreur : ' + (e && e.stack || e));
      return { ok: false, erreur: 'erreur_serveur' };
    }
  }

  avecVerrou(fn) {
    const suite = this.verrou.then(fn, fn);
    this.verrou = suite.catch(() => {});
    return suite;
  }

  /* ---------- Outils de sécurité ---------- */

  async empreinteIp(ip) {
    if (!this.cleSel) {
      let sel = await this.ctx.storage.get('sel_ip');
      if (!sel) { sel = hex(crypto.getRandomValues(new Uint8Array(32))); await this.ctx.storage.put('sel_ip', sel); }
      this.cleSel = await crypto.subtle.importKey('raw', new TextEncoder().encode(sel), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    }
    const sig = await crypto.subtle.sign('HMAC', this.cleSel, new TextEncoder().encode(String(ip || 'inconnue')));
    return hex(new Uint8Array(sig).slice(0, 16));
  }

  async estBloque(genre, empreinte) {
    const c = await this.ctx.storage.get('echecs_' + genre + '_' + empreinte);
    return !!(c && c.exp > Date.now() && c.n >= MAX_ECHECS);
  }
  async noterEchec(genre, empreinte) {
    const cle = 'echecs_' + genre + '_' + empreinte, maintenant = Date.now();
    const c = await this.ctx.storage.get(cle);
    const n = c && c.exp > maintenant ? c.n : 0;
    await this.ctx.storage.put(cle, { n: n + 1, exp: maintenant + BLOCAGE_MS });
  }
  async effacerEchecs(genre, empreinte) { await this.ctx.storage.delete('echecs_' + genre + '_' + empreinte); }

  async hacher(mdp, selHex, iter) {
    const cle = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(mdp)), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: deHex(selHex), iterations: iter, hash: 'SHA-256' }, cle, 256);
    return hex(new Uint8Array(bits));
  }
  async creerSecret(mdp) {
    const sel = hex(crypto.getRandomValues(new Uint8Array(16)));
    return { sel, iter: ITERATIONS, hash: await this.hacher(mdp, sel, ITERATIONS) };
  }
  async mdpCorrect(u, mdp) { return egalConstant(await this.hacher(mdp, u.sel, u.iter), u.hash); }

  async cleDeJeton() {
    if (!this.cleJeton) {
      let s = await this.ctx.storage.get('cle_jeton');
      if (!s) { s = hex(crypto.getRandomValues(new Uint8Array(32))); await this.ctx.storage.put('cle_jeton', s); }
      this.cleJeton = await crypto.subtle.importKey('raw', new TextEncoder().encode(s), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    }
    return this.cleJeton;
  }
  async creerJeton(u, rester) {
    const charge = b64url(JSON.stringify({ n: u.nom, v: u.version, e: Date.now() + (rester ? JETON_LONG_MS : JETON_COURT_MS), r: rester ? 1 : 0 }));
    const sig = await crypto.subtle.sign('HMAC', await this.cleDeJeton(), new TextEncoder().encode(charge));
    return charge + '.' + b64url(sig);
  }
  // Renvoie l'utilisateur si le jeton est authentique, non expiré, du compte actif et de la bonne version.
  async verifierJeton(jeton) {
    const m = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(jeton || ''));
    if (!m) return null;
    let ok = false;
    try { ok = await crypto.subtle.verify('HMAC', await this.cleDeJeton(), deB64url(m[2]), new TextEncoder().encode(m[1])); } catch (e) { return null; }
    if (!ok) return null;
    let p; try { p = JSON.parse(new TextDecoder().decode(deB64url(m[1]))); } catch (e) { return null; }
    if (!p || p.e < Date.now()) return null;
    const u = await this.lireUtilisateur(p.n);
    if (!u || !u.actif || u.version !== p.v) return null;
    u.rester = !!p.r;
    return u;
  }
  publicUtil(u) { return { nom: u.nom, role: u.role, doitChanger: !!u.provisoire }; }

  /* ---------- Comptes ---------- */

  async lireUtilisateur(nom) { return (await this.ctx.storage.get('u_' + nom)) || null; }
  async ecrireUtilisateur(u) { await this.ctx.storage.put('u_' + u.nom, u); }
  async tousUtilisateurs() { return [...(await this.ctx.storage.list({ prefix: 'u_' })).values()]; }

  async installer(req, empreinte) {
    if (await this.estBloque('setup', empreinte)) return { ok: false, erreur: 'bloque' };
    if ((await this.ctx.storage.list({ prefix: 'u_', limit: 1 })).size) return { ok: false, erreur: 'deja_installe' };
    if (!this.env.SETUP_KEY || !egalConstant(String(req.cle || ''), String(this.env.SETUP_KEY))) {
      await this.noterEchec('setup', empreinte);
      return { ok: false, erreur: 'cle' };
    }
    const nom = normaliserNom(req.nom);
    if (!nom) return { ok: false, erreur: 'nom_invalide' };
    if (String(req.motdepasse || '').length < MDP_MIN) return { ok: false, erreur: 'mdp_court' };
    await this.effacerEchecs('setup', empreinte);
    const u = Object.assign({ nom, role: 'admin', actif: true, provisoire: false, version: 1, cree: Date.now(), dernier: 0 },
                            await this.creerSecret(req.motdepasse));
    await this.ecrireUtilisateur(u);
    return { ok: true, jeton: await this.creerJeton(u, true), utilisateur: this.publicUtil(u) };
  }

  async login(req, empreinte) {
    if (await this.estBloque('login', empreinte)) return { ok: false, erreur: 'bloque' };
    const nom = normaliserNom(req.nom);
    const u = nom ? await this.lireUtilisateur(nom) : null;
    let correct = false;
    if (u) correct = await this.mdpCorrect(u, req.motdepasse);
    else await this.hacher(req.motdepasse, '00'.repeat(16), ITERATIONS);        // même durée : on ne révèle pas si le nom existe
    if (!correct) { await this.noterEchec('login', empreinte); return { ok: false, erreur: 'identifiants' }; }
    await this.effacerEchecs('login', empreinte);
    if (!u.actif) return { ok: false, erreur: 'compte_desactive' };
    u.dernier = Date.now();
    await this.ecrireUtilisateur(u);
    return { ok: true, jeton: await this.creerJeton(u, !!req.rester), utilisateur: this.publicUtil(u) };
  }

  // Renouvelle la session « rester connecté » à chaque ouverture de l'appli.
  async moi(u, jeton) {
    const rep = { ok: true, utilisateur: this.publicUtil(u) };
    if (u.rester) rep.jeton = await this.creerJeton(u, true);
    return rep;
  }

  async changerMdp(u, req) {
    if (!(await this.mdpCorrect(u, req.ancien))) return { ok: false, erreur: 'mdp_actuel' };
    const nouveau = String(req.nouveau || '');
    if (nouveau.length < MDP_MIN) return { ok: false, erreur: 'mdp_court' };
    if (nouveau === String(req.ancien) || nouveau === MDP_PROVISOIRE) return { ok: false, erreur: 'mdp_identique' };
    Object.assign(u, await this.creerSecret(nouveau), { provisoire: false, version: u.version + 1 });
    const rester = u.rester; delete u.rester;
    await this.ecrireUtilisateur(u);                       // les autres sessions de ce compte sont invalidées
    return { ok: true, jeton: await this.creerJeton(u, rester), utilisateur: this.publicUtil(u) };
  }

  /* ---------- Invitation par mail (script Google Apps Script de Marc, MailApp) ---------- */

  // Envoie au technicien le lien de l'appli, son nom de connexion et, s'il est encore le mot de passe
  // de départ, ce mot de passe. Le relais ne connaît jamais un mot de passe choisi : il ne fait que vérifier
  // si le compte a toujours « 123456 ».
  async inviter(moi, req) {
    const nom = normaliserNom(req.nom);
    if (!nom) return { ok: false, erreur: 'nom_invalide' };
    const cible = (await this.tousUtilisateurs()).find((u) => u.nom === nom);
    if (!cible) return { ok: false, erreur: 'inconnu' };
    if (!cible.actif) return { ok: false, erreur: 'compte_desactive' };
    if (!cible.email) return { ok: false, erreur: 'email_manquant' };
    if (!this.env.MAIL_URL || !this.env.MAIL_CLE) return { ok: false, erreur: 'mail_non_configure' };
    const depart = cible.provisoire && (await this.mdpCorrect(cible, MDP_PROVISOIRE)) ? MDP_PROVISOIRE : '';
    let r;
    try {
      const rep = await fetch(this.env.MAIL_URL, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow',
        body: JSON.stringify({ cle: this.env.MAIL_CLE, action: 'inviter', a: cible.email, nom,
          role: cible.role, motdepasse: depart, lien: URL_APPLI, de: moi.nom }) });
      const texte = await rep.text();
      try { r = JSON.parse(texte); } catch (e) { return { ok: false, erreur: 'mail_echec' }; }
    } catch (e) { return { ok: false, erreur: 'mail_echec' }; }
    if (!r || !r.ok) return { ok: false, erreur: r && r.erreur === 'quota' ? 'mail_quota' : 'mail_echec' };
    await this.avecVerrou(async () => {
      const u = await this.ctx.storage.get('u_' + nom);
      if (u) { u.invite = Date.now(); await this.ecrireUtilisateur(u); }
    });
    return { ok: true, nom, email: cible.email, motdepasse: depart, restant: r.restant };
  }

  /* ---------- Module administrateur ---------- */

  async admin(moi, req) {
    const liste = await this.tousUtilisateurs();
    if (req.action === 'admin_liste') {
      return { ok: true, utilisateurs: liste.map((u) => ({ nom: u.nom, role: u.role, actif: u.actif, provisoire: !!u.provisoire,
        email: u.email || '', dernier: u.dernier || 0, invite: u.invite || 0 }))
        .sort((a, b) => a.nom.localeCompare(b.nom)) };
    }
    const nom = normaliserNom(req.nom);
    if (!nom) return { ok: false, erreur: 'nom_invalide' };
    const cible = liste.find((u) => u.nom === nom) || null;
    const admins = liste.filter((u) => u.role === 'admin' && u.actif);
    const mdp = req.motdepasse ? String(req.motdepasse) : MDP_PROVISOIRE;
    switch (req.action) {
      case 'admin_ajouter': {
        if (cible) return { ok: false, erreur: 'existe_deja' };
        if (mdp.length < MDP_MIN) return { ok: false, erreur: 'mdp_court' };
        const role = req.role === 'admin' ? 'admin' : 'technicien';
        await this.ecrireUtilisateur(Object.assign({ nom, role, actif: true, provisoire: true, version: 1,
                                                     email: courriel(req.email), cree: Date.now(), dernier: 0 },
                                                   await this.creerSecret(mdp)));
        return { ok: true, nom, role, motdepasse: mdp };
      }
      // Changer le rôle d'un compte. Le dernier administrateur actif ne peut pas être rétrogradé.
      case 'admin_role': {
        if (!cible) return { ok: false, erreur: 'inconnu' };
        const role = req.role === 'admin' ? 'admin' : 'technicien';
        if (role !== 'admin' && cible.role === 'admin' && cible.actif && admins.length <= 1) return { ok: false, erreur: 'dernier_admin' };
        cible.role = role; cible.version += 1;
        await this.ecrireUtilisateur(cible);
        return { ok: true, nom, role };
      }
      // Enregistrer ou corriger l'adresse e-mail, qui sert à envoyer l'invitation.
      case 'admin_email': {
        if (!cible) return { ok: false, erreur: 'inconnu' };
        cible.email = courriel(req.email);
        await this.ecrireUtilisateur(cible);
        return { ok: true, nom, email: cible.email };
      }
      case 'admin_reinitialiser': {
        if (!cible) return { ok: false, erreur: 'inconnu' };
        if (mdp.length < MDP_MIN) return { ok: false, erreur: 'mdp_court' };
        if (req.email !== undefined) cible.email = courriel(req.email);
        Object.assign(cible, await this.creerSecret(mdp), { provisoire: true, version: cible.version + 1 });
        await this.ecrireUtilisateur(cible);
        return { ok: true, nom, motdepasse: mdp };
      }
      case 'admin_desactiver': case 'admin_activer': {
        if (!cible) return { ok: false, erreur: 'inconnu' };
        const actif = req.action === 'admin_activer';
        if (!actif && (cible.nom === moi.nom || (cible.role === 'admin' && admins.length <= 1))) return { ok: false, erreur: 'dernier_admin' };
        cible.actif = actif; cible.version += 1;
        await this.ecrireUtilisateur(cible);
        return { ok: true, nom, actif };
      }
      case 'admin_supprimer': {
        if (!cible) return { ok: false, erreur: 'inconnu' };
        if (cible.nom === moi.nom || (cible.role === 'admin' && cible.actif && admins.length <= 1)) return { ok: false, erreur: 'dernier_admin' };
        await this.ctx.storage.delete('u_' + nom);
        return { ok: true, nom };
      }
      default: return { ok: false, erreur: 'action_inconnue' };
    }
  }

  /* ---------- Accès Google (compte de service, JWT RS256) ---------- */

  async jetonGoogle() {
    if (this.jetonGoogle_ && this.jetonGoogle_.exp > Date.now() + 60000) return this.jetonGoogle_.valeur;
    const sa = JSON.parse(this.env.GOOGLE_SA_JSON);
    const urlJeton = this.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
    const maintenant = Math.floor(Date.now() / 1000);
    const enTete = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const charge = b64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: urlJeton, iat: maintenant, exp: maintenant + 3600 }));
    const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
    const der = Uint8Array.from(atob(pem), (ch) => ch.charCodeAt(0));
    const cle = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cle, new TextEncoder().encode(enTete + '.' + charge));
    const rep = await fetch(urlJeton, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + enTete + '.' + charge + '.' + b64url(signature) });
    if (!rep.ok) throw new Error('Jeton Google refusé : ' + rep.status);
    const j = await rep.json();
    this.jetonGoogle_ = { valeur: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
    return this.jetonGoogle_.valeur;
  }

  async sheets(chemin, options) {
    const base = this.env.SHEETS_API || 'https://sheets.googleapis.com/v4/spreadsheets/';
    const url = base + encodeURIComponent(this.env.SHEET_ID) + chemin;
    for (let essai = 0; essai < 2; essai++) {
      const rep = await fetch(url, Object.assign({}, options, { headers: Object.assign(
        { 'Authorization': 'Bearer ' + await this.jetonGoogle(), 'Content-Type': 'application/json' }, (options && options.headers) || {}) }));
      if (rep.status === 401 && essai === 0) { this.jetonGoogle_ = null; continue; }
      if (!rep.ok) throw new Error('API Sheets ' + rep.status + ' ' + (await rep.text()).slice(0, 300));
      return rep.json();
    }
  }
  plage(a1) { return "'" + String(this.env.ONGLET_REPONSES).replace(/'/g, "''") + "'!" + a1; }
  async lireValeurs(a1) {
    const r = await this.sheets('/values/' + encodeURIComponent(this.plage(a1)) +
      '?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER&majorDimension=ROWS', { method: 'GET' });
    return r.values || [];
  }
  async idOnglet() {
    if (this.sheetIdNum !== null) return this.sheetIdNum;
    const r = await this.sheets('?fields=sheets.properties(sheetId,title)', { method: 'GET' });
    const f = (r.sheets || []).find((s) => s.properties.title === this.env.ONGLET_REPONSES);
    if (!f) throw new Error('Onglet introuvable');
    this.sheetIdNum = f.properties.sheetId;
    return this.sheetIdNum;
  }

  /* ---------- Lecture de la feuille ---------- */

  async lirePositions() {
    if (!this.positions || Date.now() - this.positions.t > 600000) {
      const entetes = (await this.lireValeurs('1:1'))[0] || [];
      const pos = {};
      entetes.forEach((e, c) => { pos[String(e).trim()] = c; });
      this.positions = { t: Date.now(), pos };
    }
    const pos = this.positions.pos;
    for (const col of COLONNES_REQUISES) if (pos[col] === undefined) { this.positions = null; return null; }
    return pos;
  }
  nbColonnes(pos) { return Math.max.apply(null, Object.values(pos)) + 1; }

  async lireFin(n, nbCol) {
    const lettre = colonne(nbCol - 1);
    let debut = this.derniereLigne > 1 ? Math.max(2, this.derniereLigne - n - 50) : 2;
    let lignes = await this.lireValeurs('A' + debut + ':' + lettre);
    if (!lignes.length && debut > 2) { debut = 2; lignes = await this.lireValeurs('A2:' + lettre); }
    this.derniereLigne = debut + lignes.length - 1;
    if (lignes.length > n) { const coupe = lignes.length - n; lignes = lignes.slice(coupe); debut += coupe; }
    return { premiere: debut, lignes };
  }

  fiche(l, pos, ligne, aujourdhui) {
    const appareil = txt(l[pos['Appareils café']]), nature = txt(l[pos['Nature de la panne']]);
    const statut = txt(l[pos['Statut']]), reservePar = txt(l[pos['ReservePar']]);
    const serie = l[pos['Horodateur']];
    return {
      ligne, horodateur: serie, horodateurTexte: isoDepuisSerie(serie),
      cafe: txt(l[pos['Café/Salle:']]), ville: txt(l[pos['Ville']]), appareil, type: typeDe(appareil), nature,
      licence: pos['Licence'] === undefined ? '' : txt(l[pos['Licence']]),
      adresse: pos['Adresse'] === undefined ? '' : txt(l[pos['Adresse']]),
      codePostal: pos['Code Postal'] === undefined ? '' : txt(l[pos['Code Postal']]),
      statut, techniciens: listeValeurs(l[pos['Technicien']]), reservePar,
      debut: isoDepuisSerie(l[pos['Début']]), priorite: priorite(appareil),
      reserveLe: reserveLe(statut, reservePar),
      livraisonLe: livraisonLe(appareil, l[pos['DateLivraison']], aujourdhui),
      encaisser: encaisser(nature), natureCourte: natureCourte(nature), consigne: consigne(nature), ticketLiv: ticketLiv(nature)
    };
  }

  // Liste comme la vue « Interventions » d'AppSheet : seulement « En attente » et « En cours »,
  // triée par priorité croissante puis du plus ancien au plus récent.
  async liste() {
    const pos = await this.lirePositions();
    if (!pos) return { ok: false, erreur: 'colonne_manquante' };
    const { premiere, lignes } = await this.lireFin(LIGNES_LISTE, this.nbColonnes(pos));
    const aujourdhui = Math.floor(serieBruxelles(new Date()));
    const interventions = [];
    lignes.forEach((l, i) => { if (STATUTS_ACTIFS[txt(l[pos['Statut']])]) interventions.push(this.fiche(l, pos, premiere + i, aujourdhui)); });
    interventions.sort((a, b) => a.priorite - b.priorite || a.horodateur - b.horodateur);
    // Téléphone du café, lu dans l'onglet « places ». Jamais écrit dans la feuille.
    try {
      const annuaire = new Map();
      (await this.lirePlaces()).forEach((p) => {
        if (p.licence && p.telephone) annuaire.set(p.licence.toUpperCase(), p.telephone);
      });
      interventions.forEach((i) => { i.telephone = annuaire.get(txt(i.licence).toUpperCase()) || ''; });
    } catch (e) { /* confort : son absence ne bloque pas la liste */ }
    // Produits à charger, pour les livraisons Horeca venues d'une vente au comptoir.
    try {
      if (interventions.some((i) => i.type === 'LIVRAISON HORECA')) {
        const parTicket = await this.lireDetails();
        interventions.forEach((i) => {
          if (i.type !== 'LIVRAISON HORECA') return;
          const t = ticketDe(i.nature);
          if (t && parTicket.has(t)) { i.ticket = t; i.produits = parTicket.get(t); }
          else if (t) i.ticket = t;
        });
      }
    } catch (e) { /* confort : son absence ne bloque pas la liste */ }
    return { ok: true, interventions, maintenant: serieBruxelles(new Date()) };
  }

  /* ---------- Écriture : comme les actions d'AppSheet ---------- */

  // Retrouve la ligne par son Horodateur (la clé d'AppSheet), jamais par sa seule position.
  async trouverLigne(req, pos) {
    const serie = Number(req.horodateur);
    if (!isFinite(serie) || serie <= 0) return null;
    const nbCol = this.nbColonnes(pos), lettre = colonne(nbCol - 1);
    const egal = (l) => typeof l[pos['Horodateur']] === 'number' && Math.abs(l[pos['Horodateur']] - serie) < 1e-6;
    const ligne = Math.floor(Number(req.ligne) || 0);
    if (ligne >= 2) {
      const v = (await this.lireValeurs('A' + ligne + ':' + lettre + ligne))[0] || [];
      if (egal(v)) return { ligne, valeurs: v };
    }
    const tout = await this.lireValeurs('A2:' + lettre);
    for (let i = tout.length - 1; i >= 0; i--) if (egal(tout[i])) return { ligne: i + 2, valeurs: tout[i] };
    return null;
  }

  async ecrire(ligne, pos, changements, formats) {
    const data = Object.keys(changements).map((k) => ({ range: this.plage(colonne(pos[k]) + ligne), values: [[changements[k]]] }));
    const r = await this.sheets('/values:batchUpdate', { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data }) });
    if (r.totalUpdatedCells !== data.length) throw new Error('Cellules non écrites ligne ' + ligne);
    const requetes = Object.keys(formats || {}).map((k) => ({ repeatCell: {
      range: { sheetId: 0, startRowIndex: ligne - 1, endRowIndex: ligne, startColumnIndex: pos[k], endColumnIndex: pos[k] + 1 },
      cell: { userEnteredFormat: { numberFormat: formats[k] } }, fields: 'userEnteredFormat.numberFormat' } }));
    if (requetes.length) {
      const id = await this.idOnglet();
      requetes.forEach((q) => { q.repeatCell.range.sheetId = id; });
      await this.sheets(':batchUpdate', { method: 'POST', body: JSON.stringify({ requests: requetes }) });
    }
  }

  async agir(action, u, req) {
    const pos = await this.lirePositions();
    if (!pos) return { ok: false, erreur: 'colonne_manquante' };
    const trouve = await this.trouverLigne(req, pos);
    if (!trouve) return { ok: false, erreur: 'intervention_introuvable' };
    const { ligne, valeurs: v } = trouve;
    const statut = txt(v[pos['Statut']]), type = typeDe(v[pos['Appareils café']]);
    const techniciens = listeValeurs(v[pos['Technicien']]), reservePar = txt(v[pos['ReservePar']]);
    const maintenant = serieBruxelles(new Date());
    const sortie = (extra) => Object.assign({ ok: true, ligne }, extra);

    switch (action) {
      case 'prendre': {
        if (type === 'RAPPEL') return { ok: false, erreur: 'rappel_non_prenable' };
        if (statut !== 'En attente') return { ok: false, erreur: 'deja_prise', statut, techniciens };
        await this.ecrire(ligne, pos, { 'Statut': 'En cours', 'Début': maintenant, 'Technicien': u.nom }, { 'Début': FORMAT_DATE_HEURE });
        return sortie({ statut: 'En cours', techniciens: [u.nom] });
      }
      case 'accompagner': {
        if (type === 'RAPPEL') return { ok: false, erreur: 'rappel_non_prenable' };
        if (statut !== 'En cours') return { ok: false, erreur: 'pas_en_cours', statut };
        if (techniciens.includes(u.nom)) return { ok: false, erreur: 'deja_inscrit', techniciens };
        const liste = techniciens.concat([u.nom]);
        await this.ecrire(ligne, pos, { 'Technicien': joindre(liste) });
        return sortie({ statut, techniciens: liste });
      }
      case 'reserver': {
        if (type === 'RAPPEL') return { ok: false, erreur: 'rappel_non_prenable' };
        if (statut !== 'En attente') return { ok: false, erreur: 'pas_en_attente', statut };
        if (reservePar) return { ok: false, erreur: 'deja_reservee', reservePar };
        await this.ecrire(ligne, pos, { 'ReservePar': u.nom });
        return sortie({ reservePar: u.nom });
      }
      case 'liberer': {
        if (!reservePar) return { ok: false, erreur: 'pas_reservee' };
        await this.ecrire(ligne, pos, { 'ReservePar': '' });
        return sortie({ reservePar: '' });
      }
      case 'terminer': case 'fait': {
        if (action === 'fait' && type !== 'RAPPEL') return { ok: false, erreur: 'pas_un_rappel' };
        if (action === 'terminer' && type === 'RAPPEL') return { ok: false, erreur: 'rappel_utiliser_fait' };
        if (!STATUTS_ACTIFS[statut]) return { ok: false, erreur: 'deja_terminee', statut };
        if (action === 'terminer' && statut !== 'En cours') return { ok: false, erreur: 'pas_en_cours', statut };
        const formats = { 'Fin': FORMAT_DATE_HEURE, 'Durée': FORMAT_DUREE };
        const ch = { 'Fin': maintenant, 'Statut': 'Fin' };
        let debut = v[pos['Début']];
        if (typeof debut !== 'number') {                       // « Fait » : Début = maintenant s'il est vide
          if (action === 'fait') { debut = maintenant; ch['Début'] = maintenant; formats['Début'] = FORMAT_DATE_HEURE; }
        }
        ch['Durée'] = dureeSerie(debut, maintenant);
        if (action === 'terminer') {
          const champs = this.champsCloture(req, pos);
          if (champs.erreur) return { ok: false, erreur: champs.erreur };
          Object.assign(ch, champs.valeurs);
        }
        await this.ecrire(ligne, pos, ch, formats);
        return sortie({ statut: 'Fin' });
      }
    }
    return { ok: false, erreur: 'action_inconnue' };
  }


  /* ---------- Cafés (onglet « places », cache 10 minutes) ---------- */

  // Colonnes de l'onglet « places » : A licence, B nom, C adresse, D code postal, E ville, G société.
  // Produits d'une livraison Horeca, lus dans l'onglet « Détails livraisons » (Id, Ticket, Produit, Quantité).
  // Lecture seule : c'est le relais d'encodage qui efface ces lignes à la clôture, jamais celui-ci.
  async lireDetails() {
    if (this.details && Date.now() - this.details.t < CACHE_DETAILS_MS) return this.details.parTicket;
    const onglet = this.env.ONGLET_DETAILS || 'Détails livraisons';
    const parTicket = new Map();
    try {
      const r = await this.sheets('/values/' + encodeURIComponent("'" + onglet.replace(/'/g, "''") + "'!A:D") +
        '?valueRenderOption=UNFORMATTED_VALUE&majorDimension=ROWS', { method: 'GET' });
      const lignes = r.values || [];
      for (let i = 1; i < lignes.length; i++) {
        const l = lignes[i];
        const ticket = txt(l[1]), produit = txt(l[2]);
        if (!ticket || !produit) continue;
        if (!parTicket.has(ticket)) parTicket.set(ticket, []);
        parTicket.get(ticket).push({ produit, quantite: txt(l[3]) });
      }
    } catch (e) { /* l'onglet peut manquer : la livraison s'affiche alors sans son détail */ }
    this.details = { t: Date.now(), parTicket };
    return parTicket;
  }

  async lirePlaces() {
    if (this.places && Date.now() - this.places.t < CACHE_PLACES_MS) return this.places.liste;
    const onglet = this.env.ONGLET_PLACES || 'places';
    const r = await this.sheets('/values/' + encodeURIComponent("'" + onglet.replace(/'/g, "''") + "'!A:L") +
      '?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER&majorDimension=ROWS', { method: 'GET' });
    const donnees = r.values || [];
    const liste = [];
    for (let i = 1; i < donnees.length; i++) {
      const l = donnees[i];
      if (!l[0] || !l[1]) continue;
      liste.push({ licence: txt(l[0]), nom: txt(l[1]), adresse: txt(l[2]),
                   cp: l[3] === undefined ? '' : l[3], ville: txt(l[4]), societe: txt(l[6]) || 'Dongiovanni',
                   telephone: telephone(l[11]) });
    }
    this.places = { t: Date.now(), liste };
    return liste;
  }
  async cafes() {
    const liste = await this.lirePlaces();
    return { ok: true, cafes: liste.map((p) => ({ licence: p.licence, nom: p.nom, ville: p.ville,
      adresse: p.adresse, cp: p.cp, telephone: p.telephone })) };
  }
  async trouverCafe(licence, nom) {
    const lic = txt(licence).toUpperCase(), n = txt(nom).toUpperCase();
    return (await this.lirePlaces()).find((p) => p.licence.toUpperCase() === lic && p.nom.toUpperCase() === n) || null;
  }

  /* ---------- Création d'une intervention (copie fidèle d'AppSheet) ---------- */

  async creer(u, req) {
    const pos = await this.lirePositions();
    if (!pos) return { ok: false, erreur: 'colonne_manquante' };
    const cafe = await this.trouverCafe(req.licence, req.cafe);
    if (!cafe) return { ok: false, erreur: 'cafe_inconnu' };
    // Un ou plusieurs appareils, au format d'AppSheet : « FLIPPER , BILLARD ».
    // Chaque valeur doit figurer telle quelle dans la liste officielle, sinon l'écran et AppSheet
    // ne retrouveraient plus l'intervention.
    const choisis = listeValeurs(req.appareil).map((x) => x.toUpperCase());
    if (!choisis.length || choisis.some((x) => !APPAREILS.includes(x))) return { ok: false, erreur: 'appareil_invalide' };
    const appareil = joindre(choisis);
    const nature = nettoyer(req.nature, 500);
    const prendre = !!req.prendre;

    // Horodateur unique à la seconde, heure de Bruxelles, comme la PWA d'encodage.
    const { lignes } = await this.lireFin(30, pos['Horodateur'] + 1);
    const pris = new Set(lignes.map((l) => isoDepuisSerie(l[pos['Horodateur']]).replace('T', ' ')));
    let d = new Date(); d.setMilliseconds(0);
    let horo = texteBruxelles(d);
    while (pris.has(horo)) { d = new Date(d.getTime() + 1000); horo = texteBruxelles(d); }

    const cp = /^\d+$/.test(String(cafe.cp)) ? Number(cafe.cp) : cafe.cp;
    const maintenant = serieBruxelles(d);
    const valeurs = {
      'Horodateur': horo, 'Société': cafe.societe, 'Technicien': prendre ? u.nom : '',
      'Café/Salle:': cafe.nom, 'Ville': cafe.ville, 'Appareils café': appareil, 'Appareils Salle': '',
      'Nature de la panne': nature, 'Licence': cafe.licence, 'Adresse': cafe.adresse,
      'Code Postal': cp, 'Début': '', 'Fin': '', 'Durée': '',
      'Statut': prendre ? 'En cours' : 'En attente'
    };
    let maxPos = 0;
    for (const k in valeurs) if (pos[k] !== undefined && pos[k] > maxPos) maxPos = pos[k];
    const tableau = new Array(maxPos + 1).fill('');
    for (const k in valeurs) if (pos[k] !== undefined) tableau[pos[k]] = valeurs[k];

    const depart = Math.max(2, this.derniereLigne || 2);
    const a1 = encodeURIComponent(this.plage('A' + depart + ':' + colonne(maxPos)));
    const rep = await this.sheets('/values/' + a1 + ':append?valueInputOption=USER_ENTERED&insertDataOption=OVERWRITE&includeValuesInResponse=false',
      { method: 'POST', body: JSON.stringify({ majorDimension: 'ROWS', values: [tableau] }) });
    const m = /![A-Z]+(\d+)/.exec((rep.updates && rep.updates.updatedRange) || '');
    const ligne = m ? Number(m[1]) : 0;
    if (!ligne) return { ok: false, erreur: 'erreur_serveur' };
    if (ligne > this.derniereLigne) this.derniereLigne = ligne;

    // Format de l'Horodateur, identique à la PWA d'encodage.
    const formats = { 'Horodateur': { type: 'DATE_TIME', pattern: 'm/d/yyyy h:mm:ss' } };
    // « Je la prends » : Début rempli tout de suite, comme le fait AppSheet.
    if (prendre && pos['Début'] !== undefined) {
      try {
        await this.ecrire(ligne, pos, { 'Début': maintenant }, { 'Début': FORMAT_DATE_HEURE });
      } catch (e) { console.error('Début à la création : ' + e); }
    }
    try { await this.formater(ligne, pos, formats); } catch (e) { console.error('Format horodateur : ' + e); }

    // Pushover seulement si la panne est déposée pour tout le monde, et dans la fenêtre autorisée.
    if (!prendre && fenetreNotification(d)) {
      this.notifier(TITRES[appareil] || 'Nouvelle intervention',
        cafe.nom + ' (' + cafe.ville + ')' + (nature ? '\n' + nature : ''));
    }
    return { ok: true, ligne, horodateur: horo, statut: valeurs['Statut'] };
  }

  formater(ligne, pos, formats) {
    const requetes = Object.keys(formats || {}).filter((k) => pos[k] !== undefined).map((k) => ({ repeatCell: {
      range: { sheetId: 0, startRowIndex: ligne - 1, endRowIndex: ligne, startColumnIndex: pos[k], endColumnIndex: pos[k] + 1 },
      cell: { userEnteredFormat: { numberFormat: formats[k] } }, fields: 'userEnteredFormat.numberFormat' } }));
    if (!requetes.length) return Promise.resolve();
    return this.idOnglet().then((id) => {
      requetes.forEach((q) => { q.repeatCell.range.sheetId = id; });
      return this.sheets(':batchUpdate', { method: 'POST', body: JSON.stringify({ requests: requetes }) });
    });
  }

  // Envoi Pushover au groupe : n'attend pas, une notification ratée ne bloque jamais l'écriture.
  notifier(titre, message) {
    const token = this.env.PUSHOVER_TOKEN, user = this.env.PUSHOVER_USER;
    if (!token || !user) return;
    const url = this.env.PUSHOVER_API || 'https://api.pushover.net/1/messages.json';
    this.ctx.waitUntil(fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token, user, title: titre, message }).toString() }).catch(() => {}));
  }

  // Champs facultatifs du formulaire de clôture (copie fidèle de Cloture_form). La signature et les pièces
  // remplacées viendront après le relevé de leur format dans AppSheet.
  champsCloture(req, pos) {
    const valeurs = {};
    const cop = (cle, col, max) => { if (req[cle] !== undefined && pos[col] !== undefined) valeurs[col] = nettoyer(req[cle], max); };
    cop('nature', 'Nature de la panne', 500);
    cop('typeMachine', 'TypeMachine', 200);
    cop('numeroSerie', 'NumeroSerie', 100);
    cop('commentaire', 'CommentaireMachine', 2000);
    cop('nomSignataire', 'NomSignataire', 100);
    if (req.appareils !== undefined && pos['Appareils café'] !== undefined) {
      const liste = [].concat(req.appareils).map((x) => txt(x).toUpperCase()).filter(Boolean);
      if (liste.some((x) => !APPAREILS.includes(x))) return { erreur: 'appareil_invalide' };
      valeurs['Appareils café'] = joindre(liste);
    }
    return { valeurs };
  }
}

/* ---------- Utilitaires ---------- */

// Adresse e-mail d'un compte : sert à lui envoyer son invitation.
// Une adresse qui ne ressemble à rien est refusée plutôt qu'enregistrée de travers.
// Numéro de ticket d'une livraison Horeca, tel qu'il est écrit dans « Nature de la panne » :
// « Livraison Horeca – ticket 2630-2-000024 ». C'est lui qui relie la ligne à l'onglet du détail.
function ticketDe(nature) {
  const m = /ticket\s+([0-9][0-9A-Za-z-]*)/i.exec(txt(nature));
  return m ? m[1] : '';
}

function courriel(v) {
  const s = String(v === undefined || v === null ? '' : v).trim();
  if (!s || s.length > 160) return '';
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(s) ? s : '';
}
function normaliserNom(n) {
  const s = String(n === undefined || n === null ? '' : n).trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9 -]{0,19}$/.test(s) ? s : '';
}
function hex(octets) { return [...octets].map((b) => b.toString(16).padStart(2, '0')).join(''); }
function deHex(s) { const o = new Uint8Array(s.length / 2); for (let i = 0; i < o.length; i++) o[i] = parseInt(s.substr(i * 2, 2), 16); return o; }
function b64url(o) {
  const octets = typeof o === 'string' ? new TextEncoder().encode(o) : new Uint8Array(o);
  let bin = ''; for (let i = 0; i < octets.length; i++) bin += String.fromCharCode(octets[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function deB64url(s) {
  const b = atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
function egalConstant(a, b) {
  a = String(a); b = String(b);
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
