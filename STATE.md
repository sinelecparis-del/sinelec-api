# ⚡ SINELEC OS — Journal de bord
> Dernière mise à jour : 02 mai 2026
> Version : v2.1 — Session 5

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
| **IA** | Claude (Anthropic) — Sonnet 4 |
| **URL prod** | `sinelec-api-production.up.railway.app` |
| **Fichiers principaux** | `app.html` (~5400L) + `server.js` (~2363L) |
| **Device principal** | Tablette Samsung Chrome |

---

## 📊 État actuel

- **91 avis Google** — 5,0 ⭐
- **129 prestations** — 13 catégories 🔒 INTOUCHABLE
- **283+ clients** en base
- **CA Obat à importer** : ~110K€ (PRIORITÉ)

---

## 🖥️ Pages SINELEC OS

| Page | Icône | Description |
|------|-------|-------------|
| Dépannage | ⚡ | Formulaire devis rapide + panier |
| Agenda | 📅 | Leads + interventions planifiées |
| Devis | 📋 | Historique devis |
| Facture | 💶 | Historique factures |
| CA & Stats | 📊 | Dashboard chiffre d'affaires |
| Rentabilité | 💰 | CA - charges = bénéfice net |
| Historique | 📁 | Tous les documents |
| Script Vocal | 🎙️ | Assistant vocal IA fr-FR |
| Chat AI | 🤖 | Chatbot devis |
| Analyse DPE | 🏠 | Lecture PDF DPE → devis auto |
| Rapport | 📸 | Rapport d'intervention avec photos |
| Clients | 👥 | Fiches clients + historique |
| Santé | 🔧 | Monitoring 6 services |
| Paramètres | ⚙️ | Configuration |

---

## 🔄 Flux complet d'un document

```
1. DEVIS
   ├── Formulaire rempli (client, prestations, adresse)
   ├── Toggle ⚡ Immédiat / 📅 Planifié
   ├── PDF généré (ReportLab Python)
   ├── Email envoyé au client (PDF en PJ)
   └── Lien signature envoyé

2. DEVIS SIGNÉ ✅
   ├── Client signe sur son téléphone (canvas)
   ├── Signature sauvegardée Supabase (+ IP client)
   ├── PDF régénéré avec :
   │   ├── Tampon 🟢 SIGNÉ rond vert
   │   ├── Vraie signature du client
   │   └── "Bon pour accord — Devis reçu avant exécution des travaux"
   ├── Email client avec PDF signé en PJ
   ├── Email Diahe : notification
   └── Si planifié → Email lien calendrier RDV style Doctolib

3. FACTURE 💶
   ├── Générée en brouillon depuis le devis signé
   ├── Diahe modifie si besoin
   ├── Diahe envoie manuellement
   ├── PDF facture envoyé au client
   └── Relance auto J+7 et J+14 si impayée (SMS)

4. FACTURE ACQUITTÉE 💰
   ├── Paiement SumUp (lien CB) OU manuel (Terminal/Virement/Espèces)
   ├── Tampon 🔴 PAYÉ rouge + mode de paiement
   ├── Email facture acquittée → client + Diahe
   └── SMS avis Google → client (UNIQUEMENT sur facture payée)
```

---

## 📸 Rapport d'intervention

```
1. Renseigner : client, adresse, email⭐, téléphone, travaux courts
2. Cliquer 🤖 "Générer description IA" → 300+ mots style assurance
3. Modifier la description si besoin
4. Ajouter 📷 Photo AVANT + 📷 Photo APRÈS
5. Cliquer 📄 "Générer le rapport PDF"

Résultat PDF :
├── En-tête SINELEC professionnel
├── Fiche intervention (client, adresse, objet, date, référence)
├── Description technique détaillée (IA modifiable)
├── Photos avant/après côte à côte
└── Bloc signatures technicien + client

Envoi automatique :
├── PDF → email client (si email renseigné)
└── Copie → sinelec.paris@gmail.com
```

---

## 💳 Paiements acceptés

- Espèces
- Virement bancaire
- CB / SumUp (terminal ou lien en ligne)

