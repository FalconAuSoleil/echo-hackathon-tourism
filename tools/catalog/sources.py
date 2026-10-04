# Phrases sources (fr, en) du kinyarwanda, écrites à la main, courtes et simples (SPEC 5).
# Pour chaque phrase : une liste de candidats du plus naturel au plus simple. Le script traduit le premier,
# et ne passe au suivant (« simplifier et recommencer ») que si le score de rétro-traduction est sous le seuil.
# Les constats sont des phrases descriptives (jamais un conseil ni un ordre : Echo ne dit pas quoi faire).

# Phrase de chaque constat, insérée dans {finding} des lignes « à garder » et « à corriger ».
FINDING_SOURCES = {
    "P1": [("Les visiteurs ont été bien accueillis.", "Visitors felt welcome."),
           ("Les visiteurs aiment votre accueil.", "Visitors like your welcome."),
           ("Bon accueil.", "Good welcome.")],
    "P2": [("La visite du champ de café a plu.", "Visitors liked the visit of the coffee field."),
           ("Les visiteurs aiment voir les caféiers.", "Visitors like to see the coffee trees."),
           ("Le champ de café plaît.", "The coffee field is liked.")],
    # NLLB n'a pas de mot pour « torréfier » (il écrit « guteka », cuisiner) : la phrase parle de préparation.
    "P3": [("Les visiteurs ont aimé voir préparer le café et le goûter.",
            "Visitors liked seeing the coffee prepared and tasting it."),
           ("Les visiteurs ont aimé griller et goûter le café.", "Visitors liked roasting and tasting the coffee."),
           ("Les visiteurs aiment goûter le café.", "Visitors like to taste the coffee."),
           ("Le goût du café plaît.", "The coffee taste is liked.")],
    "P4": [("Les visiteurs ont aimé le repas.", "Visitors liked the meal."),
           ("Le repas était bon.", "The food was good.")],
    "P5": [("Vos explications sur le café sont claires.", "Your explanations about coffee are clear."),
           ("Les visiteurs ont bien compris vos explications.", "Visitors understood your explanations well."),
           ("Les visiteurs ont appris beaucoup sur le café.", "Visitors learned a lot about coffee.")],
    "P6": [("Les visiteurs ont aimé voir la vraie vie de la ferme.", "Visitors liked seeing real farm life."),
           ("Les visiteurs aiment la vie de la ferme.", "Visitors like farm life."),
           ("La vie à la ferme plaît.", "Life on the farm is liked.")],
    "P7": [("Les visiteurs ont aimé le paysage.", "Visitors liked the landscape."),
           ("Le paysage est beau.", "The landscape is beautiful.")],
    "P8": [("Le prix est juste pour ce que les visiteurs reçoivent.", "The price is fair for what visitors get."),
           ("La visite vaut son prix.", "The visit is worth its price."),
           ("Le prix est bon.", "The price is good.")],
    "P9": [("Les visiteurs veulent acheter votre café.", "Visitors want to buy your coffee."),
           ("Les visiteurs veulent acheter du café.", "Visitors want to buy coffee.")],
    "P10": [("Les visiteurs veulent revenir et parler de vous à leurs amis.",
             "Visitors want to come back and tell their friends about you."),
            ("Les visiteurs veulent revenir ou vous recommander.", "Visitors want to come back or recommend you."),
            ("Les visiteurs veulent revenir.", "Visitors want to come back.")],
    "P11": [("Les visiteurs sont très contents.", "Visitors are very happy."),
            ("Les visiteurs sont contents de la visite.", "Visitors are happy with the visit."),
            ("Les visiteurs sont contents.", "Visitors are happy.")],
    "N1": [("Le chemin jusqu'à la ferme est trop long ou difficile.", "The road to the farm is too long or difficult."),
           ("Le chemin est trop long.", "The path is too long."),
           ("Il est difficile d'arriver à la ferme.", "It is hard to reach the farm.")],
    "N2": [("Le prix n'est pas clair pour les visiteurs.", "The price is not clear to visitors."),
           ("Les visiteurs ne connaissent pas le prix.", "Visitors do not know the price."),
           ("Le prix est dit trop tard.", "The price is told too late.")],
    "N3": [("La visite est trop longue.", "The visit is too long."),
           ("La visite dure trop longtemps.", "The visit lasts too long.")],
    "N4": [("La visite est trop courte.", "The visit is too short."),
           ("La visite ne dure pas assez.", "The visit does not last long enough.")],
    "N5": [("Les visiteurs ont du mal à vous comprendre.", "Visitors find it hard to understand you."),
           ("Il est difficile de se comprendre.", "It is hard to understand each other."),
           ("La langue est un problème.", "Language is a problem.")],
    "N6": [("Il n'y a pas assez à manger.", "There is not enough food."),
           ("Les visiteurs ont faim.", "Visitors are hungry.")],
    "N7": [("Les toilettes manquent ou sont sales.", "Toilets are missing or dirty."),
           ("Les toilettes ne sont pas propres.", "The toilets are not clean.")],
    "N8": [("Les visiteurs manquent d'eau, d'ombre ou de pause.", "Visitors lack water, shade or a break."),
           ("Les visiteurs ont soif.", "Visitors are thirsty."),
           ("Les visiteurs manquent d'eau.", "Visitors lack water.")],
    "N9": [("Les visiteurs attendent trop longtemps.", "Visitors wait too long."),
           ("La visite commence en retard.", "The visit starts late.")],
    "N10": [("Les visiteurs ne peuvent pas acheter de café.", "Visitors cannot buy coffee."),
            ("Il n'y a rien à acheter.", "There is nothing to buy.")],
}

