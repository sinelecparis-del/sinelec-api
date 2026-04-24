// ═══════════════════════════════════════════════════════════════
// SINELEC OS v2.0 - BACKEND COMPLET
// ═══════════════════════════════════════════════════════════════
// Date: 20 Avril 2026
// Description: API complète + Cron jobs + Veille tarifaire
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');

// Charger config
const CONFIG = require('./config-v2.js');

// ═══════════════════════════════════════════════════════════════
// INITIALISATION
// ═══════════════════════════════════════════════════════════════

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(__dirname));

// Clients
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

const BREVO_API_KEY = process.env.BREVO_API_KEY;

// ═══════════════════════════════════════════════════════════════
// HEALTHCHECK
// ═══════════════════════════════════════════════════════════════

app.get('/', (req, res) => res.send('✅ SINELEC OS v2.0 API OK'));
app.get('/health', (req, res) => res.json({ 
  status: 'ok', 
  service: 'SINELEC OS v2.0',
  version: CONFIG.meta.version,
  features: Object.entries(CONFIG.features)
    .filter(([k, v]) => v === true)
    .map(([k]) => k)
}));

// ═══════════════════════════════════════════════════════════════
// HELPER: LOGS SYSTÈME
// ═══════════════════════════════════════════════════════════════

async function logSystem(type, message, data = null, success = true, error = null) {
  try {
    await supabase.from('logs_system').insert({
      type,
      message,
      data,
      success,
      error_details: error ? error.toString() : null
    });
    
    if (CONFIG.dev.debug_mode) {
      console.log(`[${type}] ${message}`, data);
    }
  } catch (err) {
    console.error('Erreur log:', err);
  }
}

// ═══════════════════════════════════════════════════════════════
// HELPER: ENVOI EMAIL BREVO
// ═══════════════════════════════════════════════════════════════

