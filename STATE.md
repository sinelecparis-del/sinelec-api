# ⚡ SINELEC OS — Journal de bord
> Dernière mise à jour : 16 mai 2026  
> Version : v3.0 — Session 6 (mega session)

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
| **Assurance décennale** | ORUS — N° 278499522 |

---

## 🏗️ Infrastructure

| Composant | Détail |
|-----------|--------|
| **Backend** | Railway + GitHub (`sinelecparis-del/sinelec-api`) |
| **Base de données** | Supabase |
| **Email/SMS** | Brevo |
| **Paiement** | SumUp |
| **IA** | Claude (Anthropic) — Sonnet 4.6 |
| **URL prod** | `sinelec-api-production.up.railway.app` |
| **Fichiers principaux** | `app.html` (~7700L) + `server.js` (~3750L) |
| **Device principal** | Tablette Samsung Chrome |

---

## 📊 État actuel

- **91 avis Google** — 5,0 ⭐ (objectif : 150+)
- **129 prestations** — 13 catégories 🔒 INTOUCHABLE
- **283+ documents** en historique
- **134 234€** CA facturé total (OBAT + SINELEC OS)
- **458€** reste à encaisser

---

## 🖥️ Pages SINELEC OS

| Page | Icône | Description |
|------|-------|-------------|
| Dépannage | ⚡ | Formulaire devis rapide + panier |
| Agenda | 📅 | Leads + interventions planifiées |
| Devis | 📋 | Historique devis |
| Facture | 💶 | Historique factures |
| CA & Stats | 📊 | Dashboard chiffre d'affaires |
| Rentabilité | 💰 | CA - charges = bénéfice net + scan ticket |
| Historique | 📁 | Tous les documents (SINELEC OS + OBAT) |
| Script Vocal | 🎙️ | Assistant vocal IA fr-FR |
| Chat AI | 🤖 | Chatbot devis |
| Analyse DPE | 🏠 | Lecture PDF DPE → devis auto ✅ fonctionnel |
| Rapport | 📸 | Rapport d'intervention avec photos |
| Clients | 👥 | Fiches clients + historique |
| Santé | 🔧 | Monitoring 6 services |
| Paramètres | ⚙️ | Configuration |

---

## 🗄️ Tables Supabase

| Table | Contenu |
|-------|---------|
| `historique` | Tous les devis et factures SINELEC OS |
| `clients` | Fiches clients |
| `agenda` | Leads + interventions planifiées |
| `rapports` | Rapports d'intervention |
| `compteurs` | Numérotation auto devis/factures |
| `grille_tarifaire` | 129 prestations 13 catégories 🔒 |
| `factures_obat` | Import OBAT (134K€ CA, 283+ docs) |
| `monitoring` | Statut 6 services |
| `ia_corrections` | Corrections auto IA |
| `signatures` | Signatures clients (base64 + IP) |
| `charges` | Charges mensuelles rentabilité |

**Colonnes tracking email** (ajoutées session 6) :
```sql
ALTER TABLE historique
ADD COLUMN IF NOT EXISTS email_ouvert boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS nb_ouvertures integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS premiere_ouverture timestamptz,
ADD COLUMN IF NOT EXISTS derniere_ouverture timestamptz;
```

**Colonnes signature** :
```sql
ALTER TABLE historique
ADD COLUMN IF NOT EXISTS signature text,
ADD COLUMN IF NOT EXISTS date_signature timestamptz,
ADD COLUMN IF NOT EXISTS cgv_acceptees boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS otp_verifie boolean DEFAULT false;
```

---

## ✅ Features réalisées — Session 6 (16 mai 2026)

### PDF & Documents
- [x] PDF signé — tampon SIGNÉ vert intégré dans colonne signature (plus de page perdue)
- [x] PDF signé — filigrane SIGNÉ diagonal moyen (opacity 0.12)
- [x] PDF facture payée — filigrane PAYÉ diagonal moyen (opacity 0.12)
- [x] PDF signé — QR code lien signature directe
- [x] PDF signé — validité 30 jours visible sous NET À PAYER
- [x] PDF signé — numéro de page 1/2 en footer
- [x] PDF historique — identique au PDF envoyé (synchro des deux scripts)
- [x] PDF OBAT — généré depuis données importées (bouton ⬇️)
- [x] Bug 500 PDF historique — couleurs OR_FONCE + VERT manquantes → corrigé
- [x] Bug 500 PDF OBAT — str(isPaye) Python dans JS → corrigé
- [x] Apostrophes dans templates Python (jusqu'au, d'application) → corrigé

### Signature client
- [x] Signature ne remontait pas dans l'app → update Supabase silencieux fixé
- [x] CGV en triple-guillemets Python → apostrophes gérées
- [x] Statut 'signe' mis à jour en 2 tentatives (complet → minimal fallback)

