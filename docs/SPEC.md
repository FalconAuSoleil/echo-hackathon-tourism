# Projet : Echo, le carnet de bord des visites (nom provisoire)

> Spécification produit fournie par l'équipe (source de vérité). Brief officiel du hackathon : `docs/hackathon-brief.pdf` (texte : `docs/hackathon-brief.txt`, annexe C Tourisme).

## 0. Ta mission

Tu développes le prototype complet d'un projet pour le hackathon « Small AI for Development » (Banque mondiale x Hack-Nation, 3-4 octobre 2026), track Tourisme.

Tu choisis librement les technologies, avec trois contraintes : l'analyse tourne entièrement sur l'appareil, aucun serveur ne sert à l'analyse, et il n'y a aucun compte ni connexion utilisateur.

Chaque élément décrit ici sert un critère du jury. Ne supprime rien sans me le signaler. Si le temps manque, suis l'ordre de priorité de la section 12.

Règle absolue : ne simule jamais une fonction en la présentant comme réelle. Si quelque chose est simulé, écris-le clairement dans l'interface et dans le README.

Tout doit pouvoir être produit sans enregistrement de voix humaine par l'équipe, et sans locuteur kinyarwanda. Les sections 5 et 9 expliquent comment.

## 1. Le hackathon : règles et notation

### Règles obligatoires
- L'outil tourne sur un appareil que l'utilisateur possède déjà.
- Sa fonction principale marche hors ligne.
- Les fichiers de modèles sont assez petits pour être installés à la main ou envoyés sur une connexion faible.
- Au moins une interaction se fait dans une langue locale nommée, par la voix ou le texte. Ici : le kinyarwanda. Le jury demandera comment l'outil se comporte avec une langue moins bien couverte.
- Un humain prend la décision finale. L'outil informe, signale ce dont il n'est pas sûr (« pas sûr, demandez à une personne ») et n'agit jamais à la place de l'utilisateur.
- Aucune hallucination : l'outil ne peut dire que des phrases d'une liste fermée.
- Toutes les données sont citées : nom, source, licence, taille, et ce qu'elles ne couvrent pas. Les données synthétiques sont signalées comme telles.

### Notation du jury
| Critère | Poids | Question posée |
|---|---|---|
| Solution construite (fidélité « Small AI ») | 25 % | Ça marche de bout en bout, dans les contraintes ? |
| Pertinence et impact | 20 % | Vrai problème du brief, résultat qui compte pour la personne ? |
| Ancrage dans les données | 15 % | Données citées, modélisation solide, manque de données comblé ? |
| Preuve que ça marche | 15 % | Preuve mesurée, adaptée aux contraintes du secteur ? |
| Valeur de l'IA | 15 % | Un SMS, un tableur ou une recherche ferait-il pareil ? |
| Réplicabilité et suite | 10 % | Réutilisable ailleurs ? |
| IA responsable | Éliminatoire | Vie privée, consentement, biais et supervision humaine crédibles ? |

### Ce que tu livres
Le prototype qui marche, son code dans un dépôt public, et la documentation décrite plus bas.

## 2. Le scénario officiel

Noor a 38 ans. Elle cultive 2 hectares dans les hauts plateaux d'Ondera : du café en haut de la pente, du maïs et des haricots en bas. Elle est membre d'une coopérative caféière depuis 11 ans. Elle parle sa langue locale (le kinyarwanda, pour ce projet) et la langue nationale.

Deux téléphones au foyer :
- le sien, un téléphone simple, pour les appels, les SMS et le mobile money ;
- le smartphone de sa fille de 16 ans, interne au lycée, disponible surtout le week-end.

Pas de Wi-Fi : le foyer achète des forfaits 3G au besoin. Noor est aux champs toute la journée, et son téléphone reste à la maison.

Côté tourisme : 6 ou 7 visiteurs par mois trouvent sa ferme par le bouche-à-oreille. La ferme n'est sur aucune plateforme. Les visiteurs arrivent avec un guide local qui traduit. Une fois partis, Noor ne sait pas ce qui leur a plu, ce qui a manqué, ni ce qui vaut la peine d'être développé.

