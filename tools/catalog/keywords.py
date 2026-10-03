# Listes de mots-clés de la méthode de comparaison sans IA (SPEC 9), par constat et par langue.
# Rédigées à la main, en minuscules. Volontairement naïves : pas de gestion de la négation ni du contexte.
# Un mot-clé peut être un mot ou une courte expression ; la correspondance (sous-chaîne, mots entiers) est décidée
# par packages/core/src/baseline.ts.

KEYWORDS = {
    "P1": {
        "en": ["welcome", "hospitality", "friendly", "kind", "warm", "host"],
        "fr": ["accueil", "accueillant", "hospitalité", "chaleureu", "gentil", "bienvenu"],
        "de": ["empfang", "empfangen", "gastfreundlich", "herzlich", "willkommen", "freundlich"],
        "es": ["acogida", "recibi", "hospitalidad", "amable", "bienvenid", "cálid"],
    },
    "P2": {
        "en": ["field", "plantation", "coffee trees", "coffee plants", "bushes", "plot"],
        "fr": ["champ", "plantation", "caféier", "plants de café", "parcelle"],
        "de": ["feld", "plantage", "kaffeesträuch", "kaffeepflanzen", "kaffeebäum", "kaffeegarten"],
        "es": ["campo", "plantación", "cafeto", "cafetal", "plantas de café", "parcela"],
    },
    "P3": {
        "en": ["roast", "tasting", "taste", "grind", "cup"],
        "fr": ["torréf", "dégustation", "goûter", "griller", "moudre"],
        "de": ["röst", "verkostung", "probieren", "mahlen"],
        "es": ["tost", "cata", "degustación", "probar", "moler"],
    },
    "P4": {
        "en": ["lunch", "meal", "food", "delicious", "tasty", "cooked"],
        "fr": ["repas", "déjeuner", "cuisine", "délicieux", "savoureu", "bon repas"],
        "de": ["essen", "mittagessen", "lecker", "köstlich", "gekocht"],
        "es": ["comida", "almuerzo", "delicios", "rico", "sabros", "cocin"],
    },
    "P5": {
        "en": ["explain", "learned", "informative", "understand how", "clear"],
        "fr": ["expliqu", "appris", "instructif", "comprends", "clair"],
        "de": ["erklär", "gelernt", "lehrreich", "verstehe", "verständlich"],
        "es": ["explic", "aprend", "instructivo", "entiendo", "clar"],
    },
    "P6": {
        "en": ["authentic", "genuine", "real life", "daily life", "farm life", "everyday"],
        "fr": ["authentique", "vraie vie", "quotidien", "vie de la ferme", "vrai"],
        "de": ["authentisch", "echt", "alltag", "landleben", "hofleben"],
        "es": ["auténtic", "genuin", "vida real", "día a día", "vida rural", "de verdad"],
    },
    "P7": {
        "en": ["view", "landscape", "scenery", "hills", "beautiful", "setting"],
        "fr": ["vue", "paysage", "collines", "cadre", "magnifique", "décor"],
        "de": ["aussicht", "blick", "landschaft", "hügel", "kulisse", "umgebung"],
        "es": ["vista", "paisaje", "colinas", "entorno", "precioso", "bonito"],
    },
    "P8": {
        "en": ["value", "worth", "reasonable", "fair price", "cheap"],
        "fr": ["rapport qualité", "vaut", "valait", "raisonnable", "pas cher", "prix juste"],
        "de": ["preis-leistung", "wert", "fair", "günstig", "angemessen"],
        "es": ["calidad-precio", "vale", "valió", "razonable", "barato", "precio justo"],
    },
    "P9": {
        "en": ["buy coffee", "buy some", "purchase", "order coffee", "take a bag", "buy her"],
        "fr": ["acheter", "achèterais", "commander du café", "rapporter un sachet"],
        "de": ["kaufen", "bestellen", "mitnehmen", "abkaufen"],
        "es": ["comprar", "compraría", "pedir café", "llevarme"],
    },
    "P10": {
        "en": ["come back", "return", "recommend", "again", "must-do"],
        "fr": ["reviendr", "revenir", "recommand", "conseille", "refera"],
        "de": ["wiederkommen", "kommen wieder", "empfehl", "noch einmal"],
        "es": ["volver", "volveremos", "recomend", "repetir"],
    },
    "P11": {
        "en": ["thank", "great", "wonderful", "amazing", "perfect", "lovely"],
        "fr": ["merci", "super", "génial", "merveilleu", "parfait", "top"],
        "de": ["danke", "super", "toll", "wunderbar", "perfekt", "großartig"],
        "es": ["gracias", "genial", "maravill", "increíble", "perfecto", "estupendo"],
    },
    "N1": {
        "en": ["path", "road", "access", "way there", "steep", "far", "lost", "track"],
        "fr": ["chemin", "route", "accès", "trajet", "montée", "loin", "perdus", "piste"],
        "de": ["weg", "straße", "anfahrt", "zufahrt", "steil", "weit", "verfahren", "piste"],
        "es": ["camino", "carretera", "acceso", "trayecto", "subida", "lejos", "perdimos", "pista"],
    },
    "N2": {
        "en": ["price", "cost", "fee", "pay", "included", "hidden"],
        "fr": ["prix", "coût", "tarif", "supplément", "payer", "frais"],
        "de": ["preis", "kosten", "aufpreis", "zahlen", "enthalten"],
        "es": ["precio", "costaba", "coste", "suplemento", "pagar", "incluía"],
    },
    "N3": {
        "en": ["too long", "dragged", "endless", "bored", "shorter", "lasted"],
        "fr": ["trop long", "longueur", "interminable", "ennuy", "raccourci", "duré"],
        "de": ["zu lang", "gezogen", "endlos", "gelangweilt", "kürzer", "dauerte"],
        "es": ["demasiado larga", "eterna", "interminable", "aburr", "acort", "duró"],
    },
    "N4": {
        "en": ["too short", "too quick", "rushed", "more time", "stayed longer", "not enough time"],
        "fr": ["trop court", "trop vite", "pressés", "plus de temps", "plus longtemps", "pas assez de temps"],
        "de": ["zu kurz", "zu schnell", "gehetzt", "mehr zeit", "länger", "zu wenig zeit"],
        "es": ["demasiado corta", "muy corta", "rápido", "prisas", "más tiempo", "poco tiempo"],
    },
    "N5": {
        "en": ["understand", "language", "translation", "communicat", "english"],
        "fr": ["comprendre", "comprenait", "langue", "traduction", "communiquer"],
        "de": ["verständig", "verstanden", "sprach", "übersetzung", "kommunikation"],
        "es": ["entender", "entendíamos", "idioma", "traducción", "comunica"],
    },
    "N6": {
        "en": ["no meal", "hungry", "starving", "no lunch", "portions", "something to eat"],
        "fr": ["pas de repas", "faim", "maigre", "portions", "à manger"],
        "de": ["kein essen", "hunger", "dürftig", "portionen", "zu essen"],
        "es": ["no hubo comida", "hambre", "escaso", "raciones", "de comer"],
    },
    "N7": {
        "en": ["toilet", "bathroom", "latrine", "hygiene", "wash our hands", "soap"],
        "fr": ["toilettes", "latrines", "hygiène", "laver les mains", "savon", "sale"],
        "de": ["toilette", "wc", "latrine", "hygiene", "händewaschen", "seife"],
        "es": ["baño", "letrina", "higiene", "lavarnos las manos", "jabón", "sucio"],
    },
    "N8": {
        "en": ["water", "shade", "thirsty", "sun", "break", "rest"],
        "fr": ["eau", "ombre", "soif", "soleil", "pause", "s'asseoir"],
        "de": ["wasser", "schatten", "durst", "sonne", "pause", "sitzplatz"],
        "es": ["agua", "sombra", "sed", "sol", "descanso", "pausa"],
    },
    "N9": {
        "en": ["wait", "late", "schedule", "on time", "agreed time", "timing"],
        "fr": ["attend", "retard", "horaire", "à l'heure", "heure convenue"],
        "de": ["warten", "gewartet", "zu spät", "uhrzeit", "vereinbarten zeit", "zeiten"],
        "es": ["esper", "retraso", "horario", "hora acordada", "tarde"],
    },
    "N10": {
        "en": ["couldn't buy", "nothing to buy", "for sale", "souvenir", "shop"],
        "fr": ["pas pu acheter", "rien à acheter", "à vendre", "souvenir", "boutique"],
        "de": ["nicht kaufen", "nichts zu kaufen", "verkauft", "souvenir", "laden"],
        "es": ["no pudimos comprar", "nada para comprar", "a la venta", "recuerdos", "tienda"],
    },
}