---

## 📱 SMS — Règles stratégiques

| Déclencheur | SMS envoyé |
|-------------|-----------|
| Veille intervention | Rappel 18h J-1 |
| Matin intervention | Confirmation 8h45 |
| Facture payée (SumUp ou manuel) | Confirmation paiement + lien avis Google |
| Facture impayée J+7 | Relance 1 |
| Facture impayée J+14 | Relance 2 (dernière) |

> ⚠️ Le SMS avis Google est **uniquement** envoyé sur facture PAYÉE — jamais sur devis, jamais sur facture en attente.

---

## 👥 Gestion clients

- **Upsert auto** : à chaque génération de devis/facture → fiche client créée/mise à jour dans Supabase
- **Bouton manuel** "👤 Fiche client" dans chaque carte historique
- **Recherche** par nom, téléphone, email ou adresse
- **Autocomplétion** client dans les formulaires (rapport, devis)

---

## 📋 Attestations PDF

| Document | Description |
|----------|-------------|
| Attestation de Conformité NF C 15-100 | Cases □ vides à cocher + tampon + signature |
| Attestation de Non-Conformité NF C 15-100 | Même format + texte déclaration non-conformité officiel |

---

## 🤖 IA Autonome

- Surveillance toutes les heures (cron)
- Capture des erreurs en mémoire (buffer 100 entrées)
- Analyse par Claude → diagnostic + proposition de correction
- Notification email Diahe si problème détecté
- Push GitHub auto si correction disponible
- Table `ia_corrections` dans Supabase
- Routes : `/api/ia/statut` + `/api/ia/appliquer`

---

## 📅 Calendrier RDV client (style Doctolib)

- Page `/rdv/:num` — responsive mobile
- Créneaux 8h-20h lun-sam
- Durée estimée selon type d'intervention (dépannage=1h, VMC=2h, tableau=3h)
- Créneaux occupés bloqués automatiquement depuis l'agenda
- Client choisit → email Diahe avec ✅ Confirmer / ❌ Refuser
- ✅ Confirmer : ajout agenda + email confirmation client
- ❌ Refuser : email client pour rechoisir

---

## 🔒 Règles absolues

- Grille 13 catégories 129 prestations → **JAMAIS modifier** 🔒
- Statuts Supabase : `envoye` / `signe` / `paye` / `facture` / `termine` / `annule` (sans accents)
- SMS avis Google = **uniquement facture payée**
- Remise max **7%**
- Acompte **40%** si montant > 400€
- Déplacement offert si intervention > 200€
- Décliner : HTA industriel, formation, stage, alternance

---

## 💰 Grille tarifaire SINELEC 2026

### Déplacement
| Prestation | Prix |
|-----------|------|
| Paris | 50€ |
| Banlieue <20km | 80€ |
| >20km | 100€ |
| MO/h supplémentaire | 70€ |
| Urgence jour | 130€ |
| Urgence soir | 180€ |
| Urgence nuit/WE | 250€ |
| Déplacement offert si intervention | >200€ |

### Appareillage
| Prestation | Prix |
|-----------|------|
| Prise standard | 90€ |
| Prise spécialisée 32A | 140€ |
| Prise étanche IP44 | 110€ |
| Déplacement prise | 130€ |
| Prise RJ45 | 65€ |
| Prise USB | 85€ |
| Interrupteur simple | 90€ |
| Va-et-vient | 110€ |
| Variateur/connecté | 130€ |

### Éclairage
| Prestation | Prix |
|-----------|------|
| Luminaire simple | 115€ |
| Lustre/lourd | 200€ |
| Spot encastré | 75€/u |
| Bandeau LED | 60€/ml |
| DCL | 100€ |
| Éclairage extérieur | 150€ |
| Chemin lumineux 3 spots | 250€ |

### Tableau électrique
| Prestation | Prix |
|-----------|------|
| Disjoncteur standard | 150€ |
| Disjoncteur diff 30mA AC | 150€ |
| Inter. diff 63A type A | 250€ |
| Contacteur J/N | 120€ |
| Parafoudre | 160€ |
| Télérupteur | 110€ |
| Mini tableau NF C 15-100 | 185€ |
| Tableau 1 rangée | 550€ |
| Tableau 2 rangées | 850€ |
| Tableau 3+ | Sur devis |
| Ajout module | 90€ |

