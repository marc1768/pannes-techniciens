# Pannes techniciens

Appli des techniciens du service technique : lecture et prise des interventions dans la feuille Google « Pannes »
(remplace AppSheet), avec connexion de chaque technicien par son nom.

- `relais/` : relais Cloudflare (Worker) : comptes, connexion, lecture et écriture dans la feuille.
- `docs/` : l'appli installable (PWA), publiée avec GitHub Pages. **À venir.**

Aucun mot de passe ni clé ne doit jamais être mis dans ce dépôt : les secrets sont saisis dans Cloudflare.