async function envoyerEmail(to, subject, htmlContent, attachment = null) {
  if (CONFIG.dev.skip_email) {
    console.log('📧 [DEV] Email skippé:', to, subject);
    return { skipped: true };
  }

  console.log('📧 Tentative envoi email à:', to);
  console.log('📧 Sujet:', subject);
  
  const payload = {
    sender: { 
      name: CONFIG.email.sender_name, 
      email: CONFIG.email.sender_email 
    },
    to: [{ email: to }],
    subject,
    htmlContent,
  };

  if (attachment) {
    payload.attachment = [{
      content: attachment.content,
      name: attachment.name,
    }];
  }

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': BREVO_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('❌ Erreur Brevo:', err);
      await logSystem('email', `Échec envoi à ${to}`, { error: err }, false, err);
      throw new Error(`Brevo error: ${err}`);
    }

    const result = await res.json();
    console.log('✅ Email envoyé avec succès !', result);
    await logSystem('email', `Email envoyé à ${to}`, { subject, messageId: result.messageId }, true);
    return result;
  } catch (error) {
    console.error('❌ Erreur lors de l\'envoi email:', error);
    await logSystem('email', `Erreur envoi à ${to}`, { error: error.message }, false, error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════
// HELPER: INCRÉMENTER COMPTEUR
// ═══════════════════════════════════════════════════════════════

async function incrementerCompteur(type) {
  const { data, error } = await supabase
    .from('compteurs')
    .select('valeur')
    .eq('type', type)
    .single();

  if (error || !data) {
    await supabase.from('compteurs').insert({ type, valeur: 1 });
    return 1;
  }

  const nouvelle_valeur = data.valeur + 1;
  await supabase
    .from('compteurs')
    .update({ valeur: nouvelle_valeur })
    .eq('type', type);

  return nouvelle_valeur;
}

// ═══════════════════════════════════════════════════════════════
// HELPER: CHARGER GRILLE TARIFAIRE
// ═══════════════════════════════════════════════════════════════

async function chargerGrilleTarifaire() {
  const { data, error } = await supabase
    .from('grille_tarifaire')
    .select('*')
    .eq('actif', true)
    .order('categorie, nom');

  if (error) {
    console.error('Erreur chargement grille:', error);
    return null;
  }

  // Grouper par catégorie
  const grille = {};
  data.forEach(item => {
    if (!grille[item.categorie]) {
      grille[item.categorie] = [];
    }
    grille[item.categorie].push({
      code: item.code,
      nom: item.nom,
      prix: item.prix_ht,
      unite: item.unite
    });
  });

  return grille;
}

// ═══════════════════════════════════════════════════════════════
// API: GÉNÉRATION DEVIS/FACTURE
// ═══════════════════════════════════════════════════════════════

app.post('/api/generer', async (req, res) => {
 if (!CONFIG.features.devis_factures) {
    return res.status(403).json({ error: 'Feature désactivée' });
  }

  try {
    const { type, client, email, telephone, adresse, prestations, pdf_base64 } = req.body;
    const startTime = Date.now();

    // Générer numéro
    const compteur = await incrementerCompteur(type);
    const annee = new Date().getFullYear();
    const mois = String(new Date().getMonth() + 1).padStart(2, '0');
    const num = type === 'devis' 
      ? `OS-${annee}${mois}-${String(compteur).padStart(3, '0')}`
      : `${annee}${mois}-${String(compteur).padStart(3, '0')}`;

    // Calculer total
    const total_ht = prestations.reduce((sum, p) => sum + (p.prix * p.quantite), 0);

    // Upload PDF Supabase Storage
    if (pdf_base64) {
      const buffer = Buffer.from(pdf_base64, 'base64');
      await supabase.storage
        .from('devis-factures')
        .upload(`${num}.pdf`, buffer, { contentType: 'application/pdf' });
    }((sum, p) => sum + (p.prix * p.quantite), 0);

    // Sauvegarder
    const { error: dbError } = await supabase.from('historique').insert({
      num,
      type,
      client,
      email,
      telephone,
      adresse,
      prestations,
      total_ht,
      statut: 'envoyé',
      date_envoi: new Date().toISOString(),
      source: 'app',
      temps_generation: Math.round((Date.now() - startTime) / 1000)
    });

    if (dbError) throw dbError;

    // Email si activé et adresse fournie
    if (CONFIG.features.email_auto && email) {
      console.log('📧 Préparation email pour:', email);
      const typeLabel = type === 'devis' ? 'Devis' : 'Facture';
      const subject = `${typeLabel} SINELEC ${num}`;
      const html = type === 'devis' ? CONFIG.email.template_devis : CONFIG.email.template_facture;

      await envoyerEmail(
  email, subject, 
  html.replace('{num}', num),
  pdf_base64 ? { content: pdf_base64, name: `${num}.pdf` } : null
);
    }

    await logSystem('generer', `${type} ${num} créé`, { client, total_ht }, true);

    res.json({ success: true, num, total_ht });
  } catch (error) {
    console.error('Erreur génération:', error);
    await logSystem('generer', 'Erreur génération', { error: error.message }, false, error);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// API: CHATBOT CLAUDE (parsing chantier)
// ═══════════════════════════════════════════════════════════════

app.post('/api/chat', async (req, res) => {
  if (!CONFIG.features.chatbot_claude) {
    return res.status(403).json({ error: 'Feature désactivée' });
  }

  try {
    const { message } = req.body;

    const grille = await chargerGrilleTarifaire();
    if (!grille) throw new Error('Impossible de charger la grille tarifaire');

    const prompt = `Tu es un assistant pour SINELEC Paris, électricien. Le client décrit son chantier. Analyse et génère un panier.

GRILLE TARIFAIRE:
${JSON.stringify(grille, null, 2)}

MESSAGE CLIENT: "${message}"

RÉPONDS EN JSON:
{
  "prestations": [
    { "code": "prise", "nom": "Prise électrique", "quantite": 2, "prix": 90 }
  ],
  "explication": "J'ai détecté..."
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const result = jsonMatch ? JSON.parse(jsonMatch[0]) : { prestations: [], explication: text };

    await logSystem('chatbot', 'Parsing chantier réussi', { message, result }, true);

    res.json(result);
  } catch (error) {
    console.error('Erreur chatbot:', error);
    await logSystem('chatbot', 'Erreur parsing', { error: error.message }, false, error);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// API: SIGNATURE CLIENT
// ═══════════════════════════════════════════════════════════════

app.post('/api/signature', async (req, res) => {
  if (!CONFIG.features.signature_client) {
    return res.status(403).json({ error: 'Feature désactivée' });
  }

  try {
    const { num, signature } = req.body;

    // Sauvegarder signature
    await supabase.from('signatures').insert({ num, signature });

    // Mettre à jour devis
    await supabase.from('historique')
      .update({ 
        signature, 
        statut: 'signé',
        date_signature: new Date().toISOString()
      })
      .eq('num', num);

    await logSystem('signature', `Devis ${num} signé`, { num }, true);

    res.json({ success: true });
  } catch (error) {
    console.error('Erreur signature:', error);
    await logSystem('signature', 'Erreur signature', { error: error.message }, false, error);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// API: HISTORIQUE
// ═══════════════════════════════════════════════════════════════

app.get('/api/historique', async (req, res) => {
  if (!CONFIG.features.historique) {
    return res.status(403).json({ error: 'Feature désactivée' });
  }

  try {
    const { type } = req.query;
    
    let query = supabase.from('historique').select('*').order('created_at', { ascending: false });
    
    if (type && type !== 'tous') {
      query = query.eq('type', type);
    }

    const { data, error } = await query;
    if (error) throw error;

    res.json(data || []);
  } catch (error) {
    console.error('Erreur historique:', error);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// API: CLIENTS (agrégés)
// ═══════════════════════════════════════════════════════════════

app.get('/api/clients', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('clients')
      .select('*')
      .order('ca_total', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error('Erreur clients:', error);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// API: RAPPORT INTERVENTION
// ═══════════════════════════════════════════════════════════════

app.post('/api/rapport', async (req, res) => {
  if (!CONFIG.features.rapports_intervention) {
    return res.status(403).json({ error: 'Feature désactivée' });
  }

  try {
    const { client, adresse, chantier, photo_avant, photo_apres, signature } = req.body;

    // Générer numéro rapport
    const compteur = await incrementerCompteur('rapport');
    const num = `R-${new Date().getFullYear()}-${String(compteur).padStart(3, '0')}`;

    // Claude génère description travaux
    const prompt = `Rédige une description professionnelle des travaux pour ce rapport d'intervention:
Chantier: ${chantier}
Client: ${client}
Adresse: ${adresse}

Décris les travaux réalisés de manière claire et professionnelle (2-3 phrases max).`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }]
    });

    const travaux = response.content[0].text;

    // Sauvegarder
    await supabase.from('rapports').insert({
      num,
      client,
      adresse,
      travaux,
      photo_avant,
      photo_apres,
      signature
    });

    await logSystem('rapport', `Rapport ${num} créé`, { client }, true);

    res.json({ success: true, num, travaux });
  } catch (error) {
    console.error('Erreur rapport:', error);
    await logSystem('rapport', 'Erreur création', { error: error.message }, false, error);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// API: GRILLE TARIFAIRE
// ═══════════════════════════════════════════════════════════════

app.get('/api/grille', async (req, res) => {
  try {
    const grille = await chargerGrilleTarifaire();
    res.json(grille || {});
  } catch (error) {
    console.error('Erreur grille:', error);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// CRON: VEILLE TARIFAIRE AUTOMATIQUE
// ═══════════════════════════════════════════════════════════════

async function veilTarifaire() {
  if (!CONFIG.features.veille_tarifaire || !CONFIG.veille.enabled) {
    console.log('⏭️ Veille tarifaire désactivée');
    return;
  }

  console.log('🔍 Démarrage veille tarifaire...');
  
  try {
    // Charger toutes les prestations
    const { data: prestations, error } = await supabase
      .from('grille_tarifaire')
      .select('*')
      .eq('actif', true)
      .eq('ajustement_auto', true);

    if (error) throw error;

    const ajustements = [];

    for (const prestation of prestations) {
      try {
        // Claude analyse le marché pour cette prestation
        const prompt = `Analyse le marché Île-de-France pour cette prestation électrique:

PRESTATION: ${prestation.nom}
PRIX ACTUEL SINELEC: ${prestation.prix_ht}€ HT

SOURCES À CONSULTER:
${CONFIG.veille.sources.join(', ')}

RÉPONDS EN JSON:
{
  "prix_min": 80,
  "prix_max": 120,
  "prix_moyen": 95,
  "recommandation": 90,
  "sources": ["source1.fr", "source2.fr"],
  "explication": "Le marché IDF se situe entre..."
}

Recommande un prix COMPÉTITIF (stratégie: ${CONFIG.veille.strategie}).`;

        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 500,
          messages: [{ role: 'user', content: prompt }],
          tools: [{ type: 'web_search_20250305', name: 'web_search' }]
        });

        const text = response.content.find(c => c.type === 'text')?.text || '';
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        
        if (!jsonMatch) continue;

        const analyse = JSON.parse(jsonMatch[0]);
        
        // Calculer ajustement
        const ecart_pct = ((analyse.recommandation - prestation.prix_ht) / prestation.prix_ht) * 100;
        
        // Appliquer seuil validation
        const auto_apply = Math.abs(ecart_pct) < CONFIG.veille.seuil_validation;

        if (auto_apply && CONFIG.veille.ajustement_auto) {
          // Mettre à jour automatiquement
          await supabase.from('grille_tarifaire')
            .update({
              prix_ht: analyse.recommandation,
              marche_min: analyse.prix_min,
              marche_max: analyse.prix_max,
              marche_moyen: analyse.prix_moyen,
              derniere_analyse: new Date().toISOString(),
              sources_analyse: analyse.sources
            })
            .eq('code', prestation.code);

          // Historique
          await supabase.from('historique_prix').insert({
            prestation_code: prestation.code,
            prix_ht: analyse.recommandation,
            marche_min: analyse.prix_min,
            marche_max: analyse.prix_max,
            raison_changement: 'Analyse marché automatique',
            changed_by: 'system'
          });

          ajustements.push({
            prestation: prestation.nom,
            ancien: prestation.prix_ht,
            nouveau: analyse.recommandation,
            ecart_pct: ecart_pct.toFixed(1),
            auto: true
          });
        } else {
          ajustements.push({
            prestation: prestation.nom,
            ancien: prestation.prix_ht,
            recommandation: analyse.recommandation,
            ecart_pct: ecart_pct.toFixed(1),
            auto: false,
            raison: 'Nécessite validation (écart > ' + CONFIG.veille.seuil_validation + '%)'
          });
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (err) {
        console.error(`Erreur analyse ${prestation.nom}:`, err);
      }
    }

    // Email rapport si activé
    if (CONFIG.veille.email_rapport && ajustements.length > 0) {
      const html = `
        <h2>📊 Rapport Veille Tarifaire</h2>
        <p>Date: ${new Date().toLocaleDateString('fr-FR')}</p>
        <h3>Ajustements effectués automatiquement:</h3>
        <ul>
          ${ajustements.filter(a => a.auto).map(a => 
            `<li><strong>${a.prestation}</strong>: ${a.ancien}€ → ${a.nouveau}€ (${a.ecart_pct > 0 ? '+' : ''}${a.ecart_pct}%)</li>`
          ).join('')}
        </ul>
        <h3>Ajustements nécessitant validation:</h3>
        <ul>
          ${ajustements.filter(a => !a.auto).map(a => 
            `<li><strong>${a.prestation}</strong>: ${a.ancien}€ → ${a.recommandation}€ (${a.ecart_pct > 0 ? '+' : ''}${a.ecart_pct}%) - ${a.raison}</li>`
          ).join('')}
        </ul>
      `;

      await envoyerEmail(
        CONFIG.veille.destinataire,
        '📊 Rapport Veille Tarifaire SINELEC',
        html
      );
    }

    await logSystem('veille', 'Veille tarifaire terminée', { nb_ajustements: ajustements.length }, true);
    console.log('✅ Veille tarifaire terminée:', ajustements.length, 'ajustements');

  } catch (error) {
    console.error('❌ Erreur veille tarifaire:', error);
    await logSystem('veille', 'Erreur veille', { error: error.message }, false, error);
  }
}

// Cron veille tarifaire (selon config)
if (CONFIG.veille.enabled) {
  const cronExpression = CONFIG.veille.frequence === 'quotidien'
    ? `0 ${CONFIG.veille.heure.split(':')[0]} * * *`
    : `0 ${CONFIG.veille.heure.split(':')[0]} * * ${CONFIG.veille.jour_semaine}`;

  cron.schedule(cronExpression, veilTarifaire);
  console.log(`📅 Veille tarifaire programmée: ${CONFIG.veille.frequence} à ${CONFIG.veille.heure}`);
}

// ═══════════════════════════════════════════════════════════════
// CRON: RELANCES AUTOMATIQUES
// ═══════════════════════════════════════════════════════════════

async function relancesAuto() {
  if (!CONFIG.features.relances_auto || !CONFIG.relances.enabled) {
    console.log('⏭️ Relances auto désactivées');
    return;
  }

  console.log('📧 Démarrage relances automatiques...');

  try {
    // Chercher devis non signés
    const { data: devis, error } = await supabase
      .from('historique')
      .select('*')
      .eq('type', 'devis')
      .eq('statut', 'envoyé')
      .lt('nb_relances', CONFIG.relances.nb_relances_max);

    if (error) throw error;

    const maintenant = new Date();
    let nb_relances = 0;

    for (const d of devis) {
      const date_envoi = new Date(d.date_envoi);
      const date_derniere_relance = d.date_derniere_relance ? new Date(d.date_derniere_relance) : null;
      
      const heures_depuis_envoi = (maintenant - date_envoi) / (1000 * 60 * 60);
      const heures_depuis_relance = date_derniere_relance 
        ? (maintenant - date_derniere_relance) / (1000 * 60 * 60)
        : Infinity;

      let doit_relancer = false;

      if (d.nb_relances === 0 && heures_depuis_envoi >= CONFIG.relances.delai_premiere_relance) {
        doit_relancer = true;
      } else if (d.nb_relances === 1 && heures_depuis_relance >= CONFIG.relances.delai_deuxieme_relance) {
        doit_relancer = true;
      }

      if (doit_relancer && d.email) {
        const template = d.nb_relances === 0 ? CONFIG.relances.template_1 : CONFIG.relances.template_2;
        const message = template.replace('{num}', d.num);

        await envoyerEmail(
          d.email,
          `Relance - Devis SINELEC ${d.num}`,
          `<p>${message}</p>`
        );

        await supabase.from('historique')
          .update({
            nb_relances: d.nb_relances + 1,
            date_derniere_relance: maintenant.toISOString(),
            statut: 'relancé'
          })
          .eq('num', d.num);

        nb_relances++;
      }
    }

    await logSystem('relances', 'Relances terminées', { nb_relances }, true);
    console.log(`✅ ${nb_relances} relance(s) envoyée(s)`);

  } catch (error) {
    console.error('❌ Erreur relances:', error);
    await logSystem('relances', 'Erreur relances', { error: error.message }, false, error);
  }
}

// Cron relances (quotidien)
if (CONFIG.relances.enabled) {
  cron.schedule('0 10 * * *', relancesAuto); // Tous les jours à 10h
  console.log('📅 Relances auto programmées: quotidien à 10h');
}

// ═══════════════════════════════════════════════════════════════
// ENDPOINT MANUEL: LANCER VEILLE MAINTENANT
// ═══════════════════════════════════════════════════════════════

app.post('/api/veille/lancer', async (req, res) => {
  if (!CONFIG.features.veille_tarifaire) {
    return res.status(403).json({ error: 'Feature désactivée' });
  }

  try {
    await veilTarifaire();
    res.json({ success: true, message: 'Veille tarifaire lancée' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ENDPOINT MANUEL: LANCER RELANCES MAINTENANT
// ═══════════════════════════════════════════════════════════════

app.post('/api/relances/lancer', async (req, res) => {
  if (!CONFIG.features.relances_auto) {
    return res.status(403).json({ error: 'Feature désactivée' });
  }

  try {
    await relancesAuto();
    res.json({ success: true, message: 'Relances lancées' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// DÉMARRAGE SERVEUR
// ═══════════════════════════════════════════════════════════════

app.listen(PORT, () => {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  ⚡ SINELEC OS v' + CONFIG.meta.version + ' - Serveur démarré !');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  📍 URL: http://localhost:' + PORT);
  console.log('  🔧 Mode: ' + (CONFIG.dev.debug_mode ? 'DEBUG' : 'PRODUCTION'));
  console.log('');
  console.log('  ✅ Features actives:');
  Object.entries(CONFIG.features)
    .filter(([k, v]) => v === true)
    .forEach(([k]) => console.log('     • ' + k));
  console.log('');
  console.log('  🤖 Crons programmés:');
  if (CONFIG.veille.enabled) {
    console.log('     • Veille tarifaire: ' + CONFIG.veille.frequence + ' à ' + CONFIG.veille.heure);
  }
  if (CONFIG.relances.enabled) {
    console.log('     • Relances auto: quotidien à 10h');
  }
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
});
