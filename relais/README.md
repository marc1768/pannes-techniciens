# Relais « techniciens » (Cloudflare Worker)

Deuxième point d'entrée sur la feuille Google « Pannes », indépendant du relais d'encodage. Il fait ce que fait
AppSheet (lire les interventions actives, prendre, accompagner, réserver, libérer, terminer, « Fait » pour les
rappels), en écrivant **les mêmes cellules, aux mêmes formats**, et ajoute la connexion par nom et un module administrateur.

## État : version 0.1 (tests locaux OK, pas encore déployée)
- Comptes, connexion, « rester connecté », mot de passe provisoire imposé par le serveur, administration.
- Lecture de la liste (filtre et tri d'AppSheet) et actions de prise, avec retrouvaille de la ligne par `Horodateur`.
- **Pas encore fait** : création d'intervention, signature client, pièces remplacées, cafés et listes modifiables,
  textes calculés à comparer avec AppSheet (test miroir), Pushover (règle : lun-ven 9 h–17 h).

## Tests
`npm test` (Node 22) : 26 tests avec une fausse feuille Google, sans réseau.

## Secrets à saisir dans Cloudflare (jamais dans le code)
- `GOOGLE_SA_JSON` : fichier JSON complet de la clé du compte de service (le même que pour l'autre relais).
- `SETUP_KEY` : une phrase longue au choix, servant UNE fois à créer le compte administrateur.

## Formats écrits dans la feuille (relevés sur de vraies lignes)
- `Début`, `Fin` : numéro de série de date-heure, format `d/m/yyyy hh:mm:ss`, heure de Bruxelles.
- `Durée` : fraction de jour (`Fin − Début`), format `hh:mm:ss`.
- `Statut` : `En attente` / `En cours` / `Fin`. `Technicien` : `DAVID , JULIEN`. `ReservePar` : un nom.