Le brief officiel situe la valeur de l'IA ici : lire des retours épars et dire à l'hôte ce qui revient, ce que les visiteurs auraient voulu différent, et autour de quoi construire la prochaine offre.

## 3. L'idée

### En une phrase
Les visiteurs laissent un message vocal dans leur langue. Echo les garde, les compare mois après mois, et dit à l'hôte, dans sa langue, ce qui plaît, ce qu'il faut corriger en priorité et ce qui revient sans être prévu. Tout se fait hors ligne, sur un téléphone déjà présent.

### Pour qui
Les petits hôtes touristiques ruraux, sans plateforme ni employé : visites de ferme, chambres chez l'habitant, artisans.

Deux modes de fonctionnement :
- **Mode A : l'hôte a un Android, même d'entrée de gamme.** Tout se passe sur son téléphone.
- **Mode B : l'hôte n'a qu'un téléphone simple, comme Noor.** L'analyse se fait sur le smartphone du foyer. L'hôte reçoit le récap par SMS sur son téléphone simple, et peut l'écouter sur le smartphone.

Noor est le cas le plus contraint. C'est le cas de référence.

### Positionnement : à respecter partout
Echo n'est **pas** un traducteur. Google Traduction ou un guide traduisent mieux pendant la visite, et Echo ne les remplace pas. Echo travaille après la visite : il garde les retours, les compte, les compare et repère ce qui revient.

Deux interdits :
- ne jamais montrer à l'hôte une traduction libre ;
- ne jamais générer de texte libre pour l'hôte.

## 4. Le parcours complet

### 4.1 Collecte
- À la fin de la visite, l'hôte donne au visiteur une carte imprimée en anglais, français, allemand et espagnol : « Dites-nous en 30 secondes ce que vous avez aimé et ce qui a manqué. Envoyez un message vocal WhatsApp à ce numéro. Le son est effacé après analyse, et votre nom n'est pas conservé. »
- Le visiteur envoie le message depuis son propre téléphone. S'il n'y a pas de réseau à la ferme, le message part plus tard tout seul.
- En envoyant ce message, le visiteur donne son accord. La carte le dit explicitement.
- Les messages écrits sont aussi acceptés. Ils suivent le même parcours, sans l'étape de transcription.

### 4.2 Réception
- Les messages arrivent sur le smartphone qui sert de numéro de la ferme.
- La personne qui a le smartphone partage les messages vers Echo en un geste. Echo les met dans une file d'attente.
- À partir de là, tout fonctionne sans Internet.

### 4.3 Analyse hors ligne, sur l'appareil
1. **Whisper** transcrit le message et détecte la langue. Choisis le plus petit modèle Whisper qui donne des résultats acceptables, et justifie ce choix par les mesures de la section 9.
2. **L'audio est effacé** dès que la transcription est terminée.
3. **Les noms propres, numéros de téléphone et adresses e-mail** sont retirés du texte avant tout stockage.
4. **Le texte est découpé** en phrases, puis en propositions (« mais », « but », « aber », « pero »...).
5. **Un petit modèle multilingue de similarité de phrases**, open source, compare chaque morceau aux exemples de chaque constat du catalogue (section 5).
   - Si la similarité dépasse un seuil calibré (section 9), le morceau est rattaché à ce constat.
   - Un morceau peut toucher au plus 2 constats, s'ils dépassent tous les deux le seuil.
6. **Si un morceau est sous le seuil**, ou si la confiance de transcription est faible, il passe en « pas sûr ».
7. **Si un morceau ne ressemble à aucun constat**, il passe en « hors liste ».

### 4.4 Les cas « pas sûr » : signaler, jamais deviner
- Un morceau « pas sûr » n'est jamais compté dans le récap.
- Le récap le signale : « {p} remarques pas comprises : demandez à une personne. »
- Sur le smartphone, une liste en lecture seule, « À faire lire par une personne », montre :
  - le texte d'origine, sans nom ;
  - une version anglaise produite par Whisper, clairement marquée « traduction automatique, à vérifier ».

  Le guide, la fille de l'hôte ou quelqu'un de la coopérative peut les lire. L'outil ne tranche jamais à leur place.

