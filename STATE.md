# SINELEC OS — STATE.md
**Dernière mise à jour : 28 Avril 2026**

---

## IDENTITÉ SINELEC
- **Raison sociale :** SINELEC EI — Diahe (auto-entrepreneur)
- **Adresse :** 128 Rue La Boétie, 75008 Paris
- **Tél :** 07 87 38 86 22 | sinelec.paris@gmail.com
- **SIRET :** 91015824500019
- **IBAN :** FR76 1695 8000 0174 2540 5920 931 | **BIC :** QNTOFRP1XXX
- **TVA :** Non applicable art. 293B CGI
- **Garantie décennale :** April — 114 Bd Marius Vivier Merle, 69003 Lyon

---

## INFRASTRUCTURE PRODUCTION
- **URL prod :** https://sinelec-api-production.up.railway.app
- **GitHub :** sinelecparis-del/sinelec-api
- **Backend :** server.js (~3554 lignes)
- **Frontend :** app.html (~4454 lignes)
- **Stack :** Railway + GitHub + Supabase + Brevo + SumUp
- **SDK Anthropic :** ^0.27.0 (mis à jour session 28/04)
- **Express body limit :** 50MB
- **Server timeout :** 300 000ms (5 min) pour analyses DPE longues

---

## FONCTIONNALITÉS ACTIVES ✅

### Core
- ⚡ Dépannage rapide → devis 20 sec → signature → facture
- 📋 Devis complet avec catalogue GRILLE
- 💶 Facture avec lien SumUp + facture acquittée auto
- 📋 Duplication devis
- 🏷️ Remise 7% sur Dépannage, Devis, Facture

### Agenda & Communication
- 📅 Agenda CRUD complet
- 📱 SMS rappel client veille 18h + matin 8h45
- ☀️ Récap email Diahe 7h + bilan 19h
- 📦 Matériel van par type d'intervention
- 🔗 Devis → Agenda automatique

### Business Intelligence
- 📊 Dashboard Chart.js (CA 6/12 mois, conversion, zones, top prestations, top clients)
- 📈 Historique complet devis/factures
- 👥 Fiche clients

### Analyse DPE ← NOUVEAU SESSION 28/04
- 📄 Import PDF (extraction texte PDF.js, 15 pages max)
- 🖼️ Import Image (PNG/JPG/HEIC)
- 🖼️ Galerie multi-sélection (jusqu'à 10 photos, compression 800px auto)
- 📷 Caméra directe
- 🤖 Claude Opus analyse UNIQUEMENT l'électricité
- 4 étapes d'analyse, 4096 tokens, prompt béton
- Recommandations cochables → devis en 1 clic
- Descriptions niveau rapport technique assureur

### Descriptions prestations ← NOUVEAU SESSION 28/04
- 20 descriptions GRILLE mises à jour (tableau, mise à la terre, VMC, chauffage, DAAF...)
- Matching intelligent normalisé (accents, variantes Claude vs GRILLE)
- GRILLE prioritaire — plus jamais de descriptions "max 12 mots" générées par Claude

### Monitoring
- 🔍 Health check horaire
- 📊 Rapport hebdo lundi 8h
- 6 services monitorés

---

## BUGS CORRIGÉS SESSION 28/04
1. Page Dépannage `display:none` → visible
2. Prix forfaits hardcodés → dynamiques depuis DEP_FORFAITS
3. Route `/api/rapport` orpheline → reconstruite
4. API key avec `\n` → `.trim()` ajouté (bloquait toutes les images)
5. SDK Anthropic 0.17.0 → 0.27.0 (support vision/images)
6. 2 appels Claude "max 12 mots" qui écrasaient les descriptions → supprimés
7. `capture="environment"` bloquait photos iOS → remplacé par `<label for="...">`
8. Modèle `claude-opus-4-6` invalide → `claude-sonnet-4-20250514` (DPE fonctionne)
9. Railway timeout 60s → `server.timeout = 300000`

---

## GRILLE TARIFAIRE (résumé)
- Déplacement Paris 50€ | Banlieue <20km 80€ | Banlieue >20km 100€
- Urgence jour 130€ | Soir 180€ | Nuit/WE 250€
- Déplacement offert si intervention >200€
- Remise max 7% globale
- Acompte 40% sur devis >400€

---

## STRATÉGIE
- **LSA :** 133€/mois → 3 leads facturés ROI x6,7
- **Google :** 83 avis 5,0⭐
- **Objectif :** 5-6 interventions/jour, 150+ avis → Top 3 Google Paris
- **Modèle :** Dépannage > chantier | Forfait tout compris (jamais à l'heure)

---

## PENDING — À FAIRE

### Dans l'app
- [ ] **Fiche client** avec historique complet des interventions
- [ ] **Remise 7%** sur la page Analyse DPE

### Hors app
- [ ] sinelecparis.fr → CNAME Railway (OVH)
- [ ] LSA mots-clés négatifs (stage/formation/alternance/BTS/CAP)
- [ ] Répondre avis David Ritzzo avec mots-clés SEO

---

## PROGRESSION EMPIRE
```
Infrastructure        ████████████████████  100%
Dépannage rapide      ████████████████████  100%
Devis / Facture       ████████████████████  100%
Agenda + SMS          ████████████████████  100%
Dashboard CA          ████████████████████  100%
Analyse DPE           ████████████████████  100%
Descriptions béton    ████████████████████  100%
Fiche client          ░░░░░░░░░░░░░░░░░░░░    0%
Domaine sinelecparis  ░░░░░░░░░░░░░░░░░░░░    0%
LSA optimisé          ████████░░░░░░░░░░░░   40%

EMPIRE TOTAL          ██████████████████░░   88%
```

---

*"Un mec tout seul avec un van et un téléphone — le client croit qu'il appelle une grosse boîte." 😂*