### Dépannage
| Prestation | Prix |
|-----------|------|
| Recherche panne | 120€ |
| Court-circuit | 125€ |
| Remise en service disjonction | 90€ |
| Réparation prise | 90€ |
| Réparation interrupteur | 90€ |
| Chauffage électrique | 220€ |
| Volet roulant | 180€ |
| Diagnostic complet | 150€ |
| Fuite de courant | 130€ |
| Attestation mise en sécurité/rétablissement Enedis | 189€ |

### Normes & Sécurité
| Prestation | Prix |
|-----------|------|
| Mise à la terre | 650€ |
| Liaison équipotentielle principale | 160€ |
| Liaison équipotentielle SdB | 140€ |
| DAAF | 85€ |
| Détecteur CO | 95€ |
| Mise conformité NF C 15-100 | 65€/m² |
| Diagnostic électrique obligatoire | 150€ |

### Circuits & Câblage
| Prestation | Prix |
|-----------|------|
| Circuit apparent 5m | 200€ |
| Circuit encastré 5m | 300€ |
| Câble supplémentaire | 20€/ml |
| Goulotte | 15€/ml |
| Chemin de câble | 30€/ml |
| Passage cloison/dalle | 120€ |

### Chauffage électrique
| Prestation | Prix |
|-----------|------|
| Convecteur | 200€ |
| Radiateur inertie | 350€ |
| Sèche-serviettes | 280€ |
| Thermostat programmable | 140€ |
| Thermostat connecté/fil pilote | 180€ |
| Remplacement convecteur→inertie | 450€ |
| Dépose ancien appareil | 60€ |

### VMC
| Prestation | Prix |
|-----------|------|
| Simple flux autoréglable | 450€ |
| Hygroréglable | 700€ |
| Remplacement moteur | 250€ |
| Bouche extraction | 60€ |
| Nettoyage/entretien | 100€ |
| Ligne dédiée VMC disj 2A | 110€ |

### Équipements divers
| Prestation | Prix |
|-----------|------|
| Interphone audio | 500€ |
| Visiophone | 900€ |
| Sonnette filaire | 130€ |
| Motorisation volet | 350€ |
| Ligne dédiée chauffe-eau | 220€ |
| Raccordement chauffe-eau | 250€ |
| Antenne TV/coax | 200€ |
| Détecteur mouvement | 90€ |
| Prise Green Up | 300€ |
| Borne IRVE 7kW | 1500€ |

### Rénovation /m²
| Prestation | Prix |
|-----------|------|
| Mise en sécurité | 65€/m² |
| Rénovation partielle | 110€/m² |
| Rénovation totale | 150€/m² |
| Installation neuve | 100€/m² |
| Dégressif au-delà de 50m² | ✅ |

---

## 🗄️ Tables Supabase

| Table | Contenu |
|-------|---------|
| `historique` | Tous les devis et factures |
| `clients` | Fiches clients |
| `agenda` | Leads + interventions planifiées |
| `rapports` | Rapports d'intervention |
| `compteurs` | Numérotation auto devis/factures |
| `grille_tarifaire` | 129 prestations 13 catégories 🔒 |
| `factures_obat` | Import Obat (110K€ CA) |
| `monitoring` | Statut 6 services |
| `ia_corrections` | Corrections auto IA |
| `signatures` | Signatures clients (base64 + IP) |
| `charges` | Charges mensuelles rentabilité |