### 4.5 Les sujets inconnus qui reviennent
- Les morceaux « hors liste » sont regroupés par sens.
- Quand un même sujet revient chez au moins 3 visiteurs différents, le récap le signale : « Un sujet que l'outil ne connaît pas revient chez {k} visiteurs : demandez à une personne de lire ces remarques. »
- Les phrases du groupe apparaissent dans la liste « À faire lire par une personne ».
- Echo ne nomme jamais ce sujet lui-même, puisqu'il n'a pas de phrase validée pour le dire.
- Le catalogue s'enrichit uniquement si quelqu'un modifie le fichier du catalogue (section 5).

### 4.6 Récap mensuel pour l'hôte
- Il est construit **uniquement** à partir des modèles de phrases kinyarwanda figés dans le catalogue, avec des emplacements pour les chiffres.
- Il contient au plus 5 lignes :
  1. **Volume :** « Ce mois-ci : {n} retours. »
  2. **À garder :** le constat positif le plus cité, avec « {k} sur {n} ».
  3. **À corriger en priorité :** le constat négatif le plus cité, avec « {k} sur {n} », plus « {x}e mois de suite » s'il revient.
     - Il faut au moins 2 mentions, ou 2 mois de suite. Sinon, la ligne dit « Rien d'urgent à corriger ».
     - En cas d'égalité, celui qui revient depuis le plus de mois l'emporte.
  4. **Sujet inconnu qui revient**, s'il y en a un (section 4.5).
  5. **Remarques pas comprises**, s'il y en a (section 4.4).
- **Le récap est envoyé de deux façons :**
  - un vrai SMS envoyé par la carte SIM d'un Android vers le téléphone simple de l'hôte, sans Internet, en un ou plusieurs SMS courts ;
  - une version audio, lue sur le smartphone à partir de fichiers audio préparés à l'avance (section 5).
- **Mois sans message :** « Pas de retour ce mois-ci. »
- Echo ne déclenche jamais d'action. L'hôte décide seul de ce qu'il change.

### 4.7 Vue coopérative (bonus)
- Tendances anonymes par constat, pour toutes les fermes qui ont donné leur accord. Exemples : « 5 fermes sur 12 : chemin trop long », « torréfaction appréciée partout : une offre à créer ».
- Les morceaux qui parlent du guide restent visibles par l'hôte uniquement. Ils n'apparaissent jamais dans la vue coopérative ni à l'extérieur.

## 5. Le catalogue de constats

### Contenu de chaque constat
- un identifiant ;
- un intitulé en français et en anglais ;
- une polarité (positif ou négatif) ;
- 5 à 10 formulations d'exemple dans chaque langue visiteur (anglais, français, allemand, espagnol), rédigées par toi et marquées synthétiques ;
- la phrase kinyarwanda du récap ;
- son fichier audio.

### Première version