### Historique
- [x] OBAT documents visibles dans historique (statuts mappés correctement)
- [x] Mapping statuts OBAT : Payée→paye, Finalisée→paye, Annulée→annule, Envoyée→envoye
- [x] Action sheet mobile — tap sur ligne → bottom sheet actions
- [x] Colonnes DATE/INTERVENTION masquées sur mobile
- [x] Bouton "Tous" reset tous les filtres (type + statut + mois + recherche)
- [x] OBAT documents : bouton ⬇️ télécharge PDF généré style SINELEC

### Automatisations
- [x] Relance devis non signés J+7 / J+14 / J+21 (cron 9h quotidien)
- [x] Email + SMS par relance avec badge "Rappel X/3"
- [x] Mode nuit 22h — tarifs urgence automatiques (180€ soir, 250€ WE/fériés)
- [x] Notif temps réel email ouvert (polling 45s + vibration + notif Chrome)
- [x] Photo ticket → rentabilité auto (Claude Vision → pré-remplit formulaire)

### Technique
- [x] GRANTS Supabase toutes tables → blindé pour octobre 2026
- [x] package.json — module ws ajouté → deploy Railway fixé
- [x] authMiddleware supprimé sur /check-signature → polling fonctionne
- [x] Colonnes tracking email créées dans Supabase

---

## ✅ Features réalisées — Sessions 1-5 (historique)

### Session 1-2
- [x] Infrastructure Railway + Supabase + Brevo + SumUp
- [x] Génération devis/facture PDF (ReportLab)
- [x] Email auto client + Diahe avec PDF en PJ
- [x] Grille tarifaire 129 prestations 13 catégories 🔒
- [x] Monitoring 6 services + health check horaire

### Session 3
- [x] Signature client électronique (canvas mobile)
- [x] IP client enregistrée (preuve juridique)
- [x] SMS rappel veille + matin (agenda)
- [x] Récap agenda 7h chaque matin
- [x] Calendrier RDV style Doctolib
- [x] Tampon SIGNÉ vert + PAYÉ rouge
- [x] Bouton flottant lead 📞

### Session 4
- [x] Script vocal IA Web Speech API fr-FR
- [x] Fiche client + historique
- [x] Waze + tel cliquable agenda
- [x] Prévisualisation PDF dans historique
- [x] Email tracking pixel espion

### Session 5
- [x] PDF signé régénéré avec vraie signature client
- [x] CGV dans PDF signé (page 2)
- [x] Rapport d'intervention (formulaire + IA + photos + PDF)
- [x] Attestation conformité / non-conformité NF C 15-100
- [x] Relances factures impayées J+7 / J+14 par SMS
- [x] IA autonome surveillance + push GitHub
- [x] Module rentabilité (CA - charges - URSSAF)
- [x] SMS avis Google après facture payée ✅
- [x] Analyse DPE auto (Claude lit PDF → devis) ✅

---

## 🔄 Flux automatisations actives

| Déclencheur | Action | Heure |
|-------------|--------|-------|
| Chaque matin | Récap agenda email Diahe | 7h00 |
| Veille intervention | SMS rappel client | 18h00 |
| Matin intervention | SMS confirmation client | 8h45 |
| Chaque lundi | Rapport hebdo email Diahe | 8h00 |
| Chaque heure | Health check 6 services | :00 |
| Devis J+7 | Email + SMS relance 1/3 | 9h00 |
| Devis J+14 | Email + SMS relance 2/3 | 9h00 |
| Devis J+21 | Email + SMS relance 3/3 | 9h00 |
| Facture J+7 | SMS relance impayée | 9h00 |
| Facture J+14 | SMS relance finale | 9h00 |
| Facture payée | SMS avis Google client | Immédiat |
| Email ouvert | Toast + notif Chrome Diahe | ~45s |
| Après 22h | Mode nuit activé (tarifs urgence) | Temps réel |

---

## 🚀 Backlog — À faire

### Priorité haute
- [ ] **sinelecparis.fr** — CNAME OVH → Railway
- [ ] **LSA mots-clés négatifs** — stage/formation/alternance/BTS/CAP

### Priorité moyenne
- [ ] Module sous-traitants (empire SINELEC)
- [ ] Numéro fixe 01 Paris
- [ ] Dashboard mobile first (KPIs XXL + graph 6 mois)
- [ ] Prévision CA mensuel (basée sur devis signés en attente)
- [ ] Devis A/B (2 options même email)
- [ ] Dossier chantier (devis + facture + rapport groupés)
- [ ] Attestation conformité auto depuis facture

### Priorité basse
- [ ] Devis par SMS
- [ ] Site pages IDF SEO (1 page/semaine)
- [ ] Numéro fixe 01

---

## 🔑 Variables d'environnement Railway

```
SUPABASE_URL=
SUPABASE_KEY=
ANTHROPIC_API_KEY=
BREVO_API_KEY=
SUMUP_API_KEY=
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

---

*Document maintenu par Claude — In sha Allah vers l'empire ⚡🔥*
