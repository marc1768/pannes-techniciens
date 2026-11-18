/**
 * Fonctions pures du relais « techniciens » : aucune lecture ni écriture ici.
 * Elles reproduisent ce qu'AppSheet calcule (colonnes virtuelles) et les formats de dates
 * que la feuille contient. Les règles viennent du relevé fait dans l'éditeur AppSheet (10/11/2026) :
 * celles marquées « à comparer » doivent être vérifiées par un test miroir sur de vraies lignes.
 */

// Valeurs de la liste « Appareils café » d'AppSheet (liste modifiable dans AppSheet, relevée le 16/11/2026).
export const APPAREILS = ['MONTANA LUXE II', 'DAYTONA', 'NEVADA', 'ZEUS', 'ARIZONA', 'MK3', 'MK4', 'ACTION PACK',
  'TOP MACHINE', 'GREYHOUND', 'TEXAS', 'KICKER', 'BILLARD', 'FLECHE', 'MACHINE A CAFE', 'LIVRAISON', 'ENTRETIEN',
  'LIVRAISON HORECA', 'AUTRE', 'INDETERMINE', 'RAPPEL'];

export const STATUTS_ACTIFS = { 'En attente': true, 'En cours': true };

export function txt(v) { return String(v === undefined || v === null ? '' : v).trim(); }

// Colonnes à valeurs multiples (EnumList) : « DAVID , JULIEN » -> ['DAVID', 'JULIEN'].
export function listeValeurs(v) {
  return txt(v).split(',').map((s) => s.trim()).filter(Boolean);
}
// Inverse : le format exact écrit par AppSheet (virgule entourée d'espaces).
export function joindre(liste) { return liste.join(' , '); }