**Positifs :**
- P1 Accueil chaleureux
- P2 Visite du champ et des caféiers intéressante
- P3 Torréfaction ou dégustation appréciée
- P4 Repas apprécié
- P5 Explications claires sur le café et la ferme
- P6 Expérience authentique, vie de la ferme
- P7 Paysage, cadre
- P8 Bon rapport qualité-prix
- P9 Envie d'acheter du café
- P10 Envie de revenir ou de recommander
- P11 Satisfaction générale (« merci, c'était super »)

**Négatifs :**
- N1 Chemin ou accès trop long ou difficile
- N2 Prix pas clairs ou annoncés trop tard
- N3 Visite trop longue
- N4 Visite trop courte
- N5 Difficulté à se comprendre
- N6 Repas absent ou insuffisant
- N7 Toilettes ou hygiène
- N8 Manque d'eau, d'ombre ou de pause
- N9 Attente, horaires non respectés
- N10 Impossible d'acheter du café ou un souvenir

### Produire le kinyarwanda sans locuteur
Tu le produis **une seule fois, avant l'utilisation**, puis tu le figes dans le catalogue. Rien n'est traduit ni généré pendant l'utilisation.

1. **Écris les phrases sources** (intitulés et modèles du récap) en français et en anglais, courtes et simples.
2. **Traduis-les en kinyarwanda** avec un modèle de traduction open source, par exemple NLLB-200, cité dans le PDF officiel.
3. **Vérifie chaque phrase par rétro-traduction :** retraduis-la du kinyarwanda vers le français, puis compare le sens avec la phrase source grâce au modèle de similarité.
   - Si le score est faible, simplifie la phrase source et recommence.
   - Garde le score de chaque phrase dans le catalogue.
4. **Les chiffres restent en chiffres.** Vérifie après traduction que chaque emplacement ({n}, {k}...) est intact.
5. **Génère les fichiers audio** avec une voix de synthèse kinyarwanda open source, par exemple MMS de Meta, citée dans le PDF officiel. Cite sa licence, qui peut être non commerciale.
6. **Marque tout ce kinyarwanda** « traduction automatique, non validée par un locuteur ». C'est une limite à écrire dans le README.

Indique aussi, comme référence, le score publié du modèle de traduction vers le kinyarwanda sur le benchmark FLORES-200.

## 6. Ce qui est stocké, et ce qui ne l'est pas

**Stocké sur l'appareil uniquement :**
- pour chaque message : date, langue, liste des constats avec leur confiance, statut ;
- le texte sans nom des morceaux « pas sûr » ou « hors liste ».

**Jamais stocké :**
- l'audio, effacé après transcription ;
- les noms ;
- les numéros des visiteurs.

**Jamais envoyé dans le cloud :** rien du tout.

**Côté coopérative :** des chiffres agrégés par constat, uniquement avec l'accord de l'hôte.

**Bonus :** un code PIN pour ouvrir Echo, utile sur un téléphone partagé.

## 7. Cas limites à gérer

- **Silence, message de moins de 3 secondes ou trop bruité :** marqué « inaudible ». Non compté, et aucune devinette.
- **Langue mal reconnue ou confiance de transcription faible :** tout le message passe en « pas sûr ».
- **Négations** (« le chemin n'était pas trop long ») : elles ne doivent pas déclencher N1. En cas de doute, « pas sûr ».
- **Une phrase avec plusieurs constats :** découpage, au plus 2 constats par morceau.
- **Doublons** (le même message envoyé deux fois) : comptés une seule fois.
- **Messages écrits :** même parcours, sans transcription.
- **Morceaux qui mentionnent le guide :** visibles par l'hôte uniquement.

## 8. La démo web « Essayer »

- Un lien public, **sans compte ni connexion**.
- Les modèles tournent sur l'appareil du visiteur du site. Après le premier chargement, tout marche même si on coupe Internet. Affiche un indicateur visible « Hors ligne ».
- **Messages d'exemple déjà chargés,** à lancer en un clic. Ce sont des voix de synthèse marquées comme telles :
  - allemand : torréfaction appréciée et chemin trop long ;
  - anglais : prix pas clairs et envie d'acheter du café ;
  - français : accueil et repas ;
  - espagnol : visite trop longue ;
  - une négation ;
  - un message ambigu, qui doit finir en « pas sûr » ;
  - trois messages sur la cueillette (anglais, allemand, français), qui doivent déclencher le signal « sujet inconnu qui revient » ;
  - un message inaudible.
- **Un bouton pour enregistrer sa propre voix,** 30 secondes maximum.
- **Pour chaque message, afficher :** la transcription, la langue détectée, le découpage, le constat rattaché avec sa confiance, les « pas sûr » en orange et les « hors liste » à part.
- **Le récap mensuel en kinyarwanda,** avec une traduction française et anglaise affichée à côté pour comprendre, et un bouton pour l'écouter.
- **Un historique de 3 mois simulés,** marqués « synthétiques », pour montrer les tendances.
- **La liste « À faire lire par une personne ».**
- **Un mode comparaison :** sur le même message, le résultat de la méthode par mots-clés à côté de celui d'Echo.
- **Un encart :** taille des modèles, et « tout tourne sur cet appareil ».

## 9. La preuve : une évaluation entièrement automatique

Aucun enregistrement humain n'est nécessaire. L'évaluation a trois niveaux, et tout se lance en une seule commande.

### Niveau 1 : transcription sur de vraies voix humaines
- Mesure le taux d'erreur de Whisper sur le jeu public FLEURS, pour l'anglais, le français, l'allemand et l'espagnol (plus le swahili en bonus).
- Si c'est utile, complète avec Mozilla Common Voice pour la variété des accents.
- Ce niveau compense le fait que les voix des niveaux suivants sont synthétiques.

### Niveau 2 : classement sur du texte
- Rédige 150 à 300 retours de visiteurs synthétiques, dans les 4 langues, aux styles variés :
  - fautes de frappe ;
  - phrases longues ou très courtes ;
  - négations ;
  - plusieurs constats par phrase ;
  - environ 10 % hors liste ;
  - quelques retours ambigus ;
  - trois retours sur la cueillette.
- Annote chaque retour avec les constats attendus.
- Ces retours sont strictement séparés des exemples du catalogue.
- Si une source publique d'avis réels, écrits en plusieurs langues, a une licence compatible, ajoute-la. Sinon, écris-le comme une limite.

### Niveau 3 : de bout en bout sur de l'audio synthétique
- Transforme 60 à 100 de ces retours en audio avec une voix de synthèse multilingue open source, en variant les voix et la vitesse.
- Ajoute des bruits d'ambiance extérieurs, issus d'une source publique dont la licence est citée, à plusieurs niveaux.
- Fais passer cet audio par tout le parcours : Whisper, puis classement.
- Mesure la perte de qualité par rapport au niveau 2.

### Les mesures, langue par langue
- **Taux d'erreur de transcription :** niveaux 1 et 3.
- **Précision, rappel et F1,** par constat et au total : niveaux 2 et 3.
- **Taux de « pas sûr ».**
- **Taux d'erreur parmi les réponses acceptées.** C'est la mesure la plus importante pour la sécurité.
- **La courbe** « part des morceaux traités » contre « taux d'erreur » selon le seuil, et la justification du seuil choisi.
- **La matrice de confusion.**
- **La détection des sujets inconnus :** le groupe « cueillette » est-il bien signalé, et y a-t-il de fausses alertes ?

### La comparaison sans IA
- Des listes de mots-clés par constat et par langue.
- Mêmes mesures sur les niveaux 2 et 3.
- Un tableau comparatif Echo / mots-clés.

### Les performances
- Taille de chaque modèle et taille totale.
- Mémoire utilisée.
- Temps de traitement d'un message de 30 secondes sur un Android d'entrée de gamme.

Tout est marqué « synthétique » quand c'est le cas. Les résultats vont dans le README.

## 10. La fiche données (dans le README)

Pour chaque source, indiquer : nom, source, licence (vérifie chacune toi-même), taille, usage dans le projet, et ce qu'elle ne couvre pas.

**Données qui montrent le problème** (chiffres pour le Rwanda, avec source et année) :
- statistiques UN Tourism (arrivées, recettes) ;
- série tourisme des World Development Indicators de la Banque mondiale ;
- World Bank Enterprise Surveys (contraintes des petites entreprises) ;
- rapport GSMA sur l'écart entre femmes et hommes dans l'usage du mobile (téléphones simples contre smartphones) ;
- OpenStreetMap via Overpass : combien d'activités touristiques rurales sont référencées autour d'une zone caféière, pour montrer que les petites fermes sont invisibles.

**Données et modèles de construction et d'évaluation :**
- Whisper ;
- le modèle multilingue de similarité de phrases ;
- FLEURS ;
- Mozilla Common Voice ;
- le modèle de traduction et FLORES-200 ;
- la voix de synthèse kinyarwanda ;
- la voix de synthèse multilingue des tests ;
- la source des bruits d'ambiance ;
- les retours rédigés par toi (synthétiques).

**Ce que les données ne couvrent pas** (le jury le note) :
- aucun corpus public de retours sur des visites de ferme en Afrique ;
- des retours rédigés, et des voix de synthèse plus propres que de vrais visiteurs dehors ;
- un kinyarwanda traduit automatiquement, sans validation par un locuteur ;
- Whisper est moins bon hors de l'anglais.

**À écrire aussi :** Echo crée la donnée qui manque aujourd'hui, c'est-à-dire des retours structurés par ferme et par coopérative.

## 11. Le README : sections attendues

1. Le problème et les utilisateurs, avec la phrase de problème (section 13).
2. Le parcours complet.
3. Ce que fait l'IA, pourquoi un outil simple ne suffit pas, et le tableau comparant Google Traduction, un guide, un formulaire et Echo.
4. Les garde-fous.
5. Les résultats chiffrés (section 9).
6. La fiche données (section 10).
7. L'IA responsable :
   - consentement ;
   - où sont les données et qui les lit ;
   - téléphone perdu ou partagé ;
   - écarts de qualité selon la langue ;
   - « pas sûr » toujours signalé, jamais deviné ;
   - traitement des critiques sur le guide.
8. Langue moins bien couverte, avec deux réponses :
   - côté hôte, le kinyarwanda n'est qu'une vingtaine de phrases figées, produites une fois et vérifiées par rétro-traduction. Pour une langue que la traduction automatique couvre mal, un locuteur peut simplement les écrire et les enregistrer, sans aucun modèle ;
   - côté visiteur, une langue mal reconnue tombe en « pas sûr ».
9. Réplicabilité : changer d'activité, c'est changer le catalogue ; déploiement par les coopératives ; coûts (modèles gratuits, seuls les SMS coûtent) ; plan de pilote.
10. Limites :
    - taux de réponse des visiteurs inconnu ;
    - le visiteur a besoin de réseau pour envoyer son message ;
    - dépendance à WhatsApp pour le prototype ;
    - faible volume pour une seule ferme ;
    - données de test et voix synthétiques ;
    - kinyarwanda non validé par un locuteur.
11. La technique : architecture, modèles et tailles, et comment lancer le projet.

## 12. Ordre de priorité

- **P0** (sans ça, rien ne compte) : le parcours complet hors ligne avec au moins 5 constats. Message vocal importé, Whisper, constats, « pas sûr » signalé, récap kinyarwanda, vrai SMS.
- **P1 :** le catalogue complet avec son kinyarwanda vérifié par rétro-traduction, l'évaluation sur trois niveaux, la comparaison avec les mots-clés, et le README (fiche données et IA responsable).
- **P2 :** la démo web publique sans compte, avec les messages d'exemple et l'historique de 3 mois.
- **P3 :** le signal « sujet inconnu qui revient ».
- **P4 :** la vue coopérative, la carte visiteur imprimable, et le swahili.

## 13. La phrase de problème (pour le README)

« Because of this tool, small rural tourism hosts like Noor will know every month what visitors loved and what to fix first, which today they never learn once visitors leave; we know because the World Bank brief describes this exact gap, and our tests show the tool captures [X %] of visitor remarks versus [Y %] for keyword matching. »

Remplacer X et Y par les résultats de la section 9.

## 14. C'est terminé quand

- [ ] Le parcours P0 marche en mode avion, sur un vrai Android.
- [ ] Un vrai SMS en kinyarwanda arrive sur un vrai téléphone simple.
- [ ] Le texte de l'hôte ne contient que des phrases figées du catalogue ; rien n'est généré pendant l'utilisation.
- [ ] Un « pas sûr » n'est jamais compté, et il est toujours signalé avec « demandez à une personne ».
- [ ] L'évaluation sur trois niveaux se lance en une commande, et ses résultats sont dans le README.
- [ ] La fiche données est complète : licences, tailles et manques.
- [ ] La partie IA responsable est rédigée.
- [ ] La démo web est accessible sans compte et marche hors ligne après le premier chargement.
- [ ] Tout ce qui est simulé est signalé comme tel.
- [ ] Le dépôt est public, avec les instructions pour lancer le projet.