# Modèles des lignes du récap (SPEC 4.4 à 4.6). Emplacements numériques {n} {k} {x} {p}.
# Les modèles avec constat ("prefix": True) ne contiennent pas {finding} dans la source : seule la partie avant
# le constat est traduite, et la ligne figée devient « <préfixe traduit> : {finding} ». Le constat est une phrase
# déjà traduite et vérifiée à part (FINDING_SOURCES). Ça garantit que {finding} est intact.
TEMPLATE_SOURCES = {
    "volume": {"slots": ["n"], "prefix": False, "candidates": [
        ("Ce mois-ci : {n} messages de visiteurs.", "This month: {n} messages from visitors."),
        ("{n} visiteurs ont envoyé un message ce mois-ci.", "{n} visitors sent a message this month."),
        ("Ce mois-ci, {n} messages.", "This month, {n} messages."),
    ]},
    "keep": {"slots": ["finding", "k", "n"], "prefix": True, "candidates": [
        ("À garder ({k} sur {n})", "Keep this ({k} out of {n})"),
        ("Ce qui plaît ({k} sur {n})", "What visitors like ({k} out of {n})"),
        ("Bien ({k} sur {n})", "Good ({k} out of {n})"),
    ]},
    "fix": {"slots": ["finding", "k", "n"], "prefix": True, "candidates": [
        ("À corriger d'abord ({k} sur {n})", "Fix first ({k} out of {n})"),
        ("Problème principal ({k} sur {n})", "Main problem ({k} out of {n})"),
        ("À améliorer ({k} sur {n})", "To improve ({k} out of {n})"),
        ("Ce qui ne plaît pas aux visiteurs ({k} sur {n})", "What visitors do not like ({k} out of {n})"),
        ("Le plus gros problème ({k} sur {n})", "The biggest problem ({k} out of {n})"),
    ]},
    "fix_streak": {"slots": ["finding", "k", "n", "x"], "prefix": True, "candidates": [
        ("Le plus gros problème ({k} sur {n}), depuis {x} mois", "The biggest problem ({k} out of {n}), for {x} months"),
        ("À corriger d'abord ({k} sur {n}), {x}e mois de suite", "Fix first ({k} out of {n}), month {x} in a row"),
        ("À corriger d'abord ({k} sur {n}), depuis {x} mois", "Fix first ({k} out of {n}), for {x} months"),
        ("Problème principal ({k} sur {n}), depuis {x} mois", "Main problem ({k} out of {n}), for {x} months"),
        ("Ce qui ne plaît pas aux visiteurs ({k} sur {n}), depuis {x} mois",
         "What visitors do not like ({k} out of {n}), for {x} months"),
    ]},
    "nothing_urgent": {"slots": [], "prefix": False, "candidates": [
        ("Rien d'urgent à corriger.", "Nothing urgent to fix."),
        ("Pas de problème urgent.", "No urgent problem."),
        ("Pas de gros problème ce mois-ci.", "No big problem this month."),
        ("Il n'y a pas de problème important.", "There is no important problem."),
    ]},
    "unknown_topic": {"slots": ["k"], "prefix": False, "candidates": [
        # « messages » restait en anglais dans le kinyarwanda (« izo message ») : on parle des mots des visiteurs.
        ("{k} visiteurs parlent d'un sujet nouveau : demandez à une personne de lire leurs mots.",
         "{k} visitors talk about a new topic: ask a person to read their words."),
        ("Un sujet inconnu revient chez {k} visiteurs : demandez à une personne de lire ce qu'ils disent.",
         "An unknown topic comes back from {k} visitors: ask a person to read what they say."),
        ("Nouveau sujet chez {k} visiteurs : demandez à une personne.", "New topic from {k} visitors: ask a person."),
    ]},
    "not_understood": {"slots": ["p"], "prefix": False, "candidates": [
        # {p} compte des remarques (morceaux « pas sûr »), pas des messages : un message peut en contenir plusieurs.
        ("{p} remarques n'ont pas été comprises : demandez à une personne.",
         "{p} remarks were not understood: ask a person."),
        ("{p} remarques pas claires : demandez à quelqu'un.", "{p} unclear remarks: ask someone."),
        ("{p} remarques pas comprises : demandez à une personne.", "{p} remarks not understood: ask a person."),
    ]},
    "no_feedback": {"slots": [], "prefix": False, "candidates": [
        ("Pas de retour ce mois-ci.", "No feedback this month."),
        ("Aucun message de visiteur ce mois-ci.", "No message from visitors this month."),
        ("Ce mois-ci, aucun visiteur n'a envoyé de message.", "This month, no visitor sent a message."),
    ]},
}