// Empêche l'interprétation d'un texte libre comme formule par Google Sheets.
export function nettoyer(valeur, max) {
  let s = String(valeur === undefined || valeur === null ? '' : valeur).replace(/[\r\n\t]+/g, ' ').trim();
  if (s.length > max) s = s.substring(0, max);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

// Type d'intervention (dans la colonne « Appareils café »). INDETERMINE s'affiche comme une panne.
export function typeDe(appareil) {
  const l = listeValeurs(appareil).map((x) => x.toUpperCase());
  if (l.includes('RAPPEL')) return 'RAPPEL';
  if (l.includes('LIVRAISON HORECA')) return 'LIVRAISON HORECA';
  if (l.includes('LIVRAISON')) return 'LIVRAISON';
  if (l.includes('ENTRETIEN')) return 'ENTRETIEN';
  if (l.includes('MACHINE A CAFE')) return 'MACHINE A CAFE';
  if (l.includes('AUTRE')) return 'AUTRE';
  return 'PANNE';
}

// Priorité (tri croissant) : formule d'AppSheet.
export function priorite(appareil) {
  const l = listeValeurs(appareil).map((x) => x.toUpperCase());
  if (l.includes('LIVRAISON HORECA')) return 0.5;
  if (l.includes('LIVRAISON')) return 2;
  if (l.includes('ENTRETIEN') || l.includes('MACHINE A CAFE')) return 1;
  return 0;
}

// « Réservé · NOM » seulement si en attente et réservé.
export function reserveLe(statut, reservePar) {
  return txt(statut) === 'En attente' && txt(reservePar) ? 'Réservé · ' + txt(reservePar) : '';
}

function jjmm(serie) {
  const d = new Date(Math.round((serie - 25569) * 86400) * 1000);
  return String(d.getUTCDate()).padStart(2, '0') + '/' + String(d.getUTCMonth() + 1).padStart(2, '0');
}
// Livraisons seulement. dateLivraison : numéro de série de la feuille ou vide. aujourdhui : numéro de série entier.
// À comparer avec AppSheet (textes exacts).
export function livraisonLe(appareil, dateLivraison, aujourdhui) {
  const l = listeValeurs(appareil).map((x) => x.toUpperCase());
  if (!l.includes('LIVRAISON') && !l.includes('LIVRAISON HORECA')) return '';
  if (typeof dateLivraison !== 'number' || !isFinite(dateLivraison) || dateLivraison <= 0) return 'Livraison : indéterminée';
  const j = Math.floor(dateLivraison);
  if (j < aujourdhui) return 'Livraison : EN RETARD · ' + jjmm(j);
  if (j === aujourdhui) return "Livraison : aujourd'hui";
  if (j === aujourdhui + 1) return 'Livraison : demain ' + jjmm(j);
  return 'Livraison : ' + jjmm(j);
}

// À comparer avec AppSheet.
export function encaisser(nature) {
  const n = txt(nature), i = n.toUpperCase().indexOf('ENCAISSER');
  if (i < 0) return '';
  return ('À ENCAISSER ' + n.slice(i + 'ENCAISSER'.length).trim()).trim();
}
export function natureCourte(nature) {
  const n = txt(nature);
  if (n.toUpperCase().indexOf('ENCAISSER') >= 0) {
    const p = n.split(' - ');
    if (p.length >= 3) return p[0] + ' - ' + p[1];
  }
  return n;
}
export function consigne(nature) {
  const n = txt(nature);
  if (!n.toUpperCase().startsWith('LIVRAISON ODOO')) return '';
  const p = n.split(' - ');
  return 'Bon de livraison ' + txt(p[1]) + " : à scanner à l'atelier avec l'application Code-barres d'Odoo.";
}
export function ticketLiv(nature) {
  const m = /ticket\s+(\S+)/i.exec(txt(nature));
  return m ? m[1] : '';
}

/* ---------- Dates de la feuille ---------- */

// Numéro de colonne (0 = A) -> lettres.
export function colonne(i) {
  let s = ''; i += 1;
  while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

// Heure de Bruxelles -> numéro de série de la feuille (jours depuis le 30/12/1899, heure locale affichée).
export function serieBruxelles(date) {
  const p = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date || new Date())
    .forEach((x) => { p[x.type] = x.value; });
  const ms = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return ms / 86400000 + 25569;
}
// Numéro de série -> « aaaa-MM-ddTHH:mm:ss » (heure affichée dans la feuille).
export function isoDepuisSerie(v) {
  if (typeof v !== 'number' || !isFinite(v) || v <= 0) return '';
  return new Date(Math.round((v - 25569) * 86400) * 1000).toISOString().slice(0, 19);
}
// Format écrit par AppSheet dans les cellules (relevé le 17/11/2026) :
//   Début, Fin : date-heure « d/m/yyyy hh:mm:ss » ; Durée : heure « hh:mm:ss » (fraction de jour).
export const FORMAT_DATE_HEURE = { type: 'DATE_TIME', pattern: 'd/m/yyyy hh:mm:ss' };
export const FORMAT_DUREE = { type: 'TIME', pattern: 'hh:mm:ss' };
// Les secondes sont arrondies comme dans la feuille pour que Fin − Début tombe juste.
export function dureeSerie(debut, fin) {
  if (typeof debut !== 'number' || typeof fin !== 'number' || !isFinite(debut) || !isFinite(fin)) return '';
  return Math.round((fin - debut) * 86400) / 86400;
}

/* ---------- Horodateur et fenêtre d'envoi des notifications ---------- */

// « aaaa-MM-jj hh:mm:ss » à l'heure de Bruxelles : le texte écrit dans la colonne Horodateur.
export function texteBruxelles(date) {
  const p = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(date || new Date()).forEach((x) => { p[x.type] = x.value; });
  return p.year + '-' + p.month + '-' + p.day + ' ' + p.hour + ':' + p.minute + ':' + p.second;
}

// Dimanche de Pâques (calcul de Gauss), en UTC.
function paques(an) {
  const a = an % 19, b = Math.floor(an / 100), c = an % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31);
  const jour = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(an, mois - 1, jour);
}

// Les dix jours fériés légaux belges d'une année, en « aaaa-MM-jj ».
export function joursFeries(an) {
  const p = paques(an), J = 86400000;
  const d = (ms) => new Date(ms).toISOString().slice(0, 10);
  return new Set([
    d(Date.UTC(an, 0, 1)), d(p + J), d(Date.UTC(an, 4, 1)), d(p + 39 * J), d(p + 50 * J),
    d(Date.UTC(an, 6, 21)), d(Date.UTC(an, 7, 15)), d(Date.UTC(an, 10, 1)),
    d(Date.UTC(an, 10, 11)), d(Date.UTC(an, 11, 25))
  ]);
}

const cacheFeries = {};
// Pushover au groupe : seulement du lundi au vendredi, de 9 h à 17 h (heure de Bruxelles),
// jamais les jours fériés belges, jamais le week-end, rien avant 9 h ni après 17 h.
export function fenetreNotification(date) {
  const p = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', weekday: 'short', hourCycle: 'h23' })
    .formatToParts(date || new Date()).forEach((x) => { p[x.type] = x.value; });
  if (p.weekday === 'Sat' || p.weekday === 'Sun') return false;
  const heure = Number(p.hour);
  if (heure < 9 || heure >= 17) return false;
  const an = Number(p.year);
  if (!cacheFeries[an]) cacheFeries[an] = joursFeries(an);
  return !cacheFeries[an].has(p.year + '-' + p.month + '-' + p.day);
}
