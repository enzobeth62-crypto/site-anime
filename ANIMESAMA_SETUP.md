# AnimeSamaApi — configuration Animeverse

Cette intégration ajoute une page indépendante à `/animes.html`. Elle ne modifie pas `index.html`, Supabase, les utilisateurs ni la bibliothèque actuelle.

## Fichiers ajoutés

- `animes.html` : page de découverte indépendante.
- `css/animes.css` : styles isolés.
- `js/animes.js` : recherche, catalogue, pagination et fiches de saisons.
- `api/animesama.js` : proxy Vercel vers le service externe.
- `ANIMESAMA_SETUP.md` : ce guide.

## Important : il faut héberger AnimeSamaApi séparément

Le dépôt [TMCooper/AnimeSamaApi](https://github.com/TMCooper/AnimeSamaApi) est un serveur Python/Flask, pas une bibliothèque JavaScript à installer directement dans le site statique. Déploie-le sur un hébergeur compatible Python et récupère l’URL HTTPS de base de ton instance.

Dans les paramètres du projet Vercel qui héberge Animeverse, ajoute une variable d’environnement :

- Nom : `ANIMESAMA_API_URL`
- Valeur : URL HTTPS de base de ton instance Python, sans chemin `/api/...` final. Exemple de forme : `https://mon-service.example`

Ne mets aucune clé secrète dans le HTML, dans `js/animes.js` ou dans GitHub. Cette variable sert uniquement au proxy serveur.

Après avoir ajouté la variable, redéploie le projet Vercel. La page est accessible à `https://ton-domaine/animes.html`.

## Initialiser le catalogue côté service Python

La documentation du dépôt source indique que la première génération du catalogue peut être longue. Sur ta propre instance Python, suis le README du dépôt et initialise le catalogue avec la procédure documentée par le mainteneur. Le bouton « Charger le catalogue » appelle ensuite `/api/loadBaseAnimeData` via le proxy. Si cette base n'a pas été générée, la requête peut échouer.

## Routes consommées

Le proxy n'autorise que des routes précises :
- `search` → `/api/getSerchAnime?q=...`
- `catalog` → `/api/loadBaseAnimeData`
- `seasons` → `/api/getInfoAnime?q=...`
- `season` → `/api/getSpecificAnime?q=...&s=...&v=...`

L'extraction des URL directes de lecteurs vidéo n'est pas intégrée à la page. Les fiches proposent à la place une recherche des options de visionnage légales via JustWatch. Aucun lecteur vidéo distant n'est intégré ni hébergé par Animeverse.

## Test rapide

1. Déploie le service Python et configure `ANIMESAMA_API_URL` dans Vercel.
2. Ouvre `/api/animesama?action=search&q=Frieren&l=3` sur ton domaine.
3. Si tu reçois un tableau JSON, ouvre `/animes.html` et recherche un titre.
4. Si tu vois une erreur de configuration, vérifie la variable Vercel et redéploie.
5. Si la requête échoue côté service, vérifie les logs de l'hébergement Python et l'initialisation de sa base de données.

## Limites

Le service externe dépend du site source, de ses règles d'accès et de ses changements techniques. Prévois des pannes ou des réponses incomplètes. Vérifie les conditions d'utilisation applicables et ne publie pas de liens vers des contenus que tu n'es pas autorisé à distribuer.