### SQL à exécuter si besoin
```sql
ALTER TABLE historique ADD COLUMN IF NOT EXISTS intervention_type TEXT DEFAULT 'immediat';
ALTER TABLE historique ADD COLUMN IF NOT EXISTS rdv_statut TEXT;
ALTER TABLE historique ADD COLUMN IF NOT EXISTS rdv_demande DATE;
ALTER TABLE historique ADD COLUMN IF NOT EXISTS rdv_heure TEXT;

CREATE TABLE IF NOT EXISTS ia_corrections (
  id BIGSERIAL PRIMARY KEY,
  date TIMESTAMPTZ DEFAULT NOW(),
  severite TEXT,
  diagnostic TEXT,
  message TEXT,
  erreurs TEXT,
  peut_corriger BOOLEAN DEFAULT FALSE,
  statut TEXT DEFAULT 'en_attente',
  commit_sha TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 🚀 Backlog — À faire

### Priorité haute
- [ ] **Import Obat CSV** — 110K€ CA à récupérer dans dashboard
- [ ] **sinelecparis.fr** — CNAME OVH → Railway (pages IDF SEO)
- [ ] **LSA mots-clés négatifs** — stage / formation / alternance / BTS / CAP

### Priorité moyenne
- [ ] Module sous-traitants (empire SINELEC)
- [ ] Numéro fixe 01 Paris
- [ ] Photo avant/après → SMS avis Google post-rapport
- [ ] Photo ticket → charge rentabilité auto
- [ ] Devis budget cible
- [ ] Analyse prix marché concurrents
- [ ] Fiche client auto à chaque devis (✅ FAIT)
- [ ] Note frais photo ticket

### Priorité basse
- [ ] Mode nuit auto après 22h
- [ ] Rappel facture J+7 (✅ FAIT)
- [ ] Réponse avis Google SEO (✅ FAIT)
- [ ] Devis par SMS
- [ ] Site pages IDF SEO
- [ ] Numéro fixe 01

---

## ✅ Features réalisées (toutes sessions)

### Session 1-2
- [x] Infrastructure Railway + Supabase + Brevo + SumUp
- [x] Génération devis/facture PDF (ReportLab)
- [x] Email auto client + Diahe avec PDF en PJ
- [x] Grille tarifaire 129 prestations 13 catégories
- [x] Monitoring 6 services + health check horaire
- [x] Rapport hebdo lundi 8h

### Session 3
- [x] Signature client électronique (canvas mobile)
- [x] IP client enregistrée (preuve juridique)
- [x] SMS rappel veille + matin (agenda)
- [x] Récap agenda 7h chaque matin
- [x] Toggle ⚡ Immédiat / 📅 Planifié
- [x] Calendrier RDV style Doctolib
- [x] Tampon SIGNÉ vert + PAYÉ rouge
- [x] Bouton flottant lead 📞

### Session 4
- [x] Descriptions prestations style assurance (300+ mots)
- [x] Script vocal IA Web Speech API fr-FR
- [x] Fiche client + historique
- [x] Waze + tel cliquable agenda
- [x] Signature popup optionnelle
- [x] Prévisualisation PDF dans historique
- [x] Agenda modifiable inline
- [x] Email confirmation RDV client

### Session 5 (ce soir)
- [x] PDF signé régénéré avec vraie signature client
- [x] "Bon pour accord — Devis reçu avant exécution des travaux"
- [x] Client reçoit copie PDF signée par email automatiquement
- [x] Fiche client créée/mise à jour auto à chaque devis/facture
- [x] Bouton manuel "👤 Fiche client" dans historique
- [x] Recherche clients corrigée (`filtrerClients`)
- [x] Conditions facture (Virement/Espèces/CB)
- [x] Validation email manquant (popup devis/facture/rapport)
- [x] Rapport d'intervention complet (formulaire + IA + photos + PDF)
- [x] Description IA rapport longue style assurance (modifiable)
- [x] Photos avant/après dans le PDF rapport
- [x] PDF rapport envoyé par email client + copie Diahe
- [x] Attestation conformité NF C 15-100 PDF
- [x] Attestation non-conformité NF C 15-100 PDF
- [x] Relances auto factures J+7 / J+14 par SMS
- [x] IA autonome surveillance + push GitHub
- [x] Réponses avis Google SEO via Railway
- [x] Module rentabilité (CA - charges - URSSAF = bénéfice net)

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

*Document maintenu par l'IA SINELEC — In sha Allah vers l'empire ⚡🔥*
