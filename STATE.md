# SINELEC OS v2.0 — État du projet
*Dernière mise à jour : 25 Avril 2026 — 06h00*

---

## 🏢 Identité SINELEC

| Info | Valeur |
|------|--------|
| Raison sociale | SINELEC — auto-entrepreneur |
| Dirigeant | Diahe |
| Adresse | 128 Rue La Boétie, 75008 Paris |
| Tél | 07 87 38 86 22 |
| Email | sinelec.paris@gmail.com |
| SIRET | 91015824500019 |
| TVA | Non applicable art. 293B CGI |
| IBAN | FR76 1695 8000 0174 2540 5920 931 |
| BIC | QNTOFRP1XXX |
| Décennale | ORUS — 114 Bd Marius Vivier Merle, 69003 Lyon |

---

## 🚀 Infrastructure

| Composant | URL / Info |
|-----------|-----------|
| Railway (prod) | https://sinelec-api-production.up.railway.app/app.html |
| GitHub | github.com/sinelecparis-del/sinelec-api |
| Supabase | Tables : historique, clients, compteurs, signatures, logs_system |
| Supabase Storage | Bucket : devis-factures (PUBLIC) |
| Email | Brevo API (BREVO_API_KEY dans Railway) |
| PDF | Python / ReportLab (exécuté via execSync dans server.js) |
| Logo | /app/logo_b64.txt (base64) |

---

## 📁 Fichiers clés

```
/app/
├── server.js          ← Backend Node.js principal
├── app.html           ← Frontend SPA (tout en un seul fichier)
├── config-v2.js       ← Feature flags et config
└── logo_b64.txt       ← Logo SINELEC en base64
```

---

## ⚙️ Features (config-v2.js)

| Feature | État |
|---------|------|
| devis_factures | ✅ ON |
| signature_client | ✅ ON |
| email_auto | ✅ ON |
| dashboard_ca | ✅ ON |
| historique | ✅ ON |
| autocomplete_adresse | ✅ ON |
| autocomplete_client | ✅ ON |
| relances_auto | ✅ ON |
| chatbot_claude | ❌ OFF (coût tokens) |
| veille_tarifaire | ❌ OFF (à activer plus tard) |

---

## 🎨 Design PDF

- **Couleurs** : Bleu marine `#1B2A4A` + Or `#C9A84C`
- **Style** : Bande marine gauche + liseré or, header marine pleine largeur
- **Badge numéro** : Encadré or en haut à droite
- **Footer** : Marine avec liseré or et numéro en or
- **Générateur** : Python/ReportLab (script généré dynamiquement dans server.js)

---

## 📊 Grille Tarifaire

**206 prestations — 20 catégories :**

1. 🚗 Déplacement & Urgences (10)
2. 🔧 Dépannage Général (18)
3. ⚡ Tableau Monophasé (17)
4. 🔌 Tableau Triphasé (12)
5. 🔩 Fournitures Diverses (23)
6. 🔌 Prises & Interrupteurs (14)
7. 💡 Éclairage (12)
8. 🔗 Circuits & Câblage (12)
9. 🛡️ Mise aux Normes & Sécurité (9)
10. 🔥 Chauffage Électrique (11)
11. 💨 VMC & Ventilation (10)
12. 🏠 Équipements Spéciaux (9)
13. 🔋 IRVE & Recharge VE (6)
14. 🏡 Domotique & Connecté (7)
15. ❄️ Climatisation & PAC (6)
16. 🏊 Piscine & Spa (6)
17. 🏗️ Chantier & Tertiaire (8)
18. 🚪 Portail & Accès (5)
19. ⚡ Groupe & Onduleur (3)
20. 📋 Administratif & Consuel (7)

**Format chaque prestation :** `{ f: forfait, fo: fourniture, mo: main_oeuvre }`

---

## ✅ Features implémentées

- [x] Génération devis/facture PDF bleu marine/or
- [x] Email auto avec PDF en pièce jointe (Brevo)
- [x] Descriptions auto par prestation (Claude API)
- [x] 3 modes facturation : Forfait / Fourniture / MO (popup au clic)
- [x] Barre de recherche temps réel par mot-clé
- [x] Toggle Particulier / Société (SIRET + TVA)
- [x] Prénom + Nom séparés en MAJUSCULES
- [x] Remise globale % ou €
- [x] Paniers favoris (localStorage)
- [x] Alerte devis non signés +48h (badge rouge historique)
- [x] PDF téléchargeable depuis historique (`/api/pdf/:num`)
- [x] Devis → Facture 1 clic (historique)
- [x] Dashboard CA (mois, année, panier moyen)
- [x] Autocomplete client + adresse GPS
- [x] Signature client (canvas touch)
- [x] Favicon ⚡ dans onglet navigateur
- [x] Mode sombre / clair
- [x] Sidebar desktop + tabs mobile

---

## 🐛 Bugs connus / à surveiller

| Bug | Statut | Note |
|-----|--------|------|
| Infos client PDF incomplètes (ville, CP, tél) | ❌ PENDING | CP dans champ séparé, pas envoyé au PDF |
| GPS autocomplete suggestions imprécises | ❌ PENDING | Suggestions trop génériques |
| Popup mode parfois crash si éléments null | ⚠️ PARTIEL | Fix addEventListener DOMContentLoaded fait |
| Page 2 PDF blanche parfois | ⚠️ SURVEILLÉ | Lié au contenu trop long |

---

## 🔥 Priorités demain (session suivante)

### P1 — Critique (finir les fondations)
1. **Fix infos client PDF** — envoyer CP + ville + tél + prenom complet au Python
2. **Descriptions auto stables** — vérifier que Claude génère bien pour chaque ligne
3. **Stabiliser popup mode** — tester sur iPhone + Android

### P2 — Important
4. **Fix GPS autocomplete** — filtrer sur Paris/IDF uniquement
5. **Devis → Facture** — vérifier navigation et pré-remplissage complet

### P3 — Croissance (après fondations)
6. **Google My Business** — optimisation fiche SINELEC
7. **Stratégie avis clients** — automatisation demande d'avis post-intervention
8. **Acquisition** — SEO local Paris, réseaux sociaux

---

## 💡 Règles métier importantes

- **Forfait tout compris** : MO + fourniture + raccordement — jamais tarif horaire
- **Acompte 40%** obligatoire sur devis > 400€
- **Déplacement offert** si intervention > 200€
- **Remise max** : -7% globale
- **Validité devis** : 30 jours
- **Mentions obligatoires** : NF C 15-100, TVA non applicable art. 293B, Garantie décennale ORUS
- **Paiements** : Virement, espèces, CB, PayPal

---

## 📈 Avancement global

| Module | % |
|--------|---|
| Infrastructure | 100% |
| PDF Design | 85% |
| Grille tarifaire | 95% |
| Interface app | 80% |
| Historique | 70% |
| Email auto | 90% |
| **TOTAL OUTIL** | **78%** |
| **EMPIRE (acquisition, croissance)** | **12%** |