# Libellés figés de l'app hôte (mode A : l'hôte se sert elle-même du téléphone). Mêmes règles que les phrases du
# récap : traduits une fois hors ligne, rétro-traduits, notés, jamais traduits au runtime. Les libellés sans
# point final restent sans point (boutons). Affichés avec une icône à côté du kinyarwanda.
UI_SOURCES = {
    "listen": {"slots": [], "candidates": [
        ("Écouter", "Listen"),
        ("Écouter le message", "Listen to the message"),
    ]},
    "send_sms": {"slots": [], "candidates": [
        ("Envoyer le SMS", "Send the SMS"),
        ("Envoyer le message", "Send the message"),
    ]},
    "analyse": {"slots": [], "candidates": [
        ("Analyser les messages", "Analyse the messages"),
        ("Lire les messages", "Read the messages"),
        ("Comprendre les messages", "Understand the messages"),
    ]},
    "recap_month": {"slots": [], "candidates": [
        ("Résumé du mois", "Summary of the month"),
        ("Le résumé de ce mois", "The summary of this month"),
        ("Ce mois-ci", "This month"),
    ]},
    # « Effacez / Delete » revient « Fermez / Lock » (NLLB : « Funga ») : sens faux malgré un score ≥ 0,75 ;
    # la tournure « Il faut effacer » revient « Vous devez supprimer » (essais du 2026-10-04).
    "delete_whatsapp": {"slots": ["n"], "candidates": [
        ("Il faut effacer {n} messages vocaux dans WhatsApp.", "You must delete {n} voice messages in WhatsApp."),
        ("Supprimez {n} messages vocaux de WhatsApp.", "Remove {n} voice messages from WhatsApp."),
        ("Effacez {n} messages dans WhatsApp.", "Delete {n} messages in WhatsApp."),
    ]},
    "deleted": {"slots": [], "candidates": [
        ("Les messages sont effacés", "The messages are deleted"),
        ("C'est effacé", "It is deleted"),
        ("J'ai effacé", "I deleted them"),
        ("Fini", "Done"),
    ]},
}

# Valeurs de protection des emplacements pendant la traduction : nombres à deux chiffres distincts, que NLLB
# recopie tels quels (les petits nombres comme 2 ou 3 sont parfois écrits en toutes lettres). Après traduction,
# chaque valeur doit apparaître exactement une fois, puis elle est remplacée par son emplacement.
SLOT_GUARDS = {"n": "17", "k": "13", "x": "14", "p": "15"}

# Nombres parlés pour le récap audio : forme de comptage kinyarwanda (orthographe actuelle, r et non l).
# Sources : Omniglot « Numbers in Kinyarwanda », languagesandnumbers.com « How to count in Kinyarwanda »,
# Harvard ELIAS « Cardinal and ordinal numbers ». Règle : dizaine + « na » + unité, « n' » devant voyelle.
# Non validé par un locuteur ; l'accord de classe nominale (ex. « abashyitsi batatu ») n'est pas fait :
# les nombres sont dits isolément, en forme de comptage.
_UNITS = ["", "rimwe", "kabiri", "gatatu", "kane", "gatanu", "gatandatu", "karindwi", "umunani", "icyenda"]
_TENS = {1: "cumi", 2: "makumyabiri", 3: "mirongo itatu"}


def number_word(n: int) -> str:
    if n == 0:
        return "zeru"
    if n < 10:
        return _UNITS[n]
    if n == 10:
        return "icumi"
    tens, unit = divmod(n, 10)
    if unit == 0:
        return _TENS[tens]
    u = _UNITS[unit]
    return f"{_TENS[tens]} n'{u}" if u[0] in "aeiou" else f"{_TENS[tens]} na {u}"


NUMBERS = {str(i): number_word(i) for i in range(0, 32)}
