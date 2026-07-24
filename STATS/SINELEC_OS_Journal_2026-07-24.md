# ⚡ SINELEC OS — Journal de bord
> Dernière mise à jour : 24 juillet 2026
> Version : v4.0 — Sessions 1-20+

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
| **Base de données** | Supabase (`jbuoiahcovngebzwpovg`) |
| **Email** | Brevo |
| **Paiement** | SumUp — Hosted Checkout réel intégré |
| **IA** | Claude (Anthropic) — Sonnet 4.6 |
| **URL prod** | `sinelec-api-production.up.railway.app` |
| **Fichiers principaux** | `app.html` (~10115L) + `server.js` (~3000L) |
| **PDF** | Python/ReportLab côté serveur Railway |
| **Device principal** | Tablette Samsung + iPhone |

---

## 📊 État actuel

- **101 avis Google** — 5,0 ⭐
- **144 prestations** dans Supabase — 13 catégories
- **CA 2026** : 16 154 € HT facturé (juillet 2026)
- **MCP SINELEC OS** connecté à Claude — génération devis directement depuis Claude

---

## ✅ Features opérationnelles

### Génération documents
- [x] Devis PDF premium Marine/Or (ReportLab Python)
- [x] Factures PDF avec tampon ACQUITTÉ/PAYÉ
- [x] Rapports d'intervention (photos AVANT/APRÈS + signature)
- [x] Numérotation synchronisée multi-appareils (Supabase)
- [x] Logo SINELEC intégré dans tous les PDFs

### Signature électronique
- [x] Page de signature client avec OTP par SMS
- [x] 3 cases CGV obligatoires avant signature
- [x] CGV complètes 13 articles affichées (Art. 1-13)
- [x] Tampon SIGNÉ vert + signature dans le PDF
- [x] Copie PDF signé envoyée à sinelec.paris@gmail.com
- [x] Traces Supabase : date, heure, IP client

### Email & communication
- [x] Email pro au client avec lien de signature
- [x] Suppression copie non signée (économie Brevo)
- [x] Email RDV si intervention planifiée
- [x] Relances automatiques J+7/J+14/J+21

### Base de données
- [x] Historique persistant Supabase
- [x] Base clients avec autocomplétion
- [x] 144 tarifs dans table `grille_tarifaire`
- [x] Dashboard CA (mois, année, panier moyen, top clients)

### IA & automatisation
- [x] Chatbot Claude — remplit le panier automatiquement
- [x] Claude rédige les rapports d'intervention
- [x] **Génération devis depuis Claude.ai** via `/api/generer`
- [x] Script `telecharger_devis.js` pour récupérer le PDF

### Paiement
- [x] SumUp Hosted Checkout intégré
- [x] Lien paiement envoyé au client
- [x] Marquage automatique facture payée

---

## 🔄 Flux automatisations actives

| Déclencheur | Action | Heure |
|-------------|--------|-------|
| Chaque matin | Récap agenda email Diahe | 7h00 |
| Devis J+7 | SMS rappel ton neutre | 9h00 |
| Devis J+14 | SMS ton commercial | 9h00 |
| Devis J+21 | SMS ton négociation | 9h00 |
| Devis J+30 | Statut → `expire` | 9h00 |
| Facture payée | Email + filigrane PAYÉ + SMS avis | Immédiat |
| Devis signé | PDF signé → client + copie Diahe | Immédiat |

---

## 🚀 Backlog — À faire

### Priorité haute
- [ ] PDF 3 pages avec CGV intégrées dans le document signé
- [ ] Mouchard email (tracking ouverture)
- [ ] Page Santé — finaliser brevo_sms + compteur erreurs
- [ ] Rendez-vous expert-comptable (CA 2025 ~140k€ > seuil micro)
- [ ] Chorus Pro — créer compte avant septembre 2026

### Priorité moyenne
- [ ] Page vitrine `sinelecparis.fr`
- [ ] Dashboard mobile first (KPIs XXL)
- [ ] Module sous-traitants
- [ ] Campagne avis en vagues (30-40/jour)

### Priorité basse / vision long terme
- [ ] Numéro fixe 01 Paris
- [ ] Site pages IDF SEO
- [ ] **ARTISANOS** — SaaS pour autres artisans

---

## 🔑 Variables d'environnement Railway

```
SUPABASE_URL=
SUPABASE_KEY=
ANTHROPIC_API_KEY=
BREVO_API_KEY=
SUMUP_API_KEY=
SUMUP_MERCHANT_CODE=
SUMUP_EMAIL=sinelec.paris@gmail.com
APP_URL=https://sinelec-api-production.up.railway.app
APP_PASSWORD=sinelec2026
JWT_SECRET=
NIXPACKS_APT_PKGS=python3 python3-pip python3-reportlab python3-pil
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

## 📌 Règles de développement non-négociables

- **Ne JAMAIS réécrire `server.js`/`app.html` entièrement** — patches ciblés uniquement
- Toujours montrer un plan avant de coder, attendre validation
- Vérifier syntaxe server.js avant chaque deploy
- Déploiement via GitHub — Railway redéploie automatiquement
- La **GRILLE** (144 prestations, 13 catégories) ne doit jamais être modifiée sans instruction explicite
- Pour générer un devis : nom+prénom, adresse, **téléphone** (OTP), **email** (envoi) — OBLIGATOIRES

---

*Document maintenu par Claude — In sha Allah vers l'empire ⚡🔥*
