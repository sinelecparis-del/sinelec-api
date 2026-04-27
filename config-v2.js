// ═══════════════════════════════════════════════════════════════
// SINELEC OS v2.0 - CONFIGURATION CENTRALISÉE
// ═══════════════════════════════════════════════════════════════
// Date: 20 Avril 2026
// Description: Feature flags + configuration système
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  
  // ═══════════════════════════════════════════════════════════════
  // INFORMATIONS ENTREPRISE
  // ═══════════════════════════════════════════════════════════════
  
  entreprise: {
    nom: 'SINELEC Paris',
    siret: '91015824500019',
    ape: '4321A',
    adresse: '128 rue La Boétie, 75008 Paris',
    telephone: '+33 X XX XX XX XX',  // À configurer
    email: 'sinelec.paris@gmail.com',
    tva_non_applicable: true,
    assurance_decennale: 'ORUS',
    zones_intervention: ['75', '77', '78', '91', '92', '93', '94', '95']
  },

  // ═══════════════════════════════════════════════════════════════
  // FEATURE FLAGS
  // ═══════════════════════════════════════════════════════════════
  
  features: {
    
    // ─────────────── CORE (Toujours actifs) ───────────────
    devis_factures: true,              // ✅ Génération devis/factures
    signature_client: true,            // ✅ Signature sur écran
    email_auto: true,                  // ✅ Envoi email automatique
    dashboard_ca: true,                // ✅ Dashboard CA basique
    historique: true,                  // ✅ Historique devis/factures
    
    // ─────────────── INTELLIGENCE (À activer progressivement) ───────────────
    chatbot_claude: true,              // ✅ Chatbot parsing chantier avec recherche web
    autocomplete_adresse: true,        // ✅ Autocomplete OpenStreetMap IDF
    autocomplete_client: true,        // 🔒 Autocomplete clients Supabase
    
    // ─────────────── AUTOMATISATION (À activer) ───────────────
    veille_tarifaire: true,           // 🔒 Analyse marché automatique
    relances_auto: true,              // 🔒 Relances 48h automatiques
    rapports_intervention: true,      // 🔒 Rapports avec photos
    
    // ─────────────── ANALYTICS AVANCÉS (À activer) ───────────────
    prediction_ca: false,              // 🔒 Prédiction CA mensuel
    analyse_devis_perdus: false,       // 🔒 Analyse pourquoi devis non signés
    stats_avancees: false,             // 🔒 Stats détaillées (taux conversion, etc.)
    recommandations_ia: true,         // 🔒 Recommandations Claude
    
    // ─────────────── FUTUR / BETA (Désactivés) ───────────────
    multi_utilisateurs: false,         // 🔒 Gestion équipe
    planning_interventions: false,     // 🔒 Planning/calendrier
    geolocalisation: false,            // 🔒 Tracking GPS chantiers
    paiement_integre: false,           // 🔒 Paiement CB dans l'app
  },

  // ═══════════════════════════════════════════════════════════════
  // VEILLE TARIFAIRE
  // ═══════════════════════════════════════════════════════════════
  
  veille: {
    enabled: false,                    // Master switch
    frequence: 'hebdo',                // 'quotidien', 'hebdo', 'mensuel'
    jour_semaine: 0,                   // 0 = Dimanche, 1 = Lundi, etc.
    heure: '03:00',                    // Heure exécution (format 24h)
    
    // Règles ajustement
    ajustement_auto: true,             // Ajuste sans validation
    seuil_validation: 10,              // % - Au-delà, demande validation
    
    // Positionnement marché
    strategie: 'milieu',               // 'bas', 'milieu', 'haut'
    marge_min_pct: 15,                 // Marge minimale acceptable
    marge_max_pct: 35,                 // Marge maximale
    
    // Sources à analyser
    sources: [
      'homeserve.fr',
      'izi-by-edf.fr',
      'hellocasa.fr',
      'starofservice.com',
      'forums clients',
      'google ads concurrence'
    ],
    
    // Email rapport
    email_rapport: true,
    destinataire: 'sinelec.paris@gmail.com'
  },

  // ═══════════════════════════════════════════════════════════════
  // RELANCES AUTOMATIQUES
  // ═══════════════════════════════════════════════════════════════
  
  relances: {
    enabled: true,                    // Master switch
    
    // Timing
    delai_premiere_relance: 48,        // Heures après envoi
    delai_deuxieme_relance: 168,       // 7 jours
    nb_relances_max: 2,                // Max avant abandon
    
    // Templates
    template_1: "Bonjour, je me permets de revenir vers vous concernant le devis SINELEC {num}. Avez-vous eu l'occasion de le consulter ? Je reste à votre disposition pour toute question.",
    template_2: "Bonjour, je vous recontacte au sujet du devis {num}. N'hésitez pas si vous souhaitez des précisions. Cordialement, SINELEC Paris",
    
    // Horaires envoi
    heure_min: '09:00',
    heure_max: '18:00',
    weekend: false                      // Envoyer le weekend ?
  },

  // ═══════════════════════════════════════════════════════════════
  // PRÉDICTION CA
  // ═══════════════════════════════════════════════════════════════
  
  prediction: {
    enabled: false,                    // Master switch
    
    // Paramètres
    historique_jours: 30,              // Analyse sur X jours
    confiance_min: 70,                 // % confiance minimale
    
    // Alertes
    alerte_baisse: true,               // Alerter si CA baisse
    seuil_alerte: -15,                 // % de baisse
    
    // Fréquence calcul
    frequence: 'quotidien',            // quotidien ou hebdo
    heure: '08:00'
  },

  // ═══════════════════════════════════════════════════════════════
  // EMAIL (BREVO)
  // ═══════════════════════════════════════════════════════════════
  
  email: {
    sender_name: 'SINELEC Paris',
    sender_email: 'sinelec.paris@gmail.com',  // Email vérifié Brevo
    
    // Templates
    template_devis: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:20px;">
    
    <!-- HEADER -->
    <div style="background:linear-gradient(135deg,#1B2A4A,#243660);border-radius:16px;padding:28px;text-align:center;margin-bottom:16px;">
      <div style="font-size:28px;font-weight:900;color:white;letter-spacing:1px;">⚡ SINELEC</div>
      <div style="color:rgba(255,255,255,0.7);font-size:13px;margin-top:6px;">128 Rue La Boetie, 75008 Paris</div>
    </div>
    
    <!-- CORPS -->
    <div style="background:white;border-radius:16px;padding:28px;margin-bottom:16px;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
      <h2 style="color:#1B2A4A;font-size:20px;margin:0 0 16px;">Votre devis {num}</h2>
      <p style="color:#555;font-size:14px;line-height:1.6;margin:0 0 12px;">Bonjour,</p>
      <p style="color:#555;font-size:14px;line-height:1.6;margin:0 0 20px;">
        Veuillez trouver ci-joint votre devis SINELEC. Vous pouvez le consulter en pièce jointe.
      </p>
      
      <!-- BOUTON SIGNATURE -->
      <div style="text-align:center;margin:28px 0;">
        <a href="{lien_signature}" target="_blank"
           style="display:inline-block;background:#C9A84C;color:white;text-decoration:none;padding:16px 36px;border-radius:12px;font-size:16px;font-weight:800;">
          ✍️ Signer le devis en ligne
        </a>
        <p style="color:#999;font-size:12px;margin-top:10px;">Cliquez pour signer votre devis de manière sécurisée</p>
        <p style="color:#aaa;font-size:11px;margin-top:8px;">Si le bouton ne fonctionne pas, copiez ce lien :</p>
        <p style="color:#1B2A4A;font-size:11px;word-break:break-all;margin-top:4px;font-weight:700;">{lien_signature}</p>
      </div>
      
      <div style="background:#f8f9fa;border-radius:10px;padding:14px;font-size:12px;color:#777;line-height:1.6;">
        <strong>Comment ça marche ?</strong><br>
        1. Cliquez sur le bouton ci-dessus<br>
        2. Lisez et acceptez les conditions générales<br>
        3. Signez avec votre doigt ou stylet<br>
        4. Vous recevrez une copie signée par email
      </div>
    </div>
    
    <!-- FOOTER -->
    <div style="text-align:center;padding:16px;color:#aaa;font-size:12px;">
      SINELEC — 07 87 38 86 22 — sinelec.paris@gmail.com<br>
      SIRET : 91015824500019 — Garantie décennale ORUS
    </div>
  </div>
</body>
</html>`,
    
    template_facture: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:20px;">
    
    <div style="background:linear-gradient(135deg,#1B2A4A,#243660);border-radius:16px;padding:28px;text-align:center;margin-bottom:16px;">
      <div style="font-size:28px;font-weight:900;color:white;letter-spacing:1px;">⚡ SINELEC</div>
      <div style="color:rgba(255,255,255,0.7);font-size:13px;margin-top:6px;">128 Rue La Boetie, 75008 Paris</div>
    </div>
    
    <div style="background:white;border-radius:16px;padding:28px;margin-bottom:16px;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
      <h2 style="color:#1B2A4A;font-size:20px;margin:0 0 16px;">Votre facture {num}</h2>
      <p style="color:#555;font-size:14px;line-height:1.6;margin:0 0 12px;">Bonjour,</p>
      <p style="color:#555;font-size:14px;line-height:1.6;margin:0 0 20px;">
        Veuillez trouver ci-joint votre facture SINELEC. Merci pour votre confiance.
      </p>
      <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:14px;text-align:center;">
        <div style="color:#16a34a;font-size:14px;font-weight:700;">✅ Merci pour votre règlement</div>
        <div style="color:#555;font-size:13px;margin-top:4px;">Coordonnées bancaires en pièce jointe</div>
      </div>
    </div>
    
    <div style="text-align:center;padding:16px;color:#aaa;font-size:12px;">
      SINELEC — 07 87 38 86 22 — sinelec.paris@gmail.com<br>
      SIRET : 91015824500019 — Garantie décennale ORUS
    </div>
  </div>
</body>
</html>`
  },

  // ═══════════════════════════════════════════════════════════════
  // UI / UX
  // ═══════════════════════════════════════════════════════════════
  
  ui: {
    theme_defaut: 'light',             // 'light' ou 'dark'
    animations: true,                  // Animations UI
    confetti: true,                    // Confetti conversion devis→facture
    sons: false,                       // Sons notifications
    
    // Mobile
    tabs_bottom: true,                 // Tabs en bas sur mobile
    sidebar_desktop: true,             // Sidebar fixe desktop
    
    // Raccourcis
    raccourcis_clavier: false          // Shortcuts clavier (futur)
  },

  // ═══════════════════════════════════════════════════════════════
  // PERFORMANCE
  // ═══════════════════════════════════════════════════════════════
  
  performance: {
    cache_grille: true,                // Cache grille tarifaire locale
    cache_duree: 3600,                 // Secondes (1h)
    lazy_load_historique: true,        // Charger historique à la demande
    compression_images: true,          // Compress photos rapports
    max_image_size: 500                // Ko max par image
  },

  // ═══════════════════════════════════════════════════════════════
  // SÉCURITÉ
  // ═══════════════════════════════════════════════════════════════
  
  securite: {
    max_tentatives_login: 5,           // Pour futur login
    timeout_session: 86400,            // Secondes (24h)
    backup_auto: false,                // Backup DB auto (futur)
    logs_retention: 90                 // Jours conservation logs
  },

  // ═══════════════════════════════════════════════════════════════
  // DÉVELOPPEMENT
  // ═══════════════════════════════════════════════════════════════
  
  dev: {
    debug_mode: false,                 // Logs verbeux
    mock_data: false,                  // Utiliser fausses données
    skip_email: false,                 // Ne pas envoyer vraiment les emails
    simulation_veille: false           // Simuler veille sans API calls
  },

  // ═══════════════════════════════════════════════════════════════
  // VERSION & COMPATIBILITÉ
  // ═══════════════════════════════════════════════════════════════
  
  meta: {
    version: '2.0.0',
    build_date: '2026-04-20',
    min_node_version: '18.0.0',
    saas_ready: true,                  // Prêt pour multi-tenant
    last_update: '2026-04-20T14:00:00Z'
  }
};

// ═══════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════

// Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
}

// Browser
if (typeof window !== 'undefined') {
  window.SINELEC_CONFIG = CONFIG;
}
