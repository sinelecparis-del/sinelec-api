[SINELEC_OS_Journal_2026-06-15.md](https://github.com/user-attachments/files/28962727/SINELEC_OS_Journal_2026-06-15.md)
# ⚡ SINELEC OS — Journal de bord
> Dernière mise à jour : 15 juin 2026
> Version : v4.0 — Sessions 7-13 (cumulé)

---

## 🏢 Identité SINELEC

| Champ | Valeur |
|-------|--------|
| **Société** | SINELEC (auto-entrepreneur) |
| **Gérant** | Diahe SINERA |
| **SIRET** | 91015824500019 |
| **Adresse** | 128 Rue La Boétie, 75008 Paris |
| **Tél** | 07 87 38 86 22 |
| **Email** | sinelec.paris@gmail.com |
| **TVA** | Non applicable art. 293B CGI |
| **IBAN** | FR76 1695 8000 0174 2540 5920 931 |
| **BIC** | QNTOFRP1XXX |
| **Assurance décennale** | ORUS — 114 Bd Marius Vivier Merle, 69003 Lyon |

---

## 🏗️ Infrastructure

| Composant | Détail |
|-----------|--------|
| **Backend** | Railway + GitHub (`sinelecparis-del/sinelec-api`) |
| **Base de données** | Supabase |
| **Email/SMS** | Brevo |
| **Paiement** | SumUp — **Hosted Checkout réel intégré** (session 13) |
| **IA** | Claude (Anthropic) — Sonnet 4.6 |
| **URL prod** | `sinelec-api-production.up.railway.app` |
| **Fichiers principaux** | `app.html` (~9005L) + `server.js` (~3184L) |
| **Device principal** | Tablette Samsung Chrome + laptop H24 |

---

## 📊 État actuel

- **101 avis Google** — 5,0 ⭐ (objectif : 150+ avant septembre 2026)
- **~149 prestations** — 13 catégories 🔒 INTOUCHABLE (grille +30% appliquée + 15 nouvelles prestations dépannage/circuits)
- **CA 2025 (baseline)** : ~140 000 € — **dépasse le seuil micro-entreprise (77 700 €/an)**
- Structuration juridique (SASU + holding) en réflexion — voir section dédiée

---

## 🖥️ Pages SINELEC OS

| Page | Icône | Description |
|------|-------|-------------|
| Dépannage | ⚡ | Formulaire devis rapide + panier, grille 13 catégories (3 colonnes mobile / 4 tablette) |
| Photo Devis IA | 📷 | Upload photo → Claude Vision analyse → devis pré-rempli |
| Agenda | 📅 | Leads + interventions planifiées |
| Devis | 📋 | Historique devis, suivi relances J+7/14/21 + expiration J+30 |
| Facture | 💶 | Historique factures + paiement en ligne SumUp |
| CA & Stats | 📊 | Dashboard chiffre d'affaires |
| Rentabilité | 💰 | CA - charges = bénéfice net + scan ticket |
| Historique | 📁 | Tous les documents (SINELEC OS + OBAT) |
| Script Vocal | 🎙️ | Assistant vocal IA fr-FR |
| Chat AI | 🤖 | Chatbot devis |
| Analyse DPE | 🏠 | Lecture PDF DPE → devis auto |
| Rapport | 📸 | Rapport d'intervention avec photos |
| Clients | 👥 | Fiches clients + historique + campagne avis Google |
| Avis Google | ⭐ | Avis reçus + **campagne relance clients passés** (session 13) |
| Santé | 🏥 | Monitoring services (cron horaire) |
| Paramètres | ⚙️ | Configuration |

---

## 🗄️ Tables Supabase

| Table | Contenu |
|-------|---------|
| `historique` | Tous les devis et factures SINELEC OS |
| `clients` | Fiches clients |
| `agenda` | Leads + interventions planifiées |
| `rapports` | Rapports d'intervention |
| `compteurs` | Numérotation auto devis/factures + baseline campagne avis |
| `charges` | Charges mensuelles rentabilité |
| `notes_frais` | Notes de frais |
| `materiaux` | Matériaux |
| `avis_google` | Suivi avis Google |
| `templates_devis` | Templates de devis |
| `logs_system` | Logs santé, erreurs, corrections IA |

### Colonnes ajoutées — sessions récentes

**Relances devis (table `historique`)** :
```sql
ALTER TABLE historique
ADD COLUMN IF NOT EXISTS sms_relance_j7 boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS sms_relance_j7_date timestamptz,
ADD COLUMN IF NOT EXISTS sms_relance_j14 boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS sms_relance_j14_date timestamptz,
ADD COLUMN IF NOT EXISTS sms_relance_j21 boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS sms_relance_j21_date timestamptz;
```

**Paiement SumUp (table `historique`)** :
```sql
ALTER TABLE historique
ADD COLUMN IF NOT EXISTS sumup_checkout_id text;
```

**Campagne avis Google (table `clients`)** :
```sql
ALTER TABLE clients
ADD COLUMN IF NOT EXISTS sms_avis_campagne_envoye boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS sms_avis_campagne_date timestamptz;
```

**Signature OTP** : stockée dans `historique.otp_code` / `historique.otp_expiry` (pas de table dédiée).

---

## ✅ Features réalisées — Sessions 7-13 (16 mai → 15 juin 2026)

### Grille tarifaire
- [x] Augmentation +30% sur les 134 prestations existantes (arrondi au multiple de 5)
- [x] +12 nouvelles prestations Dépannage résidentiel (disjoncteur qui saute en permanence, prise qui chauffe, tableau qui fait des étincelles, lumière qui clignote, volet roulant bloqué, interphone/visiophone HS, four/induction qui déclenche, chauffe-eau qui ne chauffe plus, remise en service après Enedis, diagnostic avant achat immobilier, dépannage parties communes copropriété, réparation câble sectionné)
- [x] "Réactivation ligne défectueuse (circuit)" — distincte de "Réactivation coupure générale"
- [x] "Ligne dédiée réfrigérateur/congélateur" et "Ligne dédiée prise de service (atelier/garage)" — 285€
- [x] Affichage des 13 catégories corrigé (3 colonnes mobile / 4 tablette, boutons compactés)

### CGV — Refonte juridique complète
- [x] CGV passées de 7 à **13 articles renforcés** : réception 48h (clause clé anti-litige), valeur probante numérique (SMS/photos/signature), pénalités de retard (3× taux légal + 40€), réserve de propriété, garanties (décennale ORUS + RC Pro), droit de rétractation, responsabilité + sous-traitance autorisée, résiliation client, RGPD, médiateur CM2C + Tribunal Paris
- [x] **CGV affichées sur TOUS les devis envoyés** (pas seulement signés) — bandeau doré "À lire avant signature" si non signé, bandeau vert "CGV acceptées" + signatures si signé
- [x] Bug corrigé : section CGV dupliquée 3× dans `/api/generer` (8 pages → 2-3 pages)
- [x] Bug latent corrigé : `sig_data_b64` / `date_sig` non définis dans `/api/generer` (crash si régénération d'un devis signé)

### Filigranes & tampons
- [x] Filigrane diagonal plein-page **SIGNÉ** (vert) sur devis signés et **PAYÉ** (rouge) sur factures payées — 30% opacité, 130pt, lisible
- [x] Coexiste avec le tampon rond existant

### Relances & cycle de vie devis
- [x] Cron J+7/14/21 vérifié fonctionnel (3 tons progressifs : rappel → commercial → négociation)
- [x] **Bug corrigé** : la relance manuelle "+48h" ne marquait pas `sms_relance_j7` → risque de double SMS avec le cron J+7. Désormais, une relance manuelle marque automatiquement l'étape J+7.
- [x] **Nouveau** : devis non signés à **J+30 → statut `expire`** automatiquement (cron 9h). Ne supprime rien, sort juste des compteurs "en attente"/relances.
- [x] UI accueil : alerte "+48h" enrichie avec badges d'étape (🟡 J+7 / 🟠 J+14 / 🔴 J+21), triée par urgence, sous-titre récap par étape

### Campagne Avis Google — Relance clients passés
- [x] Nouvelle section "📨 Campagne avis clients passés" en haut de la page Avis
- [x] `GET /api/avis/campagne/preview` — calcule les clients éligibles (téléphone connu, jamais sollicités via auto ou campagne)
- [x] `POST /api/avis/campagne/lancer` — envoi progressif (800ms entre chaque SMS), sauvegarde baseline avis avant/après
- [x] `GET /api/avis/campagne/status` — polling progression + gain d'avis avant/après
- [x] Message : *"Bonjour {prénom}, c'est SINELEC, votre électricien à Paris ⚡ ... un avis Google nous aiderait énormément : [lien] — Diahe"*

### Paiement en ligne SumUp — Intégration réelle
- [x] `SUMUP_API_KEY` (clé secrète `sup_sk_...`) + `SUMUP_MERCHANT_CODE` configurés
- [x] `/api/sumup/me` — route diagnostic pour récupérer le `merchant_code` via l'API SumUp
- [x] `/paiement-confirme/:num` — crée un vrai **Hosted Checkout SumUp** à la volée (lien envoyé au client n'expire jamais, la session SumUp de 30min est créée au clic)
- [x] `/paiement-retour/:num` — vérifie le statut auprès de SumUp (`PAID`/`PENDING`/`FAILED`) et marque la facture payée automatiquement si `PAID` (déclenche facture acquittée + email + filigrane PAYÉ + SMS avis)
- [x] Gestion des cas : déjà payé, montant invalide, SumUp indisponible, paiement en attente/échoué avec boutons Actualiser/Réessayer

### Page Santé — Monitoring
- [x] Diagnostic complet : 4 services vérifiés (brevo_email, supabase, claude_api, pdf_python) vs 6 attendus par l'UI → identifié manque brevo_sms + sumup
- [x] **SumUp retiré du monitoring** : `SUMUP_API_KEY` déclaré mais non utilisé pour un health check pertinent (le lien de paiement ne faisait qu'afficher une page statique avant l'intégration ci-dessus)
- [ ] **À finaliser** : brevo_sms (crédits SMS restants) + compteur d'erreurs 24h (`logs_system`) pour compléter les 6 cases

### Stratégie & business (hors code)
- [x] Conseil litige client 1800€ (40% payés, travaux contestés) → mise en demeure → recommandé AR → injonction de payer CERFA 12948*05
- [x] Vérification facturation électronique : B2C non concerné pour l'émission avant sept. 2027, juste créer un compte Chorus Pro avant sept. 2026 pour la réception
- [x] Confirmation Google AI Overviews : impact quasi nul sur recherches locales d'urgence (LSA + avis restent prioritaires)
- [x] Mockup page vitrine `sinelecparis.fr` (séparée de l'app interne) — hero, services, avis, zone IDF, contact — non déployée

---

## ✅ Features réalisées — Session 6 (16 mai 2026)

*(historique conservé — voir détails dans les versions précédentes du journal)*
- PDF signé/payé : tampons + filigranes + QR code signature + footer pagination
- Signature client : fix remontée Supabase, CGV en page 2
- Historique OBAT : mapping statuts, action sheet mobile, téléchargement PDF
- Relances devis J+7/14/21 (première version) + relances factures impayées
- Mode nuit 22h (tarifs urgence auto), notif email ouvert temps réel
- Photo ticket → rentabilité auto via Claude Vision

---

## ✅ Features réalisées — Sessions 1-5 (historique)

*(inchangé — voir versions précédentes du journal)*
- Infrastructure Railway/Supabase/Brevo/SumUp, génération PDF, grille tarifaire, monitoring
- Signature électronique + IP, SMS agenda, calendrier type Doctolib
- Script vocal IA, fiche client, prévisualisation PDF, tracking email
- Rapport d'intervention, attestation NF C 15-100, module rentabilité, SMS avis Google, analyse DPE

---

## 🔄 Flux automatisations actives

| Déclencheur | Action | Heure |
|-------------|--------|-------|
| Chaque matin | Récap agenda email Diahe | 7h00 |
| Veille intervention | SMS rappel client | 18h00 |
| Devis J+7 (ou relance manuelle 48h) | SMS rappel ton neutre | 9h00 |
| Devis J+14 | SMS ton commercial (décennale, NF C 15-100) | 9h00 |
| Devis J+21 | SMS ton négociation ("dispo pour discuter, budget") | 9h00 |
| **Devis J+30** | **Statut → `expire`** (sort des compteurs, conservé en archive) | 9h00 |
| Chaque heure | Health check services | :00 |
| Facture payée (manuel ou SumUp) | Facture acquittée + email + filigrane PAYÉ + SMS avis Google | Immédiat |
| Campagne avis (manuel, ponctuel) | SMS avis Google aux clients jamais sollicités | À la demande |
| Email ouvert | Toast + notif Chrome Diahe | ~45s polling |
| Après 22h | Mode nuit activé (tarifs urgence) | Temps réel |

---

## 🚀 Backlog — À faire

### Priorité haute
- [ ] **Rendez-vous expert-comptable** — dépassement seuil micro-entreprise (CA 2025 ~140k€ vs seuil 77 700€), envisager passage SASU
- [ ] **Avocat fiscaliste spécialisé régularisation TPE/artisans** — point distinct, avant toute structuration future
- [ ] **Page Santé** — finaliser brevo_sms (crédits) + compteur erreurs 24h
- [ ] **LSA mots-clés négatifs** — stage/formation/alternance/BTS/CAP
- [ ] **Chorus Pro** — créer le compte avant septembre 2026 (réception factures fournisseurs)

### Priorité moyenne
- [ ] Page vitrine `sinelecparis.fr` — déployer le mockup existant (séparée de l'app interne)
- [ ] Module sous-traitants (modèle 70/30 — préparé dans les CGV Art.10)
- [ ] Campagne "contrôle annuel" — 2e vague pour clients +12 mois (différée après campagne avis)
- [ ] Envoi campagne avis en vagues (30-40/jour) plutôt qu'en une fois
- [ ] Dashboard mobile first (KPIs XXL + graph 6 mois)
- [ ] Prévision CA mensuel (basée sur devis signés en attente)
- [ ] Dossier chantier (devis + facture + rapport groupés)

### Priorité basse / vision long terme
- [ ] Numéro fixe 01 Paris
- [ ] Site pages IDF SEO (1 page/semaine)
- [ ] **ARTISANOS** — SaaS pour autres artisans (base : structure SINELEC OS), à préparer une fois la structure SASU/holding en place

---

## 🔑 Variables d'environnement Railway

```
SUPABASE_URL=
SUPABASE_KEY=
ANTHROPIC_API_KEY=
BREVO_API_KEY=
SUMUP_API_KEY=          (sup_sk_...)
SUMUP_MERCHANT_CODE=    (ajouté session 13)
SUMUP_EMAIL=sinelec.paris@gmail.com
APP_URL=https://sinelec-api-production.up.railway.app
APP_PASSWORD=sinelec2026
JWT_SECRET=
GITHUB_TOKEN=
GITHUB_REPO=sinelecparis-del/sinelec-api
```

---

## 🔗 Liens utiles

| Lien | URL |
|------|-----|
| App SINELEC OS | `sinelec-api-production.up.railway.app/app.html` |
| Lien avis Google | `https://g.page/r/CSw-MABnFUAYEAE/review` |
| Repo GitHub | `github.com/sinelecparis-del/sinelec-api` |
| Railway | `railway.app` |
| Supabase | `supabase.com` |
| SumUp Dashboard | `me.sumup.com` |

---

## 📌 Règles de développement non-négociables (rappel)

- **Ne JAMAIS réécrire `server.js`/`app.html` entièrement** — patches ciblés uniquement
- Toujours montrer un visu/plan avant de coder, attendre validation explicite
- Vérifier l'équilibre des div après toute modification HTML
- Vérifier le nombre de lignes après upload GitHub (doit correspondre au local)
- Déploiement via upload GitHub (pas copier-coller, qui tronque les gros fichiers) — Railway redéploie automatiquement
- `chargerAccueil` doit rester exactement `Promise.all([fetch('/api/ca-complet'), fetch('/api/agenda')])`
- La **GRILLE** (149 prestations, 13 catégories) ne doit jamais être modifiée sans instruction explicite

---

*Document maintenu par Claude — In sha Allah vers l'empire ⚡🔥*